// The synchronous submit gate: POST /tasks/{t}/lease/{l}/submit-intent
// (21 §6.5, D-28, D-19, 19 §8.2–§8.3, D-35, 11 T-06 / T-11).
//
// Preconditions, read for an explained refusal and repeated as guards in the
// write batch (D1 runs batches one at a time, so two intents cannot both
// slip through):
//   - the lease is current (fence) and no cancel was requested;
//   - automation is enabled and not paused; the task is an apply task with
//     submit checkpoints left (one re-submit after a negative check, 19 §9.2);
//   - the application is the user's, not archived / withdrawn / rejected /
//     accepted, not already submitted or of unknown outcome, and no other
//     live task holds an intent for it;
//   - mode approval (or an auto task that fell back to approval): an APPROVED
//     submit approval of this task whose payload binds this form_hash, used
//     at most once;
//   - mode auto: the rule is effective now (flag, approved activation of
//     exactly this content, unexpired, active hours), covers the posting
//     (allowlisted domain, auto-capable adapter, browser_supported), the CV
//     policy holds, and the rule's daily and per-company limits allow it;
//   - every mode: the global cap of 40 submissions per user per day.
// Effects: `submit_intent_at = now`, state running, application submission
// status → in_progress (forward-only), a `submit_intent` event.

import type { SubmitIntentRequest } from "@pilihpendidikan/jobs-contracts/api";
import type { ChangeSource } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationRecord,
  AutomationAttemptRecord,
  AutomationTaskRecord,
  JobPostingRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { FeatureFlags } from "../../core/flags";
import { apiError, invalidTransition, notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { loadApproval } from "../../repo/automation/approvals";
import { postingOfUserJob, variantFile } from "../../repo/automation/context";
import type { LeaseRef } from "../../repo/automation/lease";
import {
  fenceGuard,
  guardApplicationSubmittable,
  guardNoOtherIntent,
  guardNotCancelled,
  leaseTaskUpdate,
} from "../../repo/automation/lease";
import {
  approvalUses,
  guardApprovalUnused,
  guardCompanyCap,
  guardGlobalCap,
  guardRuleCap,
  intentCounts,
  taskIntentCount,
} from "../../repo/automation/limits";
import { loadActivation, loadRule } from "../../repo/automation/rules";
import { otherIntentHolder } from "../../repo/automation/tasks";
import {
  loadApplication,
  planApplicationTransition,
} from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import { getUserSettings } from "../../repo/core/settings";
import { requireLease } from "./lease";
import {
  companyKey,
  coverageProblem,
  GLOBAL_SUBMISSIONS_PER_DAY,
  ruleIneffective,
} from "./policy";
import { duplicate, leaseLost, refuse } from "./shared";

const CLOSED_STAGES = new Set(["withdrawn", "rejected", "accepted"]);
const SUBMITTED = new Set(["submitted_verified", "submitted_unverified"]);
/** 19 §9.2: a negative verification allows one more submit gate. */
const MAX_INTENTS_PER_TASK = 2;

export interface SubmitIntentContext {
  flags: Pick<
    FeatureFlags,
    "JOBS_AUTOMATION_ENABLED" | "JOBS_AUTO_MODE_ENABLED"
  >;
  now: number;
  source: ChangeSource;
}

interface IntentPath {
  approvalId: string | null;
  guards: D1PreparedStatement[];
  ruleId: string | null;
}

interface Target {
  app: ApplicationRecord;
  posting: JobPostingRecord;
}

function autoModeOff() {
  return apiError(
    "mode_not_allowed",
    "Automatic submission (auto mode) is not available right now.",
    { details: { flag: "JOBS_AUTO_MODE_ENABLED" } }
  );
}

/** Task-level preconditions (flags, kind, cancel, kill switch, checkpoints). */
async function assertTaskMaySubmit(
  db: JobsDb,
  scope: UserScope,
  task: AutomationTaskRecord,
  ctx: SubmitIntentContext
): Promise<number> {
  if (!ctx.flags.JOBS_AUTOMATION_ENABLED) {
    throw refuse(
      "Automation is not available right now.",
      "automation_disabled"
    );
  }
  if (task.kind !== "apply" || !task.application_id) {
    throw invalidTransition("Only apply tasks submit.");
  }
  if (task.payload.mode === "assisted") {
    throw apiError(
      "mode_not_allowed",
      "In assisted mode you click Submit yourself; submit-intent is not used."
    );
  }
  if (task.cancel_requested) {
    throw refuse("The task was cancelled.", "cancel_requested");
  }
  const settings = await getUserSettings(db, scope, ctx.now);
  if (settings.automation_paused) {
    throw refuse("Automation is paused.", "automation_paused");
  }
  const intents = await taskIntentCount(db, scope, task.id);
  if (intents >= MAX_INTENTS_PER_TASK) {
    throw refuse(
      "This task already used its submit checkpoints.",
      "intent_limit"
    );
  }
  return intents;
}

/** The application and posting, refusing double submissions (21 §9). */
async function submittableTarget(
  db: JobsDb,
  scope: UserScope,
  task: AutomationTaskRecord
): Promise<Target> {
  const app = await loadApplication(db, scope, task.application_id as string);
  if (!app) {
    throw notFound("Application not found.");
  }
  if (app.archived || CLOSED_STAGES.has(app.stage)) {
    throw refuse(
      `The application is ${app.archived ? "archived" : app.stage}.`,
      "application_closed"
    );
  }
  if (SUBMITTED.has(app.submission_status)) {
    throw duplicate(
      "This application was already submitted.",
      "already_submitted"
    );
  }
  if (app.submission_status === "outcome_unknown") {
    throw duplicate(
      "A previous submission of this application has an unknown outcome.",
      "outcome_unknown"
    );
  }
  if (await otherIntentHolder(db, scope, app.id, task.id)) {
    throw duplicate(
      "Another task is already submitting this application.",
      "other_intent"
    );
  }
  const posting = await postingOfUserJob(db, scope, app.user_job_id);
  if (!posting) {
    throw notFound("Posting not found.");
  }
  return { app, posting };
}

/** Mode approval: an approved, unused submit approval binding this form. */
async function approvalPath(
  db: JobsDb,
  scope: UserScope,
  task: AutomationTaskRecord,
  body: SubmitIntentRequest
): Promise<IntentPath> {
  const approval = await loadApproval(db, scope, body.approval_id as string);
  if (!approval || approval.task_id !== task.id || approval.kind !== "submit") {
    throw refuse(
      "No submit approval of this task has that id.",
      "approval_missing"
    );
  }
  if (approval.state !== "approved") {
    throw refuse(
      `The approval is ${approval.state}, not approved.`,
      "approval_not_approved",
      {
        state: approval.state,
      }
    );
  }
  const approvedForm =
    approval.payload.type === "browser_submit"
      ? approval.payload.form_hash
      : null;
  if (approvedForm !== body.form_hash) {
    throw refuse(
      "The form changed after it was approved: ask for a new approval.",
      "approval_mismatch"
    );
  }
  if ((await approvalUses(db, scope, approval.id)) > 0) {
    throw refuse(
      "This approval was already used for a submission.",
      "approval_used"
    );
  }
  return {
    approvalId: approval.id,
    ruleId: null,
    guards: [guardApprovalUnused(db, scope, approval.id)],
  };
}

/** Mode auto: the rule, its coverage, the CV policy and its limits. */
async function autoPath(
  db: JobsDb,
  scope: UserScope,
  input: {
    body: SubmitIntentRequest;
    companyKey: string | null;
    ctx: SubmitIntentContext;
    target: Target;
    task: AutomationTaskRecord;
  }
): Promise<IntentPath> {
  const { body, ctx, target, task } = input;
  if (!ctx.flags.JOBS_AUTO_MODE_ENABLED) {
    throw autoModeOff();
  }
  const ruleId = task.payload.rule_id ?? null;
  if (!ruleId || (body.rule_id && body.rule_id !== ruleId)) {
    throw refuse("The task's auto rule does not match.", "rule_mismatch");
  }
  const rule = await loadRule(db, scope, ruleId);
  if (!rule) {
    throw refuse("The auto rule no longer exists.", "rule_missing");
  }
  const settings = await getUserSettings(db, scope, ctx.now);
  const activation = rule.activated_approval_id
    ? await loadActivation(db, scope, rule.activated_approval_id)
    : null;
  const ineffective = ruleIneffective(rule, {
    activation,
    autoModeEnabled: true,
    now: ctx.now,
    timezone: settings.timezone,
  });
  if (ineffective) {
    throw refuse(
      `The auto rule cannot submit now (${ineffective}).`,
      `rule_${ineffective}`
    );
  }
  const coverage = coverageProblem(rule, target.posting);
  if (coverage) {
    throw refuse(
      `The rule does not cover this posting (${coverage}).`,
      coverage
    );
  }
  const variant = target.app.cv_variant_id
    ? await variantFile(db, scope, target.app.cv_variant_id)
    : null;
  const baseCvAllowed =
    rule.cv_policy.require_cv_approval === false &&
    rule.cv_policy.tailor !== true;
  if (variant?.status !== "approved" && !baseCvAllowed) {
    throw refuse(
      "The application has no approved CV variant.",
      "cv_not_approved"
    );
  }
  const key = input.companyKey;
  const counts = await intentCounts(db, scope, {
    companyKey: key,
    now: ctx.now,
    ruleId: rule.id,
  });
  if ((counts.rule24h ?? 0) >= rule.limits.max_per_day) {
    throw refuse("The rule's daily limit is reached.", "limit_reached", {
      limit: "max_per_day",
      counts,
    });
  }
  if (key && (counts.company30d ?? 0) >= rule.limits.max_per_company_per_30d) {
    throw refuse(
      "The per-company limit for 30 days is reached.",
      "limit_reached",
      {
        limit: "max_per_company_per_30d",
        counts,
      }
    );
  }
  const guards = [
    guardRuleCap(db, scope, rule.id, ctx.now, rule.limits.max_per_day),
  ];
  if (key) {
    guards.push(
      guardCompanyCap(
        db,
        scope,
        key,
        ctx.now,
        rule.limits.max_per_company_per_30d
      )
    );
  }
  return { approvalId: null, ruleId: rule.id, guards };
}

async function choosePath(
  db: JobsDb,
  scope: UserScope,
  input: {
    body: SubmitIntentRequest;
    companyKey: string | null;
    ctx: SubmitIntentContext;
    target: Target;
    task: AutomationTaskRecord;
  }
): Promise<IntentPath> {
  if (input.body.approval_id) {
    return await approvalPath(db, scope, input.task, input.body);
  }
  if (input.task.payload.mode === "auto") {
    return await autoPath(db, scope, input);
  }
  throw refuse(
    "Approval mode needs an approved submit approval.",
    "approval_required"
  );
}

async function assertGlobalCap(
  db: JobsDb,
  scope: UserScope,
  now: number
): Promise<void> {
  const counts = await intentCounts(db, scope, {
    companyKey: null,
    now,
    ruleId: null,
  });
  if (counts.global24h >= GLOBAL_SUBMISSIONS_PER_DAY) {
    throw refuse(
      `At most ${GLOBAL_SUBMISSIONS_PER_DAY} submissions a day.`,
      "limit_reached",
      {
        limit: "global",
        counts,
      }
    );
  }
}

/** POST …/submit-intent: the server-side submit gate (D-28). */
export async function planSubmitIntent(
  db: JobsDb,
  scope: UserScope,
  ref: LeaseRef,
  body: SubmitIntentRequest,
  ctx: SubmitIntentContext
): Promise<{
  response: { submit_intent_at: number };
  statements: D1PreparedStatement[];
}> {
  const { now } = ctx;
  const { task, attempt } = await requireLease(db, scope, ref, now);
  if (!attempt) {
    throw leaseLost();
  }
  const previous = await assertTaskMaySubmit(db, scope, task, ctx);
  const target = await submittableTarget(db, scope, task);
  const key = companyKey(target.posting);
  const path = await choosePath(db, scope, {
    body,
    companyKey: key,
    ctx,
    target,
    task,
  });
  await assertGlobalCap(db, scope, now);
  const statements = await intentStatements(db, scope, {
    attempt,
    body,
    companyKey: key,
    ctx,
    path,
    previous,
    ref,
    target,
    task,
  });
  console.log(
    JSON.stringify({
      evt: "submit_intent",
      task_id: task.id,
      mode: task.payload.mode ?? null,
      via: path.approvalId ? "approval" : "rule",
    })
  );
  return { statements, response: { submit_intent_at: now } };
}

async function intentStatements(
  db: JobsDb,
  scope: UserScope,
  input: {
    attempt: AutomationAttemptRecord;
    body: SubmitIntentRequest;
    companyKey: string | null;
    ctx: SubmitIntentContext;
    path: IntentPath;
    previous: number;
    ref: LeaseRef;
    target: Target;
    task: AutomationTaskRecord;
  }
): Promise<D1PreparedStatement[]> {
  const { attempt, body, ctx, path, ref, target, task } = input;
  const { now } = ctx;
  const intentKey = `task:${task.id}:intent:${input.previous + 1}`;
  const transition = await planApplicationTransition(db, scope, {
    applicationId: target.app.id,
    actor: "automation",
    source: ctx.source,
    now,
    submission: { to: "in_progress" },
    automation: {
      taskId: task.id,
      taskCreatedAt: task.created_at,
      attemptId: attempt.id,
    },
    actorDeviceId: ref.deviceId,
    eventKeyPrefix: intentKey,
  });
  const payload: Record<string, unknown> = {
    task_id: task.id,
    attempt_id: attempt.id,
    form_hash: body.form_hash,
    mode: task.payload.mode ?? "approval",
  };
  if (path.approvalId) {
    payload.approval_id = path.approvalId;
  }
  if (path.ruleId) {
    payload.rule_id = path.ruleId;
  }
  if (input.companyKey) {
    payload.company_key = input.companyKey;
  }
  return [
    fenceGuard(db, scope, ref, now),
    guardNotCancelled(db, scope, task.id),
    guardApplicationSubmittable(db, scope, target.app.id),
    guardNoOtherIntent(db, scope, target.app.id, task.id),
    guardGlobalCap(db, scope, now, GLOBAL_SUBMISSIONS_PER_DAY),
    ...path.guards,
    ...leaseTaskUpdate(
      db,
      scope,
      ref,
      now,
      [
        ["submit_intent_at", now],
        ["state", "running"],
        ["pause_reason", null],
      ],
      { extraWhere: "cancel_requested = 0" }
    ),
    ...transition.statements,
    ...appendEvent(
      db,
      scope,
      {
        applicationId: target.app.id,
        type: "submit_intent",
        actorKind: "automation",
        actorDeviceId: ref.deviceId,
        taskId: task.id,
        attemptId: attempt.id,
        payload,
        idempotencyKey: intentKey,
        onDuplicate: "abort",
      },
      now
    ).statements,
  ];
}
