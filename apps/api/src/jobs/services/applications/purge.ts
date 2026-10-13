// Hard delete (06 §8 `DELETE /api/v1/applications/{app_id}?purge=1`).
//
// One batch removes the application and everything hanging off it (repo
// purge.ts) and keeps the user_job as `dismissed`. After the batch commits —
// never before, so a failed batch loses nothing:
//   - the R2 objects of the files only this application referenced;
//   - the private tailored CV documents of its variants (D-25, apps/cv
//     documents in CV_KV, owner-stamped to the caller);
//   - `rollup_user` messages for the local days its events fell on, so the
//     `analytics_daily` cache forgets it too ("purged applications are
//     gone", 10 §1; archived ones stay).

import type { JobsAiMessage } from "@pilihpendidikan/jobs-contracts/queue";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import { normalizeEmail } from "../../../auth";
import type { Env } from "../../../env";
import { clearOwner, resolveOwner } from "../../../ownership";
import { invalidTransition, notFound, revisionConflict } from "../../core/http";
import type { UserScope } from "../../core/scope";
import {
  liveTasksOf,
  storedSettings,
} from "../../repo/applications/applications";
import type { PurgeFile } from "../../repo/applications/purge";
import {
  eventTimes,
  filesOnlyReferencedBy,
  purgeStatements,
  tailoredCvIds,
} from "../../repo/applications/purge";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { USER_SETTINGS_DEFAULTS } from "../../repo/core/settings";

/** R2 `delete()` accepts at most 1,000 keys per call. */
const R2_DELETE_CHUNK = 1000;
/** Days per `rollup_user` message (≤ 400 by contract; stays < 8 KB). */
const ROLLUP_DAYS_PER_MESSAGE = 200;
/** Queue `sendBatch` limit (14 §6). */
const SEND_BATCH_MAX = 100;

export interface PurgePlan {
  application: ApplicationRecord;
  files: PurgeFile[];
  /** Local days (YYYY-MM-DD, user timezone) of the purged events. */
  rollupDays: string[];
  statements: D1PreparedStatement[];
  tailoredCvIds: string[];
}

function dayFormatter(timezone: string): Intl.DateTimeFormat {
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  } as const;
  try {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: timezone });
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      ...options,
      timeZone: USER_SETTINGS_DEFAULTS.timezone,
    });
  }
}

/** Distinct local days of `times` in `timezone`, ascending. */
export function localDays(
  times: readonly number[],
  timezone: string
): string[] {
  const format = dayFormatter(timezone);
  return [...new Set(times.map((t) => format.format(t)))].sort();
}

/**
 * Plans the purge. 404 when not the caller's; 409 `revision_conflict` with
 * `details.current` on a stale base revision; 422 `invalid_transition` while
 * an apply task is live (`submission_in_flight` past submit_intent, else
 * `task_live`: cancel it first).
 */
export async function planPurge(
  db: JobsDb,
  scope: UserScope,
  input: { applicationId: string; baseRevision: number | null; now: number }
): Promise<PurgePlan> {
  const app = await loadApplication(db, scope, input.applicationId);
  if (!app) {
    throw notFound("Application not found.");
  }
  if (input.baseRevision !== null && app.revision !== input.baseRevision) {
    throw revisionConflict(
      app,
      `Application changed since revision ${input.baseRevision} (now ${app.revision}).`
    );
  }
  const live = await liveTasksOf(db, scope, app.id);
  const [first] = live;
  if (first) {
    const inFlight = live.find((task) => task.submit_intent_at !== null);
    throw invalidTransition(
      inFlight
        ? "A submission for this application is in flight."
        : "Cancel the running automation before deleting this application.",
      {
        reason: inFlight ? "submission_in_flight" : "task_live",
        task_id: (inFlight ?? first).id,
      }
    );
  }
  const files = await filesOnlyReferencedBy(db, scope, app.id);
  const timezone =
    (await storedSettings(db, scope))?.timezone ??
    USER_SETTINGS_DEFAULTS.timezone;
  return {
    application: app,
    files,
    rollupDays: localDays(await eventTimes(db, scope, app.id), timezone),
    tailoredCvIds: await tailoredCvIds(db, scope, app.id),
    statements: purgeStatements(db, scope, {
      applicationId: app.id,
      userJobId: app.user_job_id,
      revision: app.revision,
      fileIds: files.map((file) => file.id),
      now: input.now,
    }),
  };
}

function rollupMessages(scope: UserScope, days: readonly string[]) {
  const messages: JobsAiMessage[] = [];
  for (let i = 0; i < days.length; i += ROLLUP_DAYS_PER_MESSAGE) {
    messages.push({
      v: 1,
      message_id: crypto.randomUUID(),
      user_id: scope.userId,
      type: "rollup_user",
      days: days.slice(i, i + ROLLUP_DAYS_PER_MESSAGE),
    });
  }
  return messages;
}

function logFailure(
  evt: string,
  requestId: string,
  plan: PurgePlan,
  err: unknown
): void {
  console.warn({
    evt,
    request_id: requestId,
    application_id: plan.application.id,
    error: err instanceof Error ? err.name : String(err),
  });
}

export interface PurgeCleanup {
  cvDocuments: number;
  r2Objects: number;
  rollupMessages: number;
}

/**
 * Runs after the purge batch committed: R2 objects, the caller's tailored CV
 * documents, the analytics rollup. Failures are logged (ids only) and never
 * undo the purge.
 */
export async function removePurgedObjects(
  env: Env,
  scope: UserScope,
  plan: PurgePlan,
  context: { ownerEmail: string; requestId: string }
): Promise<PurgeCleanup> {
  const cleanup: PurgeCleanup = {
    cvDocuments: 0,
    r2Objects: 0,
    rollupMessages: 0,
  };
  const keys = plan.files.map((file) => file.r2_key);
  for (let i = 0; i < keys.length; i += R2_DELETE_CHUNK) {
    const chunk = keys.slice(i, i + R2_DELETE_CHUNK);
    try {
      await env.JOBS_FILES.delete(chunk);
      cleanup.r2Objects += chunk.length;
    } catch (err) {
      logFailure("purge_r2_delete_failed", context.requestId, plan, err);
    }
  }
  for (const cvId of plan.tailoredCvIds) {
    const owner = await resolveOwner(env, "cv", cvId);
    if (owner && normalizeEmail(owner) === normalizeEmail(context.ownerEmail)) {
      await env.CV_KV.delete(`cv:${cvId}`);
      await clearOwner(env, "cv", cvId);
      cleanup.cvDocuments += 1;
    }
  }
  const messages = rollupMessages(scope, plan.rollupDays);
  for (let i = 0; i < messages.length; i += SEND_BATCH_MAX) {
    const group = messages.slice(i, i + SEND_BATCH_MAX);
    try {
      await env.JOBS_AI_QUEUE.sendBatch(group.map((body) => ({ body })));
      cleanup.rollupMessages += group.length;
    } catch (err) {
      logFailure("purge_rollup_enqueue_failed", context.requestId, plan, err);
    }
  }
  return cleanup;
}
