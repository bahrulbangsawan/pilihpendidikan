// POST /api/v1/tasks/{t}/attempts/{a}/late-evidence (05 §8, 20 §6.3 A):
// evidence (or a result) that arrives after the attempt's lease was lost.
//
//   - only the device that held THAT attempt's lease may send it (404 for
//     anyone else, ids never leak); refused while the lease is still live
//     (report through …/result instead);
//   - append-only: a `submission_evidence` row every time;
//   - only an attempt that passed its submit checkpoint (or an assisted
//     human click) moves the submission status, and only forward, with a
//     `submission_status_changed` event `via: late_evidence`; "forward"
//     includes the evidence edge `outcome_unknown → submitted_unverified`
//     (`isForwardSubmission`, 13 §5 S-24), while a user's decision (deny →
//     failed, confirm → submitted_verified) is never lowered;
//   - the stage never moves against a user decision: the kernel precedence
//     rule records `conflict_recorded` (the dashboard notice) instead;
//   - the task may move outcome_unknown → submitted (21 §12).

import type { LateEvidenceRequest } from "@pilihpendidikan/jobs-contracts/api";
import type {
  ChangeSource,
  SubmissionStatus,
} from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationRecord,
  AutomationAttemptRecord,
  AutomationTaskRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { invalidTransition, notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import {
  attachAttemptLogStatements,
  insertEvidenceStatements,
  lateEvidenceTaskStatements,
} from "../../repo/automation/lease";
import { attemptHadIntent } from "../../repo/automation/limits";
import { HOLDING_STATES } from "../../repo/automation/records";
import { loadAttempt, loadTask } from "../../repo/automation/tasks";
import type { TransitionPlan } from "../../repo/core/application-state";
import {
  loadApplication,
  planApplicationTransition,
} from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { evidenceRecord, evidenceStatus, isSubmitted } from "./evidence";
import { taskEvent } from "./shared";

export interface LateEvidenceResponse {
  application: ApplicationRecord;
  conflict_recorded: boolean;
  evidence: SubmissionEvidenceRecord;
  task: AutomationTaskRecord;
}

export interface LateEvidenceInput {
  attemptId: string;
  body: LateEvidenceRequest;
  deviceId: string;
  now: number;
  source: ChangeSource;
  taskId: string;
}

async function attemptOfDevice(
  db: JobsDb,
  scope: UserScope,
  input: LateEvidenceInput
): Promise<{ attempt: AutomationAttemptRecord; task: AutomationTaskRecord }> {
  const task = await loadTask(db, scope, input.taskId);
  const attempt = task ? await loadAttempt(db, scope, input.attemptId) : null;
  if (
    !(task && attempt) ||
    attempt.task_id !== task.id ||
    attempt.device_id !== input.deviceId
  ) {
    throw notFound("Attempt not found.");
  }
  if (task.kind !== "apply" || !task.application_id) {
    throw invalidTransition("Late evidence is only for apply tasks.");
  }
  const leaseLive =
    task.lease_id === attempt.lease_id &&
    (HOLDING_STATES as readonly string[]).includes(task.state) &&
    task.lease_expires_at !== null &&
    task.lease_expires_at > input.now;
  if (leaseLive) {
    throw invalidTransition(
      "This attempt's lease is still valid: report through …/result.",
      { reason: "lease_still_valid" }
    );
  }
  return { attempt, task };
}

/** The submission status the late report stands for (null: evidence only). */
function lateTarget(
  body: LateEvidenceRequest,
  hadIntent: boolean
): SubmissionStatus | null {
  if (!hadIntent) {
    return null;
  }
  const negative = body.evidence.verdict === "negative";
  if (body.outcome === "outcome_unknown" && !negative) {
    return body.evidence.verdict === "verified"
      ? "submitted_verified"
      : "outcome_unknown";
  }
  if (body.outcome === "failed" && !negative) {
    return null;
  }
  return evidenceStatus(body.evidence.verdict);
}

export async function planLateEvidence(
  db: JobsDb,
  scope: UserScope,
  input: LateEvidenceInput
): Promise<{
  response: LateEvidenceResponse;
  statements: D1PreparedStatement[];
}> {
  const { now, body } = input;
  const { attempt, task } = await attemptOfDevice(db, scope, input);
  const applicationId = task.application_id as string;
  const evidence = evidenceRecord(scope, task, attempt.id, body.evidence, now);
  const statements = [...insertEvidenceStatements(db, scope, evidence)];
  const hadIntent =
    task.payload.mode === "assisted" ||
    (await attemptHadIntent(db, scope, attempt.id));
  const target = lateTarget(body, hadIntent);
  let transition: TransitionPlan | null = null;
  if (target) {
    const submitted = isSubmitted(target);
    transition = await planApplicationTransition(db, scope, {
      applicationId,
      actor: "automation",
      source: input.source,
      now,
      actorDeviceId: input.deviceId,
      automation: {
        taskId: task.id,
        taskCreatedAt: task.created_at,
        attemptId: attempt.id,
      },
      eventKeyPrefix: `task:${task.id}:late:${evidence.id}`,
      occurredAt: body.evidence.captured_at,
      submission: {
        to: target,
        evidenceId: evidence.id,
        method: submitted ? "browser" : null,
        submittedAt: submitted ? body.evidence.captured_at : null,
        via: "late_evidence",
      },
      ...(submitted
        ? { stage: { to: "applied" as const, reason: "late_evidence" } }
        : {}),
    });
    statements.push(...transition.statements);
  }
  let after = task;
  if (isSubmitted(target) && task.state === "outcome_unknown") {
    statements.push(
      ...lateEvidenceTaskStatements(db, scope, task.id, now),
      ...taskEvent(
        db,
        scope,
        task,
        {
          type: "automation_task_finished",
          actorKind: "system",
          actorDeviceId: input.deviceId,
          attemptId: attempt.id,
          state: "submitted",
          key: `task:${task.id}:late:${evidence.id}:finished`,
          message: "Late evidence confirmed the submission.",
        },
        now
      )
    );
    after = {
      ...task,
      state: "submitted",
      finished_at: task.finished_at ?? now,
      revision: task.revision + 1,
      updated_at: now,
    };
  }
  if (body.log_file_id) {
    statements.push(
      ...attachAttemptLogStatements(db, scope, attempt.id, body.log_file_id)
    );
  }
  const application =
    transition?.after ?? (await loadApplication(db, scope, applicationId));
  if (!application) {
    throw notFound("Application not found.");
  }
  return {
    statements,
    response: {
      evidence,
      task: after,
      application,
      conflict_recorded: transition?.stage?.result === "conflict",
    },
  };
}
