// Account purge in JOBS_DB (11 §10 step 2, 14 §6 `purge_user` phase
// `jobs_db`): every row of the user, in chunks, children before parents so
// the D1 foreign keys (04 §2) never block a delete. Restartable: each chunk
// deletes "whatever is still there", so a retried or re-driven message just
// continues.
//
// Shared public postings are not the user's personal data and stay (11 §10);
// the user's PRIVATE postings (`owner_user_id`) go after their `user_jobs`.

import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { execute, queryFirst } from "../core/db";

/**
 * Every user-scoped JOBS_DB table, in deletion order (FK children first:
 * events/interviews/offers/emails → applications → user_jobs → private
 * postings; attempts → tasks). `change_log` and `idempotency_keys` last.
 */
export const PURGE_TABLES = [
  "application_events",
  "interviews",
  "offers",
  "email_applications",
  "submission_evidence",
  "automation_attempts",
  "approvals",
  "automation_tasks",
  "cv_variants",
  "files",
  "match_scores",
  "discovery_run_items",
  "discovery_runs",
  "applications",
  "user_jobs",
  "job_postings",
  "applicant_facts",
  "screening_answers",
  "automation_rules",
  "job_sources",
  "ai_usage",
  "analytics_daily",
  "user_settings",
  "idempotency_keys",
  "change_log",
] as const;
export type PurgeTable = (typeof PURGE_TABLES)[number];

/** Rows per DELETE statement (14 §7: ≤ 5,000 per statement). */
export const PURGE_CHUNK = 1000;

async function deleteChunk(
  db: JobsDb,
  scope: UserScope,
  table: PurgeTable,
  limit: number
): Promise<number> {
  if (table === "job_postings") {
    return await execute(
      db,
      "DELETE FROM job_postings WHERE owner_user_id = ? AND visibility = 'private' AND rowid IN (SELECT p.rowid FROM job_postings p WHERE p.owner_user_id = ? AND p.visibility = 'private' AND NOT EXISTS (SELECT 1 FROM user_jobs u WHERE u.posting_id = p.id) LIMIT ?)",
      scope.userId,
      scope.userId,
      limit
    );
  }
  return await execute(
    db,
    `DELETE FROM ${table} WHERE user_id = ? AND rowid IN (SELECT rowid FROM ${table} WHERE user_id = ? LIMIT ?)`,
    scope.userId,
    scope.userId,
    limit
  );
}

export interface PurgeProgress {
  /** Rows deleted by this call. */
  deleted: number;
  /** Every table is empty for the user. */
  done: boolean;
  /** DELETE statements run by this call. */
  statements: number;
}

/**
 * Deletes the user's rows table by table until every table is empty or
 * `maxStatements` DELETEs ran (then `done: false`: call again).
 */
export async function purgeUserRows(
  db: JobsDb,
  scope: UserScope,
  options: { chunk?: number; maxStatements: number }
): Promise<PurgeProgress> {
  const limit = options.chunk ?? PURGE_CHUNK;
  const progress: PurgeProgress = { deleted: 0, done: false, statements: 0 };
  for (const table of PURGE_TABLES) {
    // Empty tables cost a read, not a DELETE: a restarted purge never spends
    // its statement budget on tables it already emptied.
    if ((await countUserRows(db, scope, table, 1)) === 0) {
      continue;
    }
    for (;;) {
      if (progress.statements >= options.maxStatements) {
        return progress;
      }
      const changed = await deleteChunk(db, scope, table, limit);
      progress.statements += 1;
      progress.deleted += changed;
      if (changed < limit) {
        break;
      }
    }
  }
  progress.done = true;
  return progress;
}

/** Rows the user still has in `table` (tests and the final sweep). */
export async function countUserRows(
  db: JobsDb,
  scope: UserScope,
  table: PurgeTable,
  cap = 1_000_000
): Promise<number> {
  if (table === "job_postings") {
    const row = await queryFirst<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM (SELECT 1 FROM job_postings WHERE owner_user_id = ? AND visibility = 'private' LIMIT ?)",
      scope.userId,
      cap
    );
    return row?.n ?? 0;
  }
  const row = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} WHERE user_id = ? LIMIT ?)`,
    scope.userId,
    cap
  );
  return row?.n ?? 0;
}
