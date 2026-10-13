// Grants, refresh tokens and first-party access tokens in the identity
// database `DB` (04 §1, 17 §6–§8).
//
//   oauth_grants          one consent by one user to one client on one device
//   oauth_refresh_tokens  hash only; a family is every row of one grant,
//                         chained by `parent_id`; `used_at` marks rotation
//   mcp_tokens            access tokens (`kind='oauth'`, `scopes`, `grant_id`,
//                         `device_id`, `user_id`)
//
// Writes are built as statements and run in ONE `batch()` (a D1 batch is a
// transaction). `identityGuard` aborts the whole batch when its condition is
// false at execution time, so a read-check-write cannot race (two concurrent
// refreshes of one token: exactly one commits).

import type { GrantRevokedReason } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import { hashToken, normalizeEmail } from "../auth";
import { legacyScopeFor } from "../jobs/core/scopes";
import { GuardFailedError, UniqueViolationError } from "../jobs/repo/core/db";
import {
  REFRESH_ABSOLUTE_TTL_MS,
  REFRESH_IDLE_TTL_MS,
  splitScopes,
} from "./shared";

export interface GrantRow {
  client_id: string;
  created_at: number;
  device_id: string | null;
  id: string;
  last_used_at: number | null;
  revoked_at: number | null;
  revoked_reason: GrantRevokedReason | null;
  scopes: string;
  user_id: string;
}

export interface RefreshRow {
  created_at: number;
  expires_at: number;
  grant_id: string;
  id: string;
  parent_id: string | null;
  revoked_at: number | null;
  token_hash: string;
  used_at: number | null;
}

const GRANT_COLUMNS =
  "id, user_id, client_id, device_id, scopes, created_at, last_used_at, revoked_at, revoked_reason";
const REFRESH_COLUMNS =
  "id, grant_id, token_hash, parent_id, created_at, expires_at, used_at, revoked_at";

// ---------------------------------------------------------------------------
// Guards and batches
// ---------------------------------------------------------------------------

// Same technique as the JOBS_DB kernel guard (src/jobs/repo/core/db.ts):
// json() on malformed text raises "malformed JSON" in SQLite and D1 alike,
// and the subquery keeps it from being constant-folded.
const GUARD_ABORT =
  "json('{\"identity_guard\":' || (SELECT count(*) FROM sqlite_master WHERE 0))";
const MALFORMED_JSON_RE = /malformed JSON/i;
const UNIQUE_RE =
  /UNIQUE constraint failed: ([^:\n]+?)(?::|\s*$|\s*\(|,\s*SQLITE)/i;
const guardLabels = new WeakMap<D1PreparedStatement, string>();

/** A batch statement that aborts the batch unless `EXISTS (conditionSql)`. */
export function identityGuard(
  db: D1Database,
  label: string,
  conditionSql: string,
  ...binds: Array<string | number | null>
): D1PreparedStatement {
  const statement = db
    .prepare(
      `SELECT CASE WHEN EXISTS (${conditionSql}) THEN 1 ELSE ${GUARD_ABORT} END AS identity_guard`
    )
    .bind(...binds);
  guardLabels.set(statement, label);
  return statement;
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error
      ? `${err.message} ${cause.message}`
      : err.message;
  }
  return String(err);
}

/**
 * Runs one transactional `DB` batch; a failed `identityGuard` becomes
 * `GuardFailedError`, a UNIQUE violation `UniqueViolationError`.
 */
export async function runIdentityBatch(
  db: D1Database,
  statements: readonly D1PreparedStatement[]
): Promise<D1Result[]> {
  if (statements.length === 0) {
    return [];
  }
  try {
    return await db.batch([...statements]);
  } catch (err) {
    const text = errorText(err);
    const label = statements
      .map((s) => guardLabels.get(s))
      .find((value) => value !== undefined);
    if (label !== undefined && MALFORMED_JSON_RE.test(text)) {
      throw new GuardFailedError(label);
    }
    const unique = UNIQUE_RE.exec(text);
    if (unique) {
      throw new UniqueViolationError(unique[1].trim());
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

export async function findGrant(
  db: D1Database,
  grantId: string
): Promise<GrantRow | null> {
  return await db
    .prepare(`SELECT ${GRANT_COLUMNS} FROM oauth_grants WHERE id = ? LIMIT 1`)
    .bind(grantId)
    .first<GrantRow>();
}

export interface NewGrant {
  clientId: string;
  id: string;
  now: number;
  /** Space-delimited granted scopes. */
  scopes: string;
  userId: string;
}

/** INSERT of a grant without a device (17 §4.3 step 5; bound later, §6). */
export function insertGrant(
  db: D1Database,
  grant: NewGrant
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO oauth_grants (id, user_id, client_id, device_id, scopes, created_at) VALUES (?, ?, ?, NULL, ?, ?)"
    )
    .bind(grant.id, grant.userId, grant.clientId, grant.scopes, grant.now);
}

/** Creates a grant row now (the consent decision). */
export async function createGrant(
  db: D1Database,
  input: Omit<NewGrant, "id">
): Promise<string> {
  const id = newId("grt", input.now);
  await insertGrant(db, { ...input, id }).run();
  return id;
}

/** `last_used_at` of a grant (informational; in the issuing batch). */
export function touchGrant(
  db: D1Database,
  grantId: string,
  now: number
): D1PreparedStatement {
  return db
    .prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?")
    .bind(now, grantId);
}

/**
 * Revokes a whole grant family (17 §7.2 step 4, §8, §9): the grant (the first
 * reason sticks), every refresh token of it and every access token minted
 * under it.
 */
export function revokeGrantStatements(
  db: D1Database,
  grantId: string,
  reason: GrantRevokedReason,
  now: number
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        "UPDATE oauth_grants SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL"
      )
      .bind(now, reason, grantId),
    db
      .prepare(
        "UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL"
      )
      .bind(now, grantId),
    db
      .prepare(
        "UPDATE mcp_tokens SET status = 'revoked', revoked_at = ? WHERE grant_id = ? AND status = 'active'"
      )
      .bind(now, grantId),
  ];
}

// ---------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------

/** Idle 30 d, capped by the absolute 90 d from grant creation (17 §7.1). */
export function refreshExpiry(grantCreatedAt: number, now: number): number {
  return Math.min(
    grantCreatedAt + REFRESH_ABSOLUTE_TTL_MS,
    now + REFRESH_IDLE_TTL_MS
  );
}

export async function findRefreshByHash(
  db: D1Database,
  tokenHash: string
): Promise<RefreshRow | null> {
  return await db
    .prepare(
      `SELECT ${REFRESH_COLUMNS} FROM oauth_refresh_tokens WHERE token_hash = ? LIMIT 1`
    )
    .bind(tokenHash)
    .first<RefreshRow>();
}

/** The child a rotation created from `parent` (null when none). */
export async function findRefreshChild(
  db: D1Database,
  parent: Pick<RefreshRow, "grant_id" | "id">
): Promise<RefreshRow | null> {
  return await db
    .prepare(
      `SELECT ${REFRESH_COLUMNS} FROM oauth_refresh_tokens WHERE parent_id = ? AND grant_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .bind(parent.id, parent.grant_id)
    .first<RefreshRow>();
}

export interface NewRefresh {
  expiresAt: number;
  grantId: string;
  now: number;
  parentId: string | null;
  /** Plaintext; only its SHA-256 is stored. */
  token: string;
}

export async function insertRefresh(
  db: D1Database,
  input: NewRefresh
): Promise<{ id: string; statement: D1PreparedStatement }> {
  const id = newId("rft", input.now);
  const statement = db
    .prepare(
      "INSERT INTO oauth_refresh_tokens (id, grant_id, token_hash, parent_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(
      id,
      input.grantId,
      await hashToken(input.token),
      input.parentId,
      input.now,
      input.expiresAt
    );
  return { id, statement };
}

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

export interface NewAccessToken {
  deviceId: string | null;
  email: string;
  expiresAt: number;
  grantId: string;
  label: string;
  now: number;
  /** Space-delimited OAuth scopes of this token. */
  scopes: string;
  /** Plaintext; only its SHA-256 is stored. */
  token: string;
  userId: string;
}

/** INSERT of a first-party `kind='oauth'` access token (17 §7.1). */
export async function insertAccessToken(
  db: D1Database,
  input: NewAccessToken
): Promise<{ id: string; statement: D1PreparedStatement }> {
  const id = crypto.randomUUID();
  const statement = db
    .prepare(
      "INSERT INTO mcp_tokens (id, user_email, token_hash, label, status, kind, scope, created_at, expires_at, user_id, scopes, grant_id, device_id) VALUES (?, ?, ?, ?, 'active', 'oauth', ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      id,
      normalizeEmail(input.email),
      await hashToken(input.token),
      input.label,
      legacyScopeFor(splitScopes(input.scopes)),
      input.now,
      input.expiresAt,
      input.userId,
      input.scopes,
      input.grantId,
      input.deviceId
    );
  return { id, statement };
}
