// Mock api routes for the cloud catalog (05 §15, 24 §5): the list with the
// viewer and pipeline, one source with its runs (cursor paging), follow /
// unfollow, and the operator writes (PATCH with revision checks and
// user_modified, run / retry / re-probe with a simulated run that finishes a
// few seconds later, add a board, refresh the directory).
//
// The viewer is an operator unless MOCK_CLOUD_OPERATOR=0; the pipeline is on
// unless MOCK_CLOUD_PIPELINE=0. Boards are fictional (`.example` domains).

import type {
  CloudRunView,
  CloudSourceView,
} from "@pilihpendidikan/jobs-contracts/api";
import { parseStrategyConfig } from "@pilihpendidikan/jobs-contracts/cloud-config";
import type { CloudStrategy } from "@pilihpendidikan/jobs-contracts/enums";
import {
  CLOUD_SOURCE_CATEGORIES,
  CLOUD_STRATEGIES,
} from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import { NOW, USER_ID } from "../../src/test/fixtures";
import {
  makeCloudRun,
  makePipeline,
  sampleCloudSources,
} from "../../src/test/fixtures-cloud";
import { fresh, SHIFT } from "./state";
import type { MockRequest, MockRoute, Reply } from "./types";
import { apiError, match, NOT_FOUND, ok, revisionConflict } from "./types";

const MINUTE = 60_000;
const RUN_SECONDS = 8;
const HTTP_OF: Readonly<Record<string, number>> = {
  rate_limited: 429,
  challenge_detected: 403,
  access_denied: 403,
  auth_required: 302,
};

const operator = process.env.MOCK_CLOUD_OPERATOR !== "0";
const pipelineEnabled = process.env.MOCK_CLOUD_PIPELINE !== "0";

interface Entry {
  runs: CloudRunView[];
  scraping: boolean;
  source: CloudSourceView;
}

const entries = new Map<string, Entry>();
const directoryRuns: CloudRunView[] = [];

function shiftUntil(value: number | null): number | null {
  return value === null ? null : value + SHIFT;
}

/** Runs matching each fixture's last status (the first board has many). */
function runsFor(source: CloudSourceView, index: number): CloudRunView[] {
  const count = index === 0 ? 14 : 3;
  const runs: CloudRunView[] = [];
  for (let n = 0; n < count; n += 1) {
    const at = NOW - (20 + n * 60) * MINUTE;
    const latest = n === 0;
    const failedNow =
      latest &&
      source.last_error_class !== null &&
      source.status !== "SCRAPING";
    runs.push(
      makeCloudRun(source.id, {
        queued_at: at - MINUTE,
        started_at: at - MINUTE,
        finished_at: at,
        updated_at: at,
        strategy: source.strategy,
        ...(failedNow
          ? {
              status: source.last_run_status ?? "failed",
              error_class: source.last_error_class,
              error_message: source.last_error_message,
              http_status: HTTP_OF[source.last_error_class ?? ""] ?? 200,
              stats: { pages: 1, postings_found: 0 },
              warnings: [],
              log: [
                {
                  at: at - 30_000,
                  level: "error",
                  event: source.last_error_class ?? "error",
                  message:
                    source.last_error_message ??
                    "The run stopped. <img src=x onerror=alert(1)> stays text.",
                  url: source.listing_url ?? source.homepage_url,
                  http_status: HTTP_OF[source.last_error_class ?? ""] ?? 200,
                  ms: 900,
                },
              ],
            }
          : {}),
      })
    );
  }
  if (source.status === "SCRAPING") {
    runs.unshift(
      makeCloudRun(source.id, {
        status: "running",
        queued_at: NOW - 2 * MINUTE,
        started_at: NOW - MINUTE,
        finished_at: null,
        duration_ms: null,
        stats: { pages: 1, postings_found: 12 },
        updated_at: NOW - MINUTE,
        log: [
          {
            at: NOW - MINUTE,
            level: "info",
            event: "page_fetched",
            message: "API page 1: 12 items",
            http_status: 200,
            ms: 410,
          },
        ],
        warnings: [],
      })
    );
  }
  return runs;
}

for (const [index, raw] of sampleCloudSources().entries()) {
  const source = fresh(raw);
  source.circuit_open_until = shiftUntil(raw.circuit_open_until);
  const runs = fresh(runsFor(raw, index));
  source.last_run_id = runs[0]?.id ?? null;
  entries.set(source.id, {
    source,
    runs,
    scraping: source.status === "SCRAPING",
  });
}
directoryRuns.push(
  fresh(
    makeCloudRun(null, {
      kind: "directory",
      trigger: "schedule",
      strategy: null,
      stats: { entries: 80, registered: 0 },
      warnings: [],
      log: [],
    })
  )
);

function statusOf(entry: Entry): CloudSourceView["status"] {
  if (!entry.source.enabled) {
    return "DISABLED";
  }
  return entry.scraping ? "SCRAPING" : entry.source.health;
}

function view(entry: Entry): CloudSourceView {
  return { ...entry.source, status: statusOf(entry) };
}

function list(request: MockRequest): Reply {
  const params = request.url.searchParams;
  const status = params.get("status");
  const category = params.get("category");
  const following = params.get("following");
  const q = params.get("q")?.toLowerCase() ?? "";
  const items = [...entries.values()]
    .map(view)
    .filter(
      (source) =>
        (!status || source.status === status) &&
        (!category || source.category === category) &&
        (following === null || source.following === (following === "1")) &&
        (q === "" ||
          source.name.toLowerCase().includes(q) ||
          source.canonical_domain.includes(q))
    );
  return ok({
    items,
    viewer: { operator },
    pipeline: fresh(
      makePipeline({
        enabled: pipelineEnabled,
        ai_budget: operator
          ? {
              month: "2026-10",
              spent_micro_usd: 120_000,
              budget_micro_usd: 2_000_000,
            }
          : null,
      })
    ),
  });
}

const OPERATOR_ONLY = apiError(
  403,
  "operator_required",
  "Only catalog operators can do this."
);

function newRun(
  sourceId: string | null,
  kind: CloudRunView["kind"],
  trigger: CloudRunView["trigger"],
  strategy: CloudStrategy | null
): CloudRunView {
  const now = Date.now();
  return {
    id: newId("crn"),
    source_id: sourceId,
    kind,
    trigger,
    status: "queued",
    attempt: 1,
    requested_by: USER_ID,
    queued_at: now,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    strategy,
    stats: {},
    error_class: null,
    error_message: null,
    http_status: null,
    warnings: [],
    log: [],
    engine_version: null,
    updated_at: now,
  };
}

/** The simulated run: running at once, done RUN_SECONDS later. */
function simulate(entry: Entry, run: CloudRunView): void {
  entry.scraping = run.kind === "scrape";
  entry.source.last_run_status = "running";
  run.status = "running";
  run.started_at = Date.now();
  setTimeout(() => {
    const now = Date.now();
    run.status = "succeeded";
    run.finished_at = now;
    run.duration_ms = now - (run.started_at ?? now);
    run.http_status = 200;
    run.stats =
      run.kind === "probe"
        ? { pages: 1 }
        : {
            pages: 1,
            postings_found: 40,
            new: 3,
            updated: 1,
            unchanged: 36,
            linked: 3,
          };
    run.log = [
      {
        at: now - 1500,
        level: "info",
        event: run.kind === "probe" ? "probe_finished" : "page_fetched",
        message:
          run.kind === "probe"
            ? "Feed found and robots.txt allows it"
            : "Page 1: 40 items",
        http_status: 200,
        ms: 400,
      },
    ];
    run.updated_at = now;
    entry.scraping = false;
    entry.source = {
      ...entry.source,
      health: run.kind === "scrape" ? "ACTIVE" : entry.source.health,
      last_run_status: "succeeded",
      last_run_at: now,
      last_success_at: now,
      last_error_class: null,
      last_error_message: null,
      consecutive_failures: 0,
      next_run_at: now + entry.source.interval_minutes * MINUTE,
      updated_at: now,
    };
  }, RUN_SECONDS * 1000);
}

function startRun(id: string, body: Record<string, unknown>): Reply {
  if (!operator) {
    return OPERATOR_ONLY;
  }
  if (!pipelineEnabled) {
    return apiError(422, "policy_violation", "Cloud discovery is off.");
  }
  const entry = entries.get(id);
  if (!entry) {
    return NOT_FOUND;
  }
  const live = entry.runs.find(
    (run) => run.status === "queued" || run.status === "running"
  );
  if (live) {
    return ok({ run: live }, 202);
  }
  const retry = body.retry === true;
  const probe = body.probe === true;
  if (retry) {
    entry.source = {
      ...entry.source,
      health: entry.source.health === "UNSUPPORTED" ? "UNSUPPORTED" : "ACTIVE",
      consecutive_failures: 0,
      circuit_open_until: null,
    };
  }
  const run = newRun(
    id,
    probe ? "probe" : "scrape",
    retry ? "retry" : "manual",
    entry.source.strategy
  );
  entry.runs.unshift(run);
  entry.source.last_run_id = run.id;
  simulate(entry, run);
  return ok({ run }, 202);
}

const UPDATABLE = [
  "name",
  "listing_url",
  "category",
  "enabled",
  "priority",
  "interval_minutes",
  "strategy",
  "strategy_config",
  "rate_limit",
  "ai_enabled",
  "allow_browser",
  "health",
  "status_reason",
  "auth_required",
  "auth_note",
] as const;

function update(id: string, body: Record<string, unknown>): Reply {
  if (!operator) {
    return OPERATOR_ONLY;
  }
  const entry = entries.get(id);
  if (!entry) {
    return NOT_FOUND;
  }
  if (body.base_revision !== entry.source.revision) {
    return revisionConflict(view(entry));
  }
  const strategy = (body.strategy ?? entry.source.strategy) as CloudStrategy;
  if (!(CLOUD_STRATEGIES as readonly string[]).includes(strategy)) {
    return apiError(400, "invalid_request", "Unknown strategy.");
  }
  if (body.strategy_config !== undefined || body.strategy !== undefined) {
    const parsed = parseStrategyConfig(
      strategy,
      body.strategy_config ?? entry.source.strategy_config
    );
    if (!parsed.ok) {
      return apiError(400, "invalid_request", "Invalid strategy config.", {
        issues: parsed.issues,
      });
    }
  }
  const changed = UPDATABLE.filter((key) => body[key] !== undefined);
  const next = { ...entry.source } as Record<string, unknown>;
  for (const key of changed) {
    next[key] = body[key];
  }
  entry.source = {
    ...(next as CloudSourceView),
    user_modified: [...new Set([...entry.source.user_modified, ...changed])],
    revision: entry.source.revision + 1,
    updated_at: Date.now(),
  };
  return ok({ source: view(entry) });
}

function follow(id: string, on: boolean): Reply {
  const entry = entries.get(id);
  if (!entry) {
    return NOT_FOUND;
  }
  const was = entry.source.following;
  let delta = 0;
  if (on !== was) {
    delta = on ? 1 : -1;
  }
  entry.source = {
    ...entry.source,
    following: on,
    followers: Math.max(0, entry.source.followers + delta),
  };
  if (on) {
    const backfilled = was ? 0 : Math.min(12, entry.source.jobs_open);
    return ok({ source: view(entry), backfilled });
  }
  return ok({ source: view(entry) });
}

const PAGE_LIMIT = 20;

function runsPage(request: MockRequest, runs: readonly CloudRunView[]): Reply {
  const limit = Math.min(
    200,
    Number(request.url.searchParams.get("limit") ?? PAGE_LIMIT) || PAGE_LIMIT
  );
  const offset = Number(request.url.searchParams.get("cursor") ?? 0) || 0;
  const items = runs.slice(offset, offset + limit);
  const next = offset + limit < runs.length ? String(offset + limit) : null;
  return ok({ items, next_cursor: next });
}

const HOST_RE = /^https?:\/\/([^/?#:]+)/i;
const WWW_RE = /^www\./;

function create(body: Record<string, unknown>): Reply {
  if (!operator) {
    return OPERATOR_ONLY;
  }
  const url = typeof body.url === "string" ? body.url : "";
  const host = HOST_RE.exec(url)?.[1]?.toLowerCase().replace(WWW_RE, "");
  if (!host || typeof body.name !== "string" || body.name.trim() === "") {
    return apiError(400, "invalid_request", "Name and URL are required.");
  }
  if (
    [...entries.values()].some(
      (entry) => entry.source.canonical_domain === host
    )
  ) {
    return apiError(409, "duplicate", "This board is already in the catalog.");
  }
  const category = (CLOUD_SOURCE_CATEGORIES as readonly string[]).includes(
    String(body.category)
  )
    ? (body.category as CloudSourceView["category"])
    : "unknown";
  const strategy = (CLOUD_STRATEGIES as readonly string[]).includes(
    String(body.strategy)
  )
    ? (body.strategy as CloudStrategy)
    : "none";
  const now = Date.now();
  const id = newId("csr");
  const source: CloudSourceView = {
    ...(fresh(sampleCloudSources()[0]) as CloudSourceView),
    id,
    slug: host,
    name: body.name.trim(),
    homepage_url: url,
    listing_url: typeof body.listing_url === "string" ? body.listing_url : null,
    canonical_domain: host,
    category,
    origin: "operator",
    directory_ref: null,
    description: null,
    strategy,
    strategy_config: {},
    health: "ACTIVE",
    status_reason: "Checking the site before the first scrape.",
    enabled: false,
    priority: typeof body.priority === "number" ? body.priority : 50,
    interval_minutes:
      typeof body.interval_minutes === "number" ? body.interval_minutes : 60,
    terms_url: null,
    next_run_at: null,
    last_run_id: null,
    last_run_status: "queued",
    last_run_at: null,
    last_success_at: null,
    stats: {},
    user_modified: [],
    revision: 1,
    created_at: now,
    updated_at: now,
    status: "DISABLED",
    following: false,
    followers: 0,
    jobs_total: 0,
    jobs_open: 0,
    success_rate: null,
    avg_duration_ms: null,
  };
  const entry: Entry = { source, runs: [], scraping: false };
  const run = newRun(id, "probe", "manual", strategy);
  entry.runs.unshift(run);
  entry.source.last_run_id = run.id;
  entries.set(id, entry);
  simulate(entry, run);
  return ok({ source: view(entry), run }, 201);
}

function refreshDirectory(): Reply {
  if (!operator) {
    return OPERATOR_ONLY;
  }
  const run = newRun(null, "directory", "manual", null);
  directoryRuns.unshift(run);
  setTimeout(() => {
    run.status = "succeeded";
    run.finished_at = Date.now();
    run.duration_ms = run.finished_at - run.queued_at;
    run.stats = { entries: 80, registered: 0 };
    run.updated_at = run.finished_at;
  }, RUN_SECONDS * 1000);
  return ok({ run }, 202);
}

const SOURCE_RE = /^\/api\/v1\/cloud-sources\/(csr_[A-Za-z0-9]+)$/;
const FOLLOW_RE = /^\/api\/v1\/cloud-sources\/(csr_[A-Za-z0-9]+)\/follow$/;
const RUNS_RE = /^\/api\/v1\/cloud-sources\/(csr_[A-Za-z0-9]+)\/runs$/;

export const routes: MockRoute[] = [
  (request) => {
    if (request.path !== "/api/v1/cloud-sources") {
      return null;
    }
    if (request.method === "GET") {
      return list(request);
    }
    return request.method === "POST" ? create(request.body) : null;
  },
  (request) => {
    const get = match(request, "GET", SOURCE_RE);
    if (get) {
      const entry = entries.get(get[0] ?? "");
      return entry
        ? ok({ source: view(entry), runs: entry.runs.slice(0, 10) })
        : NOT_FOUND;
    }
    const patch = match(request, "PATCH", SOURCE_RE);
    return patch ? update(patch[0] ?? "", request.body) : null;
  },
  (request) => {
    const on = match(request, "PUT", FOLLOW_RE);
    if (on) {
      return follow(on[0] ?? "", true);
    }
    const off = match(request, "DELETE", FOLLOW_RE);
    return off ? follow(off[0] ?? "", false) : null;
  },
  (request) => {
    const get = match(request, "GET", RUNS_RE);
    if (get) {
      const entry = entries.get(get[0] ?? "");
      return entry ? runsPage(request, entry.runs) : NOT_FOUND;
    }
    const post = match(request, "POST", RUNS_RE);
    return post ? startRun(post[0] ?? "", request.body) : null;
  },
  (request) => {
    if (
      request.path === "/api/v1/cloud-discovery/runs" &&
      request.method === "GET"
    ) {
      return runsPage(request, directoryRuns);
    }
    if (
      request.path === "/api/v1/cloud-discovery/refresh" &&
      request.method === "POST"
    ) {
      return refreshDirectory();
    }
    return null;
  },
];
