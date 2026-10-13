// Row schemas: the API representation of every table in 04 (`DB` and
// `JOBS_DB`), plus the existing `mcp_tokens`, `oauth_clients` and
// `request_log` tables of `apps/api/migrations/0001_initial.sql`.
//
// Representation rules (PLAN C2): keys are the column names; JSON TEXT
// columns are parsed into their shapes; 0/1 flag columns are booleans;
// timestamps are epoch milliseconds; `CHECK (col IN (...))` columns are enums.
// `TABLE_RECORDS` maps every table name to its row schema.
import { z } from "zod";
import type { ValueSource } from "./agent";
import { EvidenceSignalsSchema } from "./agent";
import {
  CountryCodeSchema,
  DaySchema,
  DomainSchema,
  EmptyObjectSchema,
  FingerprintSchema,
  JsonObjectSchema,
  JsonValueSchema,
  MonthSchema,
  RevisionSchema,
  Sha256HexSchema,
  TimestampSchema,
  UrlSchema,
} from "./common";
import { CvVariantDiffSchema } from "./cv-tailoring";
import type { EventType } from "./enums";
import {
  ActorKindSchema,
  AdapterIdSchema,
  AiUsagePurposeSchema,
  ApplicationModeSchema,
  ApplicationSupportSchema,
  ApprovalDecidedViaSchema,
  ApprovalKindSchema,
  ApprovalStateSchema,
  AnswerKindSchema,
  AttemptOutcomeSchema,
  AutoUseSchema,
  ChangeEntitySchema,
  ChangeOpSchema,
  ChangeSourceSchema,
  CvTemplateSchema,
  CvVariantStatusSchema,
  DeviceCapabilitySchema,
  DevicePlatformSchema,
  DiscoveryErrorClassSchema,
  DiscoveryRunStatusSchema,
  EmailDeliverySchema,
  EmailStatusSchema,
  EmploymentTypeSchema,
  EventTypeSchema,
  EvidenceKindSchema,
  EvidenceScreenshotModeSchema,
  EvidenceVerdictSchema,
  FactSourceSchema,
  FeatureFlagKeySchema,
  FileKindSchema,
  FileStatusSchema,
  GrantRevokedReasonSchema,
  InboxStateSchema,
  InterviewKindSchema,
  InterviewOutcomeSchema,
  LegacyJobStatusSchema,
  LegacyTokenScopeSchema,
  LocalTaskStateSchema,
  LocaleSchema,
  MatchScoreStatusSchema,
  OfferStatusSchema,
  PauseReasonSchema,
  PostingStatusSchema,
  PostingVisibilitySchema,
  ProgressStageSchema,
  RequestLogCategorySchema,
  RequestLogStatusSchema,
  RuleModeSchema,
  RunItemOutcomeSchema,
  SalaryPeriodSchema,
  SensitivitySchema,
  SourceKindSchema,
  StageSchema,
  SubmissionMethodSchema,
  SubmissionStatusSchema,
  TaskCreatedBySchema,
  TaskKindSchema,
  TaskStateSchema,
  TokenEndpointAuthMethodSchema,
  TokenKindSchema,
  TokenStatusSchema,
  UserJobOriginSchema,
  WorkplaceTypeSchema,
} from "./enums";
import {
  ApplicationIdSchema,
  ApprovalIdSchema,
  AnswerIdSchema,
  AttemptIdSchema,
  CvVariantIdSchema,
  DeviceIdSchema,
  EmailIdSchema,
  EventIdSchema,
  EvidenceIdSchema,
  FactIdSchema,
  FileIdSchema,
  GrantIdSchema,
  InterviewIdSchema,
  LeaseIdSchema,
  OfferIdSchema,
  PostingIdSchema,
  RefreshTokenIdSchema,
  RuleIdSchema,
  RunIdSchema,
  ScoreIdSchema,
  SourceIdSchema,
  SupportAccessIdSchema,
  TaskIdSchema,
  UserIdSchema,
  UserJobIdSchema,
} from "./ids";
import { defineSchema } from "./registry";
import {
  RuleScoreCriteriaSchema,
  ScoreComponentsSchema,
  SeniorityLevelSchema,
} from "./scoring";

const ts = TimestampSchema;
const tsOrNull = TimestampSchema.nullable();
const text = z.string();
const textOrNull = z.string().nullable();

// ===========================================================================
// JSON column shapes
// ===========================================================================

/** `job_postings.locations[]` (04 §2.1, 15 §10.1). */
export const PostingLocationSchema = defineSchema(
  "records",
  "PostingLocation",
  z.object({
    raw: z.string().min(1).max(300),
    city: z.string().max(120).optional(),
    region: z.string().max(120).optional(),
    country_code: CountryCodeSchema.optional(),
  })
);
export type PostingLocation = z.infer<typeof PostingLocationSchema>;

/** `job_postings.salary` (04 §2.1); ambiguous text keeps only `raw`. */
export const SalarySchema = defineSchema(
  "records",
  "Salary",
  z.object({
    min: z.number().min(0).optional(),
    max: z.number().min(0).optional(),
    currency: z.string().length(3).optional(),
    period: SalaryPeriodSchema.optional(),
    raw: z.string().max(2000).optional(),
  })
);
export type Salary = z.infer<typeof SalarySchema>;

/** How a fetch was made (15 §4 `FetchMode`). */
export const FETCH_MODES = ["json_api", "static_html", "browser"] as const;
export const FetchModeSchema = defineSchema(
  "records",
  "FetchMode",
  z.enum(FETCH_MODES)
);

/** How fields were extracted (15 §4 `ExtractionOutcome.method`). */
export const EXTRACTION_METHODS = [
  "json_api",
  "json_ld",
  "css",
  "xpath",
  "adaptive",
] as const;
export const ExtractionMethodSchema = defineSchema(
  "records",
  "ExtractionMethod",
  z.enum(EXTRACTION_METHODS)
);

/**
 * Extraction provenance of a discovered posting (15 §11). Timestamps are
 * epoch ms (PLAN C2), so `observed_at` is a number, not the ISO string of the
 * 15 §11 example. Unknown keys are preserved.
 */
export const ExtractionProvenanceSchema = defineSchema(
  "records",
  "ExtractionProvenance",
  z.looseObject({
    v: z.literal(1),
    adapter: AdapterIdSchema,
    adapter_version: z.string().min(1),
    engine: z
      .object({
        pilih_jobs: z.string().optional(),
        scrapling: z.string().optional(),
        playwright: z.string().optional(),
      })
      .optional(),
    fetch_mode: FetchModeSchema,
    method: ExtractionMethodSchema,
    source_urls: z
      .object({
        listing: z.string().optional(),
        detail: z.string().optional(),
      })
      .optional(),
    relocated_fields: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1),
    flags: z.array(z.string()).optional(),
    observed_at: TimestampSchema,
    run_id: RunIdSchema.nullable().optional(),
    device_id: DeviceIdSchema.nullable().optional(),
  })
);
export type ExtractionProvenance = z.infer<typeof ExtractionProvenanceSchema>;

/** Legacy `JobItem` (apps/api/src/types.ts), kept verbatim (06 §5). */
export const LegacyJobItemSchema = defineSchema(
  "records",
  "LegacyJobItem",
  z.object({
    id: z.string(),
    title: z.string(),
    notes: z.string(),
    url: z.string(),
    done: z.boolean(),
  })
);

/** Legacy `JobSection` — `applications.sections` checklists (06 §5). */
export const LegacyJobSectionSchema = defineSchema(
  "records",
  "LegacyJobSection",
  z.object({
    id: z.string(),
    name: z.string(),
    items: z.array(LegacyJobItemSchema),
  })
);
export type LegacyJobSection = z.infer<typeof LegacyJobSectionSchema>;

/** Checklist caps (06 §5): 200 items, 64 KB serialized. */
export const SECTIONS_MAX_ITEMS = 200;
export const SECTIONS_MAX_BYTES = 65_536;

// --- application_events.payload per type (03 §6) ---------------------------

export const CreatedEventPayloadSchema = defineSchema(
  "records",
  "CreatedEventPayload",
  z.looseObject({
    origin: z.string().min(1).max(40),
    stage: StageSchema.optional(),
    legacy_status: LegacyJobStatusSchema.optional(),
  })
);
export const StageChangedEventPayloadSchema = defineSchema(
  "records",
  "StageChangedEventPayload",
  z.looseObject({
    from: StageSchema,
    to: StageSchema,
    reason: z.string().max(200).optional(),
  })
);
export const SubmissionStatusChangedEventPayloadSchema = defineSchema(
  "records",
  "SubmissionStatusChangedEventPayload",
  z.looseObject({
    from: SubmissionStatusSchema,
    to: SubmissionStatusSchema,
    evidence_id: EvidenceIdSchema.optional(),
    via: z.enum(["assisted_user_click", "late_evidence"]).optional(),
  })
);
export const NoteAddedEventPayloadSchema = defineSchema(
  "records",
  "NoteAddedEventPayload",
  z.looseObject({
    text: z.string().min(1).max(10_000),
    /** e.g. `follow_up_done` (06 §7), `legacy_interview_date` (06 §12.2). */
    kind: z.string().max(40).optional(),
  })
);
export const NoteDeletedEventPayloadSchema = defineSchema(
  "records",
  "NoteDeletedEventPayload",
  z.looseObject({ note_event_id: EventIdSchema })
);
export const CvVariantAttachedEventPayloadSchema = defineSchema(
  "records",
  "CvVariantAttachedEventPayload",
  z.looseObject({ cv_variant_id: CvVariantIdSchema, file_id: FileIdSchema })
);
export const AutomationTaskEventPayloadSchema = defineSchema(
  "records",
  "AutomationTaskEventPayload",
  z.looseObject({
    task_id: TaskIdSchema,
    attempt_id: AttemptIdSchema.optional(),
    state: TaskStateSchema,
    step: z.number().int().min(0).optional(),
    stage: ProgressStageSchema.optional(),
    message: z.string().max(300).optional(),
    pause_reason: PauseReasonSchema.optional(),
    error_class: z.string().max(64).optional(),
  })
);
export const ApprovalEventPayloadSchema = defineSchema(
  "records",
  "ApprovalEventPayload",
  z.looseObject({
    approval_id: ApprovalIdSchema,
    kind: ApprovalKindSchema.optional(),
    decision: ApprovalStateSchema.optional(),
  })
);
export const SubmitIntentEventPayloadSchema = defineSchema(
  "records",
  "SubmitIntentEventPayload",
  z.looseObject({
    task_id: TaskIdSchema,
    attempt_id: AttemptIdSchema,
    form_hash: z.string().length(64),
  })
);
export const InterviewEventPayloadSchema = defineSchema(
  "records",
  "InterviewEventPayload",
  z.looseObject({
    interview_id: InterviewIdSchema,
    kind: InterviewKindSchema.optional(),
    round: z.number().int().min(1).optional(),
    scheduled_at: tsOrNull.optional(),
    outcome: InterviewOutcomeSchema.optional(),
  })
);
export const OfferRecordedEventPayloadSchema = defineSchema(
  "records",
  "OfferRecordedEventPayload",
  z.looseObject({ offer_id: OfferIdSchema })
);
export const EmailSentEventPayloadSchema = defineSchema(
  "records",
  "EmailSentEventPayload",
  z.looseObject({
    email_application_id: EmailIdSchema,
    /** Provider message id; null for a local hand-off. */
    message_id: z.string().max(300).nullable(),
  })
);
export const ConflictRecordedEventPayloadSchema = defineSchema(
  "records",
  "ConflictRecordedEventPayload",
  z.looseObject({
    attempted: JsonValueSchema,
    current: JsonValueSchema,
    reason: z.string().max(300),
  })
);
export const LegacyImportedEventPayloadSchema = defineSchema(
  "records",
  "LegacyImportedEventPayload",
  z.looseObject({
    legacy_job_id: z.string().min(1),
    legacy_status: LegacyJobStatusSchema.optional(),
  })
);

/** Payload schema of each event type (03 §6). */
export const EVENT_PAYLOAD_SCHEMAS: Readonly<Record<EventType, z.ZodType>> = {
  created: CreatedEventPayloadSchema,
  stage_changed: StageChangedEventPayloadSchema,
  submission_status_changed: SubmissionStatusChangedEventPayloadSchema,
  note_added: NoteAddedEventPayloadSchema,
  note_deleted: NoteDeletedEventPayloadSchema,
  cv_variant_attached: CvVariantAttachedEventPayloadSchema,
  automation_task_created: AutomationTaskEventPayloadSchema,
  automation_task_claimed: AutomationTaskEventPayloadSchema,
  automation_task_progress: AutomationTaskEventPayloadSchema,
  automation_task_paused: AutomationTaskEventPayloadSchema,
  automation_task_finished: AutomationTaskEventPayloadSchema,
  approval_requested: ApprovalEventPayloadSchema,
  approval_decided: ApprovalEventPayloadSchema,
  submit_intent: SubmitIntentEventPayloadSchema,
  interview_scheduled: InterviewEventPayloadSchema,
  interview_updated: InterviewEventPayloadSchema,
  offer_recorded: OfferRecordedEventPayloadSchema,
  email_sent: EmailSentEventPayloadSchema,
  conflict_recorded: ConflictRecordedEventPayloadSchema,
  legacy_imported: LegacyImportedEventPayloadSchema,
};

export const EventPayloadSchema = defineSchema(
  "records",
  "EventPayload",
  z.union([
    CreatedEventPayloadSchema,
    StageChangedEventPayloadSchema,
    SubmissionStatusChangedEventPayloadSchema,
    NoteAddedEventPayloadSchema,
    NoteDeletedEventPayloadSchema,
    CvVariantAttachedEventPayloadSchema,
    AutomationTaskEventPayloadSchema,
    ApprovalEventPayloadSchema,
    SubmitIntentEventPayloadSchema,
    InterviewEventPayloadSchema,
    OfferRecordedEventPayloadSchema,
    EmailSentEventPayloadSchema,
    ConflictRecordedEventPayloadSchema,
    LegacyImportedEventPayloadSchema,
  ])
);

// --- offers, rules, sources, runs -------------------------------------------

/** `offers.compensation` `{base, currency, period, bonus?, equity?, raw?}` (06 §6.2). */
export const OfferCompensationSchema = defineSchema(
  "records",
  "OfferCompensation",
  z.object({
    base: z.number().min(0).nullable().optional(),
    currency: z.string().length(3).optional(),
    period: SalaryPeriodSchema.optional(),
    bonus: z.union([z.number().min(0), z.string().max(200)]).optional(),
    equity: z.string().max(200).optional(),
    raw: z.string().max(500).optional(),
  })
);
export type OfferCompensation = z.infer<typeof OfferCompensationSchema>;

/**
 * `automation_rules.criteria` (19 §8.3, 07 §10). `auto` rules additionally
 * need `min_score ≥ 70` and at least one of keywords, title_patterns,
 * companies or source_ids (validated by the server, not the schema).
 */
export const RuleCriteriaSchema = defineSchema(
  "records",
  "RuleCriteria",
  RuleScoreCriteriaSchema.extend({
    keywords: z.array(z.string().max(100)).max(50).optional(),
    title_patterns: z.array(z.string().max(200)).max(50).optional(),
    companies: z.array(z.string().max(200)).max(100).optional(),
    exclude_companies: z.array(z.string().max(200)).max(100).optional(),
    source_ids: z.array(SourceIdSchema).max(50).optional(),
    locations: z.array(z.string().max(200)).max(50).optional(),
    workplace_types: z.array(WorkplaceTypeSchema).optional(),
    seniority: z.array(SeniorityLevelSchema).optional(),
  })
);
export type RuleCriteria = z.infer<typeof RuleCriteriaSchema>;

/** Abuse caps (D-35). */
export const RULE_LIMIT_DEFAULTS = {
  max_per_day: 10,
  max_per_day_ceiling: 25,
  max_per_company_per_30d: 2,
  max_per_company_per_30d_ceiling: 3,
  global_submissions_per_day: 40,
  auto_min_score: 70,
  auto_max_validity_days: 30,
} as const;

const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `automation_rules.limits` (04 §2.3, D-35). */
export const RuleLimitsSchema = defineSchema(
  "records",
  "RuleLimits",
  z.object({
    max_per_day: z
      .number()
      .int()
      .min(1)
      .max(RULE_LIMIT_DEFAULTS.max_per_day_ceiling),
    max_per_company_per_30d: z
      .number()
      .int()
      .min(1)
      .max(RULE_LIMIT_DEFAULTS.max_per_company_per_30d_ceiling),
    /** Local time window in the user's timezone. */
    active_hours: z
      .object({
        start: z.string().regex(HH_MM_RE),
        end: z.string().regex(HH_MM_RE),
      })
      .nullable()
      .optional(),
    expires_at: tsOrNull.optional(),
  })
);
export type RuleLimits = z.infer<typeof RuleLimitsSchema>;

/** `automation_rules.cv_policy` (04 §2.3); default `{}`. */
export const CvPolicySchema = defineSchema(
  "records",
  "CvPolicy",
  z.object({
    base_cv_id: z.string().nullable().optional(),
    tailor: z.boolean().optional(),
    require_cv_approval: z.boolean().optional(),
  })
);
export type CvPolicy = z.infer<typeof CvPolicySchema>;

/** `job_sources.cursor_state` (15 §9); default `{}`. */
export const CursorStateSchema = defineSchema(
  "records",
  "CursorState",
  z.looseObject({
    v: z.literal(1).optional(),
    listing: z
      .object({
        etag: z.string().nullable().optional(),
        last_modified: z.string().nullable().optional(),
      })
      .optional(),
    watermark_updated_at: tsOrNull.optional(),
    seen_refs_digest: z.string().nullable().optional(),
    /** Capped at 2,000 entries (LRU). */
    detail_etags: z.record(z.string(), z.string()).optional(),
  })
);
export type CursorState = z.infer<typeof CursorStateSchema>;

/** `discovery_runs.sources[]` (04 §2.4). */
export const RunSourceSchema = defineSchema(
  "records",
  "RunSource",
  z.object({
    source_id: SourceIdSchema.nullable().optional(),
    adapter: AdapterIdSchema,
    label: z.string().max(200),
  })
);

/** `discovery_runs.stats` (04 §2.4, 15 §6); default `{}`. */
export const RunStatsSchema = defineSchema(
  "records",
  "RunStats",
  z.object({
    pages: z.number().int().min(0).optional(),
    postings_found: z.number().int().min(0).optional(),
    new: z.number().int().min(0).optional(),
    updated: z.number().int().min(0).optional(),
    unchanged: z.number().int().min(0).optional(),
    duplicates: z.number().int().min(0).optional(),
    invalid: z.number().int().min(0).optional(),
    errors_by_class: z
      .partialRecord(DiscoveryErrorClassSchema, z.number().int().min(0))
      .optional(),
    selector_drift: z.record(z.string(), z.number().int().min(0)).optional(),
  })
);
export type RunStats = z.infer<typeof RunStatsSchema>;

/** One `discovery_runs.errors[]` entry (capped at 50). */
export const RunErrorSchema = defineSchema(
  "records",
  "RunError",
  z.object({
    source_id: SourceIdSchema.nullable().optional(),
    /** `<adapter>:<org or host>`, e.g. `workday:nvidia` (15 §15). */
    source: z.string().max(200).optional(),
    error_class: DiscoveryErrorClassSchema,
    message: z.string().max(500).optional(),
    http_status: z.number().int().nullable().optional(),
    url: z.string().max(2048).optional(),
    at: TimestampSchema.optional(),
  })
);
export type RunError = z.infer<typeof RunErrorSchema>;
export const RUN_ERRORS_MAX = 50;

// --- tasks, approvals ---------------------------------------------------------

/** `automation_tasks.progress` `{stage, step, message, percent?}` (21 §5.2). */
export const TaskProgressSchema = defineSchema(
  "records",
  "TaskProgress",
  z.object({
    stage: ProgressStageSchema,
    step: z.number().int().min(0),
    message: z.string().max(300),
    percent: z.number().min(0).max(100).optional(),
  })
);
export type TaskProgress = z.infer<typeof TaskProgressSchema>;

/**
 * `automation_tasks.payload` (04 §2.6, 21 §6.2, §6.4). Known keys are typed;
 * unknown keys are preserved.
 */
export const TaskPayloadSchema = defineSchema(
  "records",
  "TaskPayload",
  z.looseObject({
    mode: ApplicationModeSchema.optional(),
    rule_id: RuleIdSchema.nullable().optional(),
    source_ids: z.array(SourceIdSchema).optional(),
    urls: z.array(UrlSchema).optional(),
    check_tracked: z.boolean().optional(),
    dry_run: z.boolean().optional(),
    resume_from_approval: ApprovalIdSchema.optional(),
    retry_hint: z.enum(["needs_headed"]).optional(),
    cancel_reason: z.string().max(60).optional(),
  })
);
export type TaskPayload = z.infer<typeof TaskPayloadSchema>;

/** Value sources shown in a submit approval: the plan's plus "typed by you". */
export const APPROVAL_FIELD_VALUE_SOURCES = [
  "fact",
  "answer",
  "option",
  "cv_file",
  "cover_letter_file",
  "generated_text",
  "user",
] as const satisfies readonly (ValueSource | "user")[];

export const BrowserSubmitApprovalPayloadSchema = defineSchema(
  "records",
  "BrowserSubmitApprovalPayload",
  z.object({
    type: z.literal("browser_submit"),
    form_hash: z.string().length(64),
    url: z.string().max(2048),
    posting_id: PostingIdSchema,
    attempt_id: AttemptIdSchema.optional(),
    device_id: DeviceIdSchema.optional(),
    fields: z
      .array(
        z.object({
          label: z.string().max(300),
          /** Protected values are masked as "(your saved answer)". */
          value_display: z.string().max(4000),
          value_source: z.enum(APPROVAL_FIELD_VALUE_SOURCES),
          sensitivity: SensitivitySchema,
          ai_written: z.boolean(),
        })
      )
      .max(300),
    attachments: z.array(
      z.object({
        file_id: FileIdSchema,
        sha256: Sha256HexSchema,
        name: z.string().max(255),
      })
    ),
    screenshot_file_id: FileIdSchema.nullable().optional(),
    injection_suspected: z.boolean().optional(),
  })
);

/** Email application approval (09 §4). */
export const EmailSubmitApprovalPayloadSchema = defineSchema(
  "records",
  "EmailSubmitApprovalPayload",
  z.object({
    type: z.literal("email_submit"),
    email_application_id: EmailIdSchema,
    to: z.string().max(254),
    cc: z.array(z.string().max(254)),
    subject: z.string().max(300),
    body_text: z.string().max(20_480),
    attachments: z.array(
      z.object({
        file_id: FileIdSchema,
        sha256: Sha256HexSchema,
        name: z.string().max(255),
      })
    ),
    ai_drafted: z.boolean(),
    recipient_confirmed: z.boolean(),
  })
);

/** Screening questions that need the user (19 §6.5). */
export const AnswerApprovalPayloadSchema = defineSchema(
  "records",
  "AnswerApprovalPayload",
  z.object({
    type: z.literal("answer"),
    attempt_id: AttemptIdSchema.optional(),
    questions: z
      .array(
        z.object({
          ref: z.string(),
          /** UNTRUSTED page text, shown quoted. */
          question: z.string().max(300),
          field_kind: z.string().max(40).optional(),
          required: z.boolean(),
          options: z.array(
            z.object({
              value: z.string().max(200),
              label: z.string().max(200),
            })
          ),
          question_key: z.string().max(120).nullable(),
          sensitivity: SensitivitySchema,
          suggestion: z
            .object({
              value: z.string().max(4000),
              value_source: z.enum(["fact", "answer", "option"]),
              fact_key: z.string().nullable().optional(),
              answer_id: AnswerIdSchema.nullable().optional(),
            })
            .nullable(),
        })
      )
      .min(1)
      .max(50),
  })
);

export const CvVariantApprovalPayloadSchema = defineSchema(
  "records",
  "CvVariantApprovalPayload",
  z.object({
    type: z.literal("cv_variant"),
    cv_variant_id: CvVariantIdSchema,
    file_id: FileIdSchema,
    sha256: Sha256HexSchema,
    template: CvTemplateSchema,
    rephrased_bullets: z.number().int().min(0),
    notes_for_user: z.array(z.string().max(200)),
  })
);

export const RuleActivationApprovalPayloadSchema = defineSchema(
  "records",
  "RuleActivationApprovalPayload",
  z.object({
    type: z.literal("rule_activation"),
    rule_id: RuleIdSchema,
    name: z.string().max(120),
    mode: RuleModeSchema,
    /** Plain-language summary shown in the dialog (12 §6.2). */
    summary: z.string().max(1000),
    criteria: RuleCriteriaSchema,
    limits: RuleLimitsSchema,
    allowed_domains: z.array(DomainSchema),
  })
);

/**
 * `approvals.payload` (03 §8). `type` is the contract-level discriminator;
 * it must agree with `approvals.kind` (`submit` ⇒ browser_submit or
 * email_submit).
 */
export const ApprovalPayloadSchema = defineSchema(
  "records",
  "ApprovalPayload",
  z.discriminatedUnion("type", [
    BrowserSubmitApprovalPayloadSchema,
    EmailSubmitApprovalPayloadSchema,
    AnswerApprovalPayloadSchema,
    CvVariantApprovalPayloadSchema,
    RuleActivationApprovalPayloadSchema,
  ])
);
export type ApprovalPayload = z.infer<typeof ApprovalPayloadSchema>;

/** Which payload types each approval kind accepts. */
export const APPROVAL_PAYLOAD_TYPES = {
  submit: ["browser_submit", "email_submit"],
  answer: ["answer"],
  cv_variant: ["cv_variant"],
  rule_activation: ["rule_activation"],
} as const;

/** `approvals.response` (e.g. the answers the user typed). */
export const ApprovalResponseSchema = defineSchema(
  "records",
  "ApprovalResponse",
  z.looseObject({
    answers: z
      .array(
        z.object({
          ref: z.string(),
          value: z.string().max(4000),
          save_to_bank: z.boolean().optional(),
          sensitivity: SensitivitySchema.optional(),
          auto_use: AutoUseSchema.optional(),
        })
      )
      .optional(),
    note: z.string().max(500).optional(),
  })
);

/** `telemetry_daily.counters` (22 §8.1). */
export const TelemetryCountersSchema = defineSchema(
  "records",
  "TelemetryCounters",
  z.looseObject({
    commands: z.record(z.string(), z.number().int().min(0)),
    error_classes: z.record(z.string(), z.number().int().min(0)),
    exit_codes: z.record(z.string(), z.number().int().min(0)).optional(),
    duration_buckets: z.record(z.string(), z.number().int().min(0)).optional(),
    agent_steps: z.number().int().min(0).optional(),
    outcomes: z.record(z.string(), z.number().int().min(0)).optional(),
  })
);

const count = z.number().int().min(0);

/** `analytics_daily.metrics` counters (10 §4). */
export const AnalyticsDailyMetricsSchema = defineSchema(
  "records",
  "AnalyticsDailyMetrics",
  z.looseObject({
    tracked: count.optional(),
    applied: count.optional(),
    applied_unverified: count.optional(),
    interviews_scheduled: count.optional(),
    offers: count.optional(),
    /** Rejections keyed by the stage they came from. */
    rejected: z.record(z.string(), count).optional(),
    withdrawn: count.optional(),
    discovered: count.optional(),
    scored: count.optional(),
    tasks: z
      .object({
        submitted: count.optional(),
        failed: count.optional(),
        paused: count.optional(),
        outcome_unknown: count.optional(),
      })
      .optional(),
    ai_cost_micro_usd: count.optional(),
  })
);

// ===========================================================================
// DB (pilihpendidikan) — 04 §1 and 0001_initial.sql
// ===========================================================================

export const UserRecordSchema = defineSchema(
  "records",
  "UserRecord",
  z.object({
    id: UserIdSchema,
    /** Normalized login key (trim + lowercase, 03 §2). */
    email: z.string().min(3).max(254),
    created_at: ts,
    updated_at: ts,
    deleted_at: tsOrNull,
  })
);
export type UserRecord = z.infer<typeof UserRecordSchema>;

/** `mcp_tokens` after migration 0002 (0001 columns + 04 §1 ALTERs). */
export const McpTokenRecordSchema = defineSchema(
  "records",
  "McpTokenRecord",
  z.object({
    id: text,
    user_email: text,
    token_hash: Sha256HexSchema,
    label: textOrNull,
    status: TokenStatusSchema,
    kind: TokenKindSchema,
    scope: LegacyTokenScopeSchema,
    created_at: ts,
    revoked_at: tsOrNull,
    last_used_at: tsOrNull,
    expires_at: tsOrNull,
    user_id: UserIdSchema.nullable(),
    /** Space-delimited OAuth scopes; null = legacy write/read mapping. */
    scopes: textOrNull,
    grant_id: GrantIdSchema.nullable(),
    device_id: DeviceIdSchema.nullable(),
  })
);
export type McpTokenRecord = z.infer<typeof McpTokenRecordSchema>;

/** `oauth_clients` after migration 0002. */
export const OAuthClientRecordSchema = defineSchema(
  "records",
  "OAuthClientRecord",
  z.object({
    client_id: text,
    /** Empty for public clients. */
    client_secret_hash: text,
    client_name: textOrNull,
    redirect_uris: z.array(z.string()),
    token_endpoint_auth_method: TokenEndpointAuthMethodSchema,
    created_at: ts,
    first_party: z.boolean(),
    /** Space-delimited ceiling (`mcp` for DCR clients). */
    allowed_scopes: textOrNull,
    loopback_any_port: z.boolean(),
  })
);
export type OAuthClientRecord = z.infer<typeof OAuthClientRecordSchema>;

export const OAuthGrantRecordSchema = defineSchema(
  "records",
  "OAuthGrantRecord",
  z.object({
    id: GrantIdSchema,
    user_id: UserIdSchema,
    client_id: text,
    device_id: DeviceIdSchema.nullable(),
    /** Space-delimited granted scopes. */
    scopes: text,
    created_at: ts,
    last_used_at: tsOrNull,
    revoked_at: tsOrNull,
    revoked_reason: GrantRevokedReasonSchema.nullable(),
  })
);
export type OAuthGrantRecord = z.infer<typeof OAuthGrantRecordSchema>;

export const OAuthRefreshTokenRecordSchema = defineSchema(
  "records",
  "OAuthRefreshTokenRecord",
  z.object({
    id: RefreshTokenIdSchema,
    grant_id: GrantIdSchema,
    token_hash: Sha256HexSchema,
    parent_id: RefreshTokenIdSchema.nullable(),
    created_at: ts,
    expires_at: ts,
    used_at: tsOrNull,
    revoked_at: tsOrNull,
  })
);
export type OAuthRefreshTokenRecord = z.infer<
  typeof OAuthRefreshTokenRecordSchema
>;

const deviceObject = z.object({
  id: DeviceIdSchema,
  user_id: UserIdSchema,
  grant_id: GrantIdSchema,
  name: z.string().min(1).max(60),
  platform: DevicePlatformSchema,
  arch: z.string().min(1).max(20),
  cli_version: text,
  /** Ed25519 SPKI base64url; reserved for DPoP (17 §11). */
  public_key: textOrNull,
  capabilities: z.array(DeviceCapabilitySchema),
  accepts_tasks: z.boolean(),
  created_at: ts,
  last_seen_at: tsOrNull,
  /** First 16 hex of SHA-256(ip). */
  last_ip_hash: textOrNull,
  revoked_at: tsOrNull,
  revision: RevisionSchema,
});
export const DeviceRecordSchema = defineSchema(
  "records",
  "DeviceRecord",
  deviceObject
);
export type DeviceRecord = z.infer<typeof DeviceRecordSchema>;

export const FeatureFlagRecordSchema = defineSchema(
  "records",
  "FeatureFlagRecord",
  z.object({
    key: FeatureFlagKeySchema,
    /** JSON scalar. */
    value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
    updated_at: ts,
    updated_by: text,
  })
);
export type FeatureFlagRecord = z.infer<typeof FeatureFlagRecordSchema>;

export const SupportAccessLogRecordSchema = defineSchema(
  "records",
  "SupportAccessLogRecord",
  z.object({
    id: SupportAccessIdSchema,
    operator_email: text,
    subject_user_id: UserIdSchema,
    reason: z.string().min(1),
    ticket_ref: textOrNull,
    /** e.g. "read:applications". */
    scope: text,
    created_at: ts,
  })
);
export type SupportAccessLogRecord = z.infer<
  typeof SupportAccessLogRecordSchema
>;

/** Existing `request_log` (0001_initial.sql); MCP tool calls. */
export const RequestLogRecordSchema = defineSchema(
  "records",
  "RequestLogRecord",
  z.object({
    id: z.number().int().min(1),
    ts,
    caller_email: text,
    caller_email_hash: textOrNull,
    tool: text,
    category: RequestLogCategorySchema,
    resource_id: textOrNull,
    status: RequestLogStatusSchema,
    duration_ms: z.number().int().min(0).nullable(),
    params: textOrNull,
    retention_until: ts,
  })
);
export type RequestLogRecord = z.infer<typeof RequestLogRecordSchema>;

// ===========================================================================
// JOBS_DB (pilihpendidikan-jobs) — 04 §2
// ===========================================================================

/** Description cap (04 header, 15 §10.1). */
export const DESCRIPTION_MAX_BYTES = 65_536;

const jobPostingObject = z.object({
  id: PostingIdSchema,
  fingerprint: FingerprintSchema,
  visibility: PostingVisibilitySchema,
  /** Not null iff private. */
  owner_user_id: UserIdSchema.nullable(),
  source_kind: SourceKindSchema,
  source_org: textOrNull,
  source_job_ref: textOrNull,
  canonical_url: textOrNull,
  apply_url: textOrNull,
  /** Registrable domain of apply_url (agent allowlist seed). */
  apply_domain: DomainSchema.nullable(),
  company_name: z.string().min(1),
  company_domain: DomainSchema.nullable(),
  title: z.string().min(1),
  department: textOrNull,
  locations: z.array(PostingLocationSchema),
  workplace_type: WorkplaceTypeSchema.nullable(),
  employment_type: EmploymentTypeSchema.nullable(),
  seniority: textOrNull,
  salary: SalarySchema.nullable(),
  description_text: z.string(),
  description_truncated: z.boolean(),
  requirements: z.array(z.string()),
  content_hash: Sha256HexSchema,
  /** sha256(company_domain|norm title|primary location) (15 §11). */
  dedupe_group: Sha256HexSchema.nullable(),
  posted_at: tsOrNull,
  first_seen_at: ts,
  last_seen_at: ts,
  last_checked_at: tsOrNull,
  status: PostingStatusSchema,
  closed_at: tsOrNull,
  missed_runs: z.number().int().min(0),
  extraction: z.union([ExtractionProvenanceSchema, EmptyObjectSchema]),
  application_support: ApplicationSupportSchema,
  revision: RevisionSchema,
  created_at: ts,
  updated_at: ts,
});
/** The posting columns, without the cross-column CHECK (for derived views). */
export const JOB_POSTING_SHAPE = jobPostingObject.shape;

export const JobPostingRecordSchema = defineSchema(
  "records",
  "JobPostingRecord",
  jobPostingObject.superRefine((row, ctx) => {
    if ((row.visibility === "private") !== (row.owner_user_id !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["owner_user_id"],
        message: "owner_user_id must be set iff visibility = 'private'",
      });
    }
  })
);
export type JobPostingRecord = z.infer<typeof JobPostingRecordSchema>;

export const UserJobRecordSchema = defineSchema(
  "records",
  "UserJobRecord",
  z.object({
    id: UserJobIdSchema,
    user_id: UserIdSchema,
    posting_id: PostingIdSchema,
    origin: UserJobOriginSchema,
    inbox_state: InboxStateSchema,
    first_run_id: RunIdSchema.nullable(),
    source_id: SourceIdSchema.nullable(),
    user_notes: z.string().max(10_000),
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
  })
);
export type UserJobRecord = z.infer<typeof UserJobRecordSchema>;

export const ApplicationRecordSchema = defineSchema(
  "records",
  "ApplicationRecord",
  z.object({
    id: ApplicationIdSchema,
    user_id: UserIdSchema,
    user_job_id: UserJobIdSchema,
    legacy_job_id: textOrNull,
    stage: StageSchema,
    stage_changed_at: ts,
    submission_status: SubmissionStatusSchema,
    submitted_at: tsOrNull,
    submission_method: SubmissionMethodSchema.nullable(),
    mode: ApplicationModeSchema,
    automation_rule_id: RuleIdSchema.nullable(),
    cv_variant_id: CvVariantIdSchema.nullable(),
    /** apps/cv slug used as base. */
    base_cv_id: textOrNull,
    /** 0 normal, 1 high, -1 low. */
    priority: z.number().int().min(-1).max(1),
    /** Fractional index, alphabet 0-9a-z (06 §1.2). */
    board_rank: z.string().min(1).max(64),
    archived: z.boolean(),
    follow_up_at: tsOrNull,
    sections: z.array(LegacyJobSectionSchema),
    last_change_source: ChangeSourceSchema,
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
  })
);
export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;

export const ApplicationEventRecordSchema = defineSchema(
  "records",
  "ApplicationEventRecord",
  z
    .object({
      id: EventIdSchema,
      user_id: UserIdSchema,
      application_id: ApplicationIdSchema,
      type: EventTypeSchema,
      from_value: textOrNull,
      to_value: textOrNull,
      payload: EventPayloadSchema,
      actor_kind: ActorKindSchema,
      actor_device_id: DeviceIdSchema.nullable(),
      task_id: TaskIdSchema.nullable(),
      attempt_id: AttemptIdSchema.nullable(),
      /** false = recorded but rejected as stale/conflicting. */
      applied_to_state: z.boolean(),
      /** Client clock (informational). */
      occurred_at: ts,
      /** Server clock (authoritative order). */
      recorded_at: ts,
      idempotency_key: z.string().min(1).max(128),
    })
    .superRefine((row, ctx) => {
      const parsed = EVENT_PAYLOAD_SCHEMAS[row.type].safeParse(row.payload);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["payload"],
          message: `payload does not match event type ${row.type}`,
        });
      }
    })
);
export type ApplicationEventRecord = z.infer<
  typeof ApplicationEventRecordSchema
>;

export const InterviewRecordSchema = defineSchema(
  "records",
  "InterviewRecord",
  z.object({
    id: InterviewIdSchema,
    user_id: UserIdSchema,
    application_id: ApplicationIdSchema,
    round: z.number().int().min(1),
    kind: InterviewKindSchema,
    scheduled_at: tsOrNull,
    duration_min: z.number().int().min(1).max(1440).nullable(),
    /** IANA zone for display. */
    timezone: textOrNull,
    /** Address or meeting URL. */
    location: textOrNull,
    interviewers: z.array(z.string().max(200)),
    outcome: InterviewOutcomeSchema,
    notes: z.string(),
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
  })
);
export type InterviewRecord = z.infer<typeof InterviewRecordSchema>;

export const OfferRecordSchema = defineSchema(
  "records",
  "OfferRecord",
  z.object({
    id: OfferIdSchema,
    user_id: UserIdSchema,
    application_id: ApplicationIdSchema,
    received_at: ts,
    compensation: OfferCompensationSchema,
    deadline_at: tsOrNull,
    status: OfferStatusSchema,
    notes: z.string(),
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
  })
);
export type OfferRecord = z.infer<typeof OfferRecordSchema>;

export const ApplicantFactRecordSchema = defineSchema(
  "records",
  "ApplicantFactRecord",
  z.object({
    id: FactIdSchema,
    user_id: UserIdSchema,
    /** Canonical key (facts.ts), e.g. contact.phone, work_auth.ID. */
    key: z.string().min(1).max(120),
    /** JSON scalar or object. */
    value: JsonValueSchema,
    source: FactSourceSchema,
    cv_id: textOrNull,
    cv_entry_id: textOrNull,
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
  })
);
export type ApplicantFactRecord = z.infer<typeof ApplicantFactRecordSchema>;

const screeningAnswerObject = z.object({
  id: AnswerIdSchema,
  user_id: UserIdSchema,
  question_key: z.string().min(1).max(120),
  /** Normalized phrasings. */
  match_patterns: z.array(z.string().max(300)).max(50),
  answer: z.string().max(4000),
  answer_kind: AnswerKindSchema,
  sensitivity: SensitivitySchema,
  auto_use: AutoUseSchema,
  revision: RevisionSchema,
  created_at: ts,
  updated_at: ts,
});
export const SCREENING_ANSWER_SHAPE = screeningAnswerObject.shape;

export const ScreeningAnswerRecordSchema = defineSchema(
  "records",
  "ScreeningAnswerRecord",
  screeningAnswerObject.superRefine((row, ctx) => {
    if (row.sensitivity === "protected" && row.auto_use === "always") {
      ctx.addIssue({
        code: "custom",
        path: ["auto_use"],
        message: "protected answers can never be auto_use = always",
      });
    }
  })
);
export type ScreeningAnswerRecord = z.infer<typeof ScreeningAnswerRecordSchema>;

export const MatchScoreRecordSchema = defineSchema(
  "records",
  "MatchScoreRecord",
  z.object({
    id: ScoreIdSchema,
    user_id: UserIdSchema,
    posting_id: PostingIdSchema,
    profile_version: z.number().int().min(0),
    rubric_version: z.string().min(1),
    /** e.g. "gpt-6-luna" or "deterministic-only". */
    model: z.string().min(1),
    score: z.number().int().min(0).max(100),
    confidence: z.number().min(0).max(1).nullable(),
    /** `{}` while `status = 'queued'` (07 §7.1). */
    components: z.union([ScoreComponentsSchema, EmptyObjectSchema]),
    explanation: z.string(),
    status: MatchScoreStatusSchema,
    created_at: ts,
  })
);
export type MatchScoreRecord = z.infer<typeof MatchScoreRecordSchema>;

export const AutomationRuleRecordSchema = defineSchema(
  "records",
  "AutomationRuleRecord",
  z.object({
    id: RuleIdSchema,
    user_id: UserIdSchema,
    name: z.string().min(1).max(120),
    enabled: z.boolean(),
    mode: RuleModeSchema,
    criteria: RuleCriteriaSchema,
    limits: RuleLimitsSchema,
    /** Registrable domains (auto mode requires non-empty). */
    allowed_domains: z.array(DomainSchema),
    cv_policy: CvPolicySchema,
    activated_approval_id: ApprovalIdSchema.nullable(),
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
  })
);
export type AutomationRuleRecord = z.infer<typeof AutomationRuleRecordSchema>;

export const JobSourceRecordSchema = defineSchema(
  "records",
  "JobSourceRecord",
  z.object({
    id: SourceIdSchema,
    user_id: UserIdSchema,
    adapter: AdapterIdSchema,
    label: z.string().min(1).max(200),
    /** Validated by the adapter's config schema (adapters.ts). */
    config: JsonObjectSchema,
    enabled: z.boolean(),
    /** Cron-like hint for the CLI scheduler, e.g. "daily@08:00". */
    schedule: textOrNull,
    last_run_id: RunIdSchema.nullable(),
    last_success_at: tsOrNull,
    cursor_state: CursorStateSchema,
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
  })
);
export type JobSourceRecord = z.infer<typeof JobSourceRecordSchema>;

export const DiscoveryRunRecordSchema = defineSchema(
  "records",
  "DiscoveryRunRecord",
  z.object({
    id: RunIdSchema,
    user_id: UserIdSchema,
    device_id: DeviceIdSchema,
    task_id: TaskIdSchema.nullable(),
    sources: z.array(RunSourceSchema),
    status: DiscoveryRunStatusSchema,
    started_at: ts,
    finished_at: tsOrNull,
    stats: RunStatsSchema,
    errors: z.array(RunErrorSchema).max(RUN_ERRORS_MAX),
    /** pilih-jobs + scrapling versions. */
    engine_version: z.string().min(1).max(200),
    revision: RevisionSchema,
  })
);
export type DiscoveryRunRecord = z.infer<typeof DiscoveryRunRecordSchema>;

export const DiscoveryRunItemRecordSchema = defineSchema(
  "records",
  "DiscoveryRunItemRecord",
  z.object({
    run_id: RunIdSchema,
    posting_id: PostingIdSchema,
    user_id: UserIdSchema,
    outcome: RunItemOutcomeSchema,
  })
);
export type DiscoveryRunItemRecord = z.infer<
  typeof DiscoveryRunItemRecordSchema
>;

const fileObject = z.object({
  id: FileIdSchema,
  user_id: UserIdSchema,
  kind: FileKindSchema,
  /** u/{user_id}/{kind}/{fil_id}{ext} */
  r2_key: z.string().min(1),
  content_type: z.string().min(1).max(200),
  size_bytes: z.number().int().min(0),
  sha256: Sha256HexSchema,
  original_name: textOrNull,
  status: FileStatusSchema,
  /** null = keep while referenced. */
  retention_until: tsOrNull,
  created_at: ts,
});
export const FileRecordSchema = defineSchema(
  "records",
  "FileRecord",
  fileObject
);
export type FileRecord = z.infer<typeof FileRecordSchema>;

export const CvVariantRecordSchema = defineSchema(
  "records",
  "CvVariantRecord",
  z.object({
    id: CvVariantIdSchema,
    user_id: UserIdSchema,
    /** null = general-purpose variant. */
    application_id: ApplicationIdSchema.nullable(),
    /** apps/cv slug (CV_KV cv:{id}). */
    base_cv_id: z.string().min(1),
    /** apps/cv slug of the generated variant document. */
    tailored_cv_id: textOrNull,
    template: CvTemplateSchema,
    status: CvVariantStatusSchema,
    /** Rendered PDF, required for 'approved'. */
    file_id: FileIdSchema.nullable(),
    diff: z.union([CvVariantDiffSchema, EmptyObjectSchema]),
    model: textOrNull,
    approved_at: tsOrNull,
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
  })
);
export type CvVariantRecord = z.infer<typeof CvVariantRecordSchema>;

export const EmailApplicationRecordSchema = defineSchema(
  "records",
  "EmailApplicationRecord",
  z.object({
    id: EmailIdSchema,
    user_id: UserIdSchema,
    application_id: ApplicationIdSchema,
    to_address: z.string().min(3).max(254),
    subject: z.string().min(1).max(300),
    /** Plain text, ≤ 20 KB (09 §8). */
    body_text: z.string().max(20_480),
    attachment_file_ids: z.array(FileIdSchema).max(5),
    delivery: EmailDeliverySchema,
    status: EmailStatusSchema,
    provider_message_id: textOrNull,
    approved_at: tsOrNull,
    sent_at: tsOrNull,
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
  })
);
export type EmailApplicationRecord = z.infer<
  typeof EmailApplicationRecordSchema
>;

export const AutomationTaskRecordSchema = defineSchema(
  "records",
  "AutomationTaskRecord",
  z.object({
    id: TaskIdSchema,
    user_id: UserIdSchema,
    kind: TaskKindSchema,
    /** Required for apply. */
    application_id: ApplicationIdSchema.nullable(),
    /** Required for render_cv. */
    cv_variant_id: CvVariantIdSchema.nullable(),
    payload: TaskPayloadSchema,
    state: TaskStateSchema,
    /** null = any eligible device of this user. */
    target_device_id: DeviceIdSchema.nullable(),
    required_capabilities: z.array(DeviceCapabilitySchema),
    priority: z.number().int(),
    not_before: ts,
    /** Queued tasks expire (default +72 h). */
    expires_at: ts,
    /** Current fencing token. */
    lease_id: LeaseIdSchema.nullable(),
    lease_device_id: DeviceIdSchema.nullable(),
    lease_expires_at: tsOrNull,
    attempt_count: z.number().int().min(0),
    max_attempts: z.number().int().min(1),
    /** Set by the synchronous submit-intent call (D-19, D-28). */
    submit_intent_at: tsOrNull,
    pause_reason: PauseReasonSchema.nullable(),
    resume_requested: z.boolean(),
    retry_of: TaskIdSchema.nullable(),
    cancel_requested: z.boolean(),
    progress: z.union([TaskProgressSchema, EmptyObjectSchema]),
    /** Last reported CLI-local state (e.g. sync_pending). */
    local_state: LocalTaskStateSchema.nullable(),
    error_class: z.string().max(64).nullable(),
    error_message: z.string().max(2000).nullable(),
    created_by: TaskCreatedBySchema,
    idempotency_key: z.string().min(1).max(128),
    revision: RevisionSchema,
    created_at: ts,
    updated_at: ts,
    finished_at: tsOrNull,
  })
);
export type AutomationTaskRecord = z.infer<typeof AutomationTaskRecordSchema>;

export const AutomationAttemptRecordSchema = defineSchema(
  "records",
  "AutomationAttemptRecord",
  z.object({
    id: AttemptIdSchema,
    task_id: TaskIdSchema,
    user_id: UserIdSchema,
    device_id: DeviceIdSchema,
    lease_id: LeaseIdSchema,
    attempt_no: z.number().int().min(1),
    started_at: ts,
    last_heartbeat_at: ts,
    ended_at: tsOrNull,
    outcome: AttemptOutcomeSchema.nullable(),
    error_class: z.string().max(64).nullable(),
    steps_count: z.number().int().min(0),
    ai_calls: z.number().int().min(0),
    /** files.id of the redacted JSONL step log (run_log). */
    log_file_id: FileIdSchema.nullable(),
    cli_version: z.string().min(1),
  })
);
export type AutomationAttemptRecord = z.infer<
  typeof AutomationAttemptRecordSchema
>;

export const ApprovalRecordSchema = defineSchema(
  "records",
  "ApprovalRecord",
  z
    .object({
      id: ApprovalIdSchema,
      user_id: UserIdSchema,
      kind: ApprovalKindSchema,
      task_id: TaskIdSchema.nullable(),
      application_id: ApplicationIdSchema.nullable(),
      /** Summary shown to the user (03 §8). */
      payload: ApprovalPayloadSchema,
      /** Binds the decision to exactly this content. */
      payload_hash: Sha256HexSchema,
      state: ApprovalStateSchema,
      response: ApprovalResponseSchema.nullable(),
      decided_via: ApprovalDecidedViaSchema.nullable(),
      decided_by_user_id: UserIdSchema.nullable(),
      decided_at: tsOrNull,
      expires_at: ts,
      created_at: ts,
      revision: RevisionSchema,
    })
    .superRefine((row, ctx) => {
      const allowed: readonly string[] = APPROVAL_PAYLOAD_TYPES[row.kind];
      if (!allowed.includes(row.payload.type)) {
        ctx.addIssue({
          code: "custom",
          path: ["payload", "type"],
          message: `payload type ${row.payload.type} does not match kind ${row.kind}`,
        });
      }
    })
);
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const SubmissionEvidenceRecordSchema = defineSchema(
  "records",
  "SubmissionEvidenceRecord",
  z.object({
    id: EvidenceIdSchema,
    user_id: UserIdSchema,
    application_id: ApplicationIdSchema,
    task_id: TaskIdSchema.nullable(),
    attempt_id: AttemptIdSchema.nullable(),
    kind: EvidenceKindSchema,
    verdict: EvidenceVerdictSchema,
    /** 19 §9: url_match, text_match, ai_probability, http_status… */
    signals: EvidenceSignalsSchema,
    final_url: textOrNull,
    page_title: textOrNull,
    /** ≤ 2 KB, redacted. */
    text_excerpt: z.string().max(2048).nullable(),
    screenshot_file_id: FileIdSchema.nullable(),
    /** Matches submit_intent / approval payload_hash. */
    form_hash: textOrNull,
    captured_at: ts,
    recorded_at: ts,
  })
);
export type SubmissionEvidenceRecord = z.infer<
  typeof SubmissionEvidenceRecordSchema
>;

export const ChangeLogRecordSchema = defineSchema(
  "records",
  "ChangeLogRecord",
  z.object({
    seq: z.number().int().min(1),
    user_id: UserIdSchema,
    entity: ChangeEntitySchema,
    entity_id: z.string().min(1),
    revision: z.number().int().min(0),
    op: ChangeOpSchema,
    changed_at: ts,
  })
);
export type ChangeLogRecord = z.infer<typeof ChangeLogRecordSchema>;

export const IdempotencyKeyRecordSchema = defineSchema(
  "records",
  "IdempotencyKeyRecord",
  z.object({
    user_id: UserIdSchema,
    key: z.string().min(1).max(128),
    /** SHA-256 of method+path+body. */
    request_hash: Sha256HexSchema,
    status_code: z.number().int().min(100).max(599),
    /** Stored response body (≤ 64 KB; larger responses store a pointer). */
    response_body: z.string(),
    created_at: ts,
    /** +7 days. */
    expires_at: ts,
  })
);
export type IdempotencyKeyRecord = z.infer<typeof IdempotencyKeyRecordSchema>;

/** Evidence retention bounds in days (14 §5.4). */
export const EVIDENCE_RETENTION_DAYS = { min: 30, default: 180, max: 730 };

export const UserSettingsRecordSchema = defineSchema(
  "records",
  "UserSettingsRecord",
  z.object({
    user_id: UserIdSchema,
    locale: LocaleSchema,
    timezone: z.string().min(1).max(64),
    default_mode: ApplicationModeSchema,
    /** User kill switch: no claims, running tasks pause. */
    automation_paused: z.boolean(),
    /** AI-drafted free text (cover-letter fields), always approval-gated. */
    generated_text_allowed: z.boolean(),
    /** MCP may decide answer/cv_variant approvals (never submit). */
    allow_mcp_approvals: z.boolean(),
    /** null = AI features off for this user. */
    ai_consent_at: tsOrNull,
    ai_scoring_sensitive: z.boolean(),
    evidence_screenshots: EvidenceScreenshotModeSchema,
    evidence_retention_days: z
      .number()
      .int()
      .min(EVIDENCE_RETENTION_DAYS.min)
      .max(EVIDENCE_RETENTION_DAYS.max),
    revision: RevisionSchema,
    updated_at: ts,
  })
);
export type UserSettingsRecord = z.infer<typeof UserSettingsRecordSchema>;

/** Defaults of a lazily created `user_settings` row (04 §2.7). */
export const USER_SETTINGS_DEFAULTS = {
  locale: "en",
  timezone: "Asia/Jakarta",
  default_mode: "approval",
  automation_paused: false,
  generated_text_allowed: false,
  allow_mcp_approvals: false,
  ai_consent_at: null,
  ai_scoring_sensitive: true,
  evidence_screenshots: "on_submit",
  evidence_retention_days: 180,
} as const satisfies Partial<UserSettingsRecord>;

export const AiUsageRecordSchema = defineSchema(
  "records",
  "AiUsageRecord",
  z.object({
    user_id: UserIdSchema,
    /** YYYY-MM (UTC). */
    month: MonthSchema,
    purpose: AiUsagePurposeSchema,
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0),
    cost_micro_usd: z.number().int().min(0),
    calls: z.number().int().min(0),
  })
);
export type AiUsageRecord = z.infer<typeof AiUsageRecordSchema>;

export const TelemetryDailyRecordSchema = defineSchema(
  "records",
  "TelemetryDailyRecord",
  z.object({
    day: DaySchema,
    /** Random per-install id, not linked to devices.id. */
    install_hash: z.string().min(8).max(64),
    cli_version: z.string().min(1).max(40),
    platform: z.string().min(1).max(40),
    counters: TelemetryCountersSchema,
  })
);
export type TelemetryDailyRecord = z.infer<typeof TelemetryDailyRecordSchema>;

export const AnalyticsDailyRecordSchema = defineSchema(
  "records",
  "AnalyticsDailyRecord",
  z.object({
    user_id: UserIdSchema,
    /** YYYY-MM-DD in the user's timezone. */
    day: DaySchema,
    metrics: AnalyticsDailyMetricsSchema,
  })
);
export type AnalyticsDailyRecord = z.infer<typeof AnalyticsDailyRecordSchema>;

// ===========================================================================
// Table map
// ===========================================================================

/** Row schema of every table, keyed by the exact SQL table name. */
export const TABLE_RECORDS = {
  // DB (pilihpendidikan)
  users: UserRecordSchema,
  mcp_tokens: McpTokenRecordSchema,
  oauth_clients: OAuthClientRecordSchema,
  oauth_grants: OAuthGrantRecordSchema,
  oauth_refresh_tokens: OAuthRefreshTokenRecordSchema,
  devices: DeviceRecordSchema,
  feature_flags: FeatureFlagRecordSchema,
  support_access_log: SupportAccessLogRecordSchema,
  request_log: RequestLogRecordSchema,
  // JOBS_DB (pilihpendidikan-jobs)
  job_postings: JobPostingRecordSchema,
  user_jobs: UserJobRecordSchema,
  applications: ApplicationRecordSchema,
  application_events: ApplicationEventRecordSchema,
  interviews: InterviewRecordSchema,
  offers: OfferRecordSchema,
  applicant_facts: ApplicantFactRecordSchema,
  screening_answers: ScreeningAnswerRecordSchema,
  match_scores: MatchScoreRecordSchema,
  automation_rules: AutomationRuleRecordSchema,
  job_sources: JobSourceRecordSchema,
  discovery_runs: DiscoveryRunRecordSchema,
  discovery_run_items: DiscoveryRunItemRecordSchema,
  files: FileRecordSchema,
  cv_variants: CvVariantRecordSchema,
  email_applications: EmailApplicationRecordSchema,
  automation_tasks: AutomationTaskRecordSchema,
  automation_attempts: AutomationAttemptRecordSchema,
  approvals: ApprovalRecordSchema,
  submission_evidence: SubmissionEvidenceRecordSchema,
  change_log: ChangeLogRecordSchema,
  idempotency_keys: IdempotencyKeyRecordSchema,
  user_settings: UserSettingsRecordSchema,
  ai_usage: AiUsageRecordSchema,
  telemetry_daily: TelemetryDailyRecordSchema,
  analytics_daily: AnalyticsDailyRecordSchema,
} as const;
export type TableName = keyof typeof TABLE_RECORDS;

/** Which database each table lives in (04 §1, §2). */
export const TABLE_DATABASE: Readonly<Record<TableName, "DB" | "JOBS_DB">> = {
  users: "DB",
  mcp_tokens: "DB",
  oauth_clients: "DB",
  oauth_grants: "DB",
  oauth_refresh_tokens: "DB",
  devices: "DB",
  feature_flags: "DB",
  support_access_log: "DB",
  request_log: "DB",
  job_postings: "JOBS_DB",
  user_jobs: "JOBS_DB",
  applications: "JOBS_DB",
  application_events: "JOBS_DB",
  interviews: "JOBS_DB",
  offers: "JOBS_DB",
  applicant_facts: "JOBS_DB",
  screening_answers: "JOBS_DB",
  match_scores: "JOBS_DB",
  automation_rules: "JOBS_DB",
  job_sources: "JOBS_DB",
  discovery_runs: "JOBS_DB",
  discovery_run_items: "JOBS_DB",
  files: "JOBS_DB",
  cv_variants: "JOBS_DB",
  email_applications: "JOBS_DB",
  automation_tasks: "JOBS_DB",
  automation_attempts: "JOBS_DB",
  approvals: "JOBS_DB",
  submission_evidence: "JOBS_DB",
  change_log: "JOBS_DB",
  idempotency_keys: "JOBS_DB",
  user_settings: "JOBS_DB",
  ai_usage: "JOBS_DB",
  telemetry_daily: "JOBS_DB",
  analytics_daily: "JOBS_DB",
};

/** The raw device and file shapes, for API views that omit columns. */
export const DEVICE_SHAPE = deviceObject.shape;
export const FILE_SHAPE = fileObject.shape;
