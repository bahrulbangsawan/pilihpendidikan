// 05 §4 — Discovery and postings (15, 20 §7).
import { z } from "zod";
import {
  DeletedResponseSchema,
  DomainSchema,
  FingerprintSchema,
  JsonObjectSchema,
  PageQuerySchema,
  paginated,
  RevisionSchema,
  Sha256HexSchema,
  TimestampSchema,
} from "../common";
import {
  ApplicationSupportSchema,
  DiscoveryRunStatusSchema,
  EmploymentTypeSchema,
  InboxBulkActionSchema,
  InboxStateSchema,
  PostingVisibilitySchema,
  RunItemOutcomeSchema,
  SourceKindSchema,
  WorkplaceTypeSchema,
} from "../enums";
import {
  ApplicationIdSchema,
  DeviceIdSchema,
  PostingIdSchema,
  RunIdSchema,
  SourceIdSchema,
  TaskIdSchema,
  UserJobIdSchema,
} from "../ids";
import {
  ApplicationRecordSchema,
  CursorStateSchema,
  DiscoveryRunRecordSchema,
  ExtractionProvenanceSchema,
  JobPostingRecordSchema,
  JobSourceRecordSchema,
  PostingLocationSchema,
  RUN_ERRORS_MAX,
  RunErrorSchema,
  RunSourceSchema,
  RunStatsSchema,
  SalarySchema,
  UserJobRecordSchema,
} from "../records";
import { AdaptersFileSchema } from "../adapters";
import { defineSchema } from "../registry";
import { route } from "./route";
import { DeleteQuerySchema, ScoreSummarySchema } from "./views";

// --- sources ------------------------------------------------------------------

export const ListSourcesQuerySchema = defineSchema(
  "api",
  "ListSourcesQuery",
  PageQuerySchema.extend({ enabled: z.enum(["0", "1"]).optional() })
);

export const JobSourcePageSchema = paginated(
  "api",
  "JobSource",
  JobSourceRecordSchema
);

/**
 * `adapter` is a free string so that `linkedin` / `indeed` reach the handler
 * and get `422 unsupported_source` (D-17) rather than `400`; `config` is
 * validated against the adapter's config schema (adapters.ts).
 */
export const CreateSourceRequestSchema = defineSchema(
  "api",
  "CreateSourceRequest",
  z.object({
    adapter: z.string().min(1).max(64),
    label: z.string().min(1).max(200),
    config: JsonObjectSchema,
    enabled: z.boolean().optional(),
    schedule: z.string().max(60).nullable().optional(),
  })
);
export type CreateSourceRequest = z.infer<typeof CreateSourceRequestSchema>;

export const SourceResponseSchema = defineSchema(
  "api",
  "SourceResponse",
  z.object({ source: JobSourceRecordSchema })
);

export const UpdateSourceRequestSchema = defineSchema(
  "api",
  "UpdateSourceRequest",
  z.object({
    base_revision: RevisionSchema,
    label: z.string().min(1).max(200).optional(),
    config: JsonObjectSchema.optional(),
    enabled: z.boolean().optional(),
    schedule: z.string().max(60).nullable().optional(),
    /** On 409 the CLI keeps the server value (20 §6.2). */
    cursor_state: CursorStateSchema.optional(),
  })
);
export type UpdateSourceRequest = z.infer<typeof UpdateSourceRequestSchema>;

// --- runs ----------------------------------------------------------------------

/** Start a run record; idempotent by the client-generated `id` (05 §4). */
export const CreateRunRequestSchema = defineSchema(
  "api",
  "CreateRunRequest",
  z.object({
    id: RunIdSchema,
    sources: z.array(RunSourceSchema).min(1).max(100),
    device_id: DeviceIdSchema,
    task_id: TaskIdSchema.nullable().optional(),
    engine_version: z.string().min(1).max(200),
    /** Offline runs report their real start (≤ 24 h skew, 03 §1). */
    started_at: TimestampSchema.optional(),
  })
);
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const RunResponseSchema = defineSchema(
  "api",
  "RunResponse",
  z.object({ run: DiscoveryRunRecordSchema })
);

export const DiscoveryRunPageSchema = paginated(
  "api",
  "DiscoveryRun",
  DiscoveryRunRecordSchema
);

/** `status_evidence` of a closed/open check (15 §12). */
export const StatusEvidenceSchema = defineSchema(
  "api",
  "StatusEvidence",
  z.object({
    http_status: z.number().int().nullable().optional(),
    marker: z.string().max(200).nullable().optional(),
  })
);

/**
 * A full `postings:batch` item: the normalized posting (15 §10.1). The server
 * recomputes `fingerprint` (mismatch ⇒ `invalid`, `fingerprint_mismatch`).
 */
export const NormalizedPostingSchema = defineSchema(
  "api",
  "NormalizedPosting",
  z.object({
    client_ref: z.string().min(1).max(64),
    fingerprint: FingerprintSchema,
    visibility: PostingVisibilitySchema,
    source_kind: SourceKindSchema,
    source_org: z.string().max(200).nullable().optional(),
    source_job_ref: z.string().max(200).nullable().optional(),
    /** The run source that produced it (user_jobs.source_id). */
    source_id: SourceIdSchema.nullable().optional(),
    canonical_url: z.string().max(2048).nullable().optional(),
    apply_url: z.string().max(2048).nullable().optional(),
    apply_domain: DomainSchema.nullable().optional(),
    company_name: z.string().min(1).max(300),
    company_domain: DomainSchema.nullable().optional(),
    title: z.string().min(1).max(300),
    department: z.string().max(200).nullable().optional(),
    locations: z.array(PostingLocationSchema).max(50),
    workplace_type: WorkplaceTypeSchema.nullable().optional(),
    employment_type: EmploymentTypeSchema.nullable().optional(),
    seniority: z.string().max(60).nullable().optional(),
    salary: SalarySchema.nullable().optional(),
    description_text: z.string(),
    description_truncated: z.boolean().optional(),
    requirements: z.array(z.string().max(500)).max(50),
    posted_at: TimestampSchema.nullable().optional(),
    application_support: ApplicationSupportSchema.optional(),
    content_hash: Sha256HexSchema,
    dedupe_group: Sha256HexSchema.nullable().optional(),
    observed_at: TimestampSchema,
    extraction: ExtractionProvenanceSchema,
    status_hint: z.enum(["open", "closed"]).optional(),
    status_evidence: StatusEvidenceSchema.optional(),
  })
);
export type NormalizedPosting = z.infer<typeof NormalizedPostingSchema>;

/**
 * An unchanged-only item: bumps `last_seen_at`, no body (05 §4, 20 §7).
 * `status_hint` / `status_evidence` let a detail check report a closure
 * without re-sending content (15 §12). Strict: other keys are rejected so a
 * malformed full item never parses as an unchanged one.
 */
export const UnchangedPostingItemSchema = defineSchema(
  "api",
  "UnchangedPostingItem",
  z.strictObject({
    client_ref: z.string().min(1).max(64),
    fingerprint: FingerprintSchema,
    content_hash: Sha256HexSchema,
    observed_at: TimestampSchema,
    status_hint: z.enum(["open", "closed"]).optional(),
    status_evidence: StatusEvidenceSchema.optional(),
  })
);
export type UnchangedPostingItem = z.infer<typeof UnchangedPostingItemSchema>;

/** Batch limits (05 §4, 20 §5.4). */
export const POSTINGS_BATCH_MAX_ITEMS = 100;
export const POSTINGS_BATCH_MAX_BYTES = 1_048_576;

export const PostingsBatchRequestSchema = defineSchema(
  "api",
  "PostingsBatchRequest",
  z.object({
    items: z
      .array(z.union([UnchangedPostingItemSchema, NormalizedPostingSchema]))
      .min(1)
      .max(POSTINGS_BATCH_MAX_ITEMS),
  })
);
export type PostingsBatchRequest = z.infer<typeof PostingsBatchRequestSchema>;

/** Error codes of an `invalid` batch item. */
export const BATCH_ITEM_ERROR_CODES = [
  "fingerprint_mismatch",
  "schema_invalid",
  "excluded_source",
  "unknown_fingerprint",
  "private_conflict",
] as const;

export const PostingsBatchResponseSchema = defineSchema(
  "api",
  "PostingsBatchResponse",
  z.object({
    items: z.array(
      z.object({
        client_ref: z.string(),
        outcome: RunItemOutcomeSchema,
        posting_id: PostingIdSchema.optional(),
        user_job_id: UserJobIdSchema.optional(),
        errors: z
          .array(
            z.object({
              code: z.enum(BATCH_ITEM_ERROR_CODES),
              message: z.string(),
              path: z.string().optional(),
            })
          )
          .optional(),
      })
    ),
  })
);
export type PostingsBatchResponse = z.infer<typeof PostingsBatchResponseSchema>;

/**
 * A fully enumerated source of the run (15 §9): only these increment
 * `missed_runs`; postings are matched by `(source_kind, source_org)`.
 */
export const CompleteSourceSchema = defineSchema(
  "api",
  "CompleteSource",
  z.object({
    source_id: SourceIdSchema.nullable().optional(),
    source_kind: SourceKindSchema,
    source_org: z.string().max(200).nullable(),
  })
);

export const CompleteRunRequestSchema = defineSchema(
  "api",
  "CompleteRunRequest",
  z.object({
    status: DiscoveryRunStatusSchema.exclude(["running"]),
    finished_at: TimestampSchema.optional(),
    stats: RunStatsSchema,
    errors: z.array(RunErrorSchema).max(RUN_ERRORS_MAX),
    complete_sources: z.array(CompleteSourceSchema),
    /** Incremental crawl state per source (15 §9). */
    cursor_states: z
      .array(
        z.object({
          source_id: SourceIdSchema,
          cursor_state: CursorStateSchema,
        })
      )
      .optional(),
  })
);
export type CompleteRunRequest = z.infer<typeof CompleteRunRequestSchema>;

export const CompleteRunResponseSchema = defineSchema(
  "api",
  "CompleteRunResponse",
  z.object({
    run: DiscoveryRunRecordSchema,
    /** Postings closed by this completion (missed_runs reached 2). */
    closed_postings: z.number().int().min(0),
  })
);

// --- inbox -----------------------------------------------------------------------

export const InboxQuerySchema = defineSchema(
  "api",
  "InboxQuery",
  PageQuerySchema.extend({
    state: InboxStateSchema.optional(),
    min_score: z.coerce.number().int().min(0).max(100).optional(),
    /** A source id (`src_…`) or an adapter / source kind. */
    source: z.string().max(64).optional(),
    q: z.string().max(200).optional(),
  })
);

export const InboxItemSchema = defineSchema(
  "api",
  "InboxItem",
  z.object({
    user_job: UserJobRecordSchema,
    posting: JobPostingRecordSchema,
    score: ScoreSummarySchema.nullable(),
    provenance: z.object({
      run_id: RunIdSchema.nullable(),
      source_id: SourceIdSchema.nullable(),
      source_label: z.string().nullable(),
      source_kind: SourceKindSchema,
    }),
    /** Other postings of the same dedupe_group linked to this user (15 §11). */
    duplicates: z.number().int().min(0),
  })
);
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const InboxItemPageSchema = paginated(
  "api",
  "InboxItem",
  InboxItemSchema
);

export const InboxBulkRequestSchema = defineSchema(
  "api",
  "InboxBulkRequest",
  z.object({
    user_job_ids: z.array(UserJobIdSchema).min(1).max(200),
    action: InboxBulkActionSchema,
  })
);
export type InboxBulkRequest = z.infer<typeof InboxBulkRequestSchema>;

export const InboxBulkResponseSchema = defineSchema(
  "api",
  "InboxBulkResponse",
  z.object({
    results: z.array(
      z.object({
        user_job_id: UserJobIdSchema,
        status: z.enum(["ok", "conflict", "not_found", "invalid"]),
        inbox_state: InboxStateSchema.optional(),
        /** Set when `track` created or found the application. */
        application_id: ApplicationIdSchema.optional(),
        /** Set when `score` queued or found a score. */
        score_status: z.enum(["queued", "cached"]).optional(),
        error: z.string().optional(),
      })
    ),
  })
);
export type InboxBulkResponse = z.infer<typeof InboxBulkResponseSchema>;

// --- tracked jobs ----------------------------------------------------------------

/** Manual add by URL: a `custom_url` stub posting the CLI or web enriches. */
export const AddJobByUrlRequestSchema = defineSchema(
  "api",
  "AddJobByUrlRequest",
  z.strictObject({
    url: z.string().url().max(2048),
    private: z.boolean().optional(),
    user_notes: z.string().max(10_000).optional(),
  })
);

/** Manual add with full posting fields (`source_kind = manual`). */
export const AddJobManualRequestSchema = defineSchema(
  "api",
  "AddJobManualRequest",
  z.object({
    title: z.string().min(1).max(300),
    company_name: z.string().min(1).max(300),
    company_domain: DomainSchema.nullable().optional(),
    apply_url: z.string().url().max(2048).nullable().optional(),
    canonical_url: z.string().url().max(2048).nullable().optional(),
    department: z.string().max(200).nullable().optional(),
    locations: z.array(PostingLocationSchema).max(50).optional(),
    workplace_type: WorkplaceTypeSchema.nullable().optional(),
    employment_type: EmploymentTypeSchema.nullable().optional(),
    seniority: z.string().max(60).nullable().optional(),
    salary: SalarySchema.nullable().optional(),
    description_text: z.string().optional(),
    requirements: z.array(z.string().max(500)).max(50).optional(),
    posted_at: TimestampSchema.nullable().optional(),
    user_notes: z.string().max(10_000).optional(),
  })
);

export const AddUserJobRequestSchema = defineSchema(
  "api",
  "AddUserJobRequest",
  z.union([AddJobByUrlRequestSchema, AddJobManualRequestSchema])
);
export type AddUserJobRequest = z.infer<typeof AddUserJobRequestSchema>;

export const UserJobResponseSchema = defineSchema(
  "api",
  "UserJobResponse",
  z.object({ user_job: UserJobRecordSchema, posting: JobPostingRecordSchema })
);

/** Tracked job + posting + latest score (05 §4). */
export const UserJobDetailSchema = defineSchema(
  "api",
  "UserJobDetail",
  z.object({
    user_job: UserJobRecordSchema,
    posting: JobPostingRecordSchema,
    score: ScoreSummarySchema.nullable(),
    application: ApplicationRecordSchema.nullable(),
  })
);
export type UserJobDetail = z.infer<typeof UserJobDetailSchema>;

export const discoveryRoutes = {
  "GET /api/v1/sources": route({
    method: "GET",
    path: "/api/v1/sources",
    operation: "listSources",
    section: "05 §4",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: ListSourcesQuerySchema,
    response: JobSourcePageSchema,
  }),
  "POST /api/v1/sources": route({
    method: "POST",
    path: "/api/v1/sources",
    operation: "createSource",
    section: "05 §4",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: CreateSourceRequestSchema,
    response: SourceResponseSchema,
  }),
  "PATCH /api/v1/sources/{src_id}": route({
    method: "PATCH",
    path: "/api/v1/sources/{src_id}",
    operation: "updateSource",
    section: "05 §4",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: UpdateSourceRequestSchema,
    response: SourceResponseSchema,
  }),
  "DELETE /api/v1/sources/{src_id}": route({
    method: "DELETE",
    path: "/api/v1/sources/{src_id}",
    operation: "deleteSource",
    section: "05 §4",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: null,
    query: DeleteQuerySchema,
    response: DeletedResponseSchema,
  }),
  "GET /api/v1/sources/adapters": route({
    method: "GET",
    path: "/api/v1/sources/adapters",
    operation: "listAdapters",
    section: "05 §4",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: AdaptersFileSchema,
  }),
  "POST /api/v1/discovery/runs": route({
    method: "POST",
    path: "/api/v1/discovery/runs",
    operation: "createRun",
    section: "05 §4",
    scope: "discovery:write",
    idempotency: "optional",
    status: 201,
    request: CreateRunRequestSchema,
    response: RunResponseSchema,
  }),
  "POST /api/v1/discovery/runs/{run_id}/postings:batch": route({
    method: "POST",
    path: "/api/v1/discovery/runs/{run_id}/postings:batch",
    operation: "postPostingsBatch",
    section: "05 §4",
    scope: "discovery:write",
    idempotency: "optional",
    status: 200,
    request: PostingsBatchRequestSchema,
    response: PostingsBatchResponseSchema,
  }),
  "POST /api/v1/discovery/runs/{run_id}/complete": route({
    method: "POST",
    path: "/api/v1/discovery/runs/{run_id}/complete",
    operation: "completeRun",
    section: "05 §4",
    scope: "discovery:write",
    idempotency: "optional",
    status: 200,
    request: CompleteRunRequestSchema,
    response: CompleteRunResponseSchema,
  }),
  "GET /api/v1/discovery/runs": route({
    method: "GET",
    path: "/api/v1/discovery/runs",
    operation: "listRuns",
    section: "05 §4",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: PageQuerySchema,
    response: DiscoveryRunPageSchema,
  }),
  "GET /api/v1/inbox": route({
    method: "GET",
    path: "/api/v1/inbox",
    operation: "listInbox",
    section: "05 §4",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: InboxQuerySchema,
    response: InboxItemPageSchema,
  }),
  "POST /api/v1/inbox:bulk": route({
    method: "POST",
    path: "/api/v1/inbox:bulk",
    operation: "inboxBulk",
    section: "05 §4",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: InboxBulkRequestSchema,
    response: InboxBulkResponseSchema,
  }),
  "POST /api/v1/user-jobs": route({
    method: "POST",
    path: "/api/v1/user-jobs",
    operation: "addUserJob",
    section: "05 §4",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: AddUserJobRequestSchema,
    response: UserJobResponseSchema,
  }),
  "GET /api/v1/user-jobs/{ujb_id}": route({
    method: "GET",
    path: "/api/v1/user-jobs/{ujb_id}",
    operation: "getUserJob",
    section: "05 §4",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: UserJobDetailSchema,
  }),
} as const;
