// Cloud discovery configuration shapes (24 §3, §4): per-strategy configs,
// rate limits, cursor state, run statistics, warnings and log lines. Kept
// apart from records.ts / cloud.ts so both can import it without a cycle.
//
// A source stores its strategy in `cloud_sources.strategy` and the config in
// `strategy_config`; `parseStrategyConfig(strategy, config)` validates the
// pair. The scraper (apps/jobs-scraper) validates the same JSON with the
// Pydantic models generated from these schemas.
import { z } from "zod";
import { TimestampSchema } from "./common";
import type { CloudStrategy } from "./enums";
import {
  CloudErrorClassSchema,
  EmploymentTypeSchema,
  WorkplaceTypeSchema,
} from "./enums";
import { defineSchema } from "./registry";

const HTTPS_URL = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

/** An absolute http(s) URL as stored in a strategy config (≤ 2048). */
export const CloudUrlSchema = defineSchema(
  "cloud",
  "CloudUrl",
  z.string().min(10).max(2048).regex(HTTPS_URL)
);

/** A dotted JSON path (`company`, `salary.min`, `tags`); "" is the root. */
export const JsonPathSchema = defineSchema(
  "cloud",
  "JsonPath",
  z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_$@.-]*$/)
);

/**
 * A CSS selector as Scrapling reads it, including the `::text` and
 * `::attr(name)` pseudo-elements (`a.title::attr(href)`).
 */
export const CssSelectorSchema = defineSchema(
  "cloud",
  "CssSelector",
  z.string().min(1).max(300)
);

/** Values applied when a posting does not state them (remote-only boards). */
export const CloudDefaultsSchema = defineSchema(
  "cloud",
  "CloudDefaults",
  z.object({
    workplace_type: WorkplaceTypeSchema.optional(),
    employment_type: EmploymentTypeSchema.optional(),
    /** Raw location text, e.g. "Indonesia" or "Worldwide". */
    location: z.string().max(200).optional(),
    /** Company name for single-employer boards. */
    company: z.string().max(300).optional(),
  })
);
export type CloudDefaults = z.infer<typeof CloudDefaultsSchema>;

/** Where each field lives in a JSON item (json_api, embedded_json). */
export const JsonFieldMapSchema = defineSchema(
  "cloud",
  "JsonFieldMap",
  z.object({
    title: JsonPathSchema,
    url: JsonPathSchema,
    company: JsonPathSchema.optional(),
    apply_url: JsonPathSchema.optional(),
    location: JsonPathSchema.optional(),
    posted_at: JsonPathSchema.optional(),
    expires_at: JsonPathSchema.optional(),
    description_html: JsonPathSchema.optional(),
    description_text: JsonPathSchema.optional(),
    salary_min: JsonPathSchema.optional(),
    salary_max: JsonPathSchema.optional(),
    salary_currency: JsonPathSchema.optional(),
    salary_text: JsonPathSchema.optional(),
    tags: JsonPathSchema.optional(),
    category: JsonPathSchema.optional(),
    employment_type: JsonPathSchema.optional(),
    external_id: JsonPathSchema.optional(),
    company_url: JsonPathSchema.optional(),
  })
);
export type JsonFieldMap = z.infer<typeof JsonFieldMapSchema>;

export const DATE_FORMATS = ["iso", "epoch_s", "epoch_ms", "rfc2822"] as const;

const strategyBase = {
  defaults: CloudDefaultsSchema.optional(),
  /** Attribution the board requires (stored in raw_metadata, shown in UI). */
  attribution: z.string().max(300).optional(),
};

/** `json_api`: a documented public JSON endpoint (Remotive, Remote OK, …). */
export const JsonApiConfigSchema = defineSchema(
  "cloud",
  "JsonApiConfig",
  z.object({
    ...strategyBase,
    url: CloudUrlSchema,
    /** Path to the item array; "" when the body is the array. */
    items_path: JsonPathSchema,
    /** Leading items that are not jobs (Remote OK's legal notice). */
    skip_items: z.number().int().min(0).max(5).optional(),
    fields: JsonFieldMapSchema,
    date_format: z.enum(DATE_FORMATS).optional(),
  })
);
export type JsonApiConfig = z.infer<typeof JsonApiConfigSchema>;

/** `rss`: an RSS 2.0 or Atom feed of jobs. */
export const RssConfigSchema = defineSchema(
  "cloud",
  "RssConfig",
  z.object({
    ...strategyBase,
    url: CloudUrlSchema,
    /**
     * How the item title carries the company: `company_title` ("Acme: Dev"),
     * `title_company` ("Dev at Acme" / "Dev - Acme"), or `title` (no company).
     */
    title_pattern: z.enum(["company_title", "title_company", "title"]),
    /** Separator for the title pattern (default ": " / " at "). */
    separator: z.string().min(1).max(10).optional(),
    /** Item element holding the company (`author`, `company`, `dc:creator`). */
    company_field: z.string().max(60).optional(),
    /** Item element holding the location (`region`, `location`). */
    location_field: z.string().max(60).optional(),
    /** Item element holding the job type (`type`, `job_type`). */
    type_field: z.string().max(60).optional(),
    /**
     * Fetch each item's link (≤ `rate_limit.max_details`, same host only) and
     * fill missing fields (company, description, dates) from its JSON-LD
     * JobPosting. For feeds whose items lack the company.
     */
    fetch_details: z.boolean().optional(),
  })
);
export type RssConfig = z.infer<typeof RssConfigSchema>;

/** `json_ld`: listing page links → detail pages with schema.org JobPosting. */
export const JsonLdConfigSchema = defineSchema(
  "cloud",
  "JsonLdConfig",
  z.object({
    ...strategyBase,
    listing_url: CloudUrlSchema,
    /** Links to detail pages on the listing (`a.job-link::attr(href)`). */
    detail_link_selector: CssSelectorSchema,
    /** Only detail URLs matching this regex are followed (same host). */
    detail_url_pattern: z.string().max(300).optional(),
    /** Read JobPosting / ItemList JSON-LD on the listing page first. */
    listing_jsonld: z.boolean().optional(),
    next_page: CssSelectorSchema.optional(),
  })
);
export type JsonLdConfig = z.infer<typeof JsonLdConfigSchema>;

/** `embedded_json`: listings inside a page script (`__NEXT_DATA__`, Nuxt). */
export const EmbeddedJsonConfigSchema = defineSchema(
  "cloud",
  "EmbeddedJsonConfig",
  z.object({
    ...strategyBase,
    url: CloudUrlSchema,
    /** Default `script#__NEXT_DATA__`. */
    script_selector: CssSelectorSchema.optional(),
    /**
     * The page assigns the data to `window.<global_name>` in an inline script
     * (`window.__PRELOADED_STATE__ = {…}`). The object literal is parsed as
     * JSON and never executed; a non-JSON literal is `parse_error`.
     */
    global_name: z
      .string()
      .max(60)
      .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
      .optional(),
    items_path: JsonPathSchema,
    fields: JsonFieldMapSchema,
    /** Prefix for relative item URLs (default: the page URL). */
    url_base: CloudUrlSchema.optional(),
    date_format: z.enum(DATE_FORMATS).optional(),
  })
);
export type EmbeddedJsonConfig = z.infer<typeof EmbeddedJsonConfigSchema>;

/** CSS selectors per field, relative to one listing item. */
export const HtmlFieldMapSchema = defineSchema(
  "cloud",
  "HtmlFieldMap",
  z.object({
    title: CssSelectorSchema,
    link: CssSelectorSchema,
    company: CssSelectorSchema.optional(),
    location: CssSelectorSchema.optional(),
    posted_at: CssSelectorSchema.optional(),
    salary: CssSelectorSchema.optional(),
    tags: CssSelectorSchema.optional(),
    employment_type: CssSelectorSchema.optional(),
  })
);
export type HtmlFieldMap = z.infer<typeof HtmlFieldMapSchema>;

/** Optional detail-page fetch for html_selectors / browser. */
export const DetailConfigSchema = defineSchema(
  "cloud",
  "DetailConfig",
  z.object({
    enabled: z.boolean(),
    /** Description container on the detail page; JSON-LD is tried first. */
    description_selector: CssSelectorSchema.optional(),
    company_selector: CssSelectorSchema.optional(),
  })
);

/** `html_selectors`: static HTML with CSS selectors + adaptive relocation. */
export const HtmlSelectorsConfigSchema = defineSchema(
  "cloud",
  "HtmlSelectorsConfig",
  z.object({
    ...strategyBase,
    url: CloudUrlSchema,
    item: CssSelectorSchema,
    fields: HtmlFieldMapSchema,
    next_page: CssSelectorSchema.optional(),
    /** Scrapling adaptive relocation on a selector miss (default true). */
    adaptive: z.boolean().optional(),
    detail: DetailConfigSchema.optional(),
  })
);
export type HtmlSelectorsConfig = z.infer<typeof HtmlSelectorsConfigSchema>;

/** `browser`: like html_selectors, rendered in headless Chromium first. */
export const BrowserConfigSchema = defineSchema(
  "cloud",
  "BrowserConfig",
  HtmlSelectorsConfigSchema.extend({
    wait_selector: CssSelectorSchema.optional(),
  })
);
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;

/** `ai`: page text is sent to the AI extractor (24 §4.3). */
export const AiStrategyConfigSchema = defineSchema(
  "cloud",
  "AiStrategyConfig",
  z.object({
    ...strategyBase,
    url: CloudUrlSchema,
  })
);
export type AiStrategyConfig = z.infer<typeof AiStrategyConfigSchema>;

export const NoneStrategyConfigSchema = defineSchema(
  "cloud",
  "NoneStrategyConfig",
  z.object({ ...strategyBase })
);

/** The config schema of each strategy. */
export const STRATEGY_CONFIG_SCHEMAS: Readonly<
  Record<CloudStrategy, z.ZodType>
> = {
  json_api: JsonApiConfigSchema,
  rss: RssConfigSchema,
  json_ld: JsonLdConfigSchema,
  embedded_json: EmbeddedJsonConfigSchema,
  html_selectors: HtmlSelectorsConfigSchema,
  browser: BrowserConfigSchema,
  ai: AiStrategyConfigSchema,
  none: NoneStrategyConfigSchema,
};

/** Validates a strategy config; `{ok: false, issues}` lists Zod issues. */
export function parseStrategyConfig(
  strategy: CloudStrategy,
  config: unknown
):
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; issues: { path: string; message: string }[] } {
  const parsed = STRATEGY_CONFIG_SCHEMAS[strategy].safeParse(config);
  if (parsed.success) {
    return { ok: true, config: parsed.data as Record<string, unknown> };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

/** The URL a strategy fetches first (the listing / feed / API). */
export function strategyEntryUrl(
  strategy: CloudStrategy,
  config: Record<string, unknown>
): string | null {
  const key = strategy === "json_ld" ? "listing_url" : "url";
  const value = config[key];
  return typeof value === "string" ? value : null;
}

/** Per-source politeness and caps (24 §6.3). Unset keys use the defaults. */
export const CloudRateLimitSchema = defineSchema(
  "cloud",
  "CloudRateLimit",
  z.object({
    /** Delay between two requests to the source (≥ 1 s). */
    min_delay_ms: z.number().int().min(1000).max(60_000).optional(),
    max_pages: z.number().int().min(1).max(10).optional(),
    max_items: z.number().int().min(1).max(500).optional(),
    max_details: z.number().int().min(0).max(50).optional(),
  })
);
export type CloudRateLimit = z.infer<typeof CloudRateLimitSchema>;

export const CLOUD_RATE_LIMIT_DEFAULTS = Object.freeze({
  min_delay_ms: 2000,
  max_pages: 3,
  max_items: 200,
  max_details: 20,
});

/** Incremental state + checkpoint of a source (24 §6.4). */
export const CloudCursorStateSchema = defineSchema(
  "cloud",
  "CloudCursorState",
  z.looseObject({
    v: z.literal(1).optional(),
    listing: z
      .object({
        etag: z.string().max(200).optional(),
        last_modified: z.string().max(100).optional(),
      })
      .optional(),
    /** Checkpoint: the next listing page of an interrupted run. */
    resume_url: z.string().max(2048).nullable().optional(),
    resume_page: z.number().int().min(0).max(100).optional(),
    /** Detail refs already fetched (≤ 500, newest last). */
    detail_seen: z.array(z.string().max(200)).max(500).optional(),
    last_complete_at: TimestampSchema.optional(),
  })
);
export type CloudCursorState = z.infer<typeof CloudCursorStateSchema>;

/** Running counters of a source (24 §2.1 `cloud_sources.stats`). */
export const CloudSourceStatsSchema = defineSchema(
  "cloud",
  "CloudSourceStats",
  z.object({
    runs: z.number().int().min(0).optional(),
    successes: z.number().int().min(0).optional(),
    failures: z.number().int().min(0).optional(),
    total_duration_ms: z.number().int().min(0).optional(),
    jobs_found_last_run: z.number().int().min(0).optional(),
    jobs_new_last_run: z.number().int().min(0).optional(),
    confidence_avg_last_run: z.number().min(0).max(1).optional(),
    warnings_last_run: z.number().int().min(0).optional(),
    ai_calls: z.number().int().min(0).optional(),
  })
);
export type CloudSourceStats = z.infer<typeof CloudSourceStatsSchema>;

/** Counters of one run (24 §2.2 `cloud_runs.stats`). */
export const CloudRunStatsSchema = defineSchema(
  "cloud",
  "CloudRunStats",
  z.object({
    pages: z.number().int().min(0).optional(),
    postings_found: z.number().int().min(0).optional(),
    new: z.number().int().min(0).optional(),
    updated: z.number().int().min(0).optional(),
    unchanged: z.number().int().min(0).optional(),
    duplicates: z.number().int().min(0).optional(),
    invalid: z.number().int().min(0).optional(),
    closed: z.number().int().min(0).optional(),
    relocated: z.number().int().min(0).optional(),
    robots_skipped: z.number().int().min(0).optional(),
    /** user_jobs created for followers. */
    linked: z.number().int().min(0).optional(),
    ai_calls: z.number().int().min(0).optional(),
    ai_items: z.number().int().min(0).optional(),
    ai_cost_micro_usd: z.number().int().min(0).optional(),
    confidence_avg: z.number().min(0).max(1).optional(),
    scraper_ms: z.number().int().min(0).optional(),
    /** Directory / probe runs. */
    entries: z.number().int().min(0).optional(),
    registered: z.number().int().min(0).optional(),
  })
);
export type CloudRunStats = z.infer<typeof CloudRunStatsSchema>;

/** A data-quality note of a run (24 §6.6). */
export const CloudWarningSchema = defineSchema(
  "cloud",
  "CloudWarning",
  z.object({
    /** missing_field, low_confidence, selector_drift, thin_description, suspicious, adaptive_reset, truncated, ai_skipped, ai_rejected, robots_skipped, … */
    code: z.string().min(1).max(64),
    message: z.string().max(500),
    field: z.string().max(64).optional(),
    count: z.number().int().min(0).optional(),
  })
);
export type CloudWarning = z.infer<typeof CloudWarningSchema>;
export const CLOUD_WARNINGS_MAX = 50;

/** One structured log line of a run (≤ 100 kept). */
export const CloudLogEntrySchema = defineSchema(
  "cloud",
  "CloudLogEntry",
  z.object({
    at: TimestampSchema,
    level: z.enum(["info", "warn", "error"]),
    event: z.string().min(1).max(64),
    message: z.string().max(500),
    url: z.string().max(2048).optional(),
    http_status: z.number().int().optional(),
    ms: z.number().int().min(0).optional(),
  })
);
export type CloudLogEntry = z.infer<typeof CloudLogEntrySchema>;
export const CLOUD_LOG_MAX = 100;

/** The fatal error that stopped a source run (null on success). */
export const CloudRunErrorSchema = defineSchema(
  "cloud",
  "CloudRunError",
  z.object({
    error_class: CloudErrorClassSchema,
    message: z.string().max(500),
    http_status: z.number().int().nullable().optional(),
    url: z.string().max(2048).nullable().optional(),
    /** From Retry-After on 429/503. */
    retry_after_s: z.number().int().min(0).nullable().optional(),
  })
);
export type CloudRunError = z.infer<typeof CloudRunErrorSchema>;
