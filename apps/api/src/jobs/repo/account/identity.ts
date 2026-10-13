// Account deletion in the identity database `DB` (04 §1, 11 §10, 17 §9).
//
//   revokeAccountStatements   step 1 + the tombstone: every grant (reason
//                             `account_deleted`), refresh token, device and
//                             access/personal/session token of the user, and
//                             `users.deleted_at` — one batch. Idempotent
//                             (only live rows change), so the purge re-runs it.
//   sessionTokenHashes        the KV browser sessions to drop
//                             (`auth:session:<hash>`) before revoking
//   hardDeleteStatements      step 5, 30 days later: the identity rows of a
//                             tombstoned user, children first (FKs)
//   listTombstonedUsers       the daily cron's scan (system)
//
// Legacy token rows may predate `mcp_tokens.user_id` (backfilled lazily), so
// tokens match by user id OR the normalized email.

import type { UserRow } from "../core/users";

/** Hashes of the user's live browser-session tokens (KV session keys). */
export async function sessionTokenHashes(
  identity: D1Database,
  user: { email: string; id: string }
): Promise<string[]> {
  const result = await identity
    .prepare(
      "SELECT token_hash FROM mcp_tokens WHERE (user_id = ? OR user_email = ?) AND kind = 'session' AND status = 'active'"
    )
    .bind(user.id, user.email)
    .all<{ token_hash: string }>();
  return (result.results ?? []).map((row) => row.token_hash);
}

/** Revokes every credential of the user and tombstones the account. */
export function revokeAccountStatements(
  identity: D1Database,
  user: { email: string; id: string },
  now: number
): D1PreparedStatement[] {
  return [
    identity
      .prepare(
        "UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
      )
      .bind(now, now, user.id),
    identity
      .prepare(
        "UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE revoked_at IS NULL AND grant_id IN (SELECT id FROM oauth_grants WHERE user_id = ?)"
      )
      .bind(now, user.id),
    identity
      .prepare(
        "UPDATE oauth_grants SET revoked_at = ?, revoked_reason = 'account_deleted' WHERE user_id = ? AND revoked_at IS NULL"
      )
      .bind(now, user.id),
    identity
      .prepare(
        "UPDATE devices SET revoked_at = ?, revision = revision + 1 WHERE user_id = ? AND revoked_at IS NULL"
      )
      .bind(now, user.id),
    identity
      .prepare(
        "UPDATE mcp_tokens SET status = 'revoked', revoked_at = ? WHERE (user_id = ? OR user_email = ?) AND status = 'active'"
      )
      .bind(now, user.id, user.email),
  ];
}

/** Runs one identity batch (a D1 batch is a transaction). */
export async function runIdentityStatements(
  identity: D1Database,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  if (statements.length > 0) {
    await identity.batch([...statements]);
  }
}

/** Tombstoned users whose `deleted_at` is before `before` (system scan). */
export async function listTombstonedUsers(
  identity: D1Database,
  input: { before: number; limit: number }
): Promise<UserRow[]> {
  const result = await identity
    .prepare(
      "SELECT id, email, created_at, updated_at, deleted_at FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at LIMIT ?"
    )
    .bind(input.before, input.limit)
    .all<UserRow>();
  return result.results ?? [];
}

/**
 * Removes the identity rows of a tombstoned user (11 §10 step 5): refresh
 * tokens, devices, tokens and grants, then the user row itself. The
 * `support_access_log` audit rows stay (no FK; 11 §9).
 */
export function hardDeleteStatements(
  identity: D1Database,
  user: { email: string; id: string }
): D1PreparedStatement[] {
  return [
    identity
      .prepare(
        "DELETE FROM oauth_refresh_tokens WHERE grant_id IN (SELECT id FROM oauth_grants WHERE user_id = ?)"
      )
      .bind(user.id),
    identity.prepare("DELETE FROM devices WHERE user_id = ?").bind(user.id),
    identity
      .prepare("DELETE FROM mcp_tokens WHERE user_id = ? OR user_email = ?")
      .bind(user.id, user.email),
    identity
      .prepare("DELETE FROM oauth_grants WHERE user_id = ?")
      .bind(user.id),
    identity
      .prepare("DELETE FROM users WHERE id = ? AND deleted_at IS NOT NULL")
      .bind(user.id),
  ];
}

export interface AccountIdentity {
  devices: Record<string, unknown>[];
  grants: Record<string, unknown>[];
  tokens: Record<string, unknown>[];
}

/**
 * The identity rows of an export (11 §10): devices, grants and token
 * metadata — never a hash or a secret.
 */
export async function accountIdentity(
  identity: D1Database,
  user: { email: string; id: string }
): Promise<AccountIdentity> {
  const [devices, grants, tokens] = await Promise.all([
    identity
      .prepare(
        "SELECT id, name, platform, arch, cli_version, capabilities, accepts_tasks, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = ? ORDER BY created_at, id"
      )
      .bind(user.id)
      .all<Record<string, unknown>>(),
    identity
      .prepare(
        "SELECT id, client_id, device_id, scopes, created_at, last_used_at, revoked_at, revoked_reason FROM oauth_grants WHERE user_id = ? ORDER BY created_at, id"
      )
      .bind(user.id)
      .all<Record<string, unknown>>(),
    identity
      .prepare(
        "SELECT id, label, kind, scope, scopes, status, created_at, last_used_at, expires_at, revoked_at FROM mcp_tokens WHERE user_id = ? OR user_email = ? ORDER BY created_at, id"
      )
      .bind(user.id, user.email)
      .all<Record<string, unknown>>(),
  ]);
  return {
    devices: devices.results ?? [],
    grants: grants.results ?? [],
    tokens: tokens.results ?? [],
  };
}
