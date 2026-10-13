// Canonical enumerations of the Job Tracker (03, 04, 05 and the area docs).
//
// Every list is exported three ways: a readonly tuple (`STAGES`), a Zod enum
// registered for the JSON Schema export (`StageSchema`, `$defs.Stage`) and a
// TypeScript union (`Stage`). `CHECK (col IN (...))` lists in 04 must stay
// byte-identical to the tuples here; `test/enums.test.ts` and the coverage
// gate parse the spec to enforce it.
import { z } from "zod";
import { defineSchema } from "./registry";

// ---------------------------------------------------------------------------
// Applications (03 §5, 04 §2.2)
// ---------------------------------------------------------------------------

/** Kanban stages in board column order (03 §5.1, 06 §1.1). */
export const STAGES = [
  "saved",
  "preparing",
  "ready",
  "applied",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
] as const;
export const StageSchema = defineSchema("enums", "Stage", z.enum(STAGES));
export type Stage = z.infer<typeof StageSchema>;

/** Stages with no automatic exit (03 §5.1). */
export const TERMINAL_STAGES = [
  "accepted",
  "rejected",
  "withdrawn",
] as const satisfies readonly Stage[];
export const NON_TERMINAL_STAGES = [
  "saved",
  "preparing",
  "ready",
  "applied",
  "interviewing",
  "offer",
] as const satisfies readonly Stage[];

/** Legacy `JobData.status` values (apps/api/src/types.ts, 06 §12.3). */
export const LEGACY_JOB_STATUSES = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "accepted",
] as const satisfies readonly Stage[];
export const LegacyJobStatusSchema = defineSchema(
  "enums",
  "LegacyJobStatus",
  z.enum(LEGACY_JOB_STATUSES)
);
export type LegacyJobStatus = z.infer<typeof LegacyJobStatusSchema>;

/** How certain we are that an application was submitted (03 §5.2). */
export const SUBMISSION_STATUSES = [
  "not_started",
  "in_progress",
  "submitted_verified",
  "submitted_unverified",
  "failed",
  "outcome_unknown",
] as const;
export const SubmissionStatusSchema = defineSchema(
  "enums",
  "SubmissionStatus",
  z.enum(SUBMISSION_STATUSES)
);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const SUBMISSION_METHODS = [
  "browser",
  "email",
  "ats_api",
  "manual",
] as const;
export const SubmissionMethodSchema = defineSchema(
  "enums",
  "SubmissionMethod",
  z.enum(SUBMISSION_METHODS)
);
export type SubmissionMethod = z.infer<typeof SubmissionMethodSchema>;

/** `POST /applications/{id}/submission` actions (05 §5). */
export const SUBMISSION_ACTIONS = ["confirm", "deny", "mark_applied"] as const;
export const SubmissionActionSchema = defineSchema(
  "enums",
  "SubmissionAction",
  z.enum(SUBMISSION_ACTIONS)
);
export type SubmissionAction = z.infer<typeof SubmissionActionSchema>;

/** Application modes (03 §5.3). */
export const APPLICATION_MODES = [
  "manual",
  "assisted",
  "approval",
  "auto",
] as const;
export const ApplicationModeSchema = defineSchema(
  "enums",
  "ApplicationMode",
  z.enum(APPLICATION_MODES)
);
export type ApplicationMode = z.infer<typeof ApplicationModeSchema>;

/** `automation_rules.mode` (04 §2.3). */
export const RULE_MODES = ["assisted", "approval", "auto"] as const;
export const RuleModeSchema = defineSchema(
  "enums",
  "RuleMode",
  z.enum(RULE_MODES)
);
export type RuleMode = z.infer<typeof RuleModeSchema>;

/** `applications.last_change_source` (04 §2.2). */
export const CHANGE_SOURCES = [
  "web",
  "cli",
  "mcp",
  "system",
  "legacy_migration",
] as const;
export const ChangeSourceSchema = defineSchema(
  "enums",
  "ChangeSource",
  z.enum(CHANGE_SOURCES)
);
export type ChangeSource = z.infer<typeof ChangeSourceSchema>;

/** `application_events.actor_kind` (03 §6). */
export const ACTOR_KINDS = [
  "user",
  "automation",
  "system",
  "mcp",
  "legacy_migration",
] as const;
export const ActorKindSchema = defineSchema(
  "enums",
  "ActorKind",
  z.enum(ACTOR_KINDS)
);
export type ActorKind = z.infer<typeof ActorKindSchema>;

/** Actors of the stage machine's permission table (03 §5.1). */
export const STAGE_ACTORS = ["user", "automation", "system"] as const;
export const StageActorSchema = defineSchema(
  "enums",
  "StageActor",
  z.enum(STAGE_ACTORS)
);
export type StageActor = z.infer<typeof StageActorSchema>;

/** `application_events.type` (03 §6). */
export const EVENT_TYPES = [
  "created",
  "stage_changed",
  "submission_status_changed",
  "note_added",
  "note_deleted",
  "cv_variant_attached",
  "automation_task_created",
  "automation_task_claimed",
  "automation_task_progress",
  "automation_task_paused",
  "automation_task_finished",
  "approval_requested",
  "approval_decided",
  "submit_intent",
  "interview_scheduled",
  "interview_updated",
  "offer_recorded",
  "email_sent",
  "conflict_recorded",
  "legacy_imported",
] as const;
export const EventTypeSchema = defineSchema(
  "enums",
  "EventType",
  z.enum(EVENT_TYPES)
);
export type EventType = z.infer<typeof EventTypeSchema>;

export const INTERVIEW_KINDS = [
  "phone_screen",
  "technical",
  "take_home",
  "onsite",
  "behavioral",
  "final",
  "other",
] as const;
export const InterviewKindSchema = defineSchema(
  "enums",
  "InterviewKind",
  z.enum(INTERVIEW_KINDS)
);
export type InterviewKind = z.infer<typeof InterviewKindSchema>;

export const INTERVIEW_OUTCOMES = [
  "pending",
  "passed",
  "failed",
  "cancelled",
  "no_show",
] as const;
export const InterviewOutcomeSchema = defineSchema(
  "enums",
  "InterviewOutcome",
  z.enum(INTERVIEW_OUTCOMES)
);
export type InterviewOutcome = z.infer<typeof InterviewOutcomeSchema>;

export const OFFER_STATUSES = [
  "open",
  "accepted",
  "declined",
  "expired",
  "rescinded",
] as const;
export const OfferStatusSchema = defineSchema(
  "enums",
  "OfferStatus",
  z.enum(OFFER_STATUSES)
);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

// ---------------------------------------------------------------------------
// Postings, tracked jobs and discovery (03 §4, 04 §2.1, §2.4, 15)
// ---------------------------------------------------------------------------

export const POSTING_VISIBILITIES = ["public", "private"] as const;
export const PostingVisibilitySchema = defineSchema(
  "enums",
  "PostingVisibility",
  z.enum(POSTING_VISIBILITIES)
);
export type PostingVisibility = z.infer<typeof PostingVisibilitySchema>;

/** `job_postings.source_kind` (04 §2.1). */
export const SOURCE_KINDS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "workday",
  "career_page",
  "generic_listing",
  "custom_url",
  "manual",
  "email",
  "legacy",
] as const;
export const SourceKindSchema = defineSchema(
  "enums",
  "SourceKind",
  z.enum(SOURCE_KINDS)
);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/** Sources with a stable job id: fingerprint key `src|…` (03 §4.2). */
export const STABLE_SOURCE_KINDS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "workday",
] as const satisfies readonly SourceKind[];
export type StableSourceKind = (typeof STABLE_SOURCE_KINDS)[number];

/** Source adapter ids of the registry (15 §14.1). */
export const ADAPTER_IDS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "workday",
  "career_page",
  "generic_listing",
  "custom_url",
] as const satisfies readonly SourceKind[];
export const AdapterIdSchema = defineSchema(
  "enums",
  "AdapterId",
  z.enum(ADAPTER_IDS)
);
export type AdapterId = z.infer<typeof AdapterIdSchema>;

/** Sources refused everywhere (D-17, 15 §14.4). */
export const EXCLUDED_SOURCE_IDS = ["linkedin", "indeed"] as const;
export const ExcludedSourceIdSchema = defineSchema(
  "enums",
  "ExcludedSourceId",
  z.enum(EXCLUDED_SOURCE_IDS)
);
export type ExcludedSourceId = z.infer<typeof ExcludedSourceIdSchema>;

export const ADAPTER_STATUSES = [
  "stable",
  "beta",
  "opt_in",
  "excluded",
] as const;
export const AdapterStatusSchema = defineSchema(
  "enums",
  "AdapterStatus",
  z.enum(ADAPTER_STATUSES)
);
export type AdapterStatus = z.infer<typeof AdapterStatusSchema>;

export const WORKPLACE_TYPES = [
  "onsite",
  "hybrid",
  "remote",
  "unknown",
] as const;
export const WorkplaceTypeSchema = defineSchema(
  "enums",
  "WorkplaceType",
  z.enum(WORKPLACE_TYPES)
);
export type WorkplaceType = z.infer<typeof WorkplaceTypeSchema>;

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "temporary",
  "internship",
  "volunteer",
  "unknown",
] as const;
export const EmploymentTypeSchema = defineSchema(
  "enums",
  "EmploymentType",
  z.enum(EMPLOYMENT_TYPES)
);
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;

export const POSTING_STATUSES = ["open", "closed", "unknown"] as const;
export const PostingStatusSchema = defineSchema(
  "enums",
  "PostingStatus",
  z.enum(POSTING_STATUSES)
);
export type PostingStatus = z.infer<typeof PostingStatusSchema>;

/** `job_postings.application_support` (04 §2.1). */
export const APPLICATION_SUPPORT = [
  "browser_supported",
  "browser_unsupported",
  "email",
  "external_redirect",
  "prohibited",
  "unknown",
] as const;
export const ApplicationSupportSchema = defineSchema(
  "enums",
  "ApplicationSupport",
  z.enum(APPLICATION_SUPPORT)
);
export type ApplicationSupport = z.infer<typeof ApplicationSupportSchema>;

export const SALARY_PERIODS = ["year", "month", "week", "day", "hour"] as const;
export const SalaryPeriodSchema = defineSchema(
  "enums",
  "SalaryPeriod",
  z.enum(SALARY_PERIODS)
);
export type SalaryPeriod = z.infer<typeof SalaryPeriodSchema>;

/** `user_jobs.origin` (04 §2.1). */
export const USER_JOB_ORIGINS = [
  "discovered",
  "manual",
  "imported",
  "legacy",
  "mcp",
] as const;
export const UserJobOriginSchema = defineSchema(
  "enums",
  "UserJobOrigin",
  z.enum(USER_JOB_ORIGINS)
);
export type UserJobOrigin = z.infer<typeof UserJobOriginSchema>;

/** `user_jobs.inbox_state` (03 §5). */
export const INBOX_STATES = ["new", "seen", "dismissed", "tracked"] as const;
export const InboxStateSchema = defineSchema(
  "enums",
  "InboxState",
  z.enum(INBOX_STATES)
);
export type InboxState = z.infer<typeof InboxStateSchema>;

/**
 * `POST /api/v1/inbox:bulk` actions (05 §4). `restore` brings a dismissed
 * job back to the inbox as `seen`.
 */
export const INBOX_BULK_ACTIONS = [
  "track",
  "dismiss",
  "seen",
  "score",
  "restore",
] as const;
export const InboxBulkActionSchema = defineSchema(
  "enums",
  "InboxBulkAction",
  z.enum(INBOX_BULK_ACTIONS)
);
export type InboxBulkAction = z.infer<typeof InboxBulkActionSchema>;

/** `discovery_runs.status` (04 §2.4, 15 §8). */
export const DISCOVERY_RUN_STATUSES = [
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export const DiscoveryRunStatusSchema = defineSchema(
  "enums",
  "DiscoveryRunStatus",
  z.enum(DISCOVERY_RUN_STATUSES)
);
export type DiscoveryRunStatus = z.infer<typeof DiscoveryRunStatusSchema>;

/** `discovery_run_items.outcome` and the `postings:batch` item outcome. */
export const RUN_ITEM_OUTCOMES = [
  "new",
  "updated",
  "unchanged",
  "invalid",
] as const;
export const RunItemOutcomeSchema = defineSchema(
  "enums",
  "RunItemOutcome",
  z.enum(RUN_ITEM_OUTCOMES)
);
export type RunItemOutcome = z.infer<typeof RunItemOutcomeSchema>;

/**
 * Discovery error taxonomy (15 §8). `source_unavailable` is the stop reason
 * named in the `http_5xx` row (5 consecutive 5xx).
 */
export const DISCOVERY_ERROR_CLASSES = [
  "network",
  "timeout",
  "http_5xx",
  "rate_limited",
  "access_denied",
  "challenge_detected",
  "robots_disallowed",
  "not_found",
  "source_closed",
  "source_unavailable",
  "parse_error",
  "schema_invalid",
  "selector_drift",
  "unsupported_content",
  "policy_blocked",
  "cancelled",
] as const;
export const DiscoveryErrorClassSchema = defineSchema(
  "enums",
  "DiscoveryErrorClass",
  z.enum(DISCOVERY_ERROR_CLASSES)
);
export type DiscoveryErrorClass = z.infer<typeof DiscoveryErrorClassSchema>;

/** Which discovery error classes the wrapper retries (15 §8). */
export const DISCOVERY_ERROR_RETRYABLE: Readonly<
  Record<DiscoveryErrorClass, boolean>
> = {
  network: true,
  timeout: true,
  http_5xx: true,
  rate_limited: true,
  access_denied: false,
  challenge_detected: false,
  robots_disallowed: false,
  not_found: false,
  source_closed: false,
  source_unavailable: false,
  parse_error: false,
  schema_invalid: false,
  selector_drift: false,
  unsupported_content: false,
  policy_blocked: false,
  cancelled: false,
};

// ---------------------------------------------------------------------------
// Automation (03 §7, 04 §2.6, 21)
// ---------------------------------------------------------------------------

export const TASK_KINDS = ["apply", "discover", "render_cv"] as const;
export const TaskKindSchema = defineSchema(
  "enums",
  "TaskKind",
  z.enum(TASK_KINDS)
);
export type TaskKind = z.infer<typeof TaskKindSchema>;

/** `automation_tasks.state` (03 §7.2). */
export const TASK_STATES = [
  "queued",
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
] as const;
export const TaskStateSchema = defineSchema(
  "enums",
  "TaskState",
  z.enum(TASK_STATES)
);
export type TaskState = z.infer<typeof TaskStateSchema>;

/** Live states (the `ux_tasks_live_apply` predicate, 04 §2.6). */
export const TASK_LIVE_STATES = [
  "queued",
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
] as const satisfies readonly TaskState[];

/** Terminal states (03 §7.2). */
export const TASK_TERMINAL_STATES = [
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
] as const satisfies readonly TaskState[];

/** `automation_tasks.created_by` (04 §2.6). */
export const TASK_CREATED_BY = ["web", "cli", "rule", "mcp", "system"] as const;
export const TaskCreatedBySchema = defineSchema(
  "enums",
  "TaskCreatedBy",
  z.enum(TASK_CREATED_BY)
);
export type TaskCreatedBy = z.infer<typeof TaskCreatedBySchema>;

/** CLI-local execution states (20 §3 `local_tasks.local_state`). */
export const LOCAL_TASK_STATES = [
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
  "submit_intent",
  "sync_pending",
  "done",
  "orphaned",
] as const;
export const LocalTaskStateSchema = defineSchema(
  "enums",
  "LocalTaskState",
  z.enum(LOCAL_TASK_STATES)
);
export type LocalTaskState = z.infer<typeof LocalTaskStateSchema>;

/** `automation_attempts.outcome` (04 §2.6). */
export const ATTEMPT_OUTCOMES = [
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
  "lease_expired",
  "outcome_unknown",
  "paused",
] as const;
export const AttemptOutcomeSchema = defineSchema(
  "enums",
  "AttemptOutcome",
  z.enum(ATTEMPT_OUTCOMES)
);
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>;

/** `POST …/lease/{l}/result` outcomes (21 §6.6). */
export const TASK_RESULT_OUTCOMES = [
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
] as const;
export const TaskResultOutcomeSchema = defineSchema(
  "enums",
  "TaskResultOutcome",
  z.enum(TASK_RESULT_OUTCOMES)
);
export type TaskResultOutcome = z.infer<typeof TaskResultOutcomeSchema>;

/** `POST …/lease/{l}/release` reasons (05 §8). */
export const RELEASE_REASONS = [
  "user_quit",
  "awaiting_approval",
  "needs_headed",
  "shutdown",
] as const;
export const ReleaseReasonSchema = defineSchema(
  "enums",
  "ReleaseReason",
  z.enum(RELEASE_REASONS)
);
export type ReleaseReason = z.infer<typeof ReleaseReasonSchema>;

/**
 * The canonical PauseReason list (03 §7.2) — the single list 04, 12, 18, 19
 * and 21 use. `external_redirect` is a page kind, not a pause reason.
 */
export const PAUSE_REASONS = [
  "captcha_or_challenge",
  "login_required",
  "account_creation_required",
  "mfa_required",
  "credential_field",
  "missing_information",
  "protected_question",
  "unknown_question",
  "unsupported_form",
  "unclear_page",
  "off_domain_navigation",
  "validation_unresolved",
  "stuck_loop",
  "needs_headed_restart",
  "payment_requested",
  "network_offline",
  "resource_exhausted",
  "low_confidence",
  "injection_suspected",
  "ai_unavailable",
  "user_requested",
] as const;
export const PauseReasonSchema = defineSchema(
  "enums",
  "PauseReason",
  z.enum(PAUSE_REASONS)
);
export type PauseReason = z.infer<typeof PauseReasonSchema>;

/**
 * Task `progress.stage` values: the apply stepper of 12 §6.3 united with the
 * progress events of 21 §6.1. `discovering` and `rendering` are the stages of
 * `discover` and `render_cv` tasks, which the spec reports through the same
 * heartbeat `progress` object without naming a stage (15 §15, 08 §6.3).
 */
export const PROGRESS_STAGES = [
  "claimed",
  "preparing_cv",
  "opening",
  "inspecting",
  "filling",
  "uploading",
  "reviewing",
  "awaiting_approval",
  "submitting",
  "verifying",
  "discovering",
  "rendering",
  "done",
] as const;
export const ProgressStageSchema = defineSchema(
  "enums",
  "ProgressStage",
  z.enum(PROGRESS_STAGES)
);
export type ProgressStage = z.infer<typeof ProgressStageSchema>;

/** Step event types of `POST …/lease/{l}/events` (05 §8, 21 §6.1). */
export const LEASE_EVENT_TYPES = [
  "started",
  "progress",
  "paused",
  "resumed",
  "submit_intent",
  "approval_requested",
  "log",
] as const;
export const LeaseEventTypeSchema = defineSchema(
  "enums",
  "LeaseEventType",
  z.enum(LEASE_EVENT_TYPES)
);
export type LeaseEventType = z.infer<typeof LeaseEventTypeSchema>;

/**
 * Task error classes named in 21 §8, 19 §4.2/§8/§10, 08 §6.3/§8 and 02. The
 * column and the result body stay free strings (19 §3.2 `error_class:
 * z.string()`); this list is the known vocabulary with its retry policy.
 */
export const TASK_ERROR_CLASSES = [
  "network_offline",
  "upstream_unavailable",
  "browser_crashed",
  "lease_expired",
  "timeout",
  "navigation_timeout",
  "page_changed",
  "selector_not_found",
  "login_required",
  "captcha_or_challenge",
  "mfa_required",
  "unsupported_form",
  "prohibited_platform",
  "domain_not_allowed",
  "policy_violation",
  "validation_errors_unresolved",
  "posting_closed",
  "posting_unavailable",
  "approval_rejected",
  "approval_expired",
  "cancelled",
  "missing_information",
  "injection_suspected",
  "budget_exceeded",
  "auto_precondition_failed",
  "precheck_failed",
  "email_application_required",
  "render_failed",
  "artifact_integrity",
  "files_unavailable",
  "cdp_non_loopback",
  "device_revoked",
] as const;
export const TaskErrorClassSchema = defineSchema(
  "enums",
  "TaskErrorClass",
  z.enum(TASK_ERROR_CLASSES)
);
export type TaskErrorClass = z.infer<typeof TaskErrorClassSchema>;

/**
 * Automatic task retry policy (21 §8, 19 §8.4): `"yes"` retries with backoff
 * while attempts remain, `"once"` retries a single time, `"no"` fails and
 * `"n/a"` ends the task as `cancelled`. Nothing is retried after
 * `submit_intent` regardless of this table (D-19).
 */
export const TASK_ERROR_RETRY: Readonly<
  Record<TaskErrorClass, "yes" | "once" | "no" | "n/a">
> = {
  network_offline: "yes",
  upstream_unavailable: "yes",
  browser_crashed: "yes",
  lease_expired: "yes",
  timeout: "once",
  navigation_timeout: "yes",
  page_changed: "once",
  selector_not_found: "once",
  login_required: "no",
  captcha_or_challenge: "no",
  mfa_required: "no",
  unsupported_form: "no",
  prohibited_platform: "no",
  domain_not_allowed: "no",
  policy_violation: "no",
  validation_errors_unresolved: "no",
  posting_closed: "no",
  posting_unavailable: "no",
  approval_rejected: "n/a",
  approval_expired: "n/a",
  cancelled: "n/a",
  missing_information: "no",
  injection_suspected: "no",
  budget_exceeded: "no",
  auto_precondition_failed: "no",
  precheck_failed: "no",
  email_application_required: "no",
  render_failed: "no",
  artifact_integrity: "no",
  files_unavailable: "yes",
  cdp_non_loopback: "no",
  device_revoked: "n/a",
};

export const APPROVAL_KINDS = [
  "submit",
  "answer",
  "cv_variant",
  "rule_activation",
] as const;
export const ApprovalKindSchema = defineSchema(
  "enums",
  "ApprovalKind",
  z.enum(APPROVAL_KINDS)
);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const APPROVAL_STATES = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;
export const ApprovalStateSchema = defineSchema(
  "enums",
  "ApprovalState",
  z.enum(APPROVAL_STATES)
);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export const APPROVAL_DECIDED_VIA = ["web", "cli", "mcp"] as const;
export const ApprovalDecidedViaSchema = defineSchema(
  "enums",
  "ApprovalDecidedVia",
  z.enum(APPROVAL_DECIDED_VIA)
);
export type ApprovalDecidedVia = z.infer<typeof ApprovalDecidedViaSchema>;

export const APPROVAL_DECISIONS = ["approve", "reject"] as const;
export const ApprovalDecisionSchema = defineSchema(
  "enums",
  "ApprovalDecision",
  z.enum(APPROVAL_DECISIONS)
);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/** `submission_evidence.kind` (04 §2.6). */
export const EVIDENCE_KINDS = [
  "browser_confirmation",
  "ats_api_response",
  "email_sent",
  "user_attestation",
  "confirmation_email",
] as const;
export const EvidenceKindSchema = defineSchema(
  "enums",
  "EvidenceKind",
  z.enum(EVIDENCE_KINDS)
);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EVIDENCE_VERDICTS = [
  "verified",
  "unverified",
  "negative",
] as const;
export const EvidenceVerdictSchema = defineSchema(
  "enums",
  "EvidenceVerdict",
  z.enum(EVIDENCE_VERDICTS)
);
export type EvidenceVerdict = z.infer<typeof EvidenceVerdictSchema>;

/** Results of the verification algorithm (19 §9.1). */
export const VERIFICATION_VERDICTS = [
  "verified",
  "unverified",
  "negative",
  "outcome_unknown",
] as const;
export const VerificationVerdictSchema = defineSchema(
  "enums",
  "VerificationVerdict",
  z.enum(VERIFICATION_VERDICTS)
);
export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema>;

// ---------------------------------------------------------------------------
// Files, CV variants, email (04 §2.5)
// ---------------------------------------------------------------------------

export const FILE_KINDS = [
  "cv_pdf",
  "cover_letter",
  "attachment",
  "evidence_screenshot",
  "run_log",
] as const;
export const FileKindSchema = defineSchema(
  "enums",
  "FileKind",
  z.enum(FILE_KINDS)
);
export type FileKind = z.infer<typeof FileKindSchema>;

export const FILE_STATUSES = ["pending", "ready", "deleted"] as const;
export const FileStatusSchema = defineSchema(
  "enums",
  "FileStatus",
  z.enum(FILE_STATUSES)
);
export type FileStatus = z.infer<typeof FileStatusSchema>;

/** The four `apps/cv` templates (08 §3). */
export const CV_TEMPLATES = ["basic", "harvard", "simple", "standard"] as const;
export const CvTemplateSchema = defineSchema(
  "enums",
  "CvTemplate",
  z.enum(CV_TEMPLATES)
);
export type CvTemplate = z.infer<typeof CvTemplateSchema>;

export const CV_VARIANT_STATUSES = [
  "generating",
  "draft",
  "approved",
  "rejected",
  "failed",
] as const;
export const CvVariantStatusSchema = defineSchema(
  "enums",
  "CvVariantStatus",
  z.enum(CV_VARIANT_STATUSES)
);
export type CvVariantStatus = z.infer<typeof CvVariantStatusSchema>;

/** CV document visibility (D-25). */
export const CV_VISIBILITIES = ["public", "private"] as const;
export const CvVisibilitySchema = defineSchema(
  "enums",
  "CvVisibility",
  z.enum(CV_VISIBILITIES)
);
export type CvVisibility = z.infer<typeof CvVisibilitySchema>;

export const EMAIL_DELIVERIES = ["local_handoff", "server_send"] as const;
export const EmailDeliverySchema = defineSchema(
  "enums",
  "EmailDelivery",
  z.enum(EMAIL_DELIVERIES)
);
export type EmailDelivery = z.infer<typeof EmailDeliverySchema>;

export const EMAIL_STATUSES = [
  "draft",
  "approved",
  "sent",
  "failed",
  "handed_off",
] as const;
export const EmailStatusSchema = defineSchema(
  "enums",
  "EmailStatus",
  z.enum(EMAIL_STATUSES)
);
export type EmailStatus = z.infer<typeof EmailStatusSchema>;

// ---------------------------------------------------------------------------
// Profile, settings, AI (03 §9, 04 §2.3, §2.7)
// ---------------------------------------------------------------------------

export const FACT_SOURCES = [
  "user_entered",
  "cv_import",
  "verified_document",
] as const;
export const FactSourceSchema = defineSchema(
  "enums",
  "FactSource",
  z.enum(FACT_SOURCES)
);
export type FactSource = z.infer<typeof FactSourceSchema>;

export const ANSWER_KINDS = [
  "text",
  "choice",
  "number",
  "boolean",
  "date",
] as const;
export const AnswerKindSchema = defineSchema(
  "enums",
  "AnswerKind",
  z.enum(ANSWER_KINDS)
);
export type AnswerKind = z.infer<typeof AnswerKindSchema>;

/** Sensitivity classes (03 §9, 19 §6). */
export const SENSITIVITIES = ["none", "personal", "protected"] as const;
export const SensitivitySchema = defineSchema(
  "enums",
  "Sensitivity",
  z.enum(SENSITIVITIES)
);
export type Sensitivity = z.infer<typeof SensitivitySchema>;

export const AUTO_USE = ["never", "approval", "always"] as const;
export const AutoUseSchema = defineSchema("enums", "AutoUse", z.enum(AUTO_USE));
export type AutoUse = z.infer<typeof AutoUseSchema>;

export const LOCALES = ["en", "id"] as const;
export const LocaleSchema = defineSchema("enums", "Locale", z.enum(LOCALES));
export type Locale = z.infer<typeof LocaleSchema>;

/** `user_settings.evidence_screenshots` (04 §2.7). */
export const EVIDENCE_SCREENSHOT_MODES = [
  "off",
  "on_submit",
  "all_steps",
] as const;
export const EvidenceScreenshotModeSchema = defineSchema(
  "enums",
  "EvidenceScreenshotMode",
  z.enum(EVIDENCE_SCREENSHOT_MODES)
);
export type EvidenceScreenshotMode = z.infer<
  typeof EvidenceScreenshotModeSchema
>;

/** `ai_usage.purpose` (04 §2.7, 07 §9). */
export const AI_USAGE_PURPOSES = [
  "score",
  "tailor_cv",
  "agent",
  "email_draft",
] as const;
export const AiUsagePurposeSchema = defineSchema(
  "enums",
  "AiUsagePurpose",
  z.enum(AI_USAGE_PURPOSES)
);
export type AiUsagePurpose = z.infer<typeof AiUsagePurposeSchema>;

/** `match_scores.status` (04 §2.3). */
export const MATCH_SCORE_STATUSES = ["queued", "ready", "failed"] as const;
export const MatchScoreStatusSchema = defineSchema(
  "enums",
  "MatchScoreStatus",
  z.enum(MATCH_SCORE_STATUSES)
);
export type MatchScoreStatus = z.infer<typeof MatchScoreStatusSchema>;

// ---------------------------------------------------------------------------
// Identity, devices, OAuth (03 §2, 04 §1, 05 §1.2, 17)
// ---------------------------------------------------------------------------

/** OAuth scopes (05 §1.2). DCR clients carry the legacy ceiling `mcp`. */
export const OAUTH_SCOPES = [
  "jobs:read",
  "jobs:write",
  "discovery:write",
  "automation:execute",
  "automation:manage",
  "cv:read",
  "cv:write",
  "files:read",
  "files:write",
  "ai:invoke",
  "devices:manage",
  "offline_access",
] as const;
export const OAuthScopeSchema = defineSchema(
  "enums",
  "OAuthScope",
  z.enum(OAUTH_SCOPES)
);
export type OAuthScope = z.infer<typeof OAuthScopeSchema>;

/** `oauth_clients.allowed_scopes` value of DCR (MCP) clients (17 §3.2). */
export const MCP_CLIENT_SCOPE = "mcp" as const;

/** Credential kinds of the extended `Caller` (PLAN C4). */
export const CREDENTIAL_KINDS = [
  "browser_session",
  "personal_write",
  "personal_read",
  "oauth_mcp",
  "oauth_cli",
] as const;
export const CredentialKindSchema = defineSchema(
  "enums",
  "CredentialKind",
  z.enum(CREDENTIAL_KINDS)
);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

/** `mcp_tokens.kind` after migration 0002 (04 §1). */
export const TOKEN_KINDS = ["personal", "session", "oauth"] as const;
export const TokenKindSchema = defineSchema(
  "enums",
  "TokenKind",
  z.enum(TOKEN_KINDS)
);
export type TokenKind = z.infer<typeof TokenKindSchema>;

export const TOKEN_STATUSES = ["active", "revoked"] as const;
export const TokenStatusSchema = defineSchema(
  "enums",
  "TokenStatus",
  z.enum(TOKEN_STATUSES)
);
export type TokenStatus = z.infer<typeof TokenStatusSchema>;

/** Legacy `mcp_tokens.scope` (apps/api/migrations/0001_initial.sql). */
export const LEGACY_TOKEN_SCOPES = ["write", "read"] as const;
export const LegacyTokenScopeSchema = defineSchema(
  "enums",
  "LegacyTokenScope",
  z.enum(LEGACY_TOKEN_SCOPES)
);
export type LegacyTokenScope = z.infer<typeof LegacyTokenScopeSchema>;

export const TOKEN_ENDPOINT_AUTH_METHODS = [
  "client_secret_basic",
  "client_secret_post",
  "none",
] as const;
export const TokenEndpointAuthMethodSchema = defineSchema(
  "enums",
  "TokenEndpointAuthMethod",
  z.enum(TOKEN_ENDPOINT_AUTH_METHODS)
);
export type TokenEndpointAuthMethod = z.infer<
  typeof TokenEndpointAuthMethodSchema
>;

/** `oauth_grants.revoked_reason` (04 §1). */
export const GRANT_REVOKED_REASONS = [
  "user",
  "device_revoked",
  "refresh_reuse",
  "admin",
  "account_deleted",
] as const;
export const GrantRevokedReasonSchema = defineSchema(
  "enums",
  "GrantRevokedReason",
  z.enum(GRANT_REVOKED_REASONS)
);
export type GrantRevokedReason = z.infer<typeof GrantRevokedReasonSchema>;

export const DEVICE_PLATFORMS = ["macos", "windows", "linux"] as const;
export const DevicePlatformSchema = defineSchema(
  "enums",
  "DevicePlatform",
  z.enum(DEVICE_PLATFORMS)
);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

/** Worker capabilities (21 §3). */
export const DEVICE_CAPABILITIES = [
  "discover",
  "apply",
  "render_cv",
  "headed_browser",
] as const;
export const DeviceCapabilitySchema = defineSchema(
  "enums",
  "DeviceCapability",
  z.enum(DEVICE_CAPABILITIES)
);
export type DeviceCapability = z.infer<typeof DeviceCapabilitySchema>;

/** `browser.mode` in the CLI config and device heartbeat (18 §3). */
export const BROWSER_MODES = ["managed", "connected", "persistent"] as const;
export const BrowserModeSchema = defineSchema(
  "enums",
  "BrowserMode",
  z.enum(BROWSER_MODES)
);
export type BrowserMode = z.infer<typeof BrowserModeSchema>;

/**
 * `browser.status` in the device heartbeat (05 §3). The spec names the field
 * without a value list; these four cover the CLI & devices page (12 §7).
 */
export const BROWSER_STATUSES = [
  "ready",
  "busy",
  "not_installed",
  "error",
] as const;
export const BrowserStatusSchema = defineSchema(
  "enums",
  "BrowserStatus",
  z.enum(BROWSER_STATUSES)
);
export type BrowserStatus = z.infer<typeof BrowserStatusSchema>;

/** Kill switches and rollout flags in `DB.feature_flags` (D-33). */
export const FEATURE_FLAG_KEYS = [
  "JOBS_V1_ENABLED",
  "JOBS_CLI_LOGIN_ENABLED",
  "JOBS_AUTOMATION_ENABLED",
  "JOBS_AUTO_MODE_ENABLED",
  "JOBS_EMAIL_SERVER_SEND_ENABLED",
  "AI_DISABLED",
  "JOBS_LEGACY_BACKEND",
] as const;
export const FeatureFlagKeySchema = defineSchema(
  "enums",
  "FeatureFlagKey",
  z.enum(FEATURE_FLAG_KEYS)
);
export type FeatureFlagKey = z.infer<typeof FeatureFlagKeySchema>;

/** Values of `JOBS_LEGACY_BACKEND` (06 §12.4). */
export const LEGACY_BACKENDS = ["kv", "d1"] as const;
export const LegacyBackendSchema = defineSchema(
  "enums",
  "LegacyBackend",
  z.enum(LEGACY_BACKENDS)
);
export type LegacyBackend = z.infer<typeof LegacyBackendSchema>;

/** `request_log.category` (apps/api/migrations/0001_initial.sql). */
export const REQUEST_LOG_CATEGORIES = [
  "cv",
  "invoice",
  "portfolio",
  "jobs",
] as const;
export const RequestLogCategorySchema = defineSchema(
  "enums",
  "RequestLogCategory",
  z.enum(REQUEST_LOG_CATEGORIES)
);
export type RequestLogCategory = z.infer<typeof RequestLogCategorySchema>;

export const REQUEST_LOG_STATUSES = ["ok", "error"] as const;
export const RequestLogStatusSchema = defineSchema(
  "enums",
  "RequestLogStatus",
  z.enum(REQUEST_LOG_STATUSES)
);
export type RequestLogStatus = z.infer<typeof RequestLogStatusSchema>;

// ---------------------------------------------------------------------------
// Sync (04 §2.7, 20)
// ---------------------------------------------------------------------------

export const CHANGE_OPS = ["upsert", "delete"] as const;
export const ChangeOpSchema = defineSchema(
  "enums",
  "ChangeOp",
  z.enum(CHANGE_OPS)
);
export type ChangeOp = z.infer<typeof ChangeOpSchema>;

/**
 * `change_log.entity` names (04 §2.7, 20 §3 `entity_cache.entity`, 07 §7.2
 * `score`). Singular, one per record type that reaches the change feed.
 */
export const CHANGE_ENTITIES = [
  "application",
  "user_job",
  "posting",
  "event",
  "interview",
  "offer",
  "task",
  "attempt",
  "approval",
  "evidence",
  "rule",
  "source",
  "run",
  "fact",
  "answer",
  "score",
  "cv_variant",
  "file",
  "email",
  "settings",
  "device",
] as const;
export const ChangeEntitySchema = defineSchema(
  "enums",
  "ChangeEntity",
  z.enum(CHANGE_ENTITIES)
);
export type ChangeEntity = z.infer<typeof ChangeEntitySchema>;

/** `GET /api/v1/snapshot?entities=` collection names (05 §11, 20 §4.2). */
export const SNAPSHOT_ENTITIES = [
  "applications",
  "user_jobs",
  "postings",
  "interviews",
  "offers",
  "tasks",
  "approvals",
  "rules",
  "sources",
  "facts",
  "answers",
  "cv_variants",
  "settings",
] as const;
export const SnapshotEntitySchema = defineSchema(
  "enums",
  "SnapshotEntity",
  z.enum(SNAPSHOT_ENTITIES)
);
export type SnapshotEntity = z.infer<typeof SnapshotEntitySchema>;

// ---------------------------------------------------------------------------
// Analytics (05 §12, 10 §6)
// ---------------------------------------------------------------------------

export const ANALYTICS_METRICS = [
  "applied",
  "interviews",
  "offers",
  "rejected",
  "discovered",
  "ai_cost",
] as const;
export const AnalyticsMetricSchema = defineSchema(
  "enums",
  "AnalyticsMetric",
  z.enum(ANALYTICS_METRICS)
);
export type AnalyticsMetric = z.infer<typeof AnalyticsMetricSchema>;

export const ANALYTICS_INTERVALS = ["day", "week", "month"] as const;
export const AnalyticsIntervalSchema = defineSchema(
  "enums",
  "AnalyticsInterval",
  z.enum(ANALYTICS_INTERVALS)
);
export type AnalyticsInterval = z.infer<typeof AnalyticsIntervalSchema>;

export const ANALYTICS_BREAKDOWNS = [
  "source",
  "company",
  "mode",
  "method",
  "cv_variant",
  "score_band",
  "workplace_type",
] as const;
export const AnalyticsBreakdownSchema = defineSchema(
  "enums",
  "AnalyticsBreakdown",
  z.enum(ANALYTICS_BREAKDOWNS)
);
export type AnalyticsBreakdown = z.infer<typeof AnalyticsBreakdownSchema>;

// ---------------------------------------------------------------------------
// API errors (05 §1.3)
// ---------------------------------------------------------------------------

/** Every `error` code of 05 §1.3 with its HTTP status. */
export const API_ERROR_STATUS = {
  invalid_request: 400,
  invalid_token: 401,
  insufficient_scope: 403,
  device_revoked: 403,
  device_not_accepting_tasks: 403,
  device_required: 403,
  not_found: 404,
  revision_conflict: 409,
  lease_lost: 409,
  idempotency_mismatch: 409,
  duplicate: 409,
  too_late: 409,
  approval_expired: 410,
  task_expired: 410,
  cursor_expired: 410,
  payload_too_large: 413,
  invalid_transition: 422,
  policy_violation: 422,
  unsupported_source: 422,
  mode_not_allowed: 422,
  cli_upgrade_required: 426,
  rate_limited: 429,
  ai_budget_exhausted: 429,
  upstream_unavailable: 503,
} as const;
export type ApiErrorCode = keyof typeof API_ERROR_STATUS;
export const API_ERROR_CODES = Object.keys(
  API_ERROR_STATUS
) as readonly ApiErrorCode[] as readonly [ApiErrorCode, ...ApiErrorCode[]];
export const ApiErrorCodeSchema = defineSchema(
  "enums",
  "ApiErrorCode",
  z.enum(API_ERROR_CODES)
);

/** `reason` of `401 invalid_token` (05 §1.3). */
export const INVALID_TOKEN_REASONS = [
  "no_bearer",
  "unknown_token",
  "expired_token",
  "revoked_token",
] as const;
export const InvalidTokenReasonSchema = defineSchema(
  "enums",
  "InvalidTokenReason",
  z.enum(INVALID_TOKEN_REASONS)
);
export type InvalidTokenReason = z.infer<typeof InvalidTokenReasonSchema>;
