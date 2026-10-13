// The daily retention job (cron `0 3 * * *`, 14 §7, 04 §4, 11 §10, 22 §8).
//
//   idempotency     idempotency_keys past expires_at (7 d)
//   change_log      older than 30 d (a contiguous seq prefix: the feed's
//                   410 floor, 20 §4.3)
//   postings        closed > 180 d and linked by no user_jobs
//   user_jobs       untracked, unseen and untouched for 90 d (+ scores)
//   run_items       discovery_run_items of runs older than 90 d
//   telemetry       telemetry_daily older than 90 d; crash reports > 30 d
//   ai_usage        months older than 13 months
//   exports         account export zips past their cleanup deadline
//   deletions       re-drive unfinished purges; hard-delete accounts
//                   tombstoned ≥ 30 d
//   capacity        PRAGMA page_count × page_size: warn ≥ 6 GB, error ≥ 8 GB
//
// Each step runs on its own: a failure is logged and the next step still
// runs; the job reports failure at the end when a JOBS_DB/R2 step failed
// (identity-database steps only log: they retry the next day).

import { DAY_MS, utcDay, utcMonth } from "../../core/clock";
import type { CronContext } from "../../cron/types";
import {
  databaseSizeBytes,
  purgeClosedPostings,
  purgeExpiredIdempotency,
  purgeOldAiUsage,
  purgeOldRunItems,
  purgeOldTelemetry,
  purgeStaleUserJobs,
  trimChangeLog,
} from "../../repo/sync/retention";
import {
  hardDeleteTombstonedUsers,
  redriveStuckPurges,
  sweepCrashReports,
  sweepExpiredExports,
} from "../account/retention";
import { TELEMETRY_RETENTION_DAYS } from "../account/telemetry";

export const CHANGE_LOG_RETENTION_MS = 30 * DAY_MS;
export const CLOSED_POSTING_RETENTION_MS = 180 * DAY_MS;
export const UNTRACKED_USER_JOB_RETENTION_MS = 90 * DAY_MS;
export const RUN_ITEM_RETENTION_MS = 90 * DAY_MS;
export const AI_USAGE_RETENTION_MONTHS = 13;
const GB = 1024 ** 3;
export const CAPACITY_WARN_BYTES = 6 * GB;
export const CAPACITY_ERROR_BYTES = 8 * GB;

/**
 * Steps on the identity database (account hard deletes and purge re-drives):
 * a failure is logged and retried the next day without failing the JOBS_DB
 * retention job.
 */
const SOFT_STEPS: ReadonlySet<string> = new Set([
  "hard_delete",
  "purge_redrive",
]);

export type RetentionReport = Record<string, number | null>;

/** `YYYY-MM` that is `months` months before `now` (UTC). */
export function monthsBefore(now: number, months: number): string {
  const date = new Date(now);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  return utcMonth(date.getTime());
}

/** Logs the JOBS_DB size at the level its threshold asks for (04 §4). */
export async function checkCapacity(
  cc: CronContext,
  measure: (db: CronContext["db"]) => Promise<number | null> = databaseSizeBytes
): Promise<number | null> {
  const bytes = await measure(cc.db);
  const event = { evt: "jobs_db_capacity", job: "retention", bytes };
  if (bytes !== null && bytes >= CAPACITY_ERROR_BYTES) {
    console.error({
      ...event,
      level: "error",
      threshold: CAPACITY_ERROR_BYTES,
    });
  } else if (bytes !== null && bytes >= CAPACITY_WARN_BYTES) {
    console.warn({ ...event, level: "warn", threshold: CAPACITY_WARN_BYTES });
  } else {
    cc.log("jobs_db_capacity", { bytes });
  }
  return bytes;
}

/** Runs every retention step; throws at the end when one failed. */
export async function runRetention(cc: CronContext): Promise<RetentionReport> {
  const now = cc.now;
  const steps: [string, () => Promise<number | null>][] = [
    ["idempotency", () => purgeExpiredIdempotency(cc.db, now)],
    [
      "change_log",
      async () =>
        (await trimChangeLog(cc.db, now - CHANGE_LOG_RETENTION_MS)).deleted,
    ],
    [
      "postings",
      () => purgeClosedPostings(cc.db, now - CLOSED_POSTING_RETENTION_MS),
    ],
    [
      "user_jobs",
      () =>
        purgeStaleUserJobs(cc.db, {
          cutoff: now - UNTRACKED_USER_JOB_RETENTION_MS,
          now,
        }),
    ],
    ["run_items", () => purgeOldRunItems(cc.db, now - RUN_ITEM_RETENTION_MS)],
    [
      "telemetry",
      () =>
        purgeOldTelemetry(
          cc.db,
          utcDay(now - TELEMETRY_RETENTION_DAYS * DAY_MS)
        ),
    ],
    ["crash_reports", () => sweepCrashReports(cc.env.JOBS_FILES, now)],
    [
      "ai_usage",
      () =>
        purgeOldAiUsage(cc.db, monthsBefore(now, AI_USAGE_RETENTION_MONTHS)),
    ],
    ["exports", () => sweepExpiredExports(cc.env.JOBS_FILES, now)],
    ["hard_delete", () => hardDeleteTombstonedUsers(cc)],
    ["purge_redrive", () => redriveStuckPurges(cc)],
    ["capacity", () => checkCapacity(cc)],
  ];
  const report: RetentionReport = {};
  const failed: string[] = [];
  for (const [name, step] of steps) {
    try {
      report[name] = await step();
    } catch (err) {
      if (!SOFT_STEPS.has(name)) {
        failed.push(name);
      }
      console.error({
        evt: "retention_step_failed",
        step: name,
        error:
          err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  }
  cc.log("retention", report);
  if (failed.length > 0) {
    throw new Error(`retention steps failed: ${failed.join(", ")}`);
  }
  return report;
}
