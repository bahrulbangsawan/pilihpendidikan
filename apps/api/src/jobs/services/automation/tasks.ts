// Task creation and the web-side task controls (05 §8, 21 §4, §8, §12,
// D-29): create, cancel, retry, resume.
//
// Creation policy (21 §4):
//   - kill switches: JOBS_AUTOMATION_ENABLED (all kinds), JOBS_AUTO_MODE_ENABLED
//     (auto), `user_settings.automation_paused` (apply);
//   - scope (D-29): `automation:manage`, or base `automation:execute` only for
//     an assisted/approval apply task targeted at the calling device;
//   - apply: owned application, not archived / already submitted / past
//     applied, mode ∈ assisted|approval|auto, auto covered by an effective
//     auto rule (approved activation, domain, adapter, support), at most one
//     live apply task per application (409 duplicate + the existing id);
//   - an eligible device must exist (or the target device must be eligible)
//     unless `queue_without_device`;
//   - required capabilities: the kind's, plus `headed_browser` for assisted;
//   - `expires_at = max(now, not_before) + 72 h`; `app.mode` follows the task.

import type {
  ApplicationMode,
  ChangeSource,
  DeviceCapability,
  TaskCreatedBy,
  TaskKind,
} from "@pilihpendidikan/jobs-contracts/enums";
import { newId, newUlid } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationRecord,
  AutomationRuleRecord,
  AutomationTaskRecord,
  JobPostingRecord,
  TaskPayload,
  UserSettingsRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import type { FeatureFlags } from "../../core/flags";
import type { ApiError } from "../../core/http";
import {
  apiError,
  insufficientScope,
  invalidRequest,
  invalidTransition,
  notFound,
} from "../../core/http";
import type { UserScope } from "../../core/scope";
import { cliVersions } from "../../core/version";
import {
  expireApprovalStatements,
  pendingApprovalsOfTask,
} from "../../repo/automation/approvals";
import {
  postingOfUserJob,
  sourcesFor,
  variantApplication,
} from "../../repo/automation/context";
import type { DeviceSummary } from "../../repo/automation/devices";
import {
  listActiveDevices,
  loadUserDevice,
} from "../../repo/automation/devices";
import { intentCounts } from "../../repo/automation/limits";
import {
  listEnabledRules,
  loadActivation,
  loadRule,
} from "../../repo/automation/rules";
import {
  findLiveApplyTask,
  findTaskByIdempotencyKey,
  finishUnleasedTaskStatements,
  insertTaskStatements,
  loadTask,
  requestCancelStatements,
  requestResumeStatements,
  setApplicationModeStatements,
} from "../../repo/automation/tasks";
import {
  loadApplication,
  planApplicationTransition,
} from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { TASK_QUEUE_TTL_MS } from "../../repo/core/leases";
import { getUserSettings } from "../../repo/core/settings";
import {
  companyKey,
  coverageProblem,
  GLOBAL_SUBMISSIONS_PER_DAY,
  ruleIneffective,
} from "./policy";
import { taskEvent, tooLate, versionAtLeast } from "./shared";

const AUTOMATABLE_MODES: readonly ApplicationMode[] = [
  "assisted",
  "approval",
  "auto",
];
const POST_APPLY_STAGES = new Set([
  "applied",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
]);
const SUBMITTED = new Set(["submitted_verified", "submitted_unverified"]);
/** Payload keys that describe one run and never carry over to a retry. */
const RUN_ONLY_KEYS = [
  "resume_from_approval",
  "retry_hint",
  "cancel_reason",
  "result_run_id",
  "result_file_id",
] as const;

export interface CreateTaskInput {
  applicationId?: string | null;
  /** The calling device (CLI), for the D-29 alt-scope rule. */
  callerDeviceId?: string | null;
  createdBy: TaskCreatedBy;
  cvVariantId?: string | null;
  /** How the scope check passed ("alt_scope" = execute without manage). */
  grantedVia?: "scope" | "alt_scope" | "system";
  idempotencyKey: string;
  kind: TaskKind;
  maxAttempts?: number;
  notBefore?: number;
  now: number;
  payload: TaskPayload;
  priority?: number;
  queueWithoutDevice?: boolean;
  /** Skip the eligible-device check (retries, rule and system tasks). */
  requireDevice?: boolean;
  /** Retry after the user confirmed nothing was submitted (21 §8). */
  resolvingOutcomeUnknown?: boolean;
  retryOf?: string | null;
  source: ChangeSource;
  targetDeviceId?: string | null;
}

export interface CreateTaskPlan {
  /** Set when the idempotency key already names a task (no statements). */
  existing: AutomationTaskRecord | null;
  statements: D1PreparedStatement[];
  task: AutomationTaskRecord;
}

function policy(
  message: string,
  reason: string,
  extra: Record<string, unknown> = {}
): ApiError {
  return apiError("policy_violation", message, {
    details: { reason, ...extra },
  });
}

/** 409 duplicate with the live task's id (21 §4). */
export function duplicateTask(taskId: string): ApiError {
  return apiError(
    "duplicate",
    "A live apply task already exists for this application.",
    { details: { task_id: taskId } }
  );
}

function requiredCapabilities(
  kind: TaskKind,
  mode: ApplicationMode | null
): DeviceCapability[] {
  if (kind === "discover") {
    return ["discover"];
  }
  if (kind === "render_cv") {
    return ["render_cv"];
  }
  return mode === "assisted" ? ["apply", "headed_browser"] : ["apply"];
}

function deviceEligible(
  device: DeviceSummary,
  required: readonly string[],
  minCliVersion: string
): boolean {
  return (
    device.revoked_at === null &&
    device.accepts_tasks &&
    versionAtLeast(device.cli_version, minCliVersion) &&
    required.every((cap) => device.capabilities.includes(cap))
  );
}

async function assertDevice(
  env: Env,
  scope: UserScope,
  input: {
    queueWithoutDevice: boolean;
    required: readonly string[];
    requireDevice: boolean;
    targetDeviceId: string | null;
  }
): Promise<void> {
  const min = cliVersions(env).min;
  if (input.targetDeviceId) {
    const device = await loadUserDevice(env.DB, scope, input.targetDeviceId);
    if (!device) {
      throw notFound("Device not found.");
    }
    if (device.revoked_at !== null) {
      throw apiError("device_revoked", "That device was revoked.");
    }
    if (!input.requireDevice || input.queueWithoutDevice) {
      return;
    }
    if (!device.accepts_tasks) {
      throw apiError(
        "device_not_accepting_tasks",
        "That device does not accept tasks (pilih-jobs worker enable)."
      );
    }
    if (!deviceEligible(device, input.required, min)) {
      throw policy(
        "That device cannot run this task (capabilities or CLI version).",
        "no_eligible_device",
        { required_capabilities: input.required }
      );
    }
    return;
  }
  if (!input.requireDevice || input.queueWithoutDevice) {
    return;
  }
  const devices = await listActiveDevices(env.DB, scope);
  if (!devices.some((device) => deviceEligible(device, input.required, min))) {
    throw policy(
      "No eligible device: connect a computer with pilih-jobs (or queue the task without a device).",
      "no_eligible_device",
      { required_capabilities: input.required }
    );
  }
}

interface ApplyContext {
  app: ApplicationRecord;
  mode: ApplicationMode;
  posting: JobPostingRecord | null;
  rule: AutomationRuleRecord | null;
}

function assertApplicationAutomatable(
  app: ApplicationRecord,
  resolvingOutcomeUnknown: boolean
): void {
  if (app.archived) {
    throw policy("The application is archived.", "application_archived");
  }
  if (SUBMITTED.has(app.submission_status)) {
    throw policy(
      "This application was already submitted.",
      "already_submitted"
    );
  }
  if (app.submission_status === "outcome_unknown" && !resolvingOutcomeUnknown) {
    throw policy(
      "A previous submission has an unknown outcome. Confirm whether it was submitted first (retry with confirm_not_submitted).",
      "outcome_unknown"
    );
  }
  if (POST_APPLY_STAGES.has(app.stage)) {
    throw policy(
      `The application is already ${app.stage}.`,
      "application_stage",
      { stage: app.stage }
    );
  }
}

async function findCoveringRule(
  db: JobsDb,
  scope: UserScope,
  input: {
    flags: Pick<FeatureFlags, "JOBS_AUTO_MODE_ENABLED">;
    now: number;
    posting: JobPostingRecord;
    ruleId: string | null;
    timezone: string;
  }
): Promise<AutomationRuleRecord | null> {
  const candidates = input.ruleId
    ? [await loadRule(db, scope, input.ruleId)].filter(
        (r): r is AutomationRuleRecord => r !== null
      )
    : (await listEnabledRules(db, scope)).filter((r) => r.mode === "auto");
  for (const rule of candidates) {
    const activation = rule.activated_approval_id
      ? await loadActivation(db, scope, rule.activated_approval_id)
      : null;
    const ineffective = ruleIneffective(rule, {
      activation,
      autoModeEnabled: input.flags.JOBS_AUTO_MODE_ENABLED,
      checkActiveHours: false,
      now: input.now,
      timezone: input.timezone,
    });
    if (
      rule.mode === "auto" &&
      ineffective === null &&
      coverageProblem(rule, input.posting) === null
    ) {
      return rule;
    }
  }
  return null;
}

function resolveMode(
  app: ApplicationRecord,
  settings: UserSettingsRecord,
  requested: ApplicationMode | undefined
): ApplicationMode {
  let mode: ApplicationMode = "approval";
  if (requested) {
    mode = requested;
  } else if (AUTOMATABLE_MODES.includes(app.mode)) {
    mode = app.mode;
  } else if (AUTOMATABLE_MODES.includes(settings.default_mode)) {
    mode = settings.default_mode;
  }
  if (!AUTOMATABLE_MODES.includes(mode)) {
    throw apiError(
      "mode_not_allowed",
      "Manual applications have no automation task; pick assisted, approval or auto.",
      { details: { mode } }
    );
  }
  return mode;
}

/** D-29: execute-only callers create assisted/approval tasks for themselves. */
function assertAltScope(input: CreateTaskInput, mode: ApplicationMode): void {
  if (input.grantedVia !== "alt_scope") {
    return;
  }
  const ownDevice =
    typeof input.callerDeviceId === "string" &&
    input.targetDeviceId === input.callerDeviceId;
  if (!(ownDevice && (mode === "assisted" || mode === "approval"))) {
    throw insufficientScope(["automation:manage"]);
  }
}

/** The auto rule that covers the application, within its limits (21 §4). */
async function autoRuleFor(
  db: JobsDb,
  scope: UserScope,
  input: {
    flags: FeatureFlags;
    now: number;
    posting: JobPostingRecord | null;
    ruleId: string | null;
    timezone: string;
  }
): Promise<AutomationRuleRecord> {
  if (!input.flags.JOBS_AUTO_MODE_ENABLED) {
    throw apiError(
      "mode_not_allowed",
      "Automatic submission (auto mode) is not available right now.",
      { details: { flag: "JOBS_AUTO_MODE_ENABLED" } }
    );
  }
  const posting = input.posting;
  const rule = posting
    ? await findCoveringRule(db, scope, { ...input, posting })
    : null;
  if (!rule) {
    throw policy(
      "No enabled auto rule with an approved activation covers this application.",
      "rule_coverage"
    );
  }
  const counts = await intentCounts(db, scope, {
    companyKey: posting ? companyKey(posting) : null,
    now: input.now,
    ruleId: rule.id,
  });
  if (
    (counts.rule24h ?? 0) >= rule.limits.max_per_day ||
    (counts.company30d ?? 0) >= rule.limits.max_per_company_per_30d ||
    counts.global24h >= GLOBAL_SUBMISSIONS_PER_DAY
  ) {
    throw policy("The rule's submission limits are reached.", "limit_reached", {
      counts,
    });
  }
  return rule;
}

async function applyContext(
  db: JobsDb,
  scope: UserScope,
  input: CreateTaskInput,
  flags: FeatureFlags
): Promise<ApplyContext> {
  if (!input.applicationId) {
    throw invalidRequest("application_id is required for apply tasks.");
  }
  const app = await loadApplication(db, scope, input.applicationId);
  if (!app) {
    throw notFound("Application not found.");
  }
  assertApplicationAutomatable(app, input.resolvingOutcomeUnknown === true);
  const settings = await getUserSettings(db, scope, input.now);
  const mode = resolveMode(app, settings, input.payload.mode);
  assertAltScope(input, mode);
  if (settings.automation_paused) {
    throw policy(
      "Automation is paused. Resume it in Settings first.",
      "automation_paused"
    );
  }
  const posting = await postingOfUserJob(db, scope, app.user_job_id);
  const ruleId = input.payload.rule_id ?? null;
  let rule: AutomationRuleRecord | null = null;
  if (mode === "auto") {
    rule = await autoRuleFor(db, scope, {
      flags,
      now: input.now,
      posting,
      ruleId,
      timezone: settings.timezone,
    });
  } else if (ruleId) {
    rule = await loadRule(db, scope, ruleId);
    if (!rule) {
      throw policy(
        "The rule named by the task does not exist.",
        "rule_missing"
      );
    }
  }
  return { app, mode, posting, rule };
}

interface TaskTarget {
  apply: ApplyContext | null;
  applicationId: string | null;
  cvVariantId: string | null;
  mode: ApplicationMode | null;
  payload: TaskPayload;
}

async function applyTarget(
  db: JobsDb,
  scope: UserScope,
  input: CreateTaskInput,
  flags: FeatureFlags
): Promise<TaskTarget> {
  const apply = await applyContext(db, scope, input, flags);
  const payload: TaskPayload = {
    ...input.payload,
    mode: apply.mode,
    rule_id: apply.rule?.id ?? null,
  };
  const key = apply.posting ? companyKey(apply.posting) : null;
  if (key) {
    payload.company_key = key;
  }
  const live = await findLiveApplyTask(db, scope, apply.app.id);
  if (live) {
    throw duplicateTask(live.id);
  }
  return {
    apply,
    applicationId: apply.app.id,
    cvVariantId: null,
    mode: apply.mode,
    payload,
  };
}

async function otherTarget(
  db: JobsDb,
  scope: UserScope,
  input: CreateTaskInput
): Promise<TaskTarget> {
  const base = {
    apply: null,
    mode: null,
    payload: { ...input.payload },
  };
  if (input.kind === "discover") {
    const ids = input.payload.source_ids ?? [];
    if (ids.length > 0) {
      const sources = await sourcesFor(db, scope, ids);
      if (sources.length !== new Set(ids).size) {
        throw notFound("Source not found.");
      }
    }
    return { ...base, applicationId: null, cvVariantId: null };
  }
  if (!input.cvVariantId) {
    throw invalidRequest("cv_variant_id is required for render_cv tasks.");
  }
  const variant = await variantApplication(db, scope, input.cvVariantId);
  if (!variant) {
    throw notFound("CV variant not found.");
  }
  return {
    ...base,
    applicationId: variant.application_id,
    cvVariantId: variant.id,
  };
}

/** The idempotency_key names an existing task: the same request, or 409. */
async function existingTask(
  db: JobsDb,
  scope: UserScope,
  input: CreateTaskInput
): Promise<AutomationTaskRecord | null> {
  const existing = await findTaskByIdempotencyKey(
    db,
    scope,
    input.idempotencyKey
  );
  if (!existing) {
    return null;
  }
  const same =
    existing.kind === input.kind &&
    existing.application_id === (input.applicationId ?? null) &&
    (input.kind !== "render_cv" ||
      existing.cv_variant_id === (input.cvVariantId ?? null));
  if (!same) {
    throw apiError(
      "idempotency_mismatch",
      "This idempotency_key already names a different task."
    );
  }
  return existing;
}

function newTaskRecord(
  scope: UserScope,
  input: CreateTaskInput,
  target: TaskTarget,
  required: DeviceCapability[]
): AutomationTaskRecord {
  const { now } = input;
  const notBefore = input.notBefore ?? now;
  return {
    id: newId("tsk", now),
    user_id: scope.userId,
    kind: input.kind,
    application_id: target.applicationId,
    cv_variant_id: target.cvVariantId,
    payload: target.payload,
    state: "queued",
    target_device_id: input.targetDeviceId ?? null,
    required_capabilities: required,
    priority: input.priority ?? 0,
    not_before: notBefore,
    expires_at: Math.max(now, notBefore) + TASK_QUEUE_TTL_MS,
    lease_id: null,
    lease_device_id: null,
    lease_expires_at: null,
    attempt_count: 0,
    max_attempts: input.maxAttempts ?? 3,
    submit_intent_at: null,
    pause_reason: null,
    resume_requested: false,
    retry_of: input.retryOf ?? null,
    cancel_requested: false,
    progress: {},
    local_state: null,
    error_class: null,
    error_message: null,
    created_by: input.createdBy,
    idempotency_key: input.idempotencyKey,
    revision: 1,
    created_at: now,
    updated_at: now,
    finished_at: null,
  };
}

function creationStatements(
  db: JobsDb,
  scope: UserScope,
  input: CreateTaskInput,
  task: AutomationTaskRecord,
  target: TaskTarget
): D1PreparedStatement[] {
  const { now } = input;
  const userCreated = input.createdBy === "web" || input.createdBy === "cli";
  const extra: Record<string, unknown> = {
    kind: task.kind,
    created_by: task.created_by,
  };
  if (target.mode) {
    extra.mode = target.mode;
  }
  if (task.retry_of) {
    extra.retry_of = task.retry_of;
  }
  if (input.resolvingOutcomeUnknown) {
    extra.confirm_not_submitted = true;
  }
  const statements = [
    ...insertTaskStatements(db, scope, task),
    ...taskEvent(
      db,
      scope,
      task,
      {
        type: "automation_task_created",
        actorKind: userCreated ? "user" : "system",
        state: "queued",
        key: `task:${task.id}:created`,
        extra,
      },
      now
    ),
  ];
  if (target.apply && target.mode) {
    statements.push(
      ...setApplicationModeStatements(db, scope, {
        applicationId: target.apply.app.id,
        mode: target.mode,
        ruleId: target.apply.rule?.id ?? null,
        now,
        source: input.source,
      })
    );
  }
  return statements;
}

/** Plans one new task (all creation paths: web, CLI, rule, system, retry). */
export async function planCreateTask(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  input: CreateTaskInput,
  flags: FeatureFlags
): Promise<CreateTaskPlan> {
  const existing = await existingTask(db, scope, input);
  if (existing) {
    return { existing, task: existing, statements: [] };
  }
  if (!flags.JOBS_AUTOMATION_ENABLED) {
    throw policy(
      "Automation is not available right now.",
      "automation_disabled"
    );
  }
  if (input.kind !== "apply" && input.grantedVia === "alt_scope") {
    throw insufficientScope(["automation:manage"]);
  }
  const target =
    input.kind === "apply"
      ? await applyTarget(db, scope, input, flags)
      : await otherTarget(db, scope, input);
  const required = requiredCapabilities(input.kind, target.mode);
  await assertDevice(env, scope, {
    queueWithoutDevice: input.queueWithoutDevice === true,
    required,
    requireDevice: input.requireDevice !== false,
    targetDeviceId: input.targetDeviceId ?? null,
  });
  const task = newTaskRecord(scope, input, target, required);
  return {
    existing: null,
    task,
    statements: creationStatements(db, scope, input, task, target),
  };
}

// ---------------------------------------------------------------------------
// Cancel, resume, retry
// ---------------------------------------------------------------------------

export interface TaskControlPlan {
  statements: D1PreparedStatement[];
  /** 200, or 202 when the cancel is delivered by the next heartbeat. */
  status: number;
  task: AutomationTaskRecord;
}

/** POST /tasks/{id}/cancel (21 §13.3). */
export async function planCancelTask(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  now: number
): Promise<TaskControlPlan> {
  const task = await loadTask(db, scope, taskId);
  if (!task) {
    throw notFound("Task not found.");
  }
  if (task.state === "cancelled") {
    return { task, statements: [], status: 200 };
  }
  if (task.submit_intent_at !== null) {
    throw tooLate();
  }
  const unleased =
    task.lease_id === null &&
    (task.state === "queued" || task.state === "awaiting_approval");
  if (unleased) {
    const pending = await pendingApprovalsOfTask(db, scope, task.id);
    const statements = [
      ...finishUnleasedTaskStatements(db, scope, task, {
        state: "cancelled",
        errorClass: "cancelled",
        reason: "user",
        now,
      }),
      ...expireApprovalStatements(db, scope, pending, now),
      ...taskEvent(
        db,
        scope,
        task,
        {
          type: "automation_task_finished",
          actorKind: "user",
          state: "cancelled",
          key: `task:${task.id}:finished`,
          message: "Cancelled by you.",
        },
        now
      ),
    ];
    return {
      statements,
      status: 200,
      task: {
        ...task,
        state: "cancelled",
        error_class: "cancelled",
        payload: { ...task.payload, cancel_reason: "user" },
        finished_at: now,
        revision: task.revision + 1,
        updated_at: now,
      },
    };
  }
  if (task.lease_id !== null) {
    if (task.cancel_requested) {
      return { task, statements: [], status: 202 };
    }
    return {
      statements: requestCancelStatements(db, scope, task, now),
      status: 202,
      task: {
        ...task,
        cancel_requested: true,
        payload: { ...task.payload, cancel_reason: "user" },
        revision: task.revision + 1,
        updated_at: now,
      },
    };
  }
  throw invalidTransition(`A ${task.state} task cannot be cancelled.`, {
    state: task.state,
  });
}

/** POST /tasks/{id}/resume: web "Resume" for a paused task (03 §7.2). */
export async function planResumeTask(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  now: number
): Promise<TaskControlPlan> {
  const task = await loadTask(db, scope, taskId);
  if (!task) {
    throw notFound("Task not found.");
  }
  if (task.state !== "paused") {
    throw invalidTransition("Only a paused task can be resumed.", {
      state: task.state,
    });
  }
  return {
    statements: requestResumeStatements(db, scope, task, now),
    status: 200,
    task: {
      ...task,
      resume_requested: true,
      revision: task.revision + 1,
      updated_at: now,
    },
  };
}

export interface RetryInput {
  confirmNotSubmitted: boolean;
  createdBy: TaskCreatedBy;
  /** Body `idempotency_key` or the request's Idempotency-Key. */
  idempotencyKey: string | null;
  now: number;
  source: ChangeSource;
}

/**
 * POST /tasks/{id}/retry (21 §8): from `failed`, or from `outcome_unknown`
 * only with `confirm_not_submitted: true` (the user's statement is recorded:
 * the application's submission status goes outcome_unknown → failed). The
 * old task stays terminal; the new one carries `retry_of`.
 */
export async function planRetryTask(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  taskId: string,
  input: RetryInput,
  flags: FeatureFlags
): Promise<CreateTaskPlan> {
  const task = await loadTask(db, scope, taskId);
  if (!task) {
    throw notFound("Task not found.");
  }
  if (task.state !== "failed" && task.state !== "outcome_unknown") {
    throw invalidTransition(
      "Only failed or outcome-unknown tasks can be retried.",
      { state: task.state }
    );
  }
  const fromUnknown = task.state === "outcome_unknown";
  if (fromUnknown && !input.confirmNotSubmitted) {
    throw policy(
      "Confirm that nothing was submitted (confirm_not_submitted: true) before retrying.",
      "confirm_not_submitted_required"
    );
  }
  const payload: TaskPayload = { ...task.payload };
  for (const key of RUN_ONLY_KEYS) {
    delete (payload as Record<string, unknown>)[key];
  }
  const key = input.idempotencyKey
    ? `retry:${input.idempotencyKey}`
    : `retry:${task.id}:${newUlid(input.now)}`;
  const statements: D1PreparedStatement[] = [];
  let resolving = false;
  if (fromUnknown && task.application_id) {
    const app = await loadApplication(db, scope, task.application_id);
    if (app?.submission_status === "outcome_unknown") {
      resolving = true;
      const transition = await planApplicationTransition(db, scope, {
        applicationId: app.id,
        actor: "user",
        source: input.source,
        now: input.now,
        submission: { to: "failed" },
        allowDuringSubmission: true,
        eventKeyPrefix: `task:${task.id}:not_submitted`,
      });
      statements.push(...transition.statements);
    }
  }
  const plan = await planCreateTask(
    db,
    scope,
    env,
    {
      kind: task.kind,
      applicationId: task.application_id,
      cvVariantId: task.cv_variant_id,
      payload,
      targetDeviceId: task.target_device_id,
      priority: task.priority,
      idempotencyKey: key.slice(0, 128),
      createdBy: input.createdBy,
      retryOf: task.id,
      requireDevice: false,
      resolvingOutcomeUnknown: resolving,
      grantedVia: "scope",
      source: input.source,
      now: input.now,
    },
    flags
  );
  if (plan.existing) {
    return plan;
  }
  return { ...plan, statements: [...statements, ...plan.statements] };
}
