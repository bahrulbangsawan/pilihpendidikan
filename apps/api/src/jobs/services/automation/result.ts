// The end of an attempt (21 §6.2, §6.4, §6.6, §8, 20 §6.2, D-18, D-19):
//
//   POST …/result   the terminal report: task state, application submission
//                   status (forward-only) and stage (precedence), the evidence
//                   row, the attempt closed, the lease cleared; a retryable
//                   failure BEFORE the intent re-queues with backoff
//   POST …/release  give the task back before the intent (409 too_late
//                   after): awaiting_approval keeps its state without a lease
//                   (or moves on if the approval was already decided);
//                   needs_headed re-queues with `headed_browser`
//
// `application_update` in the report is advisory: the server derives the
// submission status from the evidence (facts win, forward-only, 20 §6.2) and
// the stage from the precedence rule, never from the device's base_revision.
//
// After `submit_intent` only facts decide: verified evidence → submitted,
// negative evidence → failed, anything else → outcome_unknown. Nothing is
// ever re-queued past the intent (every re-queue is conditional on
// `submit_intent_at IS NULL`, and the batch is fenced on the intent as read).

import type { TaskResultRequest } from "@pilihpendidikan/jobs-contracts/api";
import type {
  AttemptOutcome,
  ChangeSource,
  PauseReason,
  ReleaseReason,
  SubmissionStatus,
  TaskState,
} from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationRecord,
  AutomationAttemptRecord,
  AutomationTaskRecord,
  SubmissionEvidenceRecord,
  TaskPayload,
} from "@pilihpendidikan/jobs-contracts/records";
import { invalidRequest, invalidTransition } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { latestTaskApproval } from "../../repo/automation/approvals";
import type { FieldValue, LeaseRef } from "../../repo/automation/lease";
import {
  CLEAR_LEASE,
  closeAttemptStatements,
  fenceGuard,
  guardIntentAsRead,
  insertEvidenceStatements,
  leaseTaskUpdate,
  linkRunStatements,
} from "../../repo/automation/lease";
import type { TransitionPlan } from "../../repo/core/application-state";
import {
  loadApplication,
  planApplicationTransition,
} from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { retryBackoffMs } from "../../repo/core/leases";
import type { EvidenceInput } from "./evidence";
import { evidenceRecord, evidenceStatus } from "./evidence";
import { requireLease } from "./lease";
import { shouldRetry } from "./policy";
import type { TaskEventInput } from "./shared";
import { taskEvent, tooLate } from "./shared";

export interface ResultResponse {
  application: ApplicationRecord | null;
  conflict_recorded: boolean;
  evidence: SubmissionEvidenceRecord | null;
  task: AutomationTaskRecord;
}

interface ResultDecision {
  attemptOutcome: AttemptOutcome;
  errorClass: string | null;
  requeue: boolean;
  submission: SubmissionStatus | null;
  taskState: TaskState;
  via?: "assisted_user_click";
}

const TERMINAL = new Set<TaskState>([
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
]);

/**
 * After an intent (or an assisted human click), only facts decide: verified
 * evidence is a submission, negative evidence a failure; unverified evidence
 * counts as an unconfirmed submission only when the device reports one;
 * anything else is `outcome_unknown` for the user to resolve.
 */
function afterIntent(
  evidence: EvidenceInput | undefined,
  reported: TaskResultRequest["outcome"],
  errorClass: string | null
): ResultDecision {
  const verdict = evidence?.verdict;
  const reportsSubmission =
    reported === "submitted" || reported === "cancelled";
  if (
    verdict === "verified" ||
    (verdict === "unverified" && reportsSubmission)
  ) {
    return {
      taskState: "submitted",
      attemptOutcome: "submitted",
      submission: evidenceStatus(verdict),
      errorClass: null,
      requeue: false,
    };
  }
  if (verdict === "negative") {
    return {
      taskState: "failed",
      attemptOutcome: "failed",
      submission: "failed",
      errorClass: errorClass ?? "validation_errors_unresolved",
      requeue: false,
    };
  }
  return {
    taskState: "outcome_unknown",
    attemptOutcome: "outcome_unknown",
    submission: "outcome_unknown",
    errorClass,
    requeue: false,
  };
}

/** A failure before any intent: retry per 21 §8, else failed. */
function beforeIntentFailure(
  task: AutomationTaskRecord,
  body: TaskResultRequest
): ResultDecision {
  const retry = shouldRetry({
    attemptCount: task.attempt_count,
    clientRetryable: body.retryable,
    errorClass: body.error_class,
    maxAttempts: task.max_attempts,
    submitIntentAt: task.submit_intent_at,
  });
  return {
    taskState: retry ? "queued" : "failed",
    attemptOutcome: "failed",
    submission: null,
    errorClass: body.error_class ?? "unknown",
    requeue: retry,
  };
}

function submittedDecision(
  task: AutomationTaskRecord,
  body: TaskResultRequest,
  intent: boolean
): ResultDecision {
  if (task.kind !== "apply") {
    throw invalidTransition("Only apply tasks report submitted.");
  }
  if (!body.evidence) {
    throw invalidRequest("A submitted result needs its evidence.");
  }
  if (body.evidence.verdict === "negative") {
    throw invalidTransition(
      "Negative evidence is not a submission; report failed."
    );
  }
  const assisted = task.payload.mode === "assisted";
  if (!(intent || assisted)) {
    throw invalidTransition(
      "No submit_intent was recorded for this task; it cannot have submitted."
    );
  }
  return {
    taskState: "submitted",
    attemptOutcome: "submitted",
    submission: evidenceStatus(body.evidence.verdict),
    errorClass: null,
    requeue: false,
    ...(intent ? {} : { via: "assisted_user_click" as const }),
  };
}

function decideResult(
  task: AutomationTaskRecord,
  body: TaskResultRequest
): ResultDecision {
  const intent = task.submit_intent_at !== null;
  const humanClicked =
    task.kind === "apply" && task.payload.mode === "assisted";
  const errorClass = body.error_class ?? null;
  switch (body.outcome) {
    case "submitted":
      return submittedDecision(task, body, intent);
    case "succeeded":
      if (task.kind === "apply") {
        throw invalidTransition(
          "Apply tasks end submitted, failed or cancelled."
        );
      }
      return {
        taskState: "succeeded",
        attemptOutcome: "succeeded",
        submission: null,
        errorClass: null,
        requeue: false,
      };
    case "failed":
      return intent
        ? afterIntent(body.evidence, body.outcome, errorClass)
        : beforeIntentFailure(task, body);
    case "cancelled":
      if (intent) {
        return afterIntent(
          body.evidence,
          body.outcome,
          errorClass ?? body.reason ?? null
        );
      }
      return {
        taskState: "cancelled",
        attemptOutcome: "cancelled",
        submission: null,
        errorClass: body.reason ?? errorClass ?? "cancelled",
        requeue: false,
      };
    default:
      return intent || humanClicked
        ? afterIntent(body.evidence, body.outcome, errorClass)
        : beforeIntentFailure(task, body);
  }
}

async function resultTransition(
  db: JobsDb,
  scope: UserScope,
  input: {
    attempt: AutomationAttemptRecord | null;
    body: TaskResultRequest;
    decision: ResultDecision;
    evidence: SubmissionEvidenceRecord | null;
    now: number;
    ref: LeaseRef;
    source: ChangeSource;
    task: AutomationTaskRecord;
  }
): Promise<TransitionPlan | null> {
  const { decision, task, body, now } = input;
  if (!(task.application_id && task.kind === "apply" && decision.submission)) {
    return null;
  }
  const submitted = decision.taskState === "submitted";
  return await planApplicationTransition(db, scope, {
    applicationId: task.application_id,
    actor: "automation",
    source: input.source,
    now,
    actorDeviceId: input.ref.deviceId,
    automation: {
      taskId: task.id,
      taskCreatedAt: task.created_at,
      attemptId: input.attempt?.id ?? null,
    },
    eventKeyPrefix: `task:${task.id}:result:${input.ref.leaseId}`,
    occurredAt: body.evidence?.captured_at,
    submission: {
      to: decision.submission,
      evidenceId: input.evidence?.id ?? null,
      method: submitted ? "browser" : null,
      submittedAt: submitted ? (body.evidence?.captured_at ?? now) : null,
      ...(decision.via ? { via: decision.via } : {}),
    },
    ...(submitted
      ? { stage: { to: "applied" as const, reason: "submitted" } }
      : {}),
  });
}

/** The task columns a result writes, and the payload it ends with. */
function resultFields(
  task: AutomationTaskRecord,
  body: TaskResultRequest,
  decision: ResultDecision,
  now: number
): { fields: Array<readonly [string, FieldValue]>; payload: TaskPayload } {
  const fields: Array<readonly [string, FieldValue]> = [
    ...CLEAR_LEASE,
    ["state", decision.taskState],
    ["error_class", decision.errorClass],
  ];
  if (TERMINAL.has(decision.taskState)) {
    fields.push(["finished_at", now]);
  }
  if (decision.requeue) {
    fields.push(
      ["not_before", now + retryBackoffMs(task.attempt_count)],
      ["pause_reason", null],
      ["local_state", null]
    );
  }
  const payload: TaskPayload = { ...task.payload };
  if (body.run_id && task.kind === "discover") {
    payload.result_run_id = body.run_id;
  }
  if (body.file_id && task.kind === "render_cv") {
    payload.result_file_id = body.file_id;
  }
  if (body.reason && decision.taskState === "cancelled") {
    payload.cancel_reason = body.reason.slice(0, 60);
  }
  fields.push(["payload", { json: payload }]);
  return { fields, payload };
}

function resultEvent(
  task: AutomationTaskRecord,
  decision: ResultDecision,
  input: { attemptId: string | null; ref: LeaseRef }
): TaskEventInput {
  const terminal = TERMINAL.has(decision.taskState);
  return {
    type: terminal ? "automation_task_finished" : "automation_task_progress",
    actorKind: "automation",
    actorDeviceId: input.ref.deviceId,
    attemptId: input.attemptId,
    state: decision.taskState,
    errorClass: decision.errorClass,
    key: terminal
      ? `task:${task.id}:finished`
      : `task:${task.id}:retry:${input.ref.leaseId}`,
    message: decision.requeue ? "The task will be retried." : undefined,
  };
}

/** Task outcomes by error class, mode and kind (21 §15). */
function logResult(
  task: AutomationTaskRecord,
  body: TaskResultRequest,
  decision: ResultDecision,
  attemptNo: number | null
): void {
  console.log(
    JSON.stringify({
      evt: "task_result",
      task_id: task.id,
      kind: task.kind,
      mode: task.payload.mode ?? null,
      reported: body.outcome,
      state: decision.taskState,
      error_class: decision.errorClass,
      attempt_no: attemptNo,
    })
  );
}

/** POST …/result: the terminal report of an attempt. */
export async function planResult(
  db: JobsDb,
  scope: UserScope,
  ref: LeaseRef,
  body: TaskResultRequest,
  input: { now: number; source: ChangeSource }
): Promise<{ response: ResultResponse; statements: D1PreparedStatement[] }> {
  const { now } = input;
  const { task, attempt } = await requireLease(db, scope, ref, now);
  const decision = decideResult(task, body);
  const statements: D1PreparedStatement[] = [
    fenceGuard(db, scope, ref, now),
    guardIntentAsRead(db, scope, task.id, task.submit_intent_at !== null),
  ];
  const evidence =
    body.evidence && task.kind === "apply" && task.application_id
      ? evidenceRecord(scope, task, attempt?.id ?? null, body.evidence, now)
      : null;
  if (evidence) {
    statements.push(...insertEvidenceStatements(db, scope, evidence));
  }
  const transition = await resultTransition(db, scope, {
    attempt,
    body,
    decision,
    evidence,
    now,
    ref,
    source: input.source,
    task,
  });
  if (transition) {
    statements.push(...transition.statements);
  }
  if (body.run_id && task.kind === "discover") {
    statements.push(...linkRunStatements(db, scope, body.run_id, task.id, now));
  }
  const { fields, payload } = resultFields(task, body, decision, now);
  statements.push(
    ...leaseTaskUpdate(db, scope, ref, now, fields, {
      extraWhere: decision.requeue ? "submit_intent_at IS NULL" : undefined,
    })
  );
  if (attempt) {
    statements.push(
      ...closeAttemptStatements(db, scope, {
        attemptId: attempt.id,
        outcome: decision.attemptOutcome,
        errorClass: decision.errorClass,
        stepsCount: body.stats?.steps_count ?? null,
        aiCalls: body.stats?.ai_calls ?? null,
        logFileId: body.log_file_id ?? null,
        now,
      })
    );
  }
  statements.push(
    ...taskEvent(
      db,
      scope,
      task,
      resultEvent(task, decision, { attemptId: attempt?.id ?? null, ref }),
      now
    )
  );
  logResult(task, body, decision, attempt?.attempt_no ?? null);
  let application: ApplicationRecord | null = transition?.after ?? null;
  if (!application && task.application_id) {
    application = await loadApplication(db, scope, task.application_id);
  }
  return {
    statements,
    response: {
      task: taskAfterResult(task, decision, payload, now),
      application,
      evidence,
      conflict_recorded: transition?.stage?.result === "conflict",
    },
  };
}

/** The task as the result batch leaves it (the response body). */
function taskAfterResult(
  task: AutomationTaskRecord,
  decision: ResultDecision,
  payload: TaskPayload,
  now: number
): AutomationTaskRecord {
  const terminal = TERMINAL.has(decision.taskState);
  return {
    ...task,
    state: decision.taskState,
    error_class: decision.errorClass,
    payload,
    lease_id: null,
    lease_device_id: null,
    lease_expires_at: null,
    finished_at: terminal ? now : task.finished_at,
    not_before: decision.requeue
      ? now + retryBackoffMs(task.attempt_count)
      : task.not_before,
    pause_reason: decision.requeue ? null : task.pause_reason,
    revision: task.revision + 1,
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

interface ReleaseDecision {
  attemptOutcome: AttemptOutcome;
  errorClass: string | null;
  eventType: TaskEventInput["type"];
  message: string;
  pauseReason: PauseReason | null;
  payload: TaskPayload;
  requiredCapabilities: AutomationTaskRecord["required_capabilities"];
  resumeApproval: boolean;
  state: TaskState;
}

function requeueDecision(
  task: AutomationTaskRecord,
  reason: ReleaseReason
): ReleaseDecision {
  if (reason !== "needs_headed") {
    return {
      attemptOutcome: "paused",
      errorClass: null,
      eventType: "automation_task_progress",
      message: "Released by the device; the task is queued again.",
      pauseReason: null,
      payload: { ...task.payload },
      requiredCapabilities: task.required_capabilities,
      resumeApproval: false,
      state: "queued",
    };
  }
  const caps = task.required_capabilities.includes("headed_browser")
    ? task.required_capabilities
    : [...task.required_capabilities, "headed_browser" as const];
  return {
    attemptOutcome: "paused",
    errorClass: null,
    eventType: "automation_task_paused",
    message: "Needs a device with a display; the task is queued for one.",
    pauseReason: "needs_headed_restart",
    payload: { ...task.payload, retry_hint: "needs_headed" },
    requiredCapabilities: caps,
    resumeApproval: false,
    state: "queued",
  };
}

function cancelledDecision(
  task: AutomationTaskRecord,
  errorClass: string,
  message: string
): ReleaseDecision {
  return {
    attemptOutcome: "cancelled",
    errorClass,
    eventType: "automation_task_finished",
    message,
    pauseReason: null,
    payload: { ...task.payload },
    requiredCapabilities: task.required_capabilities,
    resumeApproval: false,
    state: "cancelled",
  };
}

/**
 * 21 §12: a pre-intent release re-queues only while attempts remain; a
 * release on the last attempt fails the task, like a lost lease (21 §7).
 */
function exhaustedDecision(
  task: AutomationTaskRecord,
  reason: ReleaseReason
): ReleaseDecision {
  return {
    attemptOutcome: "paused",
    errorClass: "attempts_exhausted",
    eventType: "automation_task_finished",
    message: `Released by the device (${reason}) on its last attempt; the task failed.`,
    pauseReason: null,
    payload: { ...task.payload },
    requiredCapabilities: task.required_capabilities,
    resumeApproval: false,
    state: "failed",
  };
}

/** A released approval wait moves on if its approval was already decided. */
async function approvalWaitDecision(
  db: JobsDb,
  scope: UserScope,
  task: AutomationTaskRecord,
  now: number
): Promise<ReleaseDecision> {
  const approval = await latestTaskApproval(db, scope, task.id);
  if (approval?.state === "approved") {
    return {
      attemptOutcome: "paused",
      errorClass: null,
      eventType: "automation_task_progress",
      message: "Approved; the task is queued to finish the submission.",
      pauseReason: null,
      payload: { ...task.payload, resume_from_approval: approval.id },
      requiredCapabilities: task.required_capabilities,
      resumeApproval: true,
      state: "queued",
    };
  }
  const notGiven =
    approval && (approval.state !== "pending" || approval.expires_at <= now);
  if (notGiven) {
    const reason =
      approval.state === "rejected" ? "approval_rejected" : "approval_expired";
    return cancelledDecision(
      task,
      reason,
      "The approval was not given; the task is cancelled."
    );
  }
  return {
    attemptOutcome: "paused",
    errorClass: null,
    eventType: "automation_task_progress",
    message: "Waiting for your approval; the device released the browser.",
    pauseReason: null,
    payload: { ...task.payload },
    requiredCapabilities: task.required_capabilities,
    resumeApproval: false,
    state: "awaiting_approval",
  };
}

/**
 * When a released task may be claimed again: an approved resume goes at once
 * (the user is waiting on it); any other re-queue keeps the retry backoff of
 * a lost lease (`retryBackoffMs`, 21 §7), so a device that keeps giving the
 * task back cannot spin on it.
 */
function releaseNotBefore(
  task: AutomationTaskRecord,
  decision: ReleaseDecision,
  now: number
): number {
  return decision.resumeApproval
    ? now
    : now + retryBackoffMs(task.attempt_count);
}

function releaseFields(
  task: AutomationTaskRecord,
  decision: ReleaseDecision,
  now: number
): Array<readonly [string, FieldValue]> {
  const fields: Array<readonly [string, FieldValue]> = [
    ...CLEAR_LEASE,
    ["state", decision.state],
    ["pause_reason", null],
    ["local_state", null],
    ["payload", { json: decision.payload }],
    ["required_capabilities", { json: decision.requiredCapabilities }],
  ];
  if (decision.state === "queued") {
    fields.push(["not_before", releaseNotBefore(task, decision, now)]);
  }
  if (decision.state === "cancelled" || decision.state === "failed") {
    fields.push(["error_class", decision.errorClass], ["finished_at", now]);
  }
  if (decision.resumeApproval) {
    fields.push([
      "max_attempts",
      { sql: "MAX(max_attempts, attempt_count + 1)" },
    ]);
  }
  return fields;
}

/** POST …/release: give the task back before submit_intent. */
export async function planRelease(
  db: JobsDb,
  scope: UserScope,
  ref: LeaseRef,
  body: { reason: ReleaseReason },
  now: number
): Promise<{ statements: D1PreparedStatement[]; task: AutomationTaskRecord }> {
  const { task, attempt } = await requireLease(db, scope, ref, now);
  if (task.submit_intent_at !== null) {
    throw tooLate();
  }
  if (
    body.reason === "awaiting_approval" &&
    task.state !== "awaiting_approval"
  ) {
    throw invalidTransition(
      "Only a task awaiting approval can be released for it.",
      {
        state: task.state,
      }
    );
  }
  let decision: ReleaseDecision;
  if (task.cancel_requested) {
    decision = cancelledDecision(task, "cancelled", "Cancelled.");
  } else if (task.state === "awaiting_approval") {
    decision = await approvalWaitDecision(db, scope, task, now);
  } else if (task.attempt_count >= task.max_attempts) {
    decision = exhaustedDecision(task, body.reason);
  } else {
    decision = requeueDecision(task, body.reason);
  }
  const finished =
    decision.state === "cancelled" || decision.state === "failed";
  const statements: D1PreparedStatement[] = [
    fenceGuard(db, scope, ref, now),
    guardIntentAsRead(db, scope, task.id, false),
    ...leaseTaskUpdate(
      db,
      scope,
      ref,
      now,
      releaseFields(task, decision, now),
      {
        extraWhere:
          decision.state === "queued" ? "submit_intent_at IS NULL" : undefined,
      }
    ),
  ];
  if (attempt) {
    statements.push(
      ...closeAttemptStatements(db, scope, {
        attemptId: attempt.id,
        outcome: decision.attemptOutcome,
        errorClass: body.reason,
        now,
      })
    );
  }
  statements.push(
    ...taskEvent(
      db,
      scope,
      task,
      {
        type: decision.eventType,
        actorKind: "automation",
        actorDeviceId: ref.deviceId,
        attemptId: attempt?.id ?? null,
        state: decision.state,
        message: decision.message,
        pauseReason: decision.pauseReason,
        key: finished
          ? `task:${task.id}:finished`
          : `task:${task.id}:release:${ref.leaseId}`,
      },
      now
    )
  );
  return {
    statements,
    task: {
      ...task,
      state: decision.state,
      payload: decision.payload,
      required_capabilities: decision.requiredCapabilities,
      lease_id: null,
      lease_device_id: null,
      lease_expires_at: null,
      pause_reason: null,
      local_state: null,
      error_class: finished ? decision.errorClass : task.error_class,
      not_before:
        decision.state === "queued"
          ? releaseNotBefore(task, decision, now)
          : task.not_before,
      finished_at: finished ? now : task.finished_at,
      revision: task.revision + 1,
      updated_at: now,
    },
  };
}
