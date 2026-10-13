// 05 §8 — Automation: rules, tasks, claim/lease protocol, approvals (19, 21).
import { z } from "zod";
import {
  DeletedResponseSchema,
  DomainSchema,
  PageQuerySchema,
  paginated,
  RevisionSchema,
  Sha256HexSchema,
  TimestampSchema,
} from "../common";
import {
  AdapterIdSchema,
  ApplicationModeSchema,
  ApprovalDecisionSchema,
  ApprovalKindSchema,
  ApprovalStateSchema,
  CvVariantStatusSchema,
  DeviceCapabilitySchema,
  EvidenceKindSchema,
  EvidenceScreenshotModeSchema,
  EvidenceVerdictSchema,
  LocalTaskStateSchema,
  PauseReasonSchema,
  ReleaseReasonSchema,
  RuleModeSchema,
  StageSchema,
  SubmissionStatusSchema,
  TaskKindSchema,
  TaskResultOutcomeSchema,
  TaskStateSchema,
} from "../enums";
import { EvidenceSignalsSchema } from "../agent";
import {
  ApplicationIdSchema,
  ApprovalIdSchema,
  AttemptIdSchema,
  CvVariantIdSchema,
  DeviceIdSchema,
  EventIdSchema,
  FileIdSchema,
  LeaseIdSchema,
  RuleIdSchema,
  RunIdSchema,
} from "../ids";
import {
  ApplicationRecordSchema,
  ApprovalPayloadSchema,
  ApprovalRecordSchema,
  ApprovalResponseSchema,
  AutomationAttemptRecordSchema,
  AutomationRuleRecordSchema,
  AutomationTaskRecordSchema,
  CvPolicySchema,
  JobPostingRecordSchema,
  JobSourceRecordSchema,
  RuleCriteriaSchema,
  RuleLimitsSchema,
  SubmissionEvidenceRecordSchema,
  TaskPayloadSchema,
  TaskProgressSchema,
} from "../records";
import { defineSchema } from "../registry";
import { RenderTicketResponseSchema } from "./cv";
import { route } from "./route";
import { DeleteQuerySchema } from "./views";

const formHash = z.string().length(64);
const idempotencyKey = z.string().min(1).max(128);

// --- rules ---------------------------------------------------------------------------

export const AutomationRulePageSchema = paginated(
  "api",
  "AutomationRule",
  AutomationRuleRecordSchema
);

/**
 * Enabling an `auto` rule needs `automation:manage` and creates a
 * `rule_activation` approval (05 §8, 19 §8.3); it becomes effective once
 * that approval is approved.
 */
export const CreateRuleRequestSchema = defineSchema(
  "api",
  "CreateRuleRequest",
  z.object({
    name: z.string().min(1).max(120),
    mode: RuleModeSchema,
    enabled: z.boolean().optional(),
    criteria: RuleCriteriaSchema,
    limits: RuleLimitsSchema,
    allowed_domains: z.array(DomainSchema).max(50).optional(),
    cv_policy: CvPolicySchema.optional(),
  })
);
export type CreateRuleRequest = z.infer<typeof CreateRuleRequestSchema>;

export const UpdateRuleRequestSchema = defineSchema(
  "api",
  "UpdateRuleRequest",
  z.object({
    base_revision: RevisionSchema,
    name: z.string().min(1).max(120).optional(),
    mode: RuleModeSchema.optional(),
    enabled: z.boolean().optional(),
    criteria: RuleCriteriaSchema.optional(),
    limits: RuleLimitsSchema.optional(),
    allowed_domains: z.array(DomainSchema).max(50).optional(),
    cv_policy: CvPolicySchema.optional(),
  })
);
export type UpdateRuleRequest = z.infer<typeof UpdateRuleRequestSchema>;

export const RuleResponseSchema = defineSchema(
  "api",
  "RuleResponse",
  z.object({
    rule: AutomationRuleRecordSchema,
    /** The `rule_activation` approval created by enabling an `auto` rule. */
    approval: ApprovalRecordSchema.optional(),
  })
);

// --- tasks ---------------------------------------------------------------------------

export const CreateTaskRequestSchema = defineSchema(
  "api",
  "CreateTaskRequest",
  z.object({
    kind: TaskKindSchema,
    /** Required for apply. */
    application_id: ApplicationIdSchema.nullable().optional(),
    /** Required for render_cv. */
    cv_variant_id: CvVariantIdSchema.nullable().optional(),
    payload: TaskPayloadSchema,
    target_device_id: DeviceIdSchema.nullable().optional(),
    not_before: TimestampSchema.optional(),
    priority: z.number().int().min(-10).max(10).optional(),
    idempotency_key: idempotencyKey,
    /** Create even when no eligible device exists (21 §4). */
    queue_without_device: z.boolean().optional(),
  })
);
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const TaskResponseSchema = defineSchema(
  "api",
  "TaskResponse",
  z.object({ task: AutomationTaskRecordSchema })
);

export const ListTasksQuerySchema = defineSchema(
  "api",
  "ListTasksQuery",
  PageQuerySchema.extend({
    state: TaskStateSchema.optional(),
    application_id: ApplicationIdSchema.optional(),
    kind: TaskKindSchema.optional(),
  })
);

export const AutomationTaskPageSchema = paginated(
  "api",
  "AutomationTask",
  AutomationTaskRecordSchema
);

/** The CV file an apply task uploads (verified by sha256, 18 §7.1). */
export const TaskFileRefSchema = defineSchema(
  "api",
  "TaskFileRef",
  z.object({
    file_id: FileIdSchema,
    sha256: Sha256HexSchema,
  })
);

/** Context of an `apply` claim (21 §5.1, 19 §2 task bundle). */
export const ApplyTaskContextSchema = defineSchema(
  "api",
  "ApplyTaskContext",
  z.object({
    kind: z.literal("apply"),
    application: ApplicationRecordSchema,
    posting: JobPostingRecordSchema,
    mode: ApplicationModeSchema,
    cv: z
      .object({
        cv_variant_id: CvVariantIdSchema.nullable(),
        status: CvVariantStatusSchema.nullable(),
        file: TaskFileRefSchema,
      })
      .nullable(),
    cover_letter: TaskFileRefSchema.nullable(),
    rule: z
      .object({
        id: RuleIdSchema,
        mode: RuleModeSchema,
        limits: RuleLimitsSchema,
        cv_policy: CvPolicySchema,
      })
      .nullable(),
    /** Posting apply domain + adapter ATS hosts + rule domains (19 §7). */
    allowed_domains: z.array(DomainSchema),
    adapter: z
      .object({
        id: AdapterIdSchema,
        headless_ok: z.boolean(),
        auto_ok: z.boolean(),
        confirmation_url_patterns: z.array(z.string()),
        confirmation_selectors: z.array(z.string()),
      })
      .nullable(),
    approval_policy: z.object({
      /** Mode `approval`: a submit approval is required before submit_intent. */
      submit_requires_approval: z.boolean(),
      generated_text_allowed: z.boolean(),
      evidence_screenshots: EvidenceScreenshotModeSchema,
    }),
    /** Set when resuming after a released `awaiting_approval` (21 §6.4). */
    resume_from_approval: z
      .object({ approval_id: ApprovalIdSchema, payload_hash: Sha256HexSchema })
      .nullable(),
  })
);

export const DiscoverTaskContextSchema = defineSchema(
  "api",
  "DiscoverTaskContext",
  z.object({
    kind: z.literal("discover"),
    sources: z.array(JobSourceRecordSchema),
  })
);

export const RenderCvTaskContextSchema = defineSchema(
  "api",
  "RenderCvTaskContext",
  z.object({
    kind: z.literal("render_cv"),
    cv_variant_id: CvVariantIdSchema,
    render: RenderTicketResponseSchema,
  })
);

export const TaskContextSchema = defineSchema(
  "api",
  "TaskContext",
  z.discriminatedUnion("kind", [
    ApplyTaskContextSchema,
    DiscoverTaskContextSchema,
    RenderCvTaskContextSchema,
  ])
);
export type TaskContext = z.infer<typeof TaskContextSchema>;

/** Task detail incl. attempts, progress, approvals (05 §8) and the bundle. */
export const TaskDetailSchema = defineSchema(
  "api",
  "TaskDetail",
  z.object({
    task: AutomationTaskRecordSchema,
    attempts: z.array(AutomationAttemptRecordSchema),
    approvals: z.array(ApprovalRecordSchema),
    evidence: z.array(SubmissionEvidenceRecordSchema),
    device_name: z.string().nullable(),
    context: TaskContextSchema.nullable(),
  })
);
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

/** From `outcome_unknown` the body must carry `confirm_not_submitted: true`. */
export const RetryTaskRequestSchema = defineSchema(
  "api",
  "RetryTaskRequest",
  z.object({
    confirm_not_submitted: z.boolean().optional(),
    idempotency_key: idempotencyKey.optional(),
  })
);

// --- claim and lease -------------------------------------------------------------

export const ClaimTaskRequestSchema = defineSchema(
  "api",
  "ClaimTaskRequest",
  z.object({
    capabilities: z.array(DeviceCapabilitySchema),
    /** Always 1 (21 §3). */
    max: z.literal(1),
  })
);
export type ClaimTaskRequest = z.infer<typeof ClaimTaskRequestSchema>;

/** Lease timings (21 §5.4). */
export const LEASE_DURATION_MS = 120_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;

export const LeaseSchema = defineSchema(
  "api",
  "Lease",
  z.object({
    lease_id: LeaseIdSchema,
    /** The `automation_attempts` row of this lease (late evidence, 21 §9). */
    attempt_id: AttemptIdSchema,
    expires_at: TimestampSchema,
    heartbeat_interval_ms: z.number().int().min(1000),
  })
);

/** `200 {task, lease, context}`; `null` stands for `204` (no work). */
export const ClaimTaskResponseSchema = defineSchema(
  "api",
  "ClaimTaskResponse",
  z
    .object({
      task: AutomationTaskRecordSchema,
      lease: LeaseSchema,
      context: TaskContextSchema,
      poll_interval_ms: z.number().int().min(2000).optional(),
    })
    .nullable()
);
export type ClaimTaskResponse = z.infer<typeof ClaimTaskResponseSchema>;

export const LeaseHeartbeatRequestSchema = defineSchema(
  "api",
  "LeaseHeartbeatRequest",
  z.object({
    progress: TaskProgressSchema,
    local_state: LocalTaskStateSchema.nullable(),
  })
);
export type LeaseHeartbeatRequest = z.infer<typeof LeaseHeartbeatRequestSchema>;

/** `409 lease_lost` when fenced out (21 §5.2). */
export const LeaseHeartbeatResponseSchema = defineSchema(
  "api",
  "LeaseHeartbeatResponse",
  z.object({
    lease_expires_at: TimestampSchema,
    cancel_requested: z.boolean(),
    /** The web "Resume" for a paused task (03 §7.2). */
    resume_requested: z.boolean(),
    poll_interval_ms: z.number().int().min(2000),
    server_time: TimestampSchema,
  })
);
export type LeaseHeartbeatResponse = z.infer<
  typeof LeaseHeartbeatResponseSchema
>;

const eventBase = {
  idempotency_key: idempotencyKey,
  /** Client clock (informational). */
  occurred_at: TimestampSchema,
};

/**
 * Step events (05 §8, 21 §6.1). `submit_intent` and `approval_requested`
 * are listed by 05 but have dedicated routes (21 §6.3, §6.5); this route
 * rejects them per item (`status: rejected`).
 */
export const LeaseEventSchema = defineSchema(
  "api",
  "LeaseEvent",
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("started"), ...eventBase }),
    z.object({
      type: z.literal("progress"),
      ...eventBase,
      progress: TaskProgressSchema,
    }),
    z.object({
      type: z.literal("paused"),
      ...eventBase,
      pause_reason: PauseReasonSchema,
      message: z.string().max(300).optional(),
    }),
    z.object({ type: z.literal("resumed"), ...eventBase }),
    z.object({
      type: z.literal("submit_intent"),
      ...eventBase,
      form_hash: formHash,
    }),
    z.object({
      type: z.literal("approval_requested"),
      ...eventBase,
      approval_id: ApprovalIdSchema.optional(),
    }),
    z.object({
      type: z.literal("log"),
      ...eventBase,
      level: z.enum(["debug", "info", "warn", "error"]),
      message: z.string().max(1000),
    }),
  ])
);
export type LeaseEvent = z.infer<typeof LeaseEventSchema>;

export const LEASE_EVENTS_MAX = 50;

export const LeaseEventsRequestSchema = defineSchema(
  "api",
  "LeaseEventsRequest",
  z.object({ events: z.array(LeaseEventSchema).min(1).max(LEASE_EVENTS_MAX) })
);
export type LeaseEventsRequest = z.infer<typeof LeaseEventsRequestSchema>;

export const LeaseEventsResponseSchema = defineSchema(
  "api",
  "LeaseEventsResponse",
  z.object({
    results: z.array(
      z.object({
        idempotency_key: z.string(),
        status: z.enum(["recorded", "duplicate", "rejected"]),
        event_id: EventIdSchema.optional(),
        error: z.string().optional(),
      })
    ),
    task_state: TaskStateSchema,
  })
);

/** Synchronous, never queued offline (D-28). */
export const SubmitIntentRequestSchema = defineSchema(
  "api",
  "SubmitIntentRequest",
  z.object({
    form_hash: formHash,
    approval_id: ApprovalIdSchema.optional(),
    rule_id: RuleIdSchema.optional(),
  })
);
export type SubmitIntentRequest = z.infer<typeof SubmitIntentRequestSchema>;

export const SubmitIntentResponseSchema = defineSchema(
  "api",
  "SubmitIntentResponse",
  z.object({ submit_intent_at: TimestampSchema })
);

/** Evidence as the CLI reports it (04 §2.6 columns the server does not own). */
export const EvidenceInputSchema = defineSchema(
  "api",
  "EvidenceInput",
  z.object({
    kind: EvidenceKindSchema,
    verdict: EvidenceVerdictSchema,
    signals: EvidenceSignalsSchema,
    final_url: z.string().max(2048).nullable().optional(),
    page_title: z.string().max(200).nullable().optional(),
    text_excerpt: z.string().max(2048).nullable().optional(),
    screenshot_file_id: FileIdSchema.nullable().optional(),
    form_hash: formHash.nullable().optional(),
    captured_at: TimestampSchema,
  })
);
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;

/** Terminal report (05 §8, 21 §6.6). */
export const TaskResultRequestSchema = defineSchema(
  "api",
  "TaskResultRequest",
  z.object({
    outcome: TaskResultOutcomeSchema,
    error_class: z.string().min(1).max(64).optional(),
    retryable: z.boolean().optional(),
    /** e.g. approval_rejected, approval_expired, cancel_requested. */
    reason: z.string().max(60).optional(),
    evidence: EvidenceInputSchema.optional(),
    application_update: z
      .object({
        base_revision: RevisionSchema,
        submission_status: SubmissionStatusSchema,
        stage: StageSchema.optional(),
      })
      .optional(),
    log_file_id: FileIdSchema.optional(),
    stats: z
      .object({
        steps_count: z.number().int().min(0),
        ai_calls: z.number().int().min(0),
        duration_ms: z.number().int().min(0),
      })
      .optional(),
    /** discover: the run this task produced. */
    run_id: RunIdSchema.optional(),
    /** render_cv: the uploaded PDF. */
    file_id: FileIdSchema.optional(),
  })
);
export type TaskResultRequest = z.infer<typeof TaskResultRequestSchema>;

export const TaskResultResponseSchema = defineSchema(
  "api",
  "TaskResultResponse",
  z.object({
    task: AutomationTaskRecordSchema,
    application: ApplicationRecordSchema.nullable(),
    evidence: SubmissionEvidenceRecordSchema.nullable(),
    /** The stage update lost to a user decision (20 §6.2). */
    conflict_recorded: z.boolean(),
  })
);
export type TaskResultResponse = z.infer<typeof TaskResultResponseSchema>;

/** Give the task back before submit_intent (`409 too_late` after). */
export const ReleaseTaskRequestSchema = defineSchema(
  "api",
  "ReleaseTaskRequest",
  z.object({ reason: ReleaseReasonSchema })
);

/** Evidence or a result after the lease was lost (20 §6.3 A). */
export const LateEvidenceRequestSchema = defineSchema(
  "api",
  "LateEvidenceRequest",
  z.object({
    evidence: EvidenceInputSchema,
    outcome: z.enum(["submitted", "outcome_unknown", "failed"]).optional(),
    log_file_id: FileIdSchema.optional(),
  })
);
export type LateEvidenceRequest = z.infer<typeof LateEvidenceRequestSchema>;

export const LateEvidenceResponseSchema = defineSchema(
  "api",
  "LateEvidenceResponse",
  z.object({
    evidence: SubmissionEvidenceRecordSchema,
    task: AutomationTaskRecordSchema,
    application: ApplicationRecordSchema,
    conflict_recorded: z.boolean(),
  })
);

// --- approvals ---------------------------------------------------------------------

export const ListApprovalsQuerySchema = defineSchema(
  "api",
  "ListApprovalsQuery",
  PageQuerySchema.extend({
    state: ApprovalStateSchema.optional(),
    kind: ApprovalKindSchema.optional(),
  })
);

export const ApprovalPageSchema = paginated(
  "api",
  "Approval",
  ApprovalRecordSchema
);

/** `payload_hash` must match the stored one (03 §8). */
export const DecideApprovalRequestSchema = defineSchema(
  "api",
  "DecideApprovalRequest",
  z.object({
    decision: ApprovalDecisionSchema,
    payload_hash: Sha256HexSchema,
    response: ApprovalResponseSchema.optional(),
  })
);
export type DecideApprovalRequest = z.infer<typeof DecideApprovalRequestSchema>;

export const DecideApprovalResponseSchema = defineSchema(
  "api",
  "DecideApprovalResponse",
  z.object({
    approval: ApprovalRecordSchema,
    task: AutomationTaskRecordSchema.nullable(),
  })
);

/** A device creates `submit` / `answer` approvals under its lease. */
export const CreateLeaseApprovalRequestSchema = defineSchema(
  "api",
  "CreateLeaseApprovalRequest",
  z.object({
    kind: ApprovalKindSchema.extract(["submit", "answer"]),
    payload: ApprovalPayloadSchema,
    payload_hash: Sha256HexSchema,
  })
);
export type CreateLeaseApprovalRequest = z.infer<
  typeof CreateLeaseApprovalRequestSchema
>;

export const LeaseApprovalResponseSchema = defineSchema(
  "api",
  "LeaseApprovalResponse",
  z.object({ approval: ApprovalRecordSchema })
);

export const automationRoutes = {
  "GET /api/v1/rules": route({
    method: "GET",
    path: "/api/v1/rules",
    operation: "listRules",
    section: "05 §8",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: PageQuerySchema,
    response: AutomationRulePageSchema,
  }),
  "POST /api/v1/rules": route({
    method: "POST",
    path: "/api/v1/rules",
    operation: "createRule",
    section: "05 §8",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: CreateRuleRequestSchema,
    response: RuleResponseSchema,
  }),
  "GET /api/v1/rules/{rul_id}": route({
    method: "GET",
    path: "/api/v1/rules/{rul_id}",
    operation: "getRule",
    section: "05 §8",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: RuleResponseSchema,
  }),
  "PATCH /api/v1/rules/{rul_id}": route({
    method: "PATCH",
    path: "/api/v1/rules/{rul_id}",
    operation: "updateRule",
    section: "05 §8",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: UpdateRuleRequestSchema,
    response: RuleResponseSchema,
  }),
  "DELETE /api/v1/rules/{rul_id}": route({
    method: "DELETE",
    path: "/api/v1/rules/{rul_id}",
    operation: "deleteRule",
    section: "05 §8",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: null,
    query: DeleteQuerySchema,
    response: DeletedResponseSchema,
  }),
  "POST /api/v1/tasks": route({
    method: "POST",
    path: "/api/v1/tasks",
    operation: "createTask",
    section: "05 §8",
    scope: "automation:manage",
    alt_scope: "automation:execute",
    idempotency: "optional",
    status: 201,
    request: CreateTaskRequestSchema,
    response: TaskResponseSchema,
  }),
  "GET /api/v1/tasks": route({
    method: "GET",
    path: "/api/v1/tasks",
    operation: "listTasks",
    section: "05 §8",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: ListTasksQuerySchema,
    response: AutomationTaskPageSchema,
  }),
  "GET /api/v1/tasks/{tsk_id}": route({
    method: "GET",
    path: "/api/v1/tasks/{tsk_id}",
    operation: "getTask",
    section: "05 §8",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: TaskDetailSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/cancel": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/cancel",
    operation: "cancelTask",
    section: "05 §8",
    scope: "automation:manage",
    idempotency: "optional",
    status: 200,
    request: null,
    response: TaskResponseSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/retry": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/retry",
    operation: "retryTask",
    section: "05 §8",
    scope: "automation:manage",
    idempotency: "optional",
    status: 201,
    request: RetryTaskRequestSchema,
    response: TaskResponseSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/resume": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/resume",
    operation: "resumeTask",
    section: "05 §8",
    scope: "automation:manage",
    idempotency: "optional",
    status: 200,
    request: null,
    response: TaskResponseSchema,
  }),
  "POST /api/v1/devices/{dev_id}/tasks:claim": route({
    method: "POST",
    path: "/api/v1/devices/{dev_id}/tasks:claim",
    operation: "claimTask",
    section: "05 §8",
    scope: "automation:execute",
    device: true,
    idempotency: "required",
    status: 200,
    request: ClaimTaskRequestSchema,
    response: ClaimTaskResponseSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/heartbeat": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/lease/{lease_id}/heartbeat",
    operation: "leaseHeartbeat",
    section: "05 §8",
    scope: "automation:execute",
    device: true,
    idempotency: "required",
    status: 200,
    request: LeaseHeartbeatRequestSchema,
    response: LeaseHeartbeatResponseSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/events": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/lease/{lease_id}/events",
    operation: "leaseEvents",
    section: "05 §8",
    scope: "automation:execute",
    device: true,
    idempotency: "required",
    status: 200,
    request: LeaseEventsRequestSchema,
    response: LeaseEventsResponseSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/submit-intent": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/lease/{lease_id}/submit-intent",
    operation: "submitIntent",
    section: "05 §8",
    scope: "automation:execute",
    device: true,
    idempotency: "required",
    status: 200,
    request: SubmitIntentRequestSchema,
    response: SubmitIntentResponseSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/result": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/lease/{lease_id}/result",
    operation: "taskResult",
    section: "05 §8",
    scope: "automation:execute",
    device: true,
    idempotency: "required",
    status: 200,
    request: TaskResultRequestSchema,
    response: TaskResultResponseSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/release": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/lease/{lease_id}/release",
    operation: "releaseTask",
    section: "05 §8",
    scope: "automation:execute",
    device: true,
    idempotency: "required",
    status: 200,
    request: ReleaseTaskRequestSchema,
    response: TaskResponseSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence",
    operation: "lateEvidence",
    section: "05 §8",
    scope: "automation:execute",
    device: true,
    idempotency: "required",
    status: 200,
    request: LateEvidenceRequestSchema,
    response: LateEvidenceResponseSchema,
  }),
  "GET /api/v1/approvals": route({
    method: "GET",
    path: "/api/v1/approvals",
    operation: "listApprovals",
    section: "05 §8",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: ListApprovalsQuerySchema,
    response: ApprovalPageSchema,
  }),
  "POST /api/v1/approvals/{apr_id}/decide": route({
    method: "POST",
    path: "/api/v1/approvals/{apr_id}/decide",
    operation: "decideApproval",
    section: "05 §8",
    scope: "automation:manage",
    idempotency: "optional",
    status: 200,
    request: DecideApprovalRequestSchema,
    response: DecideApprovalResponseSchema,
  }),
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals": route({
    method: "POST",
    path: "/api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals",
    operation: "createLeaseApproval",
    section: "05 §8",
    scope: "automation:execute",
    device: true,
    idempotency: "required",
    status: 201,
    request: CreateLeaseApprovalRequestSchema,
    response: LeaseApprovalResponseSchema,
  }),
  "GET /api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals/{apr_id}": route({
    method: "GET",
    path: "/api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals/{apr_id}",
    operation: "getLeaseApproval",
    section: "05 §8",
    scope: "automation:execute",
    device: true,
    idempotency: "none",
    status: 200,
    request: null,
    response: LeaseApprovalResponseSchema,
  }),
} as const;
