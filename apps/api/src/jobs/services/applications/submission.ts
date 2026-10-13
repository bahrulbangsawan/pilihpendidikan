// `POST /api/v1/applications/{app_id}/submission` (05 §5, 03 §5.2, D-18):
// the user's own statement about a submission.
//
//   mark_applied  "I applied" (06 §2.2 dialog, CLI `applied`): status →
//                 submitted_verified with `user_attestation` evidence; the
//                 card moves to `applied` from saved/preparing/ready (06 §3).
//   confirm       an unconfirmed / unknown / failed outcome was submitted
//                 after all: → submitted_verified (+ attestation, same move).
//   deny          it was not submitted: → failed (negative attestation);
//                 the application's `outcome_unknown` apply tasks → failed
//                 (21 §12 "user: not submitted"). The stage stays.
//
// User decisions may set any status (20 §6.2); a request that changes
// nothing is a no-op (200, `evidence: null`).

import type { SubmissionRequest } from "@pilihpendidikan/jobs-contracts/api";
import type {
  EvidenceVerdict,
  Stage,
  SubmissionAction,
  SubmissionStatus,
} from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  invalidRequest,
  invalidTransition,
  notFound,
  revisionConflict,
} from "../../core/http";
import type { UserScope } from "../../core/scope";
import {
  failUnknownTaskStatements,
  insertEvidenceStatements,
  outcomeUnknownTasks,
} from "../../repo/applications/submission";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import { planTransitionWithRank } from "./stage";
import type { WriteContext } from "./update";

/** Stages from which "I applied" also moves the card to `applied` (06 §3). */
const BEFORE_APPLIED: readonly Stage[] = ["saved", "preparing", "ready"];

/** Statuses each action may start from (other ones are refused with 422). */
const ACTION_FROM: Readonly<
  Record<SubmissionAction, readonly SubmissionStatus[]>
> = {
  mark_applied: [
    "not_started",
    "in_progress",
    "failed",
    "outcome_unknown",
    "submitted_unverified",
    "submitted_verified",
  ],
  confirm: [
    "submitted_unverified",
    "outcome_unknown",
    "failed",
    "submitted_verified",
  ],
  deny: [
    "submitted_unverified",
    "outcome_unknown",
    "submitted_verified",
    "failed",
  ],
};

/** Clock skew tolerated for a user-entered `applied_at` (03 §1). */
const APPLIED_AT_SKEW_MS = 86_400_000;

export interface SubmissionWrite {
  application: ApplicationRecord;
  evidence: SubmissionEvidenceRecord | null;
  statements: D1PreparedStatement[];
}

function targetOf(action: SubmissionAction): {
  status: SubmissionStatus;
  verdict: EvidenceVerdict;
} {
  return action === "deny"
    ? { status: "failed", verdict: "negative" }
    : { status: "submitted_verified", verdict: "verified" };
}

function attestation(
  scope: UserScope,
  app: ApplicationRecord,
  body: SubmissionRequest,
  now: number
): SubmissionEvidenceRecord {
  const { verdict } = targetOf(body.action);
  const signals: Record<string, unknown> = {
    source: `user_${body.action}`,
    user_confirmed: body.action !== "deny",
  };
  if (body.method) {
    signals.method = body.method;
  }
  return {
    id: newId("evd", now),
    user_id: scope.userId,
    application_id: app.id,
    task_id: null,
    attempt_id: null,
    kind: "user_attestation",
    verdict,
    signals,
    final_url: null,
    page_title: null,
    text_excerpt: null,
    screenshot_file_id: null,
    form_hash: null,
    captured_at: body.action === "deny" ? now : (body.applied_at ?? now),
    recorded_at: now,
  };
}

async function denyTaskStatements(
  db: JobsDb,
  scope: UserScope,
  app: ApplicationRecord,
  input: WriteContext
): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [];
  for (const task of await outcomeUnknownTasks(db, scope, app.id)) {
    statements.push(
      ...failUnknownTaskStatements(db, scope, task.id, input.now),
      ...appendEvent(
        db,
        scope,
        {
          applicationId: app.id,
          type: "automation_task_finished",
          actorKind: input.actor,
          actorDeviceId: input.actorDeviceId,
          taskId: task.id,
          payload: {
            task_id: task.id,
            state: "failed",
            message: "Marked not submitted by the user.",
          },
        },
        input.now
      ).statements
    );
  }
  return statements;
}

/** Plans one submission action. */
export async function planSubmission(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & {
    applicationId: string;
    baseRevision: number;
    body: SubmissionRequest;
  }
): Promise<SubmissionWrite> {
  const { body, now } = input;
  if (
    body.applied_at !== undefined &&
    body.applied_at > now + APPLIED_AT_SKEW_MS
  ) {
    throw invalidRequest("applied_at is in the future.");
  }
  const app = await loadApplication(db, scope, input.applicationId);
  if (!app) {
    throw notFound("Application not found.");
  }
  if (app.revision !== input.baseRevision) {
    throw revisionConflict(
      app,
      `Application changed since revision ${input.baseRevision} (now ${app.revision}).`
    );
  }
  const from = app.submission_status;
  if (!ACTION_FROM[body.action].includes(from)) {
    throw invalidTransition(
      body.action === "deny"
        ? "There is no submission to deny."
        : "There is no submission to confirm; use mark_applied.",
      { reason: `nothing_to_${body.action}`, submission_status: from }
    );
  }
  const target = targetOf(body.action);
  const moveStage =
    body.action !== "deny" && BEFORE_APPLIED.includes(app.stage);
  const statusChanges = from !== target.status;
  if (!(statusChanges || moveStage)) {
    return { application: app, evidence: null, statements: [] };
  }
  const evidence = statusChanges ? attestation(scope, app, body, now) : null;
  let method = body.method ?? null;
  if (body.action === "mark_applied") {
    method ??= "manual";
  }
  const ranked = await planTransitionWithRank(db, scope, {
    applicationId: app.id,
    actor: input.actor,
    actorDeviceId: input.actorDeviceId,
    source: input.source,
    now,
    baseRevision: input.baseRevision,
    stage: moveStage ? { to: "applied", reason: body.action } : undefined,
    submission: statusChanges
      ? {
          to: target.status,
          evidenceId: evidence?.id ?? null,
          method,
          submittedAt: body.applied_at ?? null,
        }
      : undefined,
  });
  const statements = [...ranked.statements];
  if (evidence) {
    statements.push(...insertEvidenceStatements(db, scope, evidence));
  }
  if (body.action === "deny") {
    statements.push(...(await denyTaskStatements(db, scope, app, input)));
  }
  if (body.note) {
    statements.push(
      ...appendEvent(
        db,
        scope,
        {
          applicationId: app.id,
          type: "note_added",
          actorKind: input.actor,
          actorDeviceId: input.actorDeviceId,
          payload: { text: body.note, kind: `submission_${body.action}` },
        },
        now
      ).statements
    );
  }
  return { application: ranked.application, evidence, statements };
}
