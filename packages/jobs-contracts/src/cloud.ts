// Cloud discovery wire contracts (24 §3, §7, §8): the scraper protocol between
// apps/api and apps/jobs-scraper, the `jobs-scrape` queue messages, the AI
// extraction output and the seed catalog file (`cloud-sources.json`).
import { z } from "zod";
import { NormalizedPostingSchema } from "./api/discovery";
import {
  CloudCursorStateSchema,
  CloudLogEntrySchema,
  CloudRateLimitSchema,
  CloudRunErrorSchema,
  CloudUrlSchema,
  CloudWarningSchema,
  CLOUD_LOG_MAX,
  CLOUD_WARNINGS_MAX,
  CssSelectorSchema,
} from "./cloud-config";
import { DomainSchema, JsonObjectSchema, TimestampSchema } from "./common";
import {
  ApplicationMethodSchema,
  CloudRunTriggerSchema,
  CloudSourceCategorySchema,
  CloudSourceHealthSchema,
  CloudStrategySchema,
  EmploymentDetailSchema,
  EmploymentTypeSchema,
  WorkplaceTypeSchema,
} from "./enums";
import { CloudRunIdSchema, CloudSourceIdSchema } from "./ids";
import { defineSchema } from "./registry";

/** Protocol version of every scraper body. */
export const SCRAPER_PROTOCOL_VERSION = 1;
/** Largest scraper request / response body (24 §3). */
export const SCRAPER_MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Most items one scrape returns (the rate limit's max_items caps it lower). */
export const SCRAPE_MAX_ITEMS = 500;
/** AI fallback: most page excerpts per scrape and their size (24 §4.3). */
export const AI_CANDIDATES_MAX = 5;
export const AI_CANDIDATE_TEXT_MAX = 8192;

// --- scrape ----------------------------------------------------------------------

/** The source as the scraper needs it (no lease, stats or cursor). */
export const ScrapeSourceSchema = defineSchema(
  "cloud",
  "ScrapeSource",
  z.object({
    id: CloudSourceIdSchema,
    slug: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    homepage_url: CloudUrlSchema,
    listing_url: CloudUrlSchema.nullable(),
    canonical_domain: DomainSchema,
    strategy: CloudStrategySchema,
    strategy_config: JsonObjectSchema,
    rate_limit: CloudRateLimitSchema,
    allow_browser: z.boolean(),
  })
);
export type ScrapeSource = z.infer<typeof ScrapeSourceSchema>;

/** Largest rendered page the scraper Worker hands to the container. */
export const PREFETCHED_HTML_MAX = 3_500_000;

/**
 * A listing page rendered by the scraper Worker with Cloudflare Browser
 * Rendering (24 §4.4). The container treats it like a page it fetched: same
 * robots gate, SSRF guard, challenge / login-wall classification and parser.
 */
export const PrefetchedPageSchema = defineSchema(
  "cloud",
  "PrefetchedPage",
  z.object({
    url: CloudUrlSchema,
    final_url: CloudUrlSchema,
    status: z.number().int().min(100).max(599),
    html: z.string().max(PREFETCHED_HTML_MAX),
    renderer: z.literal("browser_rendering"),
    /** Requests the renderer blocked (robots, trackers, media). */
    blocked_requests: z.number().int().min(0),
  })
);
export type PrefetchedPage = z.infer<typeof PrefetchedPageSchema>;

export const ScrapeRequestSchema = defineSchema(
  "cloud",
  "ScrapeRequest",
  z.object({
    v: z.literal(SCRAPER_PROTOCOL_VERSION),
    run_id: CloudRunIdSchema,
    source: ScrapeSourceSchema,
    cursor_state: CloudCursorStateSchema,
    /** Wall-clock budget; the scraper stops paging and answers before it. */
    deadline_ms: z.number().int().min(5000).max(600_000),
    /** Return page excerpts for the AI fallback (24 §4.3). */
    ai_fallback: z.boolean(),
    /** The listing, already rendered by the scraper Worker (24 §4.4). */
    prefetched: PrefetchedPageSchema.optional(),
  })
);
export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;

/** Fields of the cloud job model that NormalizedPosting does not carry. */
export const CloudPostingExtrasSchema = defineSchema(
  "cloud",
  "CloudPostingExtras",
  z.object({
    skills: z.array(z.string().max(100)).max(50).optional(),
    benefits: z.array(z.string().max(300)).max(50).optional(),
    expires_at: TimestampSchema.nullable().optional(),
    employment_detail: EmploymentDetailSchema.nullable().optional(),
    application_method: ApplicationMethodSchema.nullable().optional(),
    auth_required: z.boolean().optional(),
    /** Verbatim source fields (tags, category, attribution), ≤ 8 KB JSON. */
    raw_metadata: JsonObjectSchema.optional(),
  })
);
export type CloudPostingExtras = z.infer<typeof CloudPostingExtrasSchema>;

/**
 * One scraped posting: the `postings:batch` item (fingerprint, content hash
 * and provenance computed by the scraper, recomputed by the api) plus extras.
 */
export const CloudPostingItemSchema = defineSchema(
  "cloud",
  "CloudPostingItem",
  NormalizedPostingSchema.extend({
    extras: CloudPostingExtrasSchema.optional(),
  })
);
export type CloudPostingItem = z.infer<typeof CloudPostingItemSchema>;

/** A page the AI fallback may read (text only, ≤ 8 KB). */
export const AiCandidateSchema = defineSchema(
  "cloud",
  "AiCandidate",
  z.object({
    url: CloudUrlSchema,
    /** Why it was sent: `no_items`, `strategy_ai`, `low_confidence`. */
    reason: z.string().max(40),
    title: z.string().max(300).nullable(),
    text: z.string().max(AI_CANDIDATE_TEXT_MAX),
  })
);
export type AiCandidate = z.infer<typeof AiCandidateSchema>;

export const ScrapeStatsSchema = defineSchema(
  "cloud",
  "ScrapeStats",
  z.object({
    pages: z.number().int().min(0),
    postings_found: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    invalid: z.number().int().min(0),
    relocated: z.number().int().min(0),
    robots_skipped: z.number().int().min(0),
    details_fetched: z.number().int().min(0),
    elapsed_ms: z.number().int().min(0),
    fetch_mode: z.enum(["json_api", "static_html", "browser"]).nullable(),
  })
);
export type ScrapeStats = z.infer<typeof ScrapeStatsSchema>;

export const EngineVersionsSchema = defineSchema(
  "cloud",
  "EngineVersions",
  z.object({
    scraper: z.string().max(40),
    pilih_jobs: z.string().max(40).optional(),
    scrapling: z.string().max(40).optional(),
    playwright: z.string().max(40).optional(),
  })
);

export const ScrapeResponseSchema = defineSchema(
  "cloud",
  "ScrapeResponse",
  z.object({
    v: z.literal(SCRAPER_PROTOCOL_VERSION),
    /** ok: no fatal error; partial: items then a stop; failed: no items. */
    outcome: z.enum(["ok", "partial", "failed"]),
    /** Every listing page was read (only then do absences count, 24 §6.5). */
    complete: z.boolean(),
    items: z.array(CloudPostingItemSchema).max(SCRAPE_MAX_ITEMS),
    ai_candidates: z.array(AiCandidateSchema).max(AI_CANDIDATES_MAX),
    cursor_state: CloudCursorStateSchema,
    stats: ScrapeStatsSchema,
    error: CloudRunErrorSchema.nullable(),
    warnings: z.array(CloudWarningSchema).max(CLOUD_WARNINGS_MAX),
    log: z.array(CloudLogEntrySchema).max(CLOUD_LOG_MAX),
    engine: EngineVersionsSchema,
  })
);
export type ScrapeResponse = z.infer<typeof ScrapeResponseSchema>;

// --- preflight ---------------------------------------------------------------------

/**
 * Before rendering a page, the scraper Worker asks the container whether the
 * URL may be fetched (SSRF guard, D-17 exclusions, robots.txt for our UA) and
 * gets the host's robots.txt to filter the render's own subrequests (24 §4.4).
 */
export const PreflightRequestSchema = defineSchema(
  "cloud",
  "PreflightRequest",
  z.object({
    v: z.literal(SCRAPER_PROTOCOL_VERSION),
    url: CloudUrlSchema,
  })
);
export type PreflightRequest = z.infer<typeof PreflightRequestSchema>;

export const PreflightResponseSchema = defineSchema(
  "cloud",
  "PreflightResponse",
  z.object({
    v: z.literal(SCRAPER_PROTOCOL_VERSION),
    allowed: z.boolean(),
    /** The UA the renderer must send. */
    user_agent: z.string().max(200),
    /** The host's robots.txt (null when absent / unreadable = no rules). */
    robots_txt: z.string().max(524_288).nullable(),
    crawl_delay_s: z.number().min(0).nullable(),
    error: CloudRunErrorSchema.nullable(),
  })
);
export type PreflightResponse = z.infer<typeof PreflightResponseSchema>;

// --- probe -----------------------------------------------------------------------

export const ProbeRequestSchema = defineSchema(
  "cloud",
  "ProbeRequest",
  z.object({
    v: z.literal(SCRAPER_PROTOCOL_VERSION),
    url: CloudUrlSchema,
  })
);
export type ProbeRequest = z.infer<typeof ProbeRequestSchema>;

/** A machine-readable feed found and verified on a site. */
export const ProbeFeedSchema = defineSchema(
  "cloud",
  "ProbeFeed",
  z.object({
    type: z.enum(["rss", "atom", "json_api"]),
    url: CloudUrlSchema,
    items: z.number().int().min(0),
    sample_titles: z.array(z.string().max(300)).max(5),
  })
);
export type ProbeFeed = z.infer<typeof ProbeFeedSchema>;

export const ProbeResponseSchema = defineSchema(
  "cloud",
  "ProbeResponse",
  z.object({
    v: z.literal(SCRAPER_PROTOCOL_VERSION),
    url: z.string().max(2048),
    final_url: z.string().max(2048).nullable(),
    http_status: z.number().int().nullable(),
    reachable: z.boolean(),
    robots: z.object({
      fetched: z.boolean(),
      allowed: z.boolean().nullable(),
      crawl_delay_s: z.number().min(0).nullable(),
    }),
    /** `cloudflare_challenge`, `datadome`, … (15 §8 markers). */
    protection: z.string().max(60).nullable(),
    /** The page is a login / sign-up / paywall. */
    auth_wall: z.boolean(),
    title: z.string().max(300).nullable(),
    meta_description: z.string().max(500).nullable(),
    feeds: z.array(ProbeFeedSchema).max(10),
    jsonld_job_postings: z.number().int().min(0),
    /** `__NEXT_DATA__`, `__NUXT__`, … present. */
    embedded_json: z.array(z.string().max(60)).max(10),
    /** Same-site links that look like job detail pages. */
    job_link_count: z.number().int().min(0),
    text_excerpt: z.string().max(4096),
    error: CloudRunErrorSchema.nullable(),
    log: z.array(CloudLogEntrySchema).max(CLOUD_LOG_MAX),
    engine: EngineVersionsSchema,
  })
);
export type ProbeResponse = z.infer<typeof ProbeResponseSchema>;

// --- directory ---------------------------------------------------------------------

/** How to read a directory page of outbound links (24 §7). */
export const DirectoryConfigSchema = defineSchema(
  "cloud",
  "DirectoryConfig",
  z.object({
    url: CloudUrlSchema,
    /** Each entry's link, e.g. `#resources-remote-jobs-list a[href]`. */
    link_selector: CssSelectorSchema,
    /** Relative to the link. */
    name_selector: CssSelectorSchema.optional(),
    description_selector: CssSelectorSchema.optional(),
    /** Attribute holding a stable entry id (`data-chat-anchor`). */
    anchor_attr: z.string().max(60).optional(),
  })
);
export type DirectoryConfig = z.infer<typeof DirectoryConfigSchema>;

export const DirectoryRequestSchema = defineSchema(
  "cloud",
  "DirectoryRequest",
  z.object({
    v: z.literal(SCRAPER_PROTOCOL_VERSION),
    directory: DirectoryConfigSchema,
  })
);
export type DirectoryRequest = z.infer<typeof DirectoryRequestSchema>;

export const DirectoryEntrySchema = defineSchema(
  "cloud",
  "DirectoryEntry",
  z.object({
    name: z.string().min(1).max(200),
    url: CloudUrlSchema,
    description: z.string().max(500).nullable(),
    anchor: z.string().max(200).nullable(),
  })
);
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;

export const DirectoryResponseSchema = defineSchema(
  "cloud",
  "DirectoryResponse",
  z.object({
    v: z.literal(SCRAPER_PROTOCOL_VERSION),
    final_url: z.string().max(2048).nullable(),
    http_status: z.number().int().nullable(),
    entries: z.array(DirectoryEntrySchema).max(500),
    error: CloudRunErrorSchema.nullable(),
    log: z.array(CloudLogEntrySchema).max(CLOUD_LOG_MAX),
    engine: EngineVersionsSchema,
  })
);
export type DirectoryResponse = z.infer<typeof DirectoryResponseSchema>;

// --- queue -------------------------------------------------------------------------

/** `jobs-scrape` queue messages (24 §6). ≤ 1 KB each. */
export const CloudQueueMessageSchema = defineSchema(
  "cloud",
  "CloudQueueMessage",
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("scrape_source"),
      v: z.literal(1),
      source_id: CloudSourceIdSchema,
      run_id: CloudRunIdSchema,
      trigger: CloudRunTriggerSchema,
    }),
    z.object({
      type: z.literal("probe_source"),
      v: z.literal(1),
      source_id: CloudSourceIdSchema,
      run_id: CloudRunIdSchema,
    }),
    z.object({
      type: z.literal("refresh_directory"),
      v: z.literal(1),
      run_id: CloudRunIdSchema,
    }),
  ])
);
export type CloudQueueMessage = z.infer<typeof CloudQueueMessageSchema>;

// --- AI extraction -------------------------------------------------------------------

/**
 * `structured()` output of the AI fallback (24 §4.3). Every property is
 * required and nullable (strict structured-output mode); values the page does
 * not state are null, never guessed.
 */
export const CloudAiJobSchema = defineSchema(
  "cloud",
  "CloudAiJob",
  z.strictObject({
    title: z.string().max(300),
    company: z.string().max(300).nullable(),
    location: z.string().max(200).nullable(),
    workplace_type: WorkplaceTypeSchema,
    employment_type: EmploymentTypeSchema,
    employment_detail: EmploymentDetailSchema.nullable(),
    url: z.string().max(2048).nullable(),
    posted_at: z.string().max(40).nullable(),
    salary_min: z.number().min(0).nullable(),
    salary_max: z.number().min(0).nullable(),
    salary_currency: z.string().max(3).nullable(),
    salary_period: z.enum(["hour", "day", "week", "month", "year"]).nullable(),
    description: z.string().max(4000).nullable(),
    status: z.enum(["active", "expired", "ambiguous"]),
    confidence: z.number().min(0).max(1),
    suspicious: z.boolean(),
    suspicious_reason: z.string().max(200).nullable(),
  })
);
export type CloudAiJob = z.infer<typeof CloudAiJobSchema>;

export const CloudAiExtractionSchema = defineSchema(
  "cloud",
  "CloudAiExtraction",
  z.strictObject({
    is_job_listing_page: z.boolean(),
    jobs: z.array(CloudAiJobSchema).max(50),
  })
);
export type CloudAiExtraction = z.infer<typeof CloudAiExtractionSchema>;

// --- seed catalog ----------------------------------------------------------------------

/** One audited catalog entry of `cloud-sources.json` (24 §7.1). */
export const CloudSourceSeedSchema = defineSchema(
  "cloud",
  "CloudSourceSeed",
  z.object({
    slug: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    homepage_url: CloudUrlSchema,
    listing_url: CloudUrlSchema.nullable(),
    canonical_domain: DomainSchema,
    category: CloudSourceCategorySchema,
    /** `directory` entries come from the directory; `default` were added by hand. */
    from_directory: z.boolean(),
    directory_ref: z.string().max(200).nullable(),
    description: z.string().max(500).nullable(),
    strategy: CloudStrategySchema,
    strategy_config: JsonObjectSchema,
    health: CloudSourceHealthSchema,
    status_reason: z.string().max(1000).nullable(),
    enabled: z.boolean(),
    priority: z.number().int().min(0).max(100),
    interval_minutes: z.number().int().min(60).max(10_080),
    rate_limit: CloudRateLimitSchema,
    auth_required: z.boolean(),
    auth_note: z.string().max(1000).nullable(),
    terms_url: z.string().max(2048).nullable(),
    terms_note: z.string().max(1000).nullable(),
    allow_browser: z.boolean(),
    /** Evidence from the audit (dated GET lines), kept for the report. */
    audit: z.object({
      checked_at: z.string().max(40),
      evidence: z.array(z.string().max(500)).max(20),
    }),
  })
);
export type CloudSourceSeed = z.infer<typeof CloudSourceSeedSchema>;

export const CloudSourcesFileSchema = defineSchema(
  "cloud",
  "CloudSourcesFile",
  z.object({
    version: z.number().int().min(1),
    directory: DirectoryConfigSchema,
    sources: z.array(CloudSourceSeedSchema).max(500),
  })
);
export type CloudSourcesFile = z.infer<typeof CloudSourcesFileSchema>;
