// Posting writes of cloud discovery (24 §6.5): the cloud columns of shared
// public postings, bulk sightings, expiry, and the follower links. Public
// posting statements carry `sql-allow: public-posting`; user_jobs and
// change_log statements are scoped to one follower.

import type { CloudPostingExtras } from "@pilihpendidikan/jobs-contracts/cloud";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import {
  encodeJson,
  guard,
  queryAll,
  returnedRows,
  runBatch,
  stmt,
} from "../core/db";
import {
  postingFanoutStatements,
  postingGuardSql,
} from "../discovery/postings";
import { chunk, IN_CHUNK, insertRows, marks } from "../discovery/sql";

/** Runs one transactional batch planned by a cloud service. */
export async function runCloudBatch(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<D1Result[]> {
  return await runBatch(db, statements);
}

/** Revision + last_seen_at guard of a shared posting the batch changes. */
export function postingGuardStatement(
  db: JobsDb,
  g: { id: string; lastSeenAt: number; revision: number }
): D1PreparedStatement {
  return guard(
    db,
    `posting:${g.id}`,
    postingGuardSql(),
    g.id,
    g.revision,
    g.lastSeenAt
  );
}

/**
 * Writes the cloud columns of one posting. `cloud_source_id` keeps the first
 * source that delivered the posting; the other columns follow the newest
 * observation (they belong to the same content the planner just merged).
 */
export function cloudColumnsStatement(
  db: JobsDb,
  postingId: string,
  sourceId: string,
  extras: CloudPostingExtras
): D1PreparedStatement {
  return stmt(
    db,
    // sql-allow: public-posting — cloud columns of a shared public posting
    // this run created or changed
    `UPDATE job_postings SET
       cloud_source_id = coalesce(cloud_source_id, ?),
       expires_at = ?, skills = ?, benefits = ?, employment_detail = ?,
       application_method = ?, auth_required = ?, raw_metadata = ?
     WHERE id = ? AND visibility = 'public'`,
    sourceId,
    extras.expires_at ?? null,
    encodeJson(extras.skills ?? []),
    encodeJson(extras.benefits ?? []),
    extras.employment_detail ?? null,
    extras.application_method ?? null,
    extras.auth_required ? 1 : 0,
    encodeJson(extras.raw_metadata ?? {}),
    postingId
  );
}

/**
 * `last_seen_at` / `missed_runs = 0` for postings seen unchanged: one
 * statement per ≤ 90 ids instead of one per posting (D1 query budget).
 * Also adopts postings first stored by a CLI user into the source.
 */
export function bulkSightingStatements(
  db: JobsDb,
  postingIds: readonly string[],
  sourceId: string,
  observedAt: number
): D1PreparedStatement[] {
  return chunk([...new Set(postingIds)], IN_CHUNK).map((group) =>
    stmt(
      db,
      // sql-allow: public-posting — sighting of shared public postings by a
      // complete or partial listing read
      `UPDATE job_postings SET last_seen_at = max(last_seen_at, ?), missed_runs = 0,
         cloud_source_id = coalesce(cloud_source_id, ?)
       WHERE visibility = 'public' AND id IN (${marks(group.length)})`,
      observedAt,
      sourceId,
      ...group
    )
  );
}

/**
 * Expiry after a complete run (03 §4.3, 24 §6.5): open postings of the source
 * not seen since `seenSince` get `missed_runs + 1`; those reaching 2, or whose
 * `expires_at` passed, close. Returns the closed posting ids (their change
 * reaches every linked user's feed in the same batch).
 */
export async function expireSourcePostings(
  db: JobsDb,
  sourceId: string,
  seenSince: number,
  now: number
): Promise<string[]> {
  const results = await runBatch(db, [
    stmt(
      db,
      // sql-allow: public-posting — absence count of the source's shared rows
      `UPDATE job_postings SET missed_runs = missed_runs + 1
       WHERE cloud_source_id = ? AND visibility = 'public' AND status = 'open' AND last_seen_at < ?`,
      sourceId,
      seenSince
    ),
    stmt(
      db,
      // sql-allow: public-posting — closes shared rows missing from two
      // complete runs or past their expiry date
      `UPDATE job_postings SET status = 'closed', closed_at = ?, revision = revision + 1, updated_at = ?
       WHERE cloud_source_id = ? AND visibility = 'public' AND status = 'open'
         AND (missed_runs >= 2 OR (expires_at IS NOT NULL AND expires_at < ?))
       RETURNING id`,
      now,
      now,
      sourceId,
      now
    ),
  ]);
  const closed = returnedRows<{ id: string }>(results[1]).map((r) => r.id);
  if (closed.length > 0) {
    await runBatch(db, postingFanoutStatements(db, closed, now));
  }
  return closed;
}

/** Of `postingIds`, those the user is not linked to yet. */
export async function unlinkedPostingIds(
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[]
): Promise<string[]> {
  const linked = new Set<string>();
  for (const group of chunk([...new Set(postingIds)], IN_CHUNK)) {
    const rows = await queryAll<{ posting_id: string }>(
      db,
      `SELECT posting_id FROM user_jobs WHERE user_id = ? AND posting_id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      linked.add(row.posting_id);
    }
  }
  return [...new Set(postingIds)].filter((id) => !linked.has(id));
}

/**
 * Open postings of a source first seen since `since`, newest first, that the
 * user is not linked to (follow backfill, 24 §5.3).
 */
export async function backfillCandidates(
  db: JobsDb,
  scope: UserScope,
  sourceId: string,
  since: number,
  limit: number
): Promise<string[]> {
  const rows = await queryAll<{ id: string }>(
    db,
    `SELECT p.id FROM job_postings p
     WHERE p.cloud_source_id = ? AND p.visibility = 'public' AND p.status = 'open' AND p.first_seen_at >= ?
       AND NOT EXISTS (SELECT 1 FROM user_jobs u WHERE u.posting_id = p.id AND u.user_id = ?)
     ORDER BY p.first_seen_at DESC, p.id DESC LIMIT ?`,
    sourceId,
    since,
    scope.userId,
    limit
  );
  return rows.map((row) => row.id);
}

/**
 * Inbox links of one follower: `user_jobs` (origin `discovered`, inbox `new`,
 * `source_id` = the cloud source) plus their change_log rows, in one batch.
 * A link that appeared concurrently is skipped (ON CONFLICT) and gets no
 * change row (the change rows are selected from the ids actually stored).
 */
export function followerLinkStatements(
  db: JobsDb,
  scope: UserScope,
  links: readonly { id: string; postingId: string }[],
  sourceId: string,
  now: number
): D1PreparedStatement[] {
  if (links.length === 0) {
    return [];
  }
  const inserts = insertRows(
    db,
    {
      head: "INSERT INTO user_jobs (id, user_id, posting_id, origin, inbox_state, first_run_id, source_id, user_notes, created_at, updated_at)",
      rowSql: "(?, ?, ?, 'discovered', 'new', NULL, ?, '', ?, ?)",
      tail: "ON CONFLICT (user_id, posting_id) DO NOTHING",
    },
    links.map((link) => [
      link.id,
      scope.userId,
      link.postingId,
      sourceId,
      now,
      now,
    ])
  );
  const changes = chunk(
    links.map((link) => link.id),
    IN_CHUNK
  ).flatMap((group) => [
    stmt(
      db,
      `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at)
       SELECT user_id, 'user_job', id, revision, 'upsert', ? FROM user_jobs
       WHERE user_id = ? AND id IN (${marks(group.length)})`,
      now,
      scope.userId,
      ...group
    ),
    // The posting itself, so a synced CLI receives the row the link points to.
    stmt(
      db,
      `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at)
       SELECT u.user_id, 'posting', p.id, p.revision, 'upsert', ? FROM user_jobs u
       JOIN job_postings p ON p.id = u.posting_id
       WHERE u.user_id = ? AND u.id IN (${marks(group.length)})`,
      now,
      scope.userId,
      ...group
    ),
  ]);
  return [...inserts, ...changes];
}
