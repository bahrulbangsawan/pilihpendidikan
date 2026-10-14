// Contract-valid fixtures for the cloud catalog (24, 05 §15): catalog views,
// runs with logs and warnings, and the list response. Every factory parses
// its result with the contract schema, like fixtures.ts. The boards are
// clearly fictional ("Example …" on `.example` domains); nothing here is
// real job data. Shared by the tests and scripts/mock/cloud.ts.

import type {
  CloudPipeline,
  CloudRunView,
  CloudSourceListResponse,
  CloudSourceView,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  CloudRunViewSchema,
  CloudSourceListResponseSchema,
  CloudSourceViewSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import { DAY, fixtureId, NOW } from "./fixtures";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function makeCloudSource(
  overrides: Partial<CloudSourceView> = {}
): CloudSourceView {
  return CloudSourceViewSchema.parse({
    id: fixtureId("csr"),
    slug: "remote-board.example",
    name: "Example Remote Board",
    homepage_url: "https://remote-board.example",
    listing_url: "https://remote-board.example/jobs",
    canonical_domain: "remote-board.example",
    category: "job_board",
    origin: "directory",
    directory_ref: "recommendations-example-remote-board",
    description: "A fictional remote-only job board used in fixtures.",
    strategy: "rss",
    strategy_config: {
      url: "https://remote-board.example/jobs.rss",
      title_pattern: "company_title",
      separator: ": ",
      defaults: { workplace_type: "remote" },
    },
    health: "ACTIVE",
    status_reason: null,
    enabled: true,
    priority: 70,
    interval_minutes: 60,
    rate_limit: { min_delay_ms: 2000, max_pages: 2, max_items: 200 },
    auth_required: false,
    auth_note: null,
    terms_url: "https://remote-board.example/terms",
    terms_note: null,
    ai_enabled: false,
    allow_browser: false,
    next_run_at: NOW + 40 * MINUTE,
    last_run_id: null,
    last_run_status: "succeeded",
    last_run_at: NOW - 20 * MINUTE,
    last_success_at: NOW - 20 * MINUTE,
    last_error_class: null,
    last_error_message: null,
    consecutive_failures: 0,
    circuit_open_until: null,
    stats: {
      runs: 24,
      successes: 23,
      failures: 1,
      total_duration_ms: 24 * 4200,
      jobs_found_last_run: 48,
      jobs_new_last_run: 5,
      confidence_avg_last_run: 0.9,
      warnings_last_run: 1,
      ai_calls: 0,
    },
    user_modified: [],
    revision: 3,
    created_at: NOW - 10 * DAY,
    updated_at: NOW - 20 * MINUTE,
    status: "ACTIVE",
    following: false,
    followers: 2,
    jobs_total: 312,
    jobs_open: 190,
    success_rate: 23 / 24,
    avg_duration_ms: 4200,
    ...overrides,
  });
}

export function makeCloudRun(
  sourceId: string | null,
  overrides: Partial<CloudRunView> = {}
): CloudRunView {
  return CloudRunViewSchema.parse({
    id: fixtureId("crn"),
    source_id: sourceId,
    kind: "scrape",
    trigger: "schedule",
    status: "succeeded",
    attempt: 1,
    requested_by: null,
    queued_at: NOW - 21 * MINUTE,
    started_at: NOW - 21 * MINUTE,
    finished_at: NOW - 20 * MINUTE,
    duration_ms: 4200,
    strategy: "rss",
    stats: {
      pages: 1,
      postings_found: 48,
      new: 5,
      updated: 2,
      unchanged: 41,
      duplicates: 0,
      invalid: 0,
      closed: 1,
      linked: 5,
      confidence_avg: 0.9,
      scraper_ms: 2100,
    },
    error_class: null,
    error_message: null,
    http_status: 200,
    warnings: [
      {
        code: "missing_field",
        message: "2 postings have no location",
        field: "location",
        count: 2,
      },
    ],
    log: [
      {
        at: NOW - 21 * MINUTE,
        level: "info",
        event: "robots_checked",
        message: "robots.txt allows the feed",
        url: "https://remote-board.example/robots.txt",
        http_status: 200,
        ms: 120,
      },
      {
        at: NOW - 21 * MINUTE + 2000,
        level: "info",
        event: "page_fetched",
        message: "Feed page 1: 48 items",
        url: "https://remote-board.example/jobs.rss",
        http_status: 200,
        ms: 380,
      },
      {
        at: NOW - 20 * MINUTE,
        level: "warn",
        event: "missing_field",
        message: "2 postings have no location",
      },
    ],
    engine_version: "pilih-scraper 0.1.0; pilih-jobs 0.1.0; scrapling 0.4.15",
    updated_at: NOW - 20 * MINUTE,
    ...overrides,
  });
}

export function makePipeline(
  overrides: Partial<CloudPipeline> = {}
): CloudPipeline {
  return {
    enabled: true,
    ai_enabled: false,
    schedule: "0 * * * *",
    directory_url: "https://bahrul.me/tools?category=remote-jobs",
    last_directory_refresh_at: NOW - 2 * DAY,
    ai_budget: null,
    ...overrides,
  };
}

/** One source per status, the way /sources lists them. */
export function sampleCloudSources(): CloudSourceView[] {
  return [
    makeCloudSource({ following: true, followers: 3 }),
    makeCloudSource({
      slug: "nomad-jobs.example",
      name: "Example Nomad Jobs",
      homepage_url: "https://nomad-jobs.example",
      listing_url: "https://nomad-jobs.example/remote",
      canonical_domain: "nomad-jobs.example",
      origin: "default",
      strategy: "json_api",
      strategy_config: {
        url: "https://nomad-jobs.example/api/jobs",
        items_path: "jobs",
        fields: { title: "title", url: "url", company: "company_name" },
      },
      status: "SCRAPING",
      last_run_status: "running",
      priority: 90,
      following: true,
    }),
    makeCloudSource({
      slug: "kerja-remote.example",
      name: "Example Kerja Remote",
      homepage_url: "https://kerja-remote.example",
      listing_url: "https://kerja-remote.example/lowongan",
      canonical_domain: "kerja-remote.example",
      origin: "default",
      strategy: "html_selectors",
      strategy_config: {
        url: "https://kerja-remote.example/lowongan",
        item: "article.job",
        fields: { title: "h2 a::text", link: "h2 a::attr(href)" },
        adaptive: true,
      },
      health: "FAILED",
      status: "FAILED",
      last_run_status: "failed",
      last_success_at: NOW - 3 * DAY,
      last_error_class: "parse_error",
      last_error_message: "No listing items matched article.job",
      consecutive_failures: 2,
      success_rate: 0.6,
    }),
    makeCloudSource({
      slug: "guarded-board.example",
      name: "Example Guarded Board",
      homepage_url: "https://guarded-board.example",
      listing_url: null,
      canonical_domain: "guarded-board.example",
      strategy: "html_selectors",
      strategy_config: {
        url: "https://guarded-board.example/jobs",
        item: ".job",
        fields: { title: "a::text", link: "a::attr(href)" },
      },
      health: "BLOCKED",
      status: "BLOCKED",
      status_reason: "The site answers honest crawlers with a bot challenge.",
      last_run_status: "blocked",
      last_success_at: null,
      last_error_class: "challenge_detected",
      last_error_message: "Challenge page (cloudflare_challenge) on /jobs",
      consecutive_failures: 3,
      circuit_open_until: NOW + 6 * HOUR,
      stats: {
        runs: 6,
        successes: 0,
        failures: 6,
        total_duration_ms: 6 * 1800,
        jobs_found_last_run: 0,
        jobs_new_last_run: 0,
      },
      avg_duration_ms: 1800,
      jobs_total: 0,
      jobs_open: 0,
      success_rate: 0,
    }),
    makeCloudSource({
      slug: "members-jobs.example",
      name: "Example Members Jobs",
      homepage_url: "https://members-jobs.example",
      listing_url: null,
      canonical_domain: "members-jobs.example",
      strategy: "none",
      strategy_config: {},
      health: "AUTH_REQUIRED",
      status: "AUTH_REQUIRED",
      auth_required: true,
      auth_note:
        "Listings are visible only to paying members; Pilih never signs in for you.",
      last_run_status: "auth_required",
      last_error_class: "auth_required",
      last_error_message: "Redirected to /login",
      last_success_at: null,
      stats: { runs: 1, successes: 0, failures: 1, jobs_new_last_run: 0 },
      jobs_total: 0,
      jobs_open: 0,
      success_rate: null,
      avg_duration_ms: null,
    }),
    makeCloudSource({
      slug: "busy-board.example",
      name: "Example Busy Board",
      homepage_url: "https://busy-board.example",
      canonical_domain: "busy-board.example",
      strategy: "json_api",
      strategy_config: {
        url: "https://busy-board.example/api",
        items_path: "",
        fields: { title: "position", url: "url" },
      },
      health: "RATE_LIMITED",
      status: "RATE_LIMITED",
      last_run_status: "rate_limited",
      last_error_class: "rate_limited",
      last_error_message: "429 Too Many Requests (Retry-After 3600)",
      next_run_at: NOW + 2 * HOUR,
    }),
    makeCloudSource({
      slug: "paused-board.example",
      name: "Example Paused Board",
      homepage_url: "https://paused-board.example",
      canonical_domain: "paused-board.example",
      origin: "operator",
      enabled: false,
      status: "DISABLED",
      next_run_at: null,
      priority: 20,
    }),
    makeCloudSource({
      slug: "gig-market.example",
      name: "Example Gig Market",
      homepage_url: "https://gig-market.example",
      listing_url: null,
      canonical_domain: "gig-market.example",
      category: "freelance_marketplace",
      strategy: "none",
      strategy_config: {},
      health: "UNSUPPORTED",
      status: "UNSUPPORTED",
      status_reason:
        "A freelance marketplace: projects are bid on inside the platform, not published as vacancies.",
      last_run_status: null,
      last_run_at: null,
      last_success_at: null,
      next_run_at: null,
      stats: {},
      jobs_total: 0,
      jobs_open: 0,
      success_rate: null,
      avg_duration_ms: null,
      followers: 0,
    }),
  ];
}

export function makeCloudList(
  overrides: Partial<CloudSourceListResponse> = {}
): CloudSourceListResponse {
  return CloudSourceListResponseSchema.parse({
    items: sampleCloudSources(),
    viewer: { operator: false },
    pipeline: makePipeline(),
    ...overrides,
  });
}
