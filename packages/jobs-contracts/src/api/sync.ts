// 05 §11 — Sync: change feed and snapshot (20 §4).
import { z } from "zod";
import { JsonObjectSchema, TimestampSchema } from "../common";
import { ChangeEntitySchema, ChangeOpSchema } from "../enums";
import {
  ApplicantFactRecordSchema,
  ApplicationRecordSchema,
  ApprovalRecordSchema,
  AutomationRuleRecordSchema,
  AutomationTaskRecordSchema,
  CvVariantRecordSchema,
  InterviewRecordSchema,
  JobPostingRecordSchema,
  JobSourceRecordSchema,
  OfferRecordSchema,
  ScreeningAnswerRecordSchema,
  UserJobRecordSchema,
  UserSettingsRecordSchema,
} from "../records";
import { defineSchema } from "../registry";
import { route } from "./route";

/** Change feed page size (05 §11). */
export const CHANGES_LIMIT_DEFAULT = 500;

export const ChangesQuerySchema = defineSchema(
  "api",
  "ChangesQuery",
  z.object({
    /** Last applied `change_log.seq`; 0 or absent = from the start. */
    cursor: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(CHANGES_LIMIT_DEFAULT).optional(),
    /** Comma-separated ChangeEntity names. */
    entities: z.string().max(300).optional(),
  })
);

/**
 * One change; several changes to an entity collapse into the latest
 * revision. `data` is the current row (the entity's record schema) for
 * upserts and absent for deletes.
 */
export const ChangeSchema = defineSchema(
  "api",
  "Change",
  z.object({
    seq: z.number().int().min(1),
    entity: ChangeEntitySchema,
    entity_id: z.string().min(1),
    revision: z.number().int().min(0),
    op: ChangeOpSchema,
    data: JsonObjectSchema.nullable().optional(),
  })
);
export type Change = z.infer<typeof ChangeSchema>;

/** `410 cursor_expired` when the cursor is older than retention (20 §4.3). */
export const ChangesResponseSchema = defineSchema(
  "api",
  "ChangesResponse",
  z.object({
    changes: z.array(ChangeSchema),
    next_cursor: z.number().int().min(0),
    has_more: z.boolean(),
  })
);
export type ChangesResponse = z.infer<typeof ChangesResponseSchema>;

export const SnapshotQuerySchema = defineSchema(
  "api",
  "SnapshotQuery",
  z.object({
    /** Comma-separated SnapshotEntity names (default: all). */
    entities: z.string().max(300).optional(),
  })
);

/** Full state + the cursor taken at the snapshot's start (20 §4.2). */
export const SnapshotResponseSchema = defineSchema(
  "api",
  "SnapshotResponse",
  z.object({
    cursor: z.number().int().min(0),
    taken_at: TimestampSchema,
    applications: z.array(ApplicationRecordSchema).optional(),
    user_jobs: z.array(UserJobRecordSchema).optional(),
    postings: z.array(JobPostingRecordSchema).optional(),
    interviews: z.array(InterviewRecordSchema).optional(),
    offers: z.array(OfferRecordSchema).optional(),
    tasks: z.array(AutomationTaskRecordSchema).optional(),
    approvals: z.array(ApprovalRecordSchema).optional(),
    rules: z.array(AutomationRuleRecordSchema).optional(),
    sources: z.array(JobSourceRecordSchema).optional(),
    facts: z.array(ApplicantFactRecordSchema).optional(),
    answers: z.array(ScreeningAnswerRecordSchema).optional(),
    cv_variants: z.array(CvVariantRecordSchema).optional(),
    settings: UserSettingsRecordSchema.optional(),
  })
);
export type SnapshotResponse = z.infer<typeof SnapshotResponseSchema>;

export const syncRoutes = {
  "GET /api/v1/changes": route({
    method: "GET",
    path: "/api/v1/changes",
    operation: "getChanges",
    section: "05 §11",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: ChangesQuerySchema,
    response: ChangesResponseSchema,
  }),
  "GET /api/v1/snapshot": route({
    method: "GET",
    path: "/api/v1/snapshot",
    operation: "getSnapshot",
    section: "05 §11",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: SnapshotQuerySchema,
    response: SnapshotResponseSchema,
  }),
} as const;
