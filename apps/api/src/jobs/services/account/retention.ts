// Account-side daily retention (cron `0 3 * * *`, 14 §7, 11 §10, 22 §8):
//
//   sweepExpiredExports       export zips/records past their cleanup
//                             deadline (the link itself dies after 24 h)
//   sweepCrashReports         crash reports older than 30 days
//   redriveStuckPurges        deletions whose purge did not finish (a lost or
//                             dead-lettered message) start again — phases
//                             are restartable; stale records are dropped
//   hardDeleteTombstonedUsers 30 days after the tombstone: a final sweep of
//                             JOBS_DB rows, R2 objects and KV documents, then
//                             the identity rows and the `users` row
//
// Bounded per run; whatever remains is picked up the next day.

import { DAY_MS, HOUR_MS, utcDay } from "../../core/clock";
import { trustedScope } from "../../core/scope";
import type { CronContext } from "../../cron/types";
import {
  hardDeleteStatements,
  listTombstonedUsers,
  runIdentityStatements,
} from "../../repo/account/identity";
import { purgeUserRows } from "../../repo/account/purge";
import { findUserById } from "../../repo/core/users";
import {
  DELETION_PREFIX,
  deletionRecordKey,
  EXPORT_INDEX_PREFIX,
  exportRecordKey,
  exportZipKey,
  parseExportIndexKey,
  readDeletionRecord,
  writeDeletionRecord,
} from "./records";
import { deleteOwnedDocuments, sendPurge, sweepUserObjects } from "./purge";
import { CRASH_PREFIX, CRASH_RETENTION_DAYS } from "./telemetry";

/** Tombstoned accounts are hard-deleted after 30 days (11 §10 step 5). */
export const HARD_DELETE_AFTER_MS = 30 * DAY_MS;
/** A purge still incomplete this long after the confirmation is re-driven. */
export const PURGE_REDRIVE_AFTER_MS = 6 * HOUR_MS;
/** Deletion records whose account was never tombstoned are dropped. */
const STALE_RECORD_AFTER_MS = DAY_MS;
const LIST_LIMIT = 1000;
const HARD_DELETES_PER_RUN = 50;
const FINAL_SWEEP_STATEMENTS = 200;
const DAY_PREFIX_RE = /(\d{4}-\d{2}-\d{2})\/$/;

/** Deletes expired export zips, records and index keys; returns how many. */
export async function sweepExpiredExports(
  bucket: R2Bucket,
  now: number
): Promise<number> {
  const listed = await bucket.list({
    prefix: EXPORT_INDEX_PREFIX,
    limit: LIST_LIMIT,
  });
  let swept = 0;
  for (const object of listed.objects) {
    const entry = parseExportIndexKey(object.key);
    if (!entry) {
      await bucket.delete(object.key);
      continue;
    }
    if (entry.deadline > now) {
      break; // keys are ordered by their zero-padded deadline
    }
    await bucket.delete([
      exportZipKey(entry.userId, entry.exportId),
      exportRecordKey(entry.userId, entry.exportId),
      object.key,
    ]);
    swept += 1;
  }
  return swept;
}

/** Deletes crash reports of days older than 30 days; returns how many. */
export async function sweepCrashReports(
  bucket: R2Bucket,
  now: number
): Promise<number> {
  const cutoff = utcDay(now - CRASH_RETENTION_DAYS * DAY_MS);
  const days = await bucket.list({
    prefix: CRASH_PREFIX,
    delimiter: "/",
    limit: LIST_LIMIT,
  });
  let deleted = 0;
  for (const prefix of days.delimitedPrefixes) {
    const day = DAY_PREFIX_RE.exec(prefix)?.[1];
    if (!day || day >= cutoff) {
      continue;
    }
    for (;;) {
      const page = await bucket.list({ prefix, limit: LIST_LIMIT });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) {
        await bucket.delete(keys);
        deleted += keys.length;
      }
      if (!page.truncated) {
        break;
      }
    }
  }
  return deleted;
}

/** Restarts unfinished purges; returns how many were re-sent. */
export async function redriveStuckPurges(cc: CronContext): Promise<number> {
  const listed = await cc.env.JOBS_FILES.list({
    prefix: DELETION_PREFIX,
    limit: LIST_LIMIT,
  });
  let redriven = 0;
  for (const object of listed.objects) {
    const userId = object.key.slice(DELETION_PREFIX.length, -".json".length);
    const record = await readDeletionRecord(cc.env.JOBS_FILES, userId);
    if (!record || record.completed_at !== null) {
      continue;
    }
    const user = await findUserById(cc.env.DB, userId);
    if (!user || user.deleted_at === null) {
      if (cc.now - record.confirmed_at > STALE_RECORD_AFTER_MS) {
        await cc.env.JOBS_FILES.delete(object.key);
      }
      continue;
    }
    if (cc.now - record.confirmed_at < PURGE_REDRIVE_AFTER_MS) {
      continue;
    }
    await writeDeletionRecord(cc.env.JOBS_FILES, {
      ...record,
      redrives: record.redrives + 1,
    });
    await sendPurge(cc.env, userId, "jobs_db");
    redriven += 1;
  }
  return redriven;
}

/** Final sweep + identity hard delete of accounts tombstoned ≥ 30 days. */
export async function hardDeleteTombstonedUsers(
  cc: CronContext
): Promise<number> {
  const users = await listTombstonedUsers(cc.env.DB, {
    before: cc.now - HARD_DELETE_AFTER_MS,
    limit: HARD_DELETES_PER_RUN,
  });
  let deleted = 0;
  for (const user of users) {
    const scope = trustedScope(user.id, "cron");
    const rows = await purgeUserRows(cc.db, scope, {
      maxStatements: FINAL_SWEEP_STATEMENTS,
    });
    const objects = await sweepUserObjects(cc.env.JOBS_FILES, user.id);
    if (!(rows.done && objects)) {
      cc.log("hard_delete_deferred", { user_id: user.id });
      continue;
    }
    const record = await readDeletionRecord(cc.env.JOBS_FILES, user.id);
    await deleteOwnedDocuments(
      cc.env,
      user.email,
      record?.also_delete_cvs ?? false
    );
    await runIdentityStatements(
      cc.env.DB,
      hardDeleteStatements(cc.env.DB, user)
    );
    await cc.env.JOBS_FILES.delete(deletionRecordKey(user.id));
    deleted += 1;
  }
  return deleted;
}
