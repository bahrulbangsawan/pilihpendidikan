// `cloud_source_follows` (24 §2.3, D-39): which users get a cloud source's
// new postings. User-scoped: every statement carries `user_id`, except the
// fan-out scans marked `sql-allow: system`.

import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { queryAll, queryFirst, stmt } from "../core/db";

export async function isFollowing(
  db: JobsDb,
  scope: UserScope,
  sourceId: string
): Promise<boolean> {
  const row = await queryFirst<{ one: number }>(
    db,
    "SELECT 1 AS one FROM cloud_source_follows WHERE user_id = ? AND source_id = ?",
    scope.userId,
    sourceId
  );
  return row !== null;
}

/** The caller's followed source ids. */
export async function followedSourceIds(
  db: JobsDb,
  scope: UserScope
): Promise<Set<string>> {
  const rows = await queryAll<{ source_id: string }>(
    db,
    "SELECT source_id FROM cloud_source_follows WHERE user_id = ?",
    scope.userId
  );
  return new Set(rows.map((row) => row.source_id));
}

export function followStatement(
  db: JobsDb,
  scope: UserScope,
  sourceId: string,
  now: number
): D1PreparedStatement {
  return stmt(
    db,
    "INSERT INTO cloud_source_follows (user_id, source_id, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id, source_id) DO NOTHING",
    scope.userId,
    sourceId,
    now
  );
}

export function unfollowStatement(
  db: JobsDb,
  scope: UserScope,
  sourceId: string
): D1PreparedStatement {
  return stmt(
    db,
    "DELETE FROM cloud_source_follows WHERE user_id = ? AND source_id = ?",
    scope.userId,
    sourceId
  );
}

/** Follower counts per source (catalog view; counts only). */
export async function followerCounts(db: JobsDb): Promise<Map<string, number>> {
  const rows = await queryAll<{ n: number; source_id: string }>(
    db,
    // sql-allow: system — aggregate follower counts per catalog source; no
    // user ids leave this function
    "SELECT source_id, count(*) AS n FROM cloud_source_follows GROUP BY source_id"
  );
  return new Map(rows.map((row) => [row.source_id, row.n]));
}

export async function followerCountOf(
  db: JobsDb,
  sourceId: string
): Promise<number> {
  const row = await queryFirst<{ n: number }>(
    db,
    // sql-allow: system — follower count of one catalog source
    "SELECT count(*) AS n FROM cloud_source_follows WHERE source_id = ?",
    sourceId
  );
  return row?.n ?? 0;
}

/**
 * Followers of a source for the fan-out (24 §6.5). The caller turns each id
 * into a trusted scope and acts only on that user's rows.
 */
export async function followerIds(
  db: JobsDb,
  sourceId: string
): Promise<string[]> {
  const rows = await queryAll<{ user_id: string }>(
    db,
    // sql-allow: system — fan-out of a source's new postings to its followers
    "SELECT user_id FROM cloud_source_follows WHERE source_id = ? ORDER BY created_at",
    sourceId
  );
  return rows.map((row) => row.user_id);
}
