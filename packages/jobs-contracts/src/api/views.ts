// API views shared by several 05 sections: representations derived from the
// row schemas (columns that never leave the server removed, computed fields
// added) and the denormalized board card (06 §1.3).
import { z } from "zod";
import { SemverSchema, TimestampSchema } from "../common";
import {
  ApplicationModeSchema,
  BrowserModeSchema,
  BrowserStatusSchema,
  GrantRevokedReasonSchema,
  MatchScoreStatusSchema,
  OfferStatusSchema,
  PauseReasonSchema,
  PostingStatusSchema,
  ProgressStageSchema,
  SourceKindSchema,
  StageSchema,
  SubmissionStatusSchema,
  TaskKindSchema,
  TaskStateSchema,
  WorkplaceTypeSchema,
} from "../enums";
import {
  ApplicationIdSchema,
  CvVariantIdSchema,
  DeviceIdSchema,
  PostingIdSchema,
  TaskIdSchema,
  UserJobIdSchema,
} from "../ids";
import { DEVICE_SHAPE, FILE_SHAPE } from "../records";
import { defineSchema } from "../registry";

/**
 * A device as the API returns it (05 §3): the `devices` row without
 * `grant_id` and `last_ip_hash`, plus presence computed at read time —
 * `online` (`last_seen_at` ≤ 6 min) and `active` (holds a lease with a
 * heartbeat ≤ 90 s) (04 §1).
 */
export const DeviceViewSchema = defineSchema(
  "api",
  "DeviceView",
  z
    .object(DEVICE_SHAPE)
    .omit({ grant_id: true, last_ip_hash: true })
    .extend({
      online: z.boolean(),
      active: z.boolean(),
      // Additive dashboard fields (12 §7, 17 §7.2); optional for old CLIs.
      /** The device's bound grant is live. */
      signed_in: z.boolean().optional(),
      /** Why the device was signed out, e.g. `refresh_reuse`. */
      signed_out_reason: GrantRevokedReasonSchema.nullable().optional(),
      /** The last device heartbeat (05 §3), kept for "Last sync" and outbox warnings. */
      report: z
        .object({
          cli_version: SemverSchema,
          outbox_depth: z.number().int().min(0),
          outbox_dead: z.number().int().min(0),
          outbox_pending_since: TimestampSchema.nullable(),
          last_sync_at: TimestampSchema.nullable(),
          browser: z.object({
            mode: BrowserModeSchema,
            status: BrowserStatusSchema,
          }),
          local_state_summary: z.record(z.string(), z.number().int().min(0)),
          reported_at: TimestampSchema,
        })
        .nullable()
        .optional(),
    })
);
export type DeviceView = z.infer<typeof DeviceViewSchema>;

/** Presence thresholds (04 §1). */
export const DEVICE_ONLINE_MS = 360_000;
export const DEVICE_ACTIVE_MS = 90_000;

/** A stored file as the API returns it: the `files` row without `r2_key`. */
export const FileViewSchema = defineSchema(
  "api",
  "FileView",
  z.object(FILE_SHAPE).omit({ r2_key: true })
);
export type FileView = z.infer<typeof FileViewSchema>;

/** Posting fields shown on a card and in lists (06 §1.3). */
export const PostingSummarySchema = defineSchema(
  "api",
  "PostingSummary",
  z.object({
    id: PostingIdSchema,
    title: z.string(),
    company_name: z.string(),
    company_domain: z.string().nullable(),
    /** `locations[0].raw`. */
    location: z.string().nullable(),
    workplace_type: WorkplaceTypeSchema.nullable(),
    source_kind: SourceKindSchema,
    apply_url: z.string().nullable(),
    status: PostingStatusSchema,
    closed_at: TimestampSchema.nullable(),
  })
);
export type PostingSummary = z.infer<typeof PostingSummarySchema>;

/** The score badge (06 §1.3): current profile_version only. */
export const ScoreSummarySchema = defineSchema(
  "api",
  "ScoreSummary",
  z.object({
    posting_id: PostingIdSchema,
    score: z.number().int().min(0).max(100),
    status: MatchScoreStatusSchema,
    confidence: z.number().min(0).max(1).nullable(),
    /** True when no AI component contributed ("AI off", 07 §11). */
    deterministic_only: z.boolean(),
    profile_version: z.number().int().min(0),
    rubric_version: z.string(),
    explanation: z.string(),
    created_at: TimestampSchema,
  })
);
export type ScoreSummary = z.infer<typeof ScoreSummarySchema>;

/** The live task badge (06 §1.3). */
export const LiveTaskSummarySchema = defineSchema(
  "api",
  "LiveTaskSummary",
  z.object({
    id: TaskIdSchema,
    kind: TaskKindSchema,
    state: TaskStateSchema,
    device_id: DeviceIdSchema.nullable(),
    device_name: z.string().nullable(),
    pause_reason: PauseReasonSchema.nullable(),
    progress_stage: ProgressStageSchema.nullable(),
    submit_intent_at: TimestampSchema.nullable(),
    updated_at: TimestampSchema,
  })
);
export type LiveTaskSummary = z.infer<typeof LiveTaskSummarySchema>;

/** One Kanban card with its denormalized fields (06 §1.3). */
export const BoardCardSchema = defineSchema(
  "api",
  "BoardCard",
  z.object({
    id: ApplicationIdSchema,
    revision: z.number().int().min(1),
    user_job_id: UserJobIdSchema,
    legacy_job_id: z.string().nullable(),
    stage: StageSchema,
    stage_changed_at: TimestampSchema,
    board_rank: z.string(),
    submission_status: SubmissionStatusSchema,
    mode: ApplicationModeSchema,
    priority: z.number().int().min(-1).max(1),
    archived: z.boolean(),
    follow_up_at: TimestampSchema.nullable(),
    /** `follow_up_at ≤ now`. */
    follow_up_due: z.boolean(),
    cv_variant_id: CvVariantIdSchema.nullable(),
    updated_at: TimestampSchema,
    posting: PostingSummarySchema,
    score: ScoreSummarySchema.nullable(),
    live_task: LiveTaskSummarySchema.nullable(),
    /** Next pending interview. */
    next_interview_at: TimestampSchema.nullable(),
    /** Status of the latest offer, if any. */
    latest_offer_status: OfferStatusSchema.nullable(),
  })
);
export type BoardCard = z.infer<typeof BoardCardSchema>;

/** Optional `?base_revision=` of DELETE routes (or `If-Match`, 05 §1.6). */
export const DeleteQuerySchema = defineSchema(
  "api",
  "DeleteQuery",
  z.object({ base_revision: z.coerce.number().int().min(1).optional() })
);
