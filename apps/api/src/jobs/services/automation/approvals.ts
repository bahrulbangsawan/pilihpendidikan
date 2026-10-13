// Approvals (03 §8, 21 §6.3–§6.4, 19 §8.2, 20 §6.2):
//
//   decide (web / CLI / MCP)   first decision wins; bound to payload_hash;
//                              `automation:manage` (MCP: leaf-2.10 checks
//                              allow_mcp_approvals + kind before calling)
//   device create (lease)      submit / answer approvals; task → awaiting_approval
//   device poll (lease)        the approval of this task
//
// Effects of a decision, in the decision's batch:
//   submit/answer approved   released task (no lease) → queued with
//                            payload.resume_from_approval (21 §6.4); a leased
//                            task continues when its device polls
//   submit/answer rejected   released task → cancelled (approval_rejected);
//                            leased task → cancel_requested (heartbeat)
//   answer approved          answers ticked "save for future" go to the bank
//   rule_activation approved the `auto` rule turns on (its content must be
//                            exactly what was approved)
//   cv_variant               delegated to leaf-2.6's
//                            planCvVariantApprovalDecision (attach the PDF,
//                            preparing → ready when the rule says so)

import type { CreateLeaseApprovalRequest } from "@pilihpendidikan/jobs-contracts/api";
import type {
  AutoUse,
  Sensitivity,
} from "@pilihpendidikan/jobs-contracts/enums";
import { normalizeText } from "@pilihpendidikan/jobs-contracts/fingerprint";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApprovalRecord,
  AutomationAttemptRecord,
  AutomationRuleRecord,
  AutomationTaskRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { APPROVAL_PAYLOAD_TYPES } from "@pilihpendidikan/jobs-contracts/records";
import { APPROVAL_EXPIRY_MS } from "@pilihpendidikan/jobs-contracts/stage";
import type { Env } from "../../../env";
import { getFeatureFlags } from "../../core/flags";
import {
  apiError,
  invalidRequest,
  notFound,
  revisionConflict,
} from "../../core/http";
import type { UserScope } from "../../core/scope";
import { upsertAnswerStatements } from "../../repo/automation/answers";
import {
  decideApprovalStatements,
  expireApprovalStatements,
  insertApprovalStatements,
  loadApproval,
  pendingTaskApprovals,
} from "../../repo/automation/approvals";
import type { LeaseRef } from "../../repo/automation/lease";
import { fenceGuard, leaseTaskUpdate } from "../../repo/automation/lease";
import { activateRuleStatements, loadRule } from "../../repo/automation/rules";
import {
  cancelUnleasedApprovalTaskStatements,
  flagCancelLeasedStatements,
  loadTask,
  resumeFromApprovalStatements,
} from "../../repo/automation/tasks";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import { planCvVariantApprovalDecision } from "../cv/index";
import { planEmailApprovalDecision } from "../email/index";
import { activationMatches } from "./policy";
import { taskEvent } from "./shared";

/** The API representation of an approval (contracts `ApprovalRecord`). */
export type ApprovalApi = ApprovalRecord;

export interface DecideApprovalInput {
  approvalId: string;
  decision: "approve" | "reject";
  now: number;
  payloadHash: string;
  response?: unknown;
  via: "web" | "cli" | "mcp";
}

export interface DecideApprovalResult {
  approval: ApprovalApi;
  rule: AutomationRuleRecord | null;
  statements: D1PreparedStatement[];
  /** The linked task as it will be after the batch (null when none). */
  task: AutomationTaskRecord | null;
}

interface ResponseAnswer {
  auto_use?: AutoUse;
  ref: string;
  save_to_bank?: boolean;
  sensitivity?: Sensitivity;
  value: string;
}

const SENSITIVITY_RANK: Readonly<Record<Sensitivity, number>> = {
  none: 0,
  personal: 1,
  protected: 2,
};

/** The stricter class: a user can raise, never lower, a question's class. */
function stricter(
  question: Sensitivity,
  answer: Sensitivity | undefined
): Sensitivity {
  if (!answer) {
    return question;
  }
  return SENSITIVITY_RANK[answer] > SENSITIVITY_RANK[question]
    ? answer
    : question;
}

function answersOf(response: unknown): ResponseAnswer[] {
  if (!response || typeof response !== "object") {
    return [];
  }
  const answers = (response as { answers?: unknown }).answers;
  return Array.isArray(answers) ? (answers as ResponseAnswer[]) : [];
}

/** The answer-bank statements of an approved `answer` approval (03 §9). */
function answerBankStatements(
  db: JobsDb,
  scope: UserScope,
  approval: ApprovalRecord,
  response: unknown,
  now: number
): D1PreparedStatement[] {
  if (approval.payload.type !== "answer") {
    return [];
  }
  const questions = approval.payload.questions;
  const answers = answersOf(response);
  const required = questions.filter((q) => q.required).map((q) => q.ref);
  const answered = new Set(answers.map((a) => a.ref));
  const missing = required.filter((ref) => !answered.has(ref));
  if (missing.length > 0) {
    throw apiError(
      "policy_violation",
      "Answer every required question before approving.",
      { details: { reason: "answers_missing", refs: missing } }
    );
  }
  const statements: D1PreparedStatement[] = [];
  for (const answer of answers) {
    const question = questions.find((q) => q.ref === answer.ref);
    if (!question) {
      throw invalidRequest(`Unknown question ref "${answer.ref}".`);
    }
    if (!(answer.save_to_bank && question.question_key)) {
      continue;
    }
    const sensitivity = stricter(question.sensitivity, answer.sensitivity);
    const autoUse: AutoUse = answer.auto_use ?? "approval";
    if (sensitivity === "protected" && autoUse === "always") {
      throw apiError(
        "policy_violation",
        "A protected answer can never be used automatically.",
        { details: { reason: "protected_always", ref: answer.ref } }
      );
    }
    statements.push(
      ...upsertAnswerStatements(db, scope, {
        id: newId("ans", now),
        questionKey: question.question_key,
        answer: answer.value,
        answerKind: question.options.length > 0 ? "choice" : "text",
        sensitivity,
        autoUse,
        matchPatterns: [normalizeText(question.question)].filter(Boolean),
        now,
      })
    );
  }
  return statements;
}

function approvalEvent(
  db: JobsDb,
  scope: UserScope,
  approval: ApprovalRecord,
  input: { decision: string; via: string },
  now: number
): D1PreparedStatement[] {
  if (!approval.application_id) {
    return [];
  }
  return appendEvent(
    db,
    scope,
    {
      applicationId: approval.application_id,
      type: "approval_decided",
      actorKind: input.via === "mcp" ? "mcp" : "user",
      taskId: approval.task_id,
      payload: {
        approval_id: approval.id,
        kind: approval.kind,
        decision: input.decision,
        decided_via: input.via,
      },
      idempotencyKey: `approval:${approval.id}:decided`,
    },
    now
  ).statements;
}

async function taskEffects(
  db: JobsDb,
  scope: UserScope,
  approval: ApprovalRecord,
  approved: boolean,
  now: number
): Promise<{
  statements: D1PreparedStatement[];
  task: AutomationTaskRecord | null;
}> {
  if (
    !(
      approval.task_id &&
      (approval.kind === "submit" || approval.kind === "answer")
    )
  ) {
    return { statements: [], task: null };
  }
  const task = await loadTask(db, scope, approval.task_id);
  if (!task) {
    return { statements: [], task: null };
  }
  const released =
    task.state === "awaiting_approval" &&
    task.lease_id === null &&
    task.submit_intent_at === null;
  if (approved && released && !task.cancel_requested) {
    return {
      statements: resumeFromApprovalStatements(
        db,
        scope,
        task.id,
        approval.id,
        now
      ),
      task: {
        ...task,
        state: "queued",
        payload: { ...task.payload, resume_from_approval: approval.id },
        not_before: now,
        revision: task.revision + 1,
        updated_at: now,
      },
    };
  }
  if (!approved && released) {
    return {
      statements: [
        ...cancelUnleasedApprovalTaskStatements(
          db,
          scope,
          task.id,
          "approval_rejected",
          now
        ),
        ...taskEvent(
          db,
          scope,
          task,
          {
            type: "automation_task_finished",
            actorKind: "user",
            state: "cancelled",
            errorClass: "approval_rejected",
            key: `task:${task.id}:finished`,
            message: "You rejected the approval.",
          },
          now
        ),
      ],
      task: {
        ...task,
        state: "cancelled",
        error_class: "approval_rejected",
        finished_at: now,
        revision: task.revision + 1,
        updated_at: now,
      },
    };
  }
  if (!approved && task.lease_id !== null && task.submit_intent_at === null) {
    return {
      statements: flagCancelLeasedStatements(
        db,
        scope,
        task.id,
        "approval_rejected",
        now
      ),
      task: {
        ...task,
        cancel_requested: true,
        revision: task.revision + 1,
        updated_at: now,
      },
    };
  }
  return { statements: [], task };
}

/** Approval decision latency (21 §15). */
function logDecision(
  approval: ApprovalRecord,
  state: string,
  via: string,
  now: number
): void {
  console.log(
    JSON.stringify({
      evt: "approval_decided",
      kind: approval.kind,
      decision: state,
      via,
      latency_ms: now - approval.created_at,
    })
  );
}

/** Pending, unexpired and bound to the hash the decider saw (03 §8, 20 §6.2). */
function assertDecidable(
  approval: ApprovalRecord,
  payloadHash: string,
  now: number
): void {
  if (
    approval.state === "expired" ||
    (approval.state === "pending" && approval.expires_at <= now)
  ) {
    throw apiError("approval_expired", "This approval has expired.", {
      details: { current: approval },
    });
  }
  if (approval.state !== "pending") {
    throw revisionConflict(
      approval,
      `This approval was already ${approval.state}.`
    );
  }
  if (payloadHash !== approval.payload_hash) {
    throw apiError(
      "revision_conflict",
      "The approval changed: review the current content and decide again.",
      { details: { reason: "payload_hash_mismatch", current: approval } }
    );
  }
}

/** The rule an approved `rule_activation` turns on (content must still match). */
async function activationEffects(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  approval: ApprovalRecord,
  now: number
): Promise<{ rule: AutomationRuleRecord; statements: D1PreparedStatement[] }> {
  const ruleId =
    approval.payload.type === "rule_activation"
      ? approval.payload.rule_id
      : null;
  const current = ruleId ? await loadRule(db, scope, ruleId) : null;
  if (!current || current.mode !== "auto") {
    throw apiError(
      "approval_expired",
      "The rule this approval activates changed or no longer exists."
    );
  }
  if (!activationMatches(current, approval)) {
    throw apiError(
      "revision_conflict",
      "The rule changed after this activation was requested.",
      { details: { reason: "rule_changed", current } }
    );
  }
  const flags = await getFeatureFlags(env, now);
  if (!flags.JOBS_AUTO_MODE_ENABLED) {
    throw apiError(
      "mode_not_allowed",
      "Automatic submission (auto mode) is not available right now.",
      { details: { flag: "JOBS_AUTO_MODE_ENABLED" } }
    );
  }
  return {
    statements: activateRuleStatements(db, scope, current, approval.id, now),
    rule: {
      ...current,
      enabled: true,
      activated_approval_id: approval.id,
      revision: current.revision + 1,
      updated_at: now,
    },
  };
}

/** A `cv_variant` decision belongs to the CV area (05 §7, leaf-2.6). */
async function cvVariantDecision(
  db: JobsDb,
  scope: UserScope,
  approval: ApprovalRecord,
  input: DecideApprovalInput,
  response: unknown
): Promise<D1PreparedStatement[]> {
  const note =
    response && typeof response === "object" && "note" in response
      ? String((response as { note?: unknown }).note ?? "")
      : "";
  const plan = await planCvVariantApprovalDecision(db, scope, {
    approval,
    decidedVia: input.via,
    decision: input.decision,
    now: input.now,
    payloadHash: input.payloadHash,
    reason: note || undefined,
    source: input.via,
  });
  return plan.statements;
}

/**
 * Decides an approval (POST /approvals/{id}/decide; MCP `jobs_approval_decide`
 * through leaf-2.10). Returns the batch to commit — the first statement is
 * the first-decision-wins guard, so a racing decision aborts it.
 */
export async function decideApproval(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  input: DecideApprovalInput
): Promise<DecideApprovalResult> {
  const { now } = input;
  const approval = await loadApproval(db, scope, input.approvalId);
  if (!approval) {
    throw notFound("Approval not found.");
  }
  assertDecidable(approval, input.payloadHash, now);
  const approved = input.decision === "approve";
  const state = approved ? "approved" : "rejected";
  const response = input.response ?? null;
  const decided: ApprovalRecord = {
    ...approval,
    state,
    response: response as ApprovalRecord["response"],
    decided_via: input.via,
    decided_by_user_id: scope.userId,
    decided_at: now,
    revision: approval.revision + 1,
  };
  if (approval.payload.type === "email_submit") {
    // An email draft's submit approval belongs to the email area (09 §4,
    // leaf-2.9): approve = the effects of POST /emails/{id}/approve for a
    // local hand-off (server_send → 422 "approve on the email"); reject →
    // the approval is rejected and the draft kept. MCP clients may draft
    // but never approve an email (09 §8, T9-03).
    if (input.via === "mcp" && input.decision === "approve") {
      throw apiError(
        "policy_violation",
        "Emails are approved in the dashboard or the CLI, not by an MCP client.",
        { details: { reason: "mcp_cannot_approve_email" } }
      );
    }
    const plan = await planEmailApprovalDecision(db, scope, {
      approval,
      decision: input.decision,
      env,
      now,
      payloadHash: input.payloadHash,
      source: input.via,
    });
    logDecision(approval, state, input.via, now);
    return {
      approval: plan.approval,
      rule: null,
      statements: plan.statements,
      task: null,
    };
  }
  if (approval.kind === "cv_variant") {
    const statements = await cvVariantDecision(
      db,
      scope,
      approval,
      input,
      response
    );
    logDecision(approval, state, input.via, now);
    return { approval: decided, rule: null, statements, task: null };
  }
  const statements = decideApprovalStatements(db, scope, approval, {
    state,
    response,
    decidedVia: input.via,
    now,
  });
  if (approved && approval.kind === "answer") {
    statements.push(
      ...answerBankStatements(db, scope, approval, response, now)
    );
  }
  let rule: AutomationRuleRecord | null = null;
  if (approved && approval.kind === "rule_activation") {
    const activation = await activationEffects(db, scope, env, approval, now);
    statements.push(...activation.statements);
    rule = activation.rule;
  }
  const effects = await taskEffects(db, scope, approval, approved, now);
  statements.push(
    ...effects.statements,
    ...approvalEvent(
      db,
      scope,
      approval,
      { decision: state, via: input.via },
      now
    )
  );
  logDecision(approval, state, input.via, now);
  return { approval: decided, rule, statements, task: effects.task };
}

// ---------------------------------------------------------------------------
// Device side (lease-scoped)
// ---------------------------------------------------------------------------

/**
 * POST /tasks/{t}/lease/{l}/approvals: a submit or answer approval from the
 * device; the task waits in `awaiting_approval` (the lease stays alive by
 * heartbeats). Older pending approvals of the same kind are superseded.
 */
export async function planCreateLeaseApproval(
  db: JobsDb,
  scope: UserScope,
  ref: LeaseRef,
  input: {
    attempt: AutomationAttemptRecord | null;
    body: CreateLeaseApprovalRequest;
    now: number;
    task: AutomationTaskRecord;
  }
): Promise<{ approval: ApprovalRecord; statements: D1PreparedStatement[] }> {
  const { task, body, now } = input;
  if (task.kind !== "apply" || !task.application_id) {
    throw apiError("invalid_transition", "Only apply tasks ask for approvals.");
  }
  const allowed: readonly string[] = APPROVAL_PAYLOAD_TYPES[body.kind];
  if (
    !allowed.includes(body.payload.type) ||
    body.payload.type === "email_submit"
  ) {
    throw invalidRequest(
      `A ${body.kind} approval cannot carry a ${body.payload.type} payload.`
    );
  }
  if (body.kind === "submit" && task.payload.mode === "assisted") {
    throw apiError(
      "mode_not_allowed",
      "In assisted mode you click Submit yourself; no submit approval is needed."
    );
  }
  const superseded = await pendingTaskApprovals(db, scope, task.id, body.kind);
  const approval: ApprovalRecord = {
    id: newId("apr", now),
    user_id: scope.userId,
    kind: body.kind,
    task_id: task.id,
    application_id: task.application_id,
    payload: body.payload,
    payload_hash: body.payload_hash,
    state: "pending",
    response: null,
    decided_via: null,
    decided_by_user_id: null,
    decided_at: null,
    expires_at: now + APPROVAL_EXPIRY_MS[body.kind],
    created_at: now,
    revision: 1,
  };
  const statements: D1PreparedStatement[] = [
    fenceGuard(db, scope, ref, now),
    ...expireApprovalStatements(db, scope, superseded, now),
    ...insertApprovalStatements(db, scope, approval),
    ...leaseTaskUpdate(db, scope, ref, now, [
      ["state", "awaiting_approval"],
      ["pause_reason", null],
    ]),
    ...appendEvent(
      db,
      scope,
      {
        applicationId: task.application_id,
        type: "approval_requested",
        actorKind: "automation",
        actorDeviceId: ref.deviceId,
        taskId: task.id,
        attemptId: input.attempt?.id ?? null,
        payload: { approval_id: approval.id, kind: approval.kind },
        idempotencyKey: `approval:${approval.id}:requested`,
      },
      now
    ).statements,
  ];
  return { approval, statements };
}

/** GET /tasks/{t}/lease/{l}/approvals/{apr}: the device's poll. */
export async function getLeaseApproval(
  db: JobsDb,
  scope: UserScope,
  input: { approvalId: string; now: number; task: AutomationTaskRecord }
): Promise<ApprovalRecord> {
  const approval = await loadApproval(db, scope, input.approvalId);
  if (!approval || approval.task_id !== input.task.id) {
    throw notFound("Approval not found.");
  }
  if (approval.state === "pending" && approval.expires_at <= input.now) {
    return { ...approval, state: "expired" };
  }
  return approval;
}
