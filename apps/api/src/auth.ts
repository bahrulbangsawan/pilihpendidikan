// Caller resolution and the `mcp_tokens` table.
//
// A bearer is accepted from the `Authorization` header or the session cookie
// and resolves in this order:
//   1. KV `auth:session:<sha256>` — browser sessions minted by the email link
//      (7-day TTL). Always write scope.
//   2. D1 `mcp_tokens` by `token_hash` — personal tokens (no expiry until
//      revoked), session rows (browser + MCP OAuth) and `oauth` rows (CLI
//      access tokens with structured `scopes`, 17) that have not expired.
// Only SHA-256 hashes of bearers are ever stored; the plaintext exists in
// memory during a request and in the response that hands it to its owner.
//
// Every resolved caller also carries the Job Tracker identity (03 §2, PLAN
// C4): the canonical `userId` from the lazily created `users` row, the OAuth
// `scopes` of 05 §1.2, the credential kind, and the device / grant / token
// ids of the bearer. The three legacy fields `{email, isAdmin, scope}` keep
// their meaning, so every pre-existing consumer works unchanged.

import type {
  CredentialKind,
  OAuthScope,
} from "@pilihpendidikan/jobs-contracts/enums";
import { MCP_CLIENT_SCOPE } from "@pilihpendidikan/jobs-contracts/enums";
import type { Env, TokenScope } from "./env";
import { legacyScopeFor, scopesForCredential } from "./jobs/core/scopes";
import {
  backfillTokenUserId,
  ensureUser,
  findUserById,
} from "./jobs/repo/core/users";
import { isLocalRequest } from "./origins";

const BEARER_PREFIX = "Bearer ";

export const SESSION_COOKIE = "session";

// Label of the `mcp_tokens` row behind every browser session (session.ts).
// `kind='session'` rows with any other label are MCP OAuth access tokens.
export const BROWSER_SESSION_LABEL = "Browser session";

// The legacy shape every document route, MCP tool and test literal uses.
// The Job Tracker fields are optional here so `{email, isAdmin, scope}`
// literals stay valid; `resolveCaller` always fills them (`ResolvedCaller`).
export interface Caller {
  email: string;
  isAdmin: boolean;
  scope: TokenScope;
  // Canonical `users.id` (`usr_…`, 03 §2).
  userId?: string;
  // OAuth scopes of the credential (05 §1.2).
  scopes?: readonly OAuthScope[];
  // `devices.id` of a CLI access token bound to a registered device.
  deviceId?: string | null;
  // `oauth_grants.id` of an OAuth access token.
  grantId?: string | null;
  credentialKind?: CredentialKind;
  // `mcp_tokens.id` (null for a browser session served from KV).
  tokenId?: string | null;
}

// What `resolveCaller` returns: every field is set.
export interface ResolvedCaller extends Caller {
  userId: string;
  scopes: readonly OAuthScope[];
  deviceId: string | null;
  grantId: string | null;
  credentialKind: CredentialKind;
  tokenId: string | null;
  // `users.deleted_at` (account deletion in progress, 11 §10). The /api/v1
  // router refuses tombstoned identities with 401 revoked_token.
  userDeletedAt: number | null;
}

export type McpTokenKind = "personal" | "session" | "oauth";

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
  user_id: string | null;
  scopes: string | null;
  grant_id: string | null;
  device_id: string | null;
}

export type AuthFailureReason =
  | "no_bearer"
  | "unknown_token"
  | "expired_token"
  | "revoked_token";

export type ResolveCallerResult =
  | { caller: ResolvedCaller; reason: null; tokenId: string | null }
  | {
      caller: null;
      reason: AuthFailureReason;
      tokenId: null;
      // Set when a revoked token belongs to a deleted account (11 §10): the
      // CLI wipes its local state only then; any other revocation keeps the
      // outbox for the next login (20 §5.3).
      revokedReason?: "account_deleted";
    };

export interface StoredSession {
  email: string;
  createdAt: number;
}

const TOKEN_COLUMNS =
  "id, user_email, token_hash, label, status, kind, scope, created_at, revoked_at, last_used_at, expires_at, user_id, scopes, grant_id, device_id";

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
    const email = normalizeEmail(session.email);
    const user = await ensureUser(env.DB, email, Date.now());
    return {
      caller: {
        email,
        isAdmin: isAdminEmail(email, env),
        scope: "write",
        userId: user.id,
        scopes: scopesForCredential("browser_session"),
        deviceId: null,
        grantId: null,
        credentialKind: "browser_session",
        tokenId: null,
        userDeletedAt: user.deleted_at,
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
    const owner =
      row.user_id === null ? null : await findUserById(env.DB, row.user_id);
    return owner?.deleted_at == null
      ? { caller: null, reason: "revoked_token", tokenId: null }
      : {
          caller: null,
          reason: "revoked_token",
          tokenId: null,
          revokedReason: "account_deleted",
        };
  }
  if (row.expires_at !== null && row.expires_at <= Date.now()) {
    return { caller: null, reason: "expired_token", tokenId: null };
  }
  const email = normalizeEmail(row.user_email);
  const user = await ensureUser(env.DB, email, Date.now());
  if (row.user_id === null) {
    await backfillTokenUserId(env.DB, row.id, user.id);
  }
  const credentialKind = credentialKindOf(row);
  const scopes = scopesForCredential(credentialKind, row.scopes);
  return {
    caller: {
      email,
      isAdmin: isAdminEmail(email, env),
      scope: legacyScopeOf(row, scopes),
      userId: user.id,
      scopes,
      deviceId: row.device_id,
      grantId: row.grant_id,
      credentialKind,
      tokenId: row.id,
      userDeletedAt: user.deleted_at,
    },
    reason: null,
    tokenId: row.id,
  };
}

// `oauth` rows derive the legacy scope from their OAuth scopes (17 §5.2);
// older kinds keep their stored `write`/`read`.
function legacyScopeOf(
  row: Pick<McpTokenRow, "kind" | "scope">,
  scopes: readonly string[]
): TokenScope {
  if (row.kind === "oauth") {
    return legacyScopeFor(scopes);
  }
  return row.scope === "read" ? "read" : "write";
}

// 05 §1.2: which credential a token row is.
//   personal → personal_write | personal_read (by `scope`)
//   session  → browser_session when it backs a browser sign-in, else the
//              access token of an MCP OAuth (DCR) client
//   oauth    → oauth_mcp when its scopes carry the DCR `mcp` ceiling, else a
//              scoped first-party (CLI) token
export function credentialKindOf(
  row: Pick<McpTokenRow, "kind" | "label" | "scope" | "scopes">
): CredentialKind {
  if (row.kind === "personal") {
    return row.scope === "read" ? "personal_read" : "personal_write";
  }
  if (row.kind === "session") {
    return row.label === BROWSER_SESSION_LABEL
      ? "browser_session"
      : "oauth_mcp";
  }
  const declared = (row.scopes ?? "").split(" ");
  return declared.includes(MCP_CLIENT_SCOPE) ? "oauth_mcp" : "oauth_cli";
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
  // Job Tracker links (04 §1); all optional for legacy callers.
  userId?: string | null;
  scopes?: string | null;
  grantId?: string | null;
  deviceId?: string | null;
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
    user_id: input.userId ?? null,
    scopes: input.scopes ?? null,
    grant_id: input.grantId ?? null,
    device_id: input.deviceId ?? null,
  };
  await db
    .prepare(
      "INSERT INTO mcp_tokens (id, user_email, token_hash, label, status, kind, scope, created_at, expires_at, user_id, scopes, grant_id, device_id) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      row.id,
      row.user_email,
      row.token_hash,
      row.label,
      row.kind,
      row.scope,
      row.created_at,
      row.expires_at,
      row.user_id,
      row.scopes,
      row.grant_id,
      row.device_id
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
