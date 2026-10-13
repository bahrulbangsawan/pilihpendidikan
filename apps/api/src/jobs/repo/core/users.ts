// Canonical user identity (03 §2, D-03) in the identity database `DB`.
//
// `users.id` (`usr_<ULID>`) is created lazily the first time an email
// authenticates: `resolveCaller` (src/auth.ts) calls `ensureUser`, which reads
// first and only inserts when the row is missing (`INSERT … ON CONFLICT(email)
// DO NOTHING RETURNING`, then a re-read when a concurrent request won). No
// backfill job is needed. `users` lives in `DB`, never in `JOBS_DB`; every
// Job Tracker row stores the `user_id`, never the email.

import { newId } from "@pilihpendidikan/jobs-contracts/ids";

export interface UserRow {
  created_at: number;
  deleted_at: number | null;
  email: string;
  id: string;
  updated_at: number;
}

const USER_COLUMNS = "id, email, created_at, updated_at, deleted_at";

/** The user row of a normalized email, or null. */
export async function findUserByEmail(
  db: D1Database,
  email: string
): Promise<UserRow | null> {
  return await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<UserRow>();
}

/** The user row of a `usr_` id, or null. */
export async function findUserById(
  db: D1Database,
  userId: string
): Promise<UserRow | null> {
  return await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`)
    .bind(userId)
    .first<UserRow>();
}

/**
 * Returns the user row for a **normalized** email, creating it when missing.
 * Idempotent and race-safe: two concurrent first sign-ins converge on one row.
 * A tombstoned row (`deleted_at` set, 11 §10) is returned as is; the v1 router
 * refuses tombstoned identities.
 */
export async function ensureUser(
  db: D1Database,
  email: string,
  now: number
): Promise<UserRow> {
  const existing = await findUserByEmail(db, email);
  if (existing) {
    return existing;
  }
  const inserted = await db
    .prepare(
      `INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING RETURNING ${USER_COLUMNS}`
    )
    .bind(newId("usr", now), email, now, now)
    .first<UserRow>();
  if (inserted) {
    return inserted;
  }
  const winner = await findUserByEmail(db, email);
  if (!winner) {
    throw new Error("users row vanished during lazy creation");
  }
  return winner;
}

/** Records the user id on a token row that predates it (04 §1, lazy). */
export async function backfillTokenUserId(
  db: D1Database,
  tokenId: string,
  userId: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE mcp_tokens SET user_id = ? WHERE id = ? AND user_id IS NULL"
    )
    .bind(userId, tokenId)
    .run();
}
