// The `purge_user` consumer (14 §6, 11 §10 steps 1–4): restartable phases,
// each one message, each re-sent to itself while work remains.
//
//   jobs_db  revoke again (idempotent: catches anything minted since the
//            confirmation), then delete every JOBS_DB row of the user in
//            FK-safe order, ≤ 60 statements × 1,000 rows per message
//   r2       sweep `u/{user_id}/` (files, evidence, logs, exports),
//            ≤ 10 × 1,000 objects per message
//   cv_kv    delete the user's CV documents (tailored variants always, base
//            CVs only when the user ticked "also delete my CVs") and the
//            legacy JOBS_KV job documents; the deletion record is completed
//
// Every phase first checks that the account IS tombstoned: a stale or
// forged message for a live user does nothing (11 §6.1 rule 2). The
// tombstoned `users` row itself is hard-deleted 30 days later by the daily
// cron (services/account/retention.ts).

import type {
  JobsAiMessageOf,
  PURGE_PHASES,
} from "@pilihpendidikan/jobs-contracts/queue";
import { deleteCvDocument, isTailoredCvId } from "../../../documents/cv-create";
import type { Env } from "../../../env";
import { clearOwner } from "../../../ownership";
import type { QueueContext, QueueOutcome } from "../../queue/types";
import { ACK } from "../../queue/types";
import { purgeUserRows } from "../../repo/account/purge";
import type { UserRow } from "../../repo/core/users";
import { findUserById } from "../../repo/core/users";
import { revokeAccount } from "./delete";
import type { DeletionRecord } from "./records";
import { readDeletionRecord, writeDeletionRecord } from "./records";
import { ownedDocumentIds, sendJobsMessage } from "./shared";

type PurgePhase = (typeof PURGE_PHASES)[number];
type PurgeContext = QueueContext<JobsAiMessageOf<"purge_user">>;

/** DELETE statements per `jobs_db` message. */
export const PURGE_STATEMENTS_PER_MESSAGE = 60;
/** R2 list pages (1,000 keys each) per `r2` message. */
export const R2_PAGES_PER_MESSAGE = 10;
const R2_PAGE = 1000;

/** Sends the next (or the same, to continue) purge phase. */
export async function sendPurge(
  env: Pick<Env, "JOBS_AI_QUEUE">,
  userId: string,
  phase: PurgePhase
): Promise<void> {
  await sendJobsMessage(env, {
    v: 1,
    type: "purge_user",
    message_id: crypto.randomUUID(),
    user_id: userId,
    phase,
  });
}

/**
 * Deletes up to `pages` × 1,000 objects under `u/{user_id}/`; true when the
 * prefix is empty.
 */
export async function sweepUserObjects(
  bucket: R2Bucket,
  userId: string,
  pages: number = R2_PAGES_PER_MESSAGE
): Promise<boolean> {
  const prefix = `u/${userId}/`;
  for (let page = 0; page < pages; page++) {
    const listed = await bucket.list({ prefix, limit: R2_PAGE });
    const keys = listed.objects.map((object) => object.key);
    if (keys.length > 0) {
      await bucket.delete(keys);
    }
    if (!listed.truncated && keys.length < R2_PAGE) {
      return true;
    }
  }
  const rest = await bucket.list({ prefix, limit: 1 });
  return rest.objects.length === 0;
}

/**
 * Deletes the user's KV documents: tailored CVs always, base CVs when asked,
 * legacy job documents (the pre-D1 tracker). Returns how many went.
 */
export async function deleteOwnedDocuments(
  env: Env,
  email: string,
  alsoDeleteCvs: boolean
): Promise<{ cvs: number; legacyJobs: number }> {
  let cvs = 0;
  for (const id of await ownedDocumentIds(env, "cv", email)) {
    if (alsoDeleteCvs || isTailoredCvId(id)) {
      await deleteCvDocument(env, id);
      cvs += 1;
    }
  }
  let legacyJobs = 0;
  for (const id of await ownedDocumentIds(env, "jobs", email)) {
    await env.JOBS_KV.delete(`job:${id}`);
    await clearOwner(env, "jobs", id);
    legacyJobs += 1;
  }
  return { cvs, legacyJobs };
}

async function markPhase(
  env: Pick<Env, "JOBS_FILES">,
  record: DeletionRecord | null,
  phase: PurgePhase,
  now: number
): Promise<void> {
  if (!record) {
    return;
  }
  const phases = record.phases_done.includes(phase)
    ? record.phases_done
    : [...record.phases_done, phase];
  await writeDeletionRecord(env.JOBS_FILES, {
    ...record,
    phases_done: phases,
    completed_at: phase === "cv_kv" ? now : record.completed_at,
  });
}

async function runJobsDbPhase(
  qc: PurgeContext,
  user: UserRow,
  record: DeletionRecord | null
): Promise<QueueOutcome> {
  await revokeAccount(qc.env, user, qc.now);
  const progress = await purgeUserRows(qc.db, qc.scope, {
    maxStatements: PURGE_STATEMENTS_PER_MESSAGE,
  });
  qc.log("purge_user_jobs_db", {
    deleted: progress.deleted,
    done: progress.done,
  });
  if (!progress.done) {
    await sendPurge(qc.env, user.id, "jobs_db");
    return ACK;
  }
  await markPhase(qc.env, record, "jobs_db", qc.now);
  await sendPurge(qc.env, user.id, "r2");
  return ACK;
}

async function runR2Phase(
  qc: PurgeContext,
  user: UserRow,
  record: DeletionRecord | null
): Promise<QueueOutcome> {
  const done = await sweepUserObjects(qc.env.JOBS_FILES, user.id);
  qc.log("purge_user_r2", { done });
  if (!done) {
    await sendPurge(qc.env, user.id, "r2");
    return ACK;
  }
  await markPhase(qc.env, record, "r2", qc.now);
  await sendPurge(qc.env, user.id, "cv_kv");
  return ACK;
}

async function runCvKvPhase(
  qc: PurgeContext,
  user: UserRow,
  record: DeletionRecord | null
): Promise<QueueOutcome> {
  const removed = await deleteOwnedDocuments(
    qc.env,
    user.email,
    record?.also_delete_cvs ?? false
  );
  qc.log("purge_user_cv_kv", {
    cvs: removed.cvs,
    legacy_jobs: removed.legacyJobs,
  });
  await markPhase(qc.env, record, "cv_kv", qc.now);
  return ACK;
}

/** One `purge_user` message. */
export async function runPurgePhase(qc: PurgeContext): Promise<QueueOutcome> {
  const user = await findUserById(qc.env.DB, qc.scope.userId);
  if (!user || user.deleted_at === null) {
    qc.log("purge_user_skipped", {
      reason: user ? "not_tombstoned" : "no_user",
    });
    return ACK;
  }
  const record = await readDeletionRecord(qc.env.JOBS_FILES, user.id);
  switch (qc.message.phase) {
    case "jobs_db":
      return await runJobsDbPhase(qc, user, record);
    case "r2":
      return await runR2Phase(qc, user, record);
    default:
      return await runCvKvPhase(qc, user, record);
  }
}
