// The cloud catalog routes (05 §15, 24 §5): reads and follows for every
// signed-in user, catalog management for operators (`ADMIN_EMAILS`, D-39).
// Catalog rows are system data; follows are the caller's own rows.

import type {
  CloudPipeline,
  CloudSourceListResponse,
  CloudSourceView,
  CreateCloudSourceRequest,
  StartCloudRunRequest,
  UpdateCloudSourceRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import { CLOUD_DISPATCH_CRON } from "@pilihpendidikan/jobs-contracts/api";
import { parseStrategyConfig } from "@pilihpendidikan/jobs-contracts/cloud-config";
import { CLOUD_SOURCES_FILE } from "@pilihpendidikan/jobs-contracts/cloud-sources";
import type { CloudStrategy } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { CloudSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { RouteContext } from "../../core/context";
import {
  apiError,
  invalidRequest,
  notFound,
  revisionConflict,
} from "../../core/http";
import type { PageRequest } from "../../core/pagination";
import { pageOf } from "../../core/pagination";
import { GuardFailedError } from "../../repo/core/db";
import {
  followedSourceIds,
  followerCountOf,
  followerCounts,
  followStatement,
  isFollowing,
  unfollowStatement,
} from "../../repo/cloud/follows";
import { runCloudBatch } from "../../repo/cloud/postings";
import {
  latestRunsOf,
  liveDirectoryRun,
  liveRunOf,
  pageRuns,
} from "../../repo/cloud/runs";
import {
  findCloudSourcesByDomain,
  getCloudSource,
  getCloudSourceBySlug,
  insertCloudSourceStatement,
  listCloudSources,
  postingCountsBySource,
  postingCountsOf,
  revisionedUpdateStatements,
} from "../../repo/cloud/sources";
import { getState, STATE_KEYS } from "../../repo/cloud/state";
import { budgetMicroUsd, cloudAiEnabled, monthKey, spentThisMonth } from "./ai";
import {
  CloudQueueUnavailableError,
  queueDirectoryRefresh,
  queueProbe,
  queueScrape,
} from "./dispatch";
import { backfillFollow } from "./fanout";
import { ensureCatalogSeeded } from "./seed";
import { cloudUrlMessage, validateCloudUrl } from "./url";
import { statusOf, toCloudSourceView } from "./views";

type Ctx = RouteContext<unknown, unknown, unknown>;

/** The caller manages the catalog (24 §5.4). */
export function isOperator(c: Ctx): boolean {
  return c.caller.isAdmin === true;
}

function requireOperator(c: Ctx): void {
  if (!isOperator(c)) {
    throw apiError(
      "operator_required",
      "Only catalog operators (ADMIN_EMAILS) can change cloud sources."
    );
  }
}

function requirePipeline(c: Ctx): void {
  if (!c.flags.JOBS_CLOUD_DISCOVERY_ENABLED) {
    throw apiError(
      "policy_violation",
      "Cloud discovery is switched off (JOBS_CLOUD_DISCOVERY_ENABLED)."
    );
  }
}

function queueError(err: unknown): never {
  if (err instanceof CloudQueueUnavailableError) {
    throw apiError("upstream_unavailable", err.message);
  }
  throw err;
}

async function viewOf(
  c: Ctx,
  source: CloudSourceRecord
): Promise<CloudSourceView> {
  const [following, followers, jobs] = await Promise.all([
    isFollowing(c.db, c.scope, source.id),
    followerCountOf(c.db, source.id),
    postingCountsOf(c.db, source.id),
  ]);
  return toCloudSourceView(source, { following, followers, jobs }, c.now);
}

async function loadSource(c: Ctx, id: string): Promise<CloudSourceRecord> {
  const source = await getCloudSource(c.db, id);
  if (!source) {
    throw notFound("Cloud source not found.");
  }
  return source;
}

async function pipelineOf(c: Ctx): Promise<CloudPipeline> {
  const refreshed = await getState(c.db, STATE_KEYS.directoryRefreshedAt);
  return {
    enabled: c.flags.JOBS_CLOUD_DISCOVERY_ENABLED,
    ai_enabled: cloudAiEnabled(c.flags),
    schedule: CLOUD_DISPATCH_CRON,
    directory_url: CLOUD_SOURCES_FILE.directory.url,
    last_directory_refresh_at: refreshed ? Number(refreshed) : null,
    ai_budget: isOperator(c)
      ? {
          month: monthKey(c.now).slice(-7),
          spent_micro_usd: await spentThisMonth(c.db, c.now),
          budget_micro_usd: budgetMicroUsd(c.env),
        }
      : null,
  };
}

export interface ListCloudQuery {
  category?: string;
  following?: "0" | "1";
  q?: string;
  status?: string;
}

/** `GET /api/v1/cloud-sources`. */
export async function listCatalog(
  c: Ctx,
  query: ListCloudQuery
): Promise<CloudSourceListResponse> {
  await ensureCatalogSeeded(c.db, c.now);
  const [sources, followed, followers, jobs] = await Promise.all([
    listCloudSources(c.db),
    followedSourceIds(c.db, c.scope),
    followerCounts(c.db),
    postingCountsBySource(c.db),
  ]);
  const needle = query.q?.trim().toLowerCase() ?? "";
  const items = sources
    .filter((source) => {
      if (query.status && statusOf(source, c.now) !== query.status) {
        return false;
      }
      if (query.category && source.category !== query.category) {
        return false;
      }
      if (query.following === "1" && !followed.has(source.id)) {
        return false;
      }
      if (query.following === "0" && followed.has(source.id)) {
        return false;
      }
      return (
        needle === "" ||
        source.name.toLowerCase().includes(needle) ||
        source.canonical_domain.includes(needle) ||
        source.slug.includes(needle)
      );
    })
    .map((source) =>
      toCloudSourceView(
        source,
        {
          following: followed.has(source.id),
          followers: followers.get(source.id) ?? 0,
          jobs: jobs.get(source.id) ?? { total: 0, open: 0 },
        },
        c.now
      )
    );
  return {
    items,
    viewer: { operator: isOperator(c) },
    pipeline: await pipelineOf(c),
  };
}

/** `GET /api/v1/cloud-sources/{csr_id}`. */
export async function getCatalogDetail(c: Ctx, id: string) {
  const source = await loadSource(c, id);
  return {
    source: await viewOf(c, source),
    runs: await latestRunsOf(c.db, source.id, 10),
  };
}

function runPage(
  rows: Awaited<ReturnType<typeof pageRuns>>,
  page: PageRequest
) {
  return pageOf(rows, page.limit, (run) => [run.queued_at, run.id]);
}

function afterOf(page: PageRequest): [number, string] | null {
  if (!page.cursor) {
    return null;
  }
  const [at, id] = page.cursor;
  if (typeof at !== "number" || typeof id !== "string") {
    throw invalidRequest("Cursor does not match this list.");
  }
  return [at, id];
}

/** `GET /api/v1/cloud-sources/{csr_id}/runs`. */
export async function listSourceRuns(c: Ctx, id: string, page: PageRequest) {
  const source = await loadSource(c, id);
  const rows = await pageRuns(
    c.db,
    { sourceId: source.id },
    { after: afterOf(page), limit: page.limit + 1 }
  );
  return runPage(rows, page);
}

/** `GET /api/v1/cloud-discovery/runs`. */
export async function listDiscoveryRuns(c: Ctx, page: PageRequest) {
  const rows = await pageRuns(
    c.db,
    { kinds: ["directory", "probe"] },
    { after: afterOf(page), limit: page.limit + 1 }
  );
  return runPage(rows, page);
}

/** `PUT /api/v1/cloud-sources/{csr_id}/follow`. */
export async function followSource(c: Ctx, id: string) {
  const source = await loadSource(c, id);
  const already = await isFollowing(c.db, c.scope, source.id);
  await runCloudBatch(c.db, [followStatement(c.db, c.scope, source.id, c.now)]);
  const backfilled = already
    ? 0
    : await backfillFollow(c.env, c.db, c.scope, source.id, c.now);
  return { source: await viewOf(c, source), backfilled };
}

/** `DELETE /api/v1/cloud-sources/{csr_id}/follow` (inbox entries stay). */
export async function unfollowSource(c: Ctx, id: string) {
  const source = await loadSource(c, id);
  await runCloudBatch(c.db, [unfollowStatement(c.db, c.scope, source.id)]);
  return { source: await viewOf(c, source) };
}

function checkedStrategy(
  strategy: CloudStrategy,
  config: Record<string, unknown>
): Record<string, unknown> {
  const parsed = parseStrategyConfig(strategy, config);
  if (!parsed.ok) {
    throw invalidRequest(
      `strategy_config is not valid for ${strategy}.`,
      parsed.issues
    );
  }
  for (const key of ["url", "listing_url", "url_base"]) {
    const value = parsed.config[key];
    if (typeof value === "string") {
      const checked = validateCloudUrl(value);
      if (!checked.ok) {
        throw invalidRequest(
          `strategy_config.${key}: ${cloudUrlMessage(checked.problem)}`
        );
      }
    }
  }
  return parsed.config;
}

/** `POST /api/v1/cloud-sources` (operator). */
export async function createCatalogSource(
  c: Ctx,
  body: CreateCloudSourceRequest
) {
  requireOperator(c);
  requirePipeline(c);
  const checked = validateCloudUrl(body.url);
  if (!checked.ok) {
    throw apiError(
      checked.problem === "excluded" ? "unsupported_source" : "invalid_request",
      cloudUrlMessage(checked.problem)
    );
  }
  if (body.listing_url) {
    const listing = validateCloudUrl(body.listing_url);
    if (!listing.ok) {
      throw invalidRequest(`listing_url: ${cloudUrlMessage(listing.problem)}`);
    }
  }
  await ensureCatalogSeeded(c.db, c.now);
  const existing =
    (await getCloudSourceBySlug(c.db, checked.domain)) ??
    (await findCloudSourcesByDomain(c.db, checked.domain))[0];
  if (existing) {
    throw apiError(
      "duplicate",
      `${checked.domain} is already in the catalog as "${existing.name}".`,
      {
        details: { source_id: existing.id },
      }
    );
  }
  const strategy = body.strategy ?? "none";
  const strategyConfig = checkedStrategy(strategy, body.strategy_config ?? {});
  const record: CloudSourceRecord = {
    id: newId("csr", c.now),
    slug: checked.domain,
    name: body.name,
    homepage_url: checked.url,
    listing_url: body.listing_url ?? null,
    canonical_domain: checked.domain,
    category: body.category ?? "unknown",
    origin: "operator",
    directory_ref: null,
    description: null,
    strategy,
    strategy_config: strategyConfig,
    health: strategy === "none" ? "UNSUPPORTED" : "ACTIVE",
    status_reason: "Added by an operator; a probe run is checking the site.",
    enabled: false,
    priority: body.priority ?? 50,
    interval_minutes: body.interval_minutes ?? 120,
    rate_limit: {},
    auth_required: false,
    auth_note: null,
    terms_url: null,
    terms_note: null,
    ai_enabled: false,
    allow_browser: false,
    next_run_at: null,
    lease_id: null,
    lease_expires_at: null,
    last_run_id: null,
    last_run_status: null,
    last_run_at: null,
    last_success_at: null,
    last_error_class: null,
    last_error_message: null,
    consecutive_failures: 0,
    circuit_open_until: null,
    cursor_state: {},
    stats: {},
    user_modified: [
      "name",
      ...(body.strategy ? ["strategy", "strategy_config"] : []),
      ...(body.category ? ["category"] : []),
      ...(body.listing_url ? ["listing_url"] : []),
    ],
    revision: 1,
    created_at: c.now,
    updated_at: c.now,
  };
  await runCloudBatch(c.db, [insertCloudSourceStatement(c.db, record)]);
  const run = await queueProbe(
    c.env,
    c.db,
    record.id,
    "manual",
    c.now,
    c.scope.userId
  ).catch(queueError);
  return { source: await viewOf(c, record), run };
}

const EDITABLE = [
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

/** `PATCH /api/v1/cloud-sources/{csr_id}` (operator, base_revision). */
export async function updateCatalogSource(
  c: Ctx,
  id: string,
  body: UpdateCloudSourceRequest
) {
  requireOperator(c);
  const source = await loadSource(c, id);
  const base = c.baseRevision(body.base_revision);
  if (source.revision !== base) {
    throw revisionConflict(await viewOf(c, source));
  }
  const patch: Partial<CloudSourceRecord> = {};
  for (const key of EDITABLE) {
    if (body[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = body[key];
    }
  }
  if (body.listing_url) {
    const listing = validateCloudUrl(body.listing_url);
    if (!listing.ok) {
      throw invalidRequest(`listing_url: ${cloudUrlMessage(listing.problem)}`);
    }
  }
  const strategy = body.strategy ?? source.strategy;
  if (body.strategy !== undefined || body.strategy_config !== undefined) {
    patch.strategy_config = checkedStrategy(
      strategy,
      body.strategy_config ??
        (body.strategy === source.strategy ? source.strategy_config : {})
    );
  }
  if (patch.health === "ACTIVE") {
    // Re-activating clears the breaker and schedules the source now.
    patch.consecutive_failures = 0;
    patch.circuit_open_until = null;
    patch.next_run_at = c.now;
  }
  if (patch.enabled === true && !source.enabled) {
    patch.next_run_at = c.now;
  }
  const changed = Object.keys(patch).filter((key) =>
    (EDITABLE as readonly string[]).includes(key)
  );
  patch.user_modified = [...new Set([...source.user_modified, ...changed])];
  try {
    await runCloudBatch(
      c.db,
      revisionedUpdateStatements(c.db, source.id, base, patch, c.now)
    );
  } catch (err) {
    if (err instanceof GuardFailedError) {
      throw revisionConflict(await viewOf(c, await loadSource(c, id)));
    }
    throw err;
  }
  console.log(
    JSON.stringify({
      evt: "cloud_source_updated",
      request_id: c.requestId,
      source_id: source.id,
      operator: c.scope.userId,
      fields: changed,
    })
  );
  return { source: await viewOf(c, await loadSource(c, id)) };
}

/** `POST /api/v1/cloud-sources/{csr_id}/runs` (operator). */
export async function startCatalogRun(
  c: Ctx,
  id: string,
  body: StartCloudRunRequest
) {
  requireOperator(c);
  requirePipeline(c);
  const source = await loadSource(c, id);
  if (body.probe) {
    const live = await liveRunOf(c.db, source.id, "probe");
    if (live) {
      return { run: live };
    }
    return {
      run: await queueProbe(
        c.env,
        c.db,
        source.id,
        "manual",
        c.now,
        c.scope.userId
      ).catch(queueError),
    };
  }
  if (source.strategy === "none") {
    throw apiError(
      "policy_violation",
      "This source has no extraction strategy; configure one first."
    );
  }
  if (!source.enabled) {
    throw apiError(
      "policy_violation",
      "This source is disabled; enable it first."
    );
  }
  const live = await liveRunOf(c.db, source.id, "scrape");
  if (live) {
    return { run: live };
  }
  const extra = body.retry
    ? revisionedUpdateStatements(
        c.db,
        source.id,
        source.revision,
        {
          health: source.health === "UNSUPPORTED" ? source.health : "ACTIVE",
          status_reason: null,
          consecutive_failures: 0,
          circuit_open_until: null,
        },
        c.now
      )
    : [];
  if (
    !body.retry &&
    ["BLOCKED", "AUTH_REQUIRED", "UNSUPPORTED"].includes(source.health)
  ) {
    throw apiError(
      "policy_violation",
      `The source is ${source.health}; use retry to clear it deliberately.`
    );
  }
  try {
    const run = await queueScrape(
      c.env,
      c.db,
      source,
      body.retry ? "retry" : "manual",
      c.now,
      c.scope.userId,
      extra
    );
    return { run };
  } catch (err) {
    if (err instanceof GuardFailedError) {
      throw revisionConflict(await viewOf(c, await loadSource(c, id)));
    }
    return queueError(err);
  }
}

/** `POST /api/v1/cloud-discovery/refresh` (operator). */
export async function refreshDirectory(c: Ctx) {
  requireOperator(c);
  requirePipeline(c);
  const live = await liveDirectoryRun(c.db);
  if (live) {
    return { run: live };
  }
  return {
    run: await queueDirectoryRefresh(
      c.env,
      c.db,
      "manual",
      c.now,
      c.scope.userId
    ).catch(queueError),
  };
}
