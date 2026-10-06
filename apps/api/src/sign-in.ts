// Email sign-in links. One function issues them (used by `POST /auth/request`
// and the /connect form); the `/auth/verify` routes redeem them.
//
// The link token is 256-bit, stored only as `auth:magic:<sha256>` in AUTH_KV
// for 15 minutes, and consumed by a POST from a confirm page, never by the
// GET, so inbox link scanners that prefetch URLs cannot burn it.

import { hashToken, normalizeEmail, randomSecret } from "./auth";
import { resolveAllowedOrigin } from "./cors";
import { sendSignInEmail } from "./email";
import type { Env } from "./env";
import { publicOrigin } from "./origins";
import {
  checkRateLimits,
  clientIpFor,
  MAGIC_LINK_EMAIL,
  MAGIC_LINK_IP,
} from "./rate-limit";

export const MAGIC_TTL_SECONDS = 900;
// KV's minimum TTL; the code only has to survive one redirect.
export const AUTH_CODE_TTL_SECONDS = 60;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value);
}

export interface MagicRecord {
  email: string;
  // App origin to return to with a one-time `?code=`; null means /connect.
  returnTo: string | null;
}

export interface AuthCodeRecord {
  token: string;
  email: string;
}

export type RequestLinkResult =
  | { ok: true }
  | { ok: false; status: 400 | 429; error: string; retryAfter?: number };

// `returnTo` must be exactly one of the app origins this Worker serves (the
// local dev ports only while running locally). Anything else is dropped so
// a sign-in link can never hand a code to a foreign site.
export function resolveReturnTo(
  request: Request,
  candidate: unknown
): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return null;
  }
  const probe = new Request(request.url, { headers: { origin: candidate } });
  return resolveAllowedOrigin(probe);
}

export async function requestSignInLink(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  rawEmail: string,
  returnTo: string | null
): Promise<RequestLinkResult> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: "Enter a valid email address." };
  }
  const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
    [MAGIC_LINK_IP, clientIpFor(request)],
    [MAGIC_LINK_EMAIL, email],
  ]);
  if (!limit.ok) {
    return {
      ok: false,
      status: 429,
      error: "Too many sign-in requests. Try again later.",
      retryAfter: limit.retryAfterSeconds,
    };
  }
  const token = randomSecret();
  const key = `auth:magic:${await hashToken(token)}`;
  const record: MagicRecord = { email, returnTo };
  await env.AUTH_KV.put(key, JSON.stringify(record), {
    expirationTtl: MAGIC_TTL_SECONDS,
  });
  const link = `${publicOrigin(request)}/auth/verify?t=${encodeURIComponent(token)}`;
  sendSignInEmail(env, ctx, { to: email, link, purpose: "sign in" }, () =>
    env.AUTH_KV.delete(key)
  );
  return { ok: true };
}

export async function readMagicRecord(
  env: Env,
  token: string
): Promise<MagicRecord | null> {
  return await env.AUTH_KV.get<MagicRecord>(
    `auth:magic:${await hashToken(token)}`,
    "json"
  );
}

// Single use: the record is deleted before the caller mints anything.
export async function consumeMagicRecord(
  env: Env,
  token: string
): Promise<MagicRecord | null> {
  const key = `auth:magic:${await hashToken(token)}`;
  const record = await env.AUTH_KV.get<MagicRecord>(key, "json");
  if (!record) {
    return null;
  }
  await env.AUTH_KV.delete(key);
  return record;
}

export async function storeAuthCode(
  env: Env,
  record: AuthCodeRecord
): Promise<string> {
  const code = randomSecret();
  await env.AUTH_KV.put(
    `auth:code:${await hashToken(code)}`,
    JSON.stringify(record),
    { expirationTtl: AUTH_CODE_TTL_SECONDS }
  );
  return code;
}

export async function consumeAuthCode(
  env: Env,
  code: string
): Promise<AuthCodeRecord | null> {
  const key = `auth:code:${await hashToken(code)}`;
  const record = await env.AUTH_KV.get<AuthCodeRecord>(key, "json");
  if (!record) {
    return null;
  }
  await env.AUTH_KV.delete(key);
  return record;
}
