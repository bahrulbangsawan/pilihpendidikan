// The BFF session (D-15, job-tracker-spec 12 §1): the API browser-session
// bearer lives only server-side, sealed with AES-256-GCM into the
// `__Host-jobs-session` cookie, so the BFF needs no session store. The value is
// `v1.<iv>.<ciphertext>` (base64url); the cookie name and the version are bound
// as additional authenticated data, so a value minted for another cookie or
// format never opens. Any tamper, a wrong key or an expired `exp` reads as
// "signed out".

import { z } from "zod";
import { readCookie } from "./cookies";

const SEAL_VERSION = "v1";
const IV_BYTES = 12;
const MIN_SECRET_LENGTH = 16;
/** Sealed values above this are refused unread (a cookie holds ~4 KB). */
const MAX_SEALED_LENGTH = 3800;

export interface BffSession {
  /** The API browser-session bearer. Never leaves the Worker. */
  bearer: string;
  email: string;
  /** Epoch ms after which the session is dead (bearer expiry). */
  exp: number;
}

const SessionPayloadSchema = z.object({
  bearer: z.string().min(16).max(512),
  email: z.string().min(3).max(254),
  exp: z.number().int().positive(),
});

const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;
const TRAILING_PADDING_RE = /=+$/;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(TRAILING_PADDING_RE, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL_RE.test(value)) {
    return null;
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/**
 * The AES-256 key for `secret`: SHA-256 of the secret's UTF-8 bytes, so any
 * sufficiently random string (base64, hex or raw) works as `BFF_COOKIE_KEY`.
 */
export function sessionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error("BFF_COOKIE_KEY is too short (use 32 random bytes).");
  }
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle
      .digest("SHA-256", encoder.encode(secret))
      .then((raw) =>
        crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
          "encrypt",
          "decrypt",
        ])
      );
    keyCache.set(secret, key);
  }
  return key;
}

function additionalData(cookieName: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${SEAL_VERSION}|${cookieName}`);
}

/** Seals `session` for the cookie called `cookieName`. */
export async function sealSession(
  session: BffSession,
  secret: string,
  cookieName: string
): Promise<string> {
  const payload = SessionPayloadSchema.parse(session);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(cookieName) },
    await sessionKey(secret),
    encoder.encode(JSON.stringify(payload))
  );
  return `${SEAL_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/**
 * Opens a sealed cookie value. Returns null for anything that is not a
 * current session this key sealed for this cookie: malformed, tampered,
 * sealed under another key or cookie name, or expired at `nowMs`.
 */
export async function openSession(
  sealed: string,
  secret: string,
  cookieName: string,
  nowMs: number
): Promise<BffSession | null> {
  if (sealed.length === 0 || sealed.length > MAX_SEALED_LENGTH) {
    return null;
  }
  const [version, ivPart, dataPart, ...rest] = sealed.split(".");
  if (version !== SEAL_VERSION || rest.length > 0 || !ivPart || !dataPart) {
    return null;
  }
  const iv = fromBase64Url(ivPart);
  const ciphertext = fromBase64Url(dataPart);
  if (!(iv && ciphertext) || iv.length !== IV_BYTES) {
    return null;
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(cookieName) },
      await sessionKey(secret),
      ciphertext
    );
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(plaintext));
  } catch {
    return null;
  }
  const result = SessionPayloadSchema.safeParse(parsed);
  if (!result.success || result.data.exp <= nowMs) {
    return null;
  }
  return result.data;
}

export interface CookieSession {
  session: BffSession | null;
  /** A cookie was sent but does not open (tampered, expired, rotated key). */
  stale: boolean;
}

/** The session carried by a `Cookie` header, if any opens. */
export async function sessionFromCookieHeader(
  cookieHeader: string | null | undefined,
  secret: string,
  cookieName: string,
  nowMs: number
): Promise<CookieSession> {
  const raw = readCookie(cookieHeader, cookieName);
  if (!raw) {
    return { session: null, stale: false };
  }
  const session = await openSession(raw, secret, cookieName, nowMs);
  return { session, stale: session === null };
}

/** What the browser may know about a session: never the bearer. */
export interface PublicSession {
  email: string | null;
  expiresAt: number | null;
  signedIn: boolean;
}

export function publicSession(session: BffSession | null): PublicSession {
  return {
    signedIn: session !== null,
    email: session?.email ?? null,
    expiresAt: session?.exp ?? null,
  };
}
