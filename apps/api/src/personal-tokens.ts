// Personal tokens: long-lived bearers a signed-in user mints at /connect (or
// through `/auth/tokens`) and pastes into an app or an MCP client. Scope
// `write` can read and change documents; `read` can only read them and only
// receives the read-only MCP tools.

import type { Caller, McpTokenKind, McpTokenRow } from "./auth";
import {
  createToken,
  deleteTokenRow,
  findTokenById,
  listTokens,
  randomSecret,
  revokeTokenRow,
} from "./auth";
import type { Env, TokenScope } from "./env";
import { checkRateLimits, TOKEN_CREATE_EMAIL } from "./rate-limit";

export const MAX_LABEL_LENGTH = 60;

export interface PublicToken {
  id: string;
  label: string | null;
  kind: McpTokenKind;
  scope: TokenScope;
  status: "active" | "revoked";
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  expiresAt: number | null;
}

export function toPublicToken(row: McpTokenRow): PublicToken {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    scope: row.scope,
    status: row.status,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
  };
}

export function parseScope(value: unknown): TokenScope | null {
  if (value === undefined || value === null || value === "") {
    return "write";
  }
  return value === "write" || value === "read" ? value : null;
}

export function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().slice(0, MAX_LABEL_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

export function listPersonalTokens(
  env: Env,
  caller: Caller
): Promise<McpTokenRow[]> {
  return listTokens(env.DB, caller.email, "personal");
}

// Signed-in browsers and connected MCP clients (OAuth) that still work.
export async function listActiveSessions(
  env: Env,
  caller: Caller
): Promise<McpTokenRow[]> {
  const now = Date.now();
  const rows = await listTokens(env.DB, caller.email, "session");
  return rows.filter(
    (row) =>
      row.status === "active" &&
      (row.expires_at === null || row.expires_at > now)
  );
}

export type MintResult =
  | { ok: true; token: string; row: McpTokenRow }
  | { ok: false; status: 403 | 429; error: string; retryAfter?: number };

export async function mintPersonalToken(
  env: Env,
  caller: Caller,
  label: string | null,
  scope: TokenScope
): Promise<MintResult> {
  // A read-scoped bearer must not be able to mint itself a write token.
  if (caller.scope !== "write") {
    return { ok: false, status: 403, error: "insufficient_scope" };
  }
  const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
    [TOKEN_CREATE_EMAIL, caller.email],
  ]);
  if (!limit.ok) {
    return {
      ok: false,
      status: 429,
      error: "Too many new tokens. Try again later.",
      retryAfter: limit.retryAfterSeconds,
    };
  }
  const token = randomSecret();
  const row = await createToken(env.DB, {
    email: caller.email,
    token,
    label,
    kind: "personal",
    scope,
    expiresAt: null,
  });
  return { ok: true, token, row };
}

export type TokenChangeResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string };

// Another user's token answers 404, so ids are not an existence oracle.
async function ownedToken(
  env: Env,
  caller: Caller,
  id: string
): Promise<McpTokenRow | TokenChangeResult> {
  if (caller.scope !== "write") {
    return { ok: false, status: 403, error: "insufficient_scope" };
  }
  const row = await findTokenById(env.DB, id);
  if (!row || row.user_email !== caller.email) {
    return { ok: false, status: 404, error: "Token not found." };
  }
  return row;
}

export async function revokeOwnedToken(
  env: Env,
  caller: Caller,
  id: string
): Promise<TokenChangeResult> {
  const row = await ownedToken(env, caller, id);
  if ("ok" in row) {
    return row;
  }
  await revokeTokenRow(env.DB, row.id);
  if (row.kind === "session") {
    // Browser sessions are also cached in KV under the same hash.
    await env.AUTH_KV.delete(`auth:session:${row.token_hash}`);
  }
  return { ok: true };
}

export async function deleteOwnedToken(
  env: Env,
  caller: Caller,
  id: string
): Promise<TokenChangeResult> {
  const row = await ownedToken(env, caller, id);
  if ("ok" in row) {
    return row;
  }
  if (row.status !== "revoked") {
    return {
      ok: false,
      status: 400,
      error: "Revoke the token before deleting it.",
    };
  }
  await deleteTokenRow(env.DB, row.id);
  return { ok: true };
}
