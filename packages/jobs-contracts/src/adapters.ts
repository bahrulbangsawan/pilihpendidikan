// Source adapter registry (15 §14): the manifest schema, the per-adapter
// config schemas and the parsed `adapters.json` that the API serves at
// `GET /api/v1/sources/adapters` and the CLI bundles.
//
// `config_schema` in adapters.json is generated from ADAPTER_CONFIG_SCHEMAS
// by `bun run build` (and verified by `bun run check`), so the server can
// validate configs with Zod while the web renders forms from JSON Schema.
import { z } from "zod";
import adaptersFile from "../adapters.json" with { type: "json" };
import { JsonObjectSchema, SemverSchema, UrlSchema } from "./common";
import type { AdapterId, ExcludedSourceId } from "./enums";
import {
  ADAPTER_IDS,
  AdapterIdSchema,
  DiscoveryErrorClassSchema,
  ExcludedSourceIdSchema,
} from "./enums";
import { asciiHost, registrableDomain } from "./fingerprint";
import { defineSchema } from "./registry";

export const PAGINATION_KINDS = [
  "none",
  "offset",
  "cursor",
  "page_links",
  "single_response",
] as const;
export const INCREMENTAL_KINDS = ["etag", "watermark", "content_hash"] as const;
/** Manifest application_support (the posting column adds email, prohibited). */
export const MANIFEST_APPLICATION_SUPPORT = [
  "browser_supported",
  "browser_unsupported",
  "external_redirect",
  "unknown",
] as const;
export const APPLICATION_API_KINDS = ["none", "employer_key_required"] as const;

/** One adapter manifest (15 §14.1). */
export const AdapterManifestSchema = defineSchema(
  "adapters",
  "AdapterManifest",
  z.object({
    id: AdapterIdSchema,
    /** Semver of the adapter logic. */
    version: SemverSchema,
    /** The CLI refuses adapters newer than itself. */
    min_cli_version: SemverSchema,
    display_name: z.string().min(1).max(80),
    status: z.enum(["stable", "beta", "opt_in"]),
    capabilities: z.object({
      /** Can enumerate postings from a board. */
      discovery: z.boolean(),
      pagination: z.enum(PAGINATION_KINDS),
      /** Has a per-posting detail fetch. */
      detail: z.boolean(),
      /** Fields provided natively (no text parsing). */
      structured_fields: z.array(z.string()),
      /** Always false in v1 (public sources only). */
      auth_required: z.boolean(),
      browser_required: z.boolean(),
      incremental: z.array(z.enum(INCREMENTAL_KINDS)),
      application_support: z.enum(MANIFEST_APPLICATION_SUPPORT),
      application_api: z.enum(APPLICATION_API_KINDS),
    }),
    restrictions: z.object({
      robots_respected: z.literal(true),
      /** Shown in the UI when adding the source. */
      tos_notes: z.string().max(500),
      requires_opt_in: z.boolean(),
      /** Error classes that disable the source. */
      stop_on: z.array(DiscoveryErrorClassSchema),
    }),
    rate_limits: z.object({
      per_domain_concurrency: z.union([z.literal(1), z.literal(2)]),
      min_delay_ms: z.number().int().min(1000),
      max_pages: z.number().int().min(1).max(50),
    }),
    /** Read by the browser agent (18 §10, 19 §8.3). */
    automation: z.object({
      /** `auto` may run headless on this adapter's forms. */
      headless_ok: z.boolean(),
      /** `auto` allowed at all (never career_page, generic_listing, custom_url, workday). */
      auto_ok: z.boolean(),
      /** Application hosts; an entry matches the host and its subdomains. */
      ats_hosts: z.array(z.string()),
      /** Regex sources matched against the post-submit URL (19 §9). */
      confirmation_url_patterns: z.array(z.string()),
      /** CSS selectors of confirmation markers (19 §9). */
      confirmation_selectors: z.array(z.string()),
    }),
    /** JSON Schema of `job_sources.config` (generated from ADAPTER_CONFIG_SCHEMAS). */
    config_schema: JsonObjectSchema,
  })
);
export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;

/**
 * A source refused everywhere (D-17, 15 §14.4). A `hosts` entry matches the
 * host and its subdomains; `name.*` matches any host whose registrable
 * domain's first label is `name` (e.g. `indeed.*` → indeed.com, id.indeed.com,
 * indeed.co.uk).
 */
export const ExcludedSourceSchema = defineSchema(
  "adapters",
  "ExcludedSource",
  z.object({
    id: ExcludedSourceIdSchema,
    status: z.literal("excluded"),
    display_name: z.string().min(1),
    hosts: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
    evidence_urls: z.array(UrlSchema),
  })
);
export type ExcludedSource = z.infer<typeof ExcludedSourceSchema>;

export const AdapterRegistryEntrySchema = defineSchema(
  "adapters",
  "AdapterRegistryEntry",
  z.union([AdapterManifestSchema, ExcludedSourceSchema])
);
export type AdapterRegistryEntry = z.infer<typeof AdapterRegistryEntrySchema>;

/** The whole `adapters.json` (also the `/sources/adapters` response). */
export const AdaptersFileSchema = defineSchema(
  "adapters",
  "AdaptersFile",
  z.object({
    version: z.literal(1),
    adapters: z.array(AdapterRegistryEntrySchema),
  })
);
export type AdaptersFile = z.infer<typeof AdaptersFileSchema>;

// ---------------------------------------------------------------------------
// Per-adapter config schemas (15 §14.3)
// ---------------------------------------------------------------------------

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const LOWER_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const HTTPS_URL = /^https?:\/\//;

const slug = (title: string) => z.string().regex(SLUG).meta({ title });
const httpUrl = (title: string) =>
  z.string().url().max(2048).regex(HTTPS_URL).meta({ title });

export const ADAPTER_CONFIG_SCHEMAS = {
  greenhouse: z.strictObject({ board_token: slug("Board token") }),
  lever: z.strictObject({
    site: slug("Lever site"),
    region: z.enum(["global", "eu"]).optional().meta({ title: "Region" }),
    filters: z
      .strictObject({
        location: z.string().max(200).optional(),
        commitment: z.string().max(200).optional(),
        team: z.string().max(200).optional(),
        department: z.string().max(200).optional(),
      })
      .optional()
      .meta({ title: "Filters" }),
  }),
  ashby: z.strictObject({ job_board_name: slug("Job board name") }),
  smartrecruiters: z.strictObject({
    company_identifier: slug("Company identifier"),
  }),
  workable: z.strictObject({
    subdomain: z.string().regex(LOWER_SLUG).meta({ title: "Subdomain" }),
  }),
  workday: z.strictObject({
    tenant: z.string().regex(LOWER_SLUG).meta({ title: "Tenant" }),
    wd_host_number: z
      .number()
      .int()
      .min(1)
      .max(99)
      .meta({ title: "Host number (wdN)" }),
    site: slug("Career site"),
    search_text: z.string().max(200).optional().meta({ title: "Search text" }),
    /** Set by the CLI on the first denial or challenge (15 §8, §14.3). */
    disabled_reason: z
      .enum(["challenge", "access_denied", "rate_limited"])
      .optional()
      .meta({ title: "Disabled because" }),
  }),
  career_page: z.strictObject({
    url: httpUrl("Careers page URL"),
    item_css: z.string().max(300).optional().meta({ title: "Item selector" }),
    fields: z
      .record(z.string().max(40), z.string().max(300))
      .optional()
      .meta({ title: "Field selectors" }),
    next_css: z
      .string()
      .max(300)
      .optional()
      .meta({ title: "Next-page selector" }),
    allow_browser: z.boolean().optional().meta({ title: "Allow browser" }),
  }),
  generic_listing: z.strictObject({
    start_url: httpUrl("Start URL"),
    detail_url_pattern: z
      .string()
      .min(1)
      .max(300)
      .meta({ title: "Detail URL pattern (regex)" }),
    listing_url_pattern: z
      .string()
      .max(300)
      .optional()
      .meta({ title: "Listing URL pattern (regex)" }),
    max_pages: z.number().int().min(1).max(50).meta({ title: "Max pages" }),
    allow_browser: z.boolean().optional().meta({ title: "Allow browser" }),
  }),
  custom_url: z.strictObject({
    url: httpUrl("Job URL"),
    private: z.boolean().optional().meta({ title: "Private" }),
  }),
} as const satisfies Record<AdapterId, z.ZodType>;

/** The JSON Schema written into adapters.json `config_schema`. */
export function adapterConfigJsonSchema(
  id: AdapterId
): Record<string, unknown> {
  const { $schema: _schema, ...rest } = z.toJSONSchema(
    ADAPTER_CONFIG_SCHEMAS[id],
    { io: "input" }
  ) as Record<string, unknown>;
  return rest;
}

/** Validates `job_sources.config` for an adapter. */
export function parseAdapterConfig(
  adapter: AdapterId,
  config: unknown
): z.ZodSafeParseResult<Record<string, unknown>> {
  return ADAPTER_CONFIG_SCHEMAS[adapter].safeParse(
    config
  ) as z.ZodSafeParseResult<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// The parsed registry
// ---------------------------------------------------------------------------

/** adapters.json, validated at load. */
export const ADAPTERS_FILE: AdaptersFile =
  AdaptersFileSchema.parse(adaptersFile);

function isManifest(entry: AdapterRegistryEntry): entry is AdapterManifest {
  return entry.status !== "excluded";
}

/** The 9 adapter manifests, in registry order. */
export const ADAPTER_MANIFESTS: readonly AdapterManifest[] =
  ADAPTERS_FILE.adapters.filter(isManifest);

/** linkedin and indeed (D-17). */
export const EXCLUDED_SOURCES: readonly ExcludedSource[] =
  ADAPTERS_FILE.adapters.filter(
    (entry): entry is ExcludedSource => entry.status === "excluded"
  );

export function getAdapterManifest(id: AdapterId): AdapterManifest {
  const manifest = ADAPTER_MANIFESTS.find((entry) => entry.id === id);
  if (!manifest) {
    throw new Error(`adapters.json lacks adapter ${id}`);
  }
  return manifest;
}

export function isAdapterId(value: string): value is AdapterId {
  return (ADAPTER_IDS as readonly string[]).includes(value);
}

/** True when `host` equals `pattern` or is a subdomain; `name.*` per ExcludedSource. */
export function hostMatches(host: string, pattern: string): boolean {
  const normalized = asciiHost(host);
  if (!normalized) {
    return false;
  }
  if (pattern.endsWith(".*")) {
    const label = pattern.slice(0, -2);
    const domain = registrableDomain(normalized);
    return domain !== null && domain.split(".")[0] === label;
  }
  return normalized === pattern || normalized.endsWith(`.${pattern}`);
}

/** The excluded source a host (or URL) belongs to, or null. */
export function excludedSourceFor(hostOrUrl: string): ExcludedSourceId | null {
  const host = asciiHost(hostOrUrl);
  if (!host) {
    return null;
  }
  const hit = EXCLUDED_SOURCES.find((entry) =>
    entry.hosts.some((pattern) => hostMatches(host, pattern))
  );
  return hit?.id ?? null;
}

/** True for linkedin.com, *.indeed.* and other excluded hosts (D-17). */
export function isExcludedHost(hostOrUrl: string): boolean {
  return excludedSourceFor(hostOrUrl) !== null;
}

/** The ATS adapter whose `ats_hosts` include `host`, or null. */
export function adapterForAtsHost(hostOrUrl: string): AdapterId | null {
  const host = asciiHost(hostOrUrl);
  if (!host) {
    return null;
  }
  const hit = ADAPTER_MANIFESTS.find((manifest) =>
    manifest.automation.ats_hosts.some((pattern) => hostMatches(host, pattern))
  );
  return hit?.id ?? null;
}
