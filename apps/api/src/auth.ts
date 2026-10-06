// Caller resolution and the `mcp_tokens` table.
//
// A bearer is accepted from the `Authorization` header or the session cookie
// and resolves in this order:
//   1. KV `auth:session:<sha256>` — browser sessions minted by the email link
//      (7-day TTL). Always write scope.
//   2. D1 `mcp_tokens` by `token_hash` — personal tokens (no expiry until
//      revoked) and session rows (browser + OAuth) that have not expired.
// Only SHA-256 hashes of bearers are ever stored; the plaintext exists in
// memory during a request and in the response that hands it to its owner.

import type { Env, TokenScope } from "./env";
import { isLocalRequest } from "./origins";

const BEARER_PREFIX = "Bearer ";

export const SESSION_COOKIE = "session";

export interface Caller {
  email: string;
  isAdmin: boolean;
  scope: TokenScope;
}

export type McpTokenKind = "personal" | "session";

export interface McpTokenRow {
  id: string;
  user_email: string;
  token_hash: string;
  label: string | null;
  status: "active" | "revoked";
  kind: McpTokenKind;
  scope: TokenScope;
  created_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
  expires_at: number | null;
}

export type AuthFailureReason =
  | "no_bearer"
  | "unknown_token"
  | "expired_token"
  | "revoked_token";

export type ResolveCallerResult =
  | { caller: Caller; reason: null; tokenId: string | null }
  | { caller: null; reason: AuthFailureReason; tokenId: null };

export interface StoredSession {
  email: string;
  createdAt: number;
}

const TOKEN_COLUMNS =
  "id, user_email, token_hash, label, status, kind, scope, created_at, revoked_at, last_used_at, expires_at";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAdminEmail(email: string, env: Env): boolean {
  const configured = env.ADMIN_EMAILS ?? "";
  if (!configured.trim()) {
    return false;
  }
  const target = normalizeEmail(email);
  return configured
    .split(",")
    .map(normalizeEmail)
    .some((entry) => entry.length > 0 && entry === target);
}

// SHA-256 of the raw token, lowercase hex.
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  let hex = "";
  for (const b of new Uint8Array(digest)) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

const BASE64_PLUS_RE = /\+/g;
const BASE64_SLASH_RE = /\//g;
const BASE64_PAD_RE = /=+$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(BASE64_PLUS_RE, "-")
    .replace(BASE64_SLASH_RE, "_")
    .replace(BASE64_PAD_RE, "");
}

// 256-bit random secret, base64url. Used for every bearer, magic link, code
// and client secret this Worker issues.
export function randomSecret(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// Cookies this Worker sets are `__Host-<name>` in production (Secure,
// Path=/, no Domain, so a sibling subdomain cannot plant or overwrite them)
// and plain `<name>` on http localhost, where Secure cookies are rejected.
// Production never reads the unprefixed name.
export function hostCookieName(request: Request, name: string): string {
  return isLocalRequest(new URL(request.url)) ? name : `__Host-${name}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) {
    return null;
  }
  const needle = `${name}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(needle)) {
      const value = trimmed.slice(needle.length).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

export function readHostCookie(request: Request, name: string): string | null {
  return readCookie(request, hostCookieName(request, name));
}

export function readSessionCookie(request: Request): string | null {
  return readHostCookie(request, SESSION_COOKIE);
}

export function readBearer(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header?.startsWith(BEARER_PREFIX)) {
    const value = header.slice(BEARER_PREFIX.length).trim();
    if (value.length > 0) {
      return value;
    }
  }
  return readSessionCookie(request);
}

// Constant-time comparison of two equal-length hex digests.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: constant-time compare needs XOR/OR
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function resolveCaller(
  request: Request,
  env: Env
): Promise<ResolveCallerResult> {
  const bearer = readBearer(request);
  if (!bearer) {
    return { caller: null, reason: "no_bearer", tokenId: null };
  }
  return await resolveBearer(bearer, env);
}

export async function resolveBearer(
  bearer: string,
  env: Env
): Promise<ResolveCallerResult> {
  const tokenHash = await hashToken(bearer);
  const session = await env.AUTH_KV.get<StoredSession>(
    `auth:session:${tokenHash}`,
    "json"
  );
  if (session) {
    return {
      caller: {
        email: session.email,
        isAdmin: isAdminEmail(session.email, env),
        scope: "write",
      },
      reason: null,
      tokenId: null,
    };
  }
  const row = await env.DB.prepare(
    `SELECT ${TOKEN_COLUMNS} FROM mcp_tokens WHERE token_hash = ? LIMIT 1`
  )
    .bind(tokenHash)
    .first<McpTokenRow>();
  if (!row) {
    return { caller: null, reason: "unknown_token", tokenId: null };
  }
  if (row.status !== "active" || row.revoked_at !== null) {
    return { caller: null, reason: "revoked_token", tokenId: null };
  }
  if (row.expires_at !== null && row.expires_at <= Date.now()) {
    return { caller: null, reason: "expired_token", tokenId: null };
  }
  return {
    caller: {
      email: row.user_email,
      isAdmin: isAdminEmail(row.user_email, env),
      scope: row.scope === "read" ? "read" : "write",
    },
    reason: null,
    tokenId: row.id,
  };
}

// `last_used_at` is informational; callers pass the promise to waitUntil.
export async function touchToken(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE mcp_tokens SET last_used_at = ? WHERE id = ? AND status = 'active'"
    )
    .bind(Date.now(), id)
    .run();
}

export async function listTokens(
  db: D1Database,
  email: string,
  kind: McpTokenKind
): Promise<McpTokenRow[]> {
  const result = await db
    .prepare(
      `SELECT ${TOKEN_COLUMNS} FROM mcp_tokens WHERE user_email = ? AND kind = ? ORDER BY created_at DESC`
    )
    .bind(normalizeEmail(email), kind)
    .all<McpTokenRow>();
  return result.results ?? [];
}

export async function findTokenById(
  db: D1Database,
  id: string
): Promise<McpTokenRow | null> {
  const row = await db
    .prepare(`SELECT ${TOKEN_COLUMNS} FROM mcp_tokens WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<McpTokenRow>();
  return row ?? null;
}

export interface CreateTokenInput {
  email: string;
  token: string;
  label: string | null;
  kind: McpTokenKind;
  scope: TokenScope;
  expiresAt: number | null;
}

export async function createToken(
  db: D1Database,
  input: CreateTokenInput
): Promise<McpTokenRow> {
  const row: McpTokenRow = {
    id: crypto.randomUUID(),
    user_email: normalizeEmail(input.email),
    token_hash: await hashToken(input.token),
    label: input.label,
    status: "active",
    kind: input.kind,
    scope: input.scope,
    created_at: Date.now(),
    revoked_at: null,
    last_used_at: null,
    expires_at: input.expiresAt,
  };
  await db
    .prepare(
      "INSERT INTO mcp_tokens (id, user_email, token_hash, label, status, kind, scope, created_at, expires_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)"
    )
    .bind(
      row.id,
      row.user_email,
      row.token_hash,
      row.label,
      row.kind,
      row.scope,
      row.created_at,
      row.expires_at
    )
    .run();
  return row;
}

export async function revokeTokenRow(
  db: D1Database,
  id: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE mcp_tokens SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'"
    )
    .bind(Date.now(), id)
    .run();
}

// Only revoked rows can be deleted, so a delete never silently kills a token
// that is still in use.
export async function deleteTokenRow(
  db: D1Database,
  id: string
): Promise<void> {
  await db
    .prepare("DELETE FROM mcp_tokens WHERE id = ? AND status = 'revoked'")
    .bind(id)
    .run();
}

export async function revokeSessionByToken(
  db: D1Database,
  token: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE mcp_tokens SET status = 'revoked', revoked_at = ? WHERE token_hash = ? AND kind = 'session' AND status = 'active'"
    )
    .bind(Date.now(), await hashToken(token))
    .run();
}
