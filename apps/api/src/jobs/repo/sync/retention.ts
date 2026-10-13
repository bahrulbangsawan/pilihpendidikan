// The daily retention statements of 14 §7 / 04 §4 (cron `0 3 * * *`). Every
// statement here is a SYSTEM scan across users (no user predicate by design)
// and carries a `sql-allow` marker. Work is chunked (≤ 5,000 rows per
// statement) and bounded per run, so a backlog drains over several days.
//
//   purgeExpiredIdempotency   idempotency_keys past `expires_at` (7 d)
//   trimChangeLog             change_log older than 30 d, as a contiguous
//                             seq PREFIX (the feed's 410 floor relies on it)
//   purgeClosedPostings       closed postings > 180 d with no user_jobs link
//   purgeStaleUserJobs        untracked user_jobs unseen for 90 d (+ their
//                             scores), each with a `delete` change
//   purgeOldRunItems          discovery_run_items of runs older than 90 d
//   purgeOldTelemetry         telemetry_daily older than 90 d (22 §8.1)
//   purgeOldAiUsage           ai_usage months older than 13 months (04 §4)
//   databaseSizeBytes         PRAGMA page_count × page_size (capacity check)

import type { JobsDb } from "../core/db";
import { d1, execute, queryFirst, runBatch, stmt } from "../core/db";

/** Rows per DELETE (14 §7). */
export const RETENTION_CHUNK = 5000;

/** Repeats a chunked DELETE until it deletes less than a chunk. */
async function drain(
  run: () => Promise<number>,
  chunkSize: number,
  maxRounds: number
): Promise<number> {
  let total = 0;
  for (let round = 0; round < maxRounds; round++) {
    const changed = await run();
    total += changed;
    if (changed < chunkSize) {
      break;
    }
  }
  return total;
}

export interface RetentionOptions {
  chunk?: number;
  maxRounds?: number;
}

function opts(options: RetentionOptions): { chunk: number; rounds: number } {
  return {
    chunk: options.chunk ?? RETENTION_CHUNK,
    rounds: options.maxRounds ?? 20,
  };
}

/** Deletes idempotency rows whose `expires_at` passed. */
export async function purgeExpiredIdempotency(
  db: JobsDb,
  now: number,
  options: RetentionOptions = {}
): Promise<number> {
  const { chunk, rounds } = opts(options);
  return await drain(
    () =>
      execute(
        db,
        // sql-allow: system — daily retention across users (idempotency 7 d, 04 §4)
        "DELETE FROM idempotency_keys WHERE rowid IN (SELECT rowid FROM idempotency_keys WHERE expires_at < ? LIMIT ?)",
        now,
        chunk
      ),
    chunk,
    rounds
  );
}

/**
 * The first seq to KEEP: the oldest row changed at or after `cutoff`, else
 * (every row is older) the newest row, kept as the floor marker. Null when
 * the log is empty.
 */
export async function changeLogBoundary(
  db: JobsDb,
  cutoff: number
): Promise<number | null> {
  const first = await queryFirst<{ seq: number }>(
    db,
    // sql-allow: system — retention boundary scan in seq order (no user data)
    "SELECT seq FROM change_log WHERE changed_at >= ? ORDER BY seq LIMIT 1",
    cutoff
  );
  if (first) {
    return first.seq;
  }
  const newest = await queryFirst<{ seq: number | null }>(
    db,
    // sql-allow: system — retention boundary (no user data)
    "SELECT MAX(seq) AS seq FROM change_log"
  );
  return newest?.seq ?? null;
}

/**
 * Deletes every change_log row below the boundary (a contiguous prefix of
 * the global seq), so `MIN(seq)` is exactly the oldest retained change.
 */
export async function trimChangeLog(
  db: JobsDb,
  cutoff: number,
  options: RetentionOptions = {}
): Promise<{ boundary: number | null; deleted: number }> {
  const { chunk, rounds } = opts(options);
  const boundary = await changeLogBoundary(db, cutoff);
  if (boundary === null) {
    return { boundary, deleted: 0 };
  }
  const deleted = await drain(
    () =>
      execute(
        db,
        // sql-allow: system — change_log retention 30 d across users (04 §4, 20 §4.3)
        "DELETE FROM change_log WHERE seq IN (SELECT seq FROM change_log WHERE seq < ? ORDER BY seq LIMIT ?)",
        boundary,
        chunk
      ),
    chunk,
    rounds
  );
  return { boundary, deleted };
}

/** Closed postings (closed before `cutoff`) that no user links any more. */
export async function purgeClosedPostings(
  db: JobsDb,
  cutoff: number,
  options: RetentionOptions = {}
): Promise<number> {
  const { chunk, rounds } = opts(options);
  return await drain(
    () =>
      execute(
        db,
        // sql-allow: public-posting — retention of shared postings nobody tracks (04 §4)
        "DELETE FROM job_postings WHERE id IN (SELECT p.id FROM job_postings p WHERE p.status = 'closed' AND p.closed_at IS NOT NULL AND p.closed_at < ? AND NOT EXISTS (SELECT 1 FROM user_jobs u WHERE u.posting_id = p.id) LIMIT ?)",
        cutoff,
        chunk
      ),
    chunk,
    rounds
  );
}

// The candidate set of `purgeStaleUserJobs`, evaluated identically by every
// statement of one batch (a batch is one transaction).
// sql-allow: system — candidate set of the daily user_jobs retention (04 §4)
const STALE_USER_JOBS =
  "SELECT u.id FROM user_jobs u JOIN job_postings p ON p.id = u.posting_id WHERE u.inbox_state <> 'tracked' AND u.updated_at < ? AND p.last_seen_at < ? AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_job_id = u.id) ORDER BY u.id LIMIT ?";

/**
 * Untracked user_jobs (no application, inbox state not `tracked`) whose
 * posting was not seen and which nobody touched since `cutoff` (04 §4,
 * 90 d). Each deletion appends a `user_job` delete change; the user's match
 * scores of that posting go with it.
 */
export async function purgeStaleUserJobs(
  db: JobsDb,
  input: { cutoff: number; now: number },
  options: RetentionOptions = {}
): Promise<number> {
  const { chunk, rounds } = opts(options);
  const binds = [input.cutoff, input.cutoff, chunk] as const;
  return await drain(
    async () => {
      const results = await runBatch(db, [
        stmt(
          db,
          // sql-allow: system — daily retention across users (user_jobs 90 d, 04 §4)
          `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'user_job', id, revision + 1, 'delete', ? FROM user_jobs WHERE id IN (${STALE_USER_JOBS})`,
          input.now,
          ...binds
        ),
        stmt(
          db,
          // sql-allow: system — scores of the purged user_jobs (same candidate set)
          `DELETE FROM match_scores WHERE (user_id, posting_id) IN (SELECT user_id, posting_id FROM user_jobs WHERE id IN (${STALE_USER_JOBS}))`,
          ...binds
        ),
        stmt(
          db,
          // sql-allow: system — daily retention across users (user_jobs 90 d, 04 §4)
          `DELETE FROM user_jobs WHERE id IN (${STALE_USER_JOBS})`,
          ...binds
        ),
      ]);
      return results.at(-1)?.meta?.changes ?? 0;
    },
    chunk,
    rounds
  );
}

/** Run items of runs that started before `cutoff` (04 §4, 90 d). */
export async function purgeOldRunItems(
  db: JobsDb,
  cutoff: number,
  options: RetentionOptions = {}
): Promise<number> {
  const { chunk, rounds } = opts(options);
  return await drain(
    () =>
      execute(
        db,
        // sql-allow: system — discovery_run_items retention 90 d across users (04 §4)
        "DELETE FROM discovery_run_items WHERE rowid IN (SELECT i.rowid FROM discovery_run_items i LEFT JOIN discovery_runs r ON r.id = i.run_id AND r.user_id = i.user_id WHERE r.id IS NULL OR r.started_at < ? LIMIT ?)",
        cutoff,
        chunk
      ),
    chunk,
    rounds
  );
}

/** Anonymous telemetry days before `day` (22 §8.1: 90 d). */
export async function purgeOldTelemetry(
  db: JobsDb,
  day: string,
  options: RetentionOptions = {}
): Promise<number> {
  const { chunk, rounds } = opts(options);
  return await drain(
    () =>
      execute(
        db,
        // sql-allow: anonymous — telemetry_daily has no user column (22 §8.1)
        "DELETE FROM telemetry_daily WHERE rowid IN (SELECT rowid FROM telemetry_daily WHERE day < ? LIMIT ?)",
        day,
        chunk
      ),
    chunk,
    rounds
  );
}

/** AI usage months before `month` (04 §4: 13 months). */
export async function purgeOldAiUsage(
  db: JobsDb,
  month: string,
  options: RetentionOptions = {}
): Promise<number> {
  const { chunk, rounds } = opts(options);
  return await drain(
    () =>
      execute(
        db,
        // sql-allow: system — ai_usage retention 13 months across users (04 §4)
        "DELETE FROM ai_usage WHERE rowid IN (SELECT rowid FROM ai_usage WHERE month < ? LIMIT ?)",
        month,
        chunk
      ),
    chunk,
    rounds
  );
}

/**
 * JOBS_DB size in bytes: `PRAGMA page_count × page_size` (14 §7), falling
 * back to D1's `meta.size_after` where the PRAGMA is not available.
 */
export async function databaseSizeBytes(db: JobsDb): Promise<number | null> {
  try {
    const pages = await queryFirst<{ page_count: number }>(
      db,
      "PRAGMA page_count"
    );
    const size = await queryFirst<{ page_size: number }>(
      db,
      "PRAGMA page_size"
    );
    if (pages && size) {
      return Number(pages.page_count) * Number(size.page_size);
    }
  } catch {
    // D1 may refuse the PRAGMA: use the size it reports instead.
  }
  try {
    const result = await d1(db).prepare("SELECT 1 AS one").run();
    const bytes = Number(result.meta?.size_after ?? 0);
    return bytes > 0 ? bytes : null;
  } catch {
    return null;
  }
}
