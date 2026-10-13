// Browser sessions: minted when someone confirms an email sign-in link.
// A session is a 256-bit bearer stored as `auth:session:<sha256>` in AUTH_KV
// (7-day TTL, the hot path) plus a `mcp_tokens` row of kind `session` with the
// same expiry (so it can be listed and revoked). The bearer travels in an
// HttpOnly cookie: `__Host-session` (Secure, Path=/, no Domain) in production,
// plain `session` on http localhost where Secure cookies are rejected.

import type { StoredSession } from "./auth";
import {
  BROWSER_SESSION_LABEL,
  createToken,
  hashToken,
  hostCookieName,
  normalizeEmail,
  randomSecret,
  revokeSessionByToken,
  SESSION_COOKIE,
} from "./auth";
import type { Env } from "./env";
import { ensureUser } from "./jobs/repo/core/users";
import { isLocalRequest } from "./origins";

export const SESSION_TTL_SECONDS = 604_800; // 7 days

// The D1 row is written before the KV record and awaited, so a sign-out that
// follows immediately always finds a row to revoke (a row written after the
// revoke would otherwise keep the bearer alive through the D1 fallback).
// Signing in is also where most users get their canonical `users` row
// (03 §2); the row id is recorded on the token. The label marks the row as a
// browser session for scope resolution (05 §1.2, `credentialKindOf`).
export async function createBrowserSession(
  env: Env,
  email: string
): Promise<string> {
  const token = randomSecret();
  const normalized = normalizeEmail(email);
  const user = await ensureUser(env.DB, normalized, Date.now());
  await createToken(env.DB, {
    email: normalized,
    token,
    label: BROWSER_SESSION_LABEL,
    kind: "session",
    scope: "write",
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    userId: user.id,
  });
  const session: StoredSession = { email: normalized, createdAt: Date.now() };
  await env.AUTH_KV.put(
    `auth:session:${await hashToken(token)}`,
    JSON.stringify(session),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return token;
}

// Deletes the KV session and revokes its D1 row. Awaited, so a sign-out is
// complete by the time the response is sent.
export async function endBrowserSession(
  env: Env,
  token: string
): Promise<void> {
  await env.AUTH_KV.delete(`auth:session:${await hashToken(token)}`);
  await revokeSessionByToken(env.DB, token);
}

// Builds a host-only cookie: `__Host-<name>; Secure` in production, plain
// `<name>` on http localhost. HttpOnly, SameSite=Lax, Path=/ always.
export function hostCookie(
  request: Request,
  name: string,
  value: string,
  maxAge: number
): string {
  const secure = isLocalRequest(new URL(request.url)) ? "" : " Secure;";
  return `${hostCookieName(request, name)}=${value}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function sessionCookie(request: Request, token: string): string {
  return hostCookie(request, SESSION_COOKIE, token, SESSION_TTL_SECONDS);
}

export function clearSessionCookie(request: Request): string {
  return hostCookie(request, SESSION_COOKIE, "", 0);
}
