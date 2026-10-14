// 05 §15 — Cloud discovery (24 §5): the system catalog of remote-job boards,
// its runs, per-user follows and the operator controls.
import { z } from "zod";
import { CloudRateLimitSchema, CloudUrlSchema } from "../cloud-config";
import {
  paginated,
  JsonObjectSchema,
  PageQuerySchema,
  RevisionSchema,
  TimestampSchema,
} from "../common";
import {
  CloudSourceCategorySchema,
  CloudSourceHealthSchema,
  CloudSourceStatusSchema,
  CloudStrategySchema,
} from "../enums";
import { CloudRunRecordSchema, CloudSourceRecordSchema } from "../records";
import { defineSchema } from "../registry";
import { route } from "./route";

/** The hourly schedule of the pipeline (wrangler.jsonc trigger). */
export const CLOUD_DISPATCH_CRON = "0 * * * *";

/**
 * A catalog entry as every signed-in user sees it: the row without its lease
 * and cursor, plus the computed status and the caller's follow state.
 */
export const CloudSourceViewSchema = defineSchema(
  "api",
  "CloudSourceView",
  CloudSourceRecordSchema.omit({
    lease_id: true,
    lease_expires_at: true,
    cursor_state: true,
  }).extend({
    /** DISABLED when switched off, SCRAPING while leased, else `health`. */
    status: CloudSourceStatusSchema,
    following: z.boolean(),
    followers: z.number().int().min(0),
    /** Postings this source delivered, and those still open. */
    jobs_total: z.number().int().min(0),
    jobs_open: z.number().int().min(0),
    /** successes / runs; null before the first run. */
    success_rate: z.number().min(0).max(1).nullable(),
    avg_duration_ms: z.number().int().min(0).nullable(),
  })
);
export type CloudSourceView = z.infer<typeof CloudSourceViewSchema>;

/** A run as the API returns it (a copy of the row schema, so both names export). */
export const CloudRunViewSchema = defineSchema(
  "api",
  "CloudRunView",
  CloudRunRecordSchema.extend({})
);
export type CloudRunView = z.infer<typeof CloudRunViewSchema>;

export const CloudPipelineSchema = defineSchema(
  "api",
  "CloudPipeline",
  z.object({
    /** `JOBS_CLOUD_DISCOVERY_ENABLED`. */
    enabled: z.boolean(),
    /** `JOBS_CLOUD_AI_ENABLED` and not `AI_DISABLED`. */
    ai_enabled: z.boolean(),
    schedule: z.literal(CLOUD_DISPATCH_CRON),
    directory_url: z.string(),
    last_directory_refresh_at: TimestampSchema.nullable(),
    /** Operators only: this month's AI spend against the system budget. */
    ai_budget: z
      .object({
        month: z.string(),
        spent_micro_usd: z.number().int().min(0),
        budget_micro_usd: z.number().int().min(0),
      })
      .nullable(),
  })
);
export type CloudPipeline = z.infer<typeof CloudPipelineSchema>;

export const ListCloudSourcesQuerySchema = defineSchema(
  "api",
  "ListCloudSourcesQuery",
  z.object({
    status: CloudSourceStatusSchema.optional(),
    category: CloudSourceCategorySchema.optional(),
    following: z.enum(["0", "1"]).optional(),
    q: z.string().max(200).optional(),
  })
);

export const CloudSourceListResponseSchema = defineSchema(
  "api",
  "CloudSourceListResponse",
  z.object({
    items: z.array(CloudSourceViewSchema),
    viewer: z.object({ operator: z.boolean() }),
    pipeline: CloudPipelineSchema,
  })
);
export type CloudSourceListResponse = z.infer<
  typeof CloudSourceListResponseSchema
>;

export const CloudSourceDetailResponseSchema = defineSchema(
  "api",
  "CloudSourceDetailResponse",
  z.object({
    source: CloudSourceViewSchema,
    /** The ten newest runs. */
    runs: z.array(CloudRunViewSchema),
  })
);
export type CloudSourceDetailResponse = z.infer<
  typeof CloudSourceDetailResponseSchema
>;

export const CloudSourceResponseSchema = defineSchema(
  "api",
  "CloudSourceResponse",
  z.object({ source: CloudSourceViewSchema })
);

export const FollowCloudSourceResponseSchema = defineSchema(
  "api",
  "FollowCloudSourceResponse",
  z.object({
    source: CloudSourceViewSchema,
    /** Open postings of the last 14 days added to the inbox (≤ 50). */
    backfilled: z.number().int().min(0),
  })
);
export type FollowCloudSourceResponse = z.infer<
  typeof FollowCloudSourceResponseSchema
>;

export const CloudRunPageSchema = paginated(
  "api",
  "CloudRun",
  CloudRunViewSchema
);

export const CloudRunResponseSchema = defineSchema(
  "api",
  "CloudRunResponse",
  z.object({ run: CloudRunViewSchema })
);

/** Operator: register a board by URL; a probe run classifies it (24 §7.3). */
export const CreateCloudSourceRequestSchema = defineSchema(
  "api",
  "CreateCloudSourceRequest",
  z.object({
    name: z.string().min(1).max(200),
    url: CloudUrlSchema,
    listing_url: CloudUrlSchema.nullable().optional(),
    category: CloudSourceCategorySchema.optional(),
    strategy: CloudStrategySchema.optional(),
    strategy_config: JsonObjectSchema.optional(),
    priority: z.number().int().min(0).max(100).optional(),
    interval_minutes: z.number().int().min(60).max(10_080).optional(),
  })
);
export type CreateCloudSourceRequest = z.infer<
  typeof CreateCloudSourceRequestSchema
>;

export const CreateCloudSourceResponseSchema = defineSchema(
  "api",
  "CreateCloudSourceResponse",
  z.object({ source: CloudSourceViewSchema, run: CloudRunViewSchema })
);

/** Operator edits; each changed key is remembered in `user_modified`. */
export const UpdateCloudSourceRequestSchema = defineSchema(
  "api",
  "UpdateCloudSourceRequest",
  z.object({
    base_revision: RevisionSchema,
    name: z.string().min(1).max(200).optional(),
    listing_url: CloudUrlSchema.nullable().optional(),
    category: CloudSourceCategorySchema.optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(100).optional(),
    interval_minutes: z.number().int().min(60).max(10_080).optional(),
    strategy: CloudStrategySchema.optional(),
    strategy_config: JsonObjectSchema.optional(),
    rate_limit: CloudRateLimitSchema.optional(),
    ai_enabled: z.boolean().optional(),
    allow_browser: z.boolean().optional(),
    /** Only ACTIVE (re-activate) or UNSUPPORTED (retire) by hand. */
    health: CloudSourceHealthSchema.extract([
      "ACTIVE",
      "UNSUPPORTED",
    ]).optional(),
    status_reason: z.string().max(1000).nullable().optional(),
    auth_required: z.boolean().optional(),
    auth_note: z.string().max(1000).nullable().optional(),
  })
);
export type UpdateCloudSourceRequest = z.infer<
  typeof UpdateCloudSourceRequestSchema
>;

/** Operator: run now; `retry` also closes the breaker and clears BLOCKED. */
export const StartCloudRunRequestSchema = defineSchema(
  "api",
  "StartCloudRunRequest",
  z.object({
    retry: z.boolean().optional(),
    /** Re-probe the site instead of scraping it. */
    probe: z.boolean().optional(),
  })
);
export type StartCloudRunRequest = z.infer<typeof StartCloudRunRequestSchema>;

export const cloudRoutes = {
  "GET /api/v1/cloud-sources": route({
    method: "GET",
    path: "/api/v1/cloud-sources",
    operation: "listCloudSources",
    section: "05 §15",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: ListCloudSourcesQuerySchema,
    response: CloudSourceListResponseSchema,
  }),
  "POST /api/v1/cloud-sources": route({
    method: "POST",
    path: "/api/v1/cloud-sources",
    operation: "createCloudSource",
    section: "05 §15",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: CreateCloudSourceRequestSchema,
    response: CreateCloudSourceResponseSchema,
  }),
  "GET /api/v1/cloud-sources/{csr_id}": route({
    method: "GET",
    path: "/api/v1/cloud-sources/{csr_id}",
    operation: "getCloudSource",
    section: "05 §15",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: CloudSourceDetailResponseSchema,
  }),
  "PATCH /api/v1/cloud-sources/{csr_id}": route({
    method: "PATCH",
    path: "/api/v1/cloud-sources/{csr_id}",
    operation: "updateCloudSource",
    section: "05 §15",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: UpdateCloudSourceRequestSchema,
    response: CloudSourceResponseSchema,
  }),
  "PUT /api/v1/cloud-sources/{csr_id}/follow": route({
    method: "PUT",
    path: "/api/v1/cloud-sources/{csr_id}/follow",
    operation: "followCloudSource",
    section: "05 §15",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: null,
    response: FollowCloudSourceResponseSchema,
  }),
  "DELETE /api/v1/cloud-sources/{csr_id}/follow": route({
    method: "DELETE",
    path: "/api/v1/cloud-sources/{csr_id}/follow",
    operation: "unfollowCloudSource",
    section: "05 §15",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: null,
    response: CloudSourceResponseSchema,
  }),
  "GET /api/v1/cloud-sources/{csr_id}/runs": route({
    method: "GET",
    path: "/api/v1/cloud-sources/{csr_id}/runs",
    operation: "listCloudSourceRuns",
    section: "05 §15",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: PageQuerySchema,
    response: CloudRunPageSchema,
  }),
  "POST /api/v1/cloud-sources/{csr_id}/runs": route({
    method: "POST",
    path: "/api/v1/cloud-sources/{csr_id}/runs",
    operation: "startCloudRun",
    section: "05 §15",
    scope: "jobs:write",
    idempotency: "optional",
    status: 202,
    request: StartCloudRunRequestSchema,
    response: CloudRunResponseSchema,
  }),
  "GET /api/v1/cloud-discovery/runs": route({
    method: "GET",
    path: "/api/v1/cloud-discovery/runs",
    operation: "listCloudDiscoveryRuns",
    section: "05 §15",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: PageQuerySchema,
    response: CloudRunPageSchema,
  }),
  "POST /api/v1/cloud-discovery/refresh": route({
    method: "POST",
    path: "/api/v1/cloud-discovery/refresh",
    operation: "refreshCloudDirectory",
    section: "05 §15",
    scope: "jobs:write",
    idempotency: "optional",
    status: 202,
    request: null,
    response: CloudRunResponseSchema,
  }),
} as const;
