// `scrape_source` and `probe_source` handlers of the `jobs-scrape` queue
// (24 §6.2–§6.6, §7.2).
//
// Scrape, per message (at-least-once delivery; every step is idempotent):
//   1. flag off / run already final / source gone or not schedulable → the
//      run is closed (`skipped` / `failed`) and the message acked;
//   2. lease the source (`lease_id` = the run id, re-entrant for a redelivery
//      of the same run); another live run → this run is `skipped`;
//   3. call the scraper with the stored checkpoint (`cursor_state`);
//      transient failures (network, timeout, 5xx, scraper unreachable) with
//      no items retry with jittered exponential backoff (≤ 3 retries), the
//      checkpoint saved so the retry resumes;
//   4. ingest items (shared postings), then the AI fallback when allowed;
//   5. a complete, error-free read expires postings missing twice;
//   6. new postings go to followers' inboxes and scoring;
//   7. ONE write closes the run (stats, warnings, log) and updates the
//      source (health, breaker, schedule, stats, cursor), fenced on the lease.

import type {
  CloudQueueMessage,
  ProbeResponse,
} from "@pilihpendidikan/jobs-contracts/cloud";
import { SCRAPER_PROTOCOL_VERSION } from "@pilihpendidikan/jobs-contracts/cloud";
import type {
  CloudLogEntry,
  CloudRunError,
  CloudWarning,
} from "@pilihpendidikan/jobs-contracts/cloud-config";
import {
  CLOUD_LOG_MAX,
  CLOUD_RATE_LIMIT_DEFAULTS,
} from "@pilihpendidikan/jobs-contracts/cloud-config";
import type {
  CloudRunRecord,
  CloudSourceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  acquireLease,
  applySystemUpdate,
  getCloudSource,
  systemUpdateStatement,
} from "../repo/cloud/sources";
import {
  applyCloudRunUpdate,
  getCloudRun,
  updateCloudRunStatement,
} from "../repo/cloud/runs";
import { expireSourcePostings, runCloudBatch } from "../repo/cloud/postings";
import {
  CloudAiBudget,
  classifyWithAi,
  cloudAiEnabled,
  extractWithAi,
  minConfidence,
} from "../services/cloud/ai";
import { decideFromProbe } from "../services/cloud/classify";
import { linkFollowers } from "../services/cloud/fanout";
import {
  finishOutcome,
  isTransient,
  LEASE_TTL_MS,
  MAX_DELIVERIES,
  PROBE_DEADLINE_MS,
  retryDelaySeconds,
  SCRAPE_DEADLINE_MS,
} from "../services/cloud/health";
import type { IngestResult } from "../services/cloud/ingest";
import { ingestItems, mergeWarnings } from "../services/cloud/ingest";
import type { ScrapeEnvelope } from "../services/cloud/scraper-client";
import {
  probe as probeSite,
  ScraperUnavailableError,
  scrape,
} from "../services/cloud/scraper-client";
import type { CloudContext, CloudOutcome } from "./types";
import { CLOUD_ACK, logLine } from "./types";

type ScrapeMessage = Extract<CloudQueueMessage, { type: "scrape_source" }>;
type ProbeMessage = Extract<CloudQueueMessage, { type: "probe_source" }>;

const FINAL_STATUSES: ReadonlySet<CloudRunRecord["status"]> = new Set([
  "succeeded",
  "partial",
  "failed",
  "blocked",
  "auth_required",
  "rate_limited",
  "unsupported",
  "skipped",
]);
const LIVE: CloudRunRecord["status"][] = ["queued", "running"];

function capLog(entries: readonly CloudLogEntry[]): CloudLogEntry[] {
  if (entries.length <= CLOUD_LOG_MAX) {
    return [...entries];
  }
  // Keep the start and the end of a long run.
  return [
    ...entries.slice(0, 40),
    ...entries.slice(entries.length - (CLOUD_LOG_MAX - 40)),
  ];
}

async function closeRun(
  qc: CloudContext,
  runId: string,
  status: CloudRunRecord["status"],
  message: string,
  extra: Partial<CloudRunRecord> = {}
): Promise<void> {
  const now = qc.now();
  await applyCloudRunUpdate(
    qc.db,
    runId,
    {
      status,
      finished_at: now,
      error_message: message,
      log: [
        logLine(now, status === "skipped" ? "info" : "warn", status, message),
      ],
      ...extra,
    },
    now,
    LIVE
  );
}

/** Loads the message's run; null (ack) when it is gone or already final. */
async function liveRun(
  qc: CloudContext,
  runId: string
): Promise<CloudRunRecord | null> {
  const run = await getCloudRun(qc.db, runId);
  if (!run || FINAL_STATUSES.has(run.status)) {
    qc.log("cloud_run_not_live", { run_id: runId, status: run?.status });
    return null;
  }
  return run;
}

function scrapeRequestOf(
  source: CloudSourceRecord,
  runId: string,
  aiFallback: boolean
) {
  return {
    v: SCRAPER_PROTOCOL_VERSION,
    run_id: runId,
    source: {
      id: source.id,
      slug: source.slug,
      name: source.name,
      homepage_url: source.homepage_url,
      listing_url: source.listing_url,
      canonical_domain: source.canonical_domain,
      strategy: source.strategy,
      strategy_config: source.strategy_config,
      rate_limit: { ...CLOUD_RATE_LIMIT_DEFAULTS, ...source.rate_limit },
      allow_browser: source.allow_browser,
    },
    cursor_state: source.cursor_state,
    deadline_ms: SCRAPE_DEADLINE_MS,
    ai_fallback: aiFallback,
  } as const;
}

async function retryLater(
  qc: CloudContext,
  run: CloudRunRecord,
  source: CloudSourceRecord,
  error: CloudRunError,
  log: CloudLogEntry[],
  cursorState: CloudSourceRecord["cursor_state"] | null
): Promise<CloudOutcome> {
  const delaySeconds = retryDelaySeconds(qc.attempts, qc.random);
  const now = qc.now();
  log.push(
    logLine(
      now,
      "warn",
      "retry_scheduled",
      `${error.error_class}: ${error.message} — retry ${qc.attempts} of ${MAX_DELIVERIES - 1} in ${delaySeconds} s`
    )
  );
  // Release the lease (a scheduled tick may run meanwhile; the retry
  // re-leases) and keep the checkpoint so the retry resumes.
  await runCloudBatch(qc.db, [
    systemUpdateStatement(
      qc.db,
      source.id,
      {
        lease_id: null,
        lease_expires_at: null,
        ...(cursorState ? { cursor_state: cursorState } : {}),
      },
      now,
      { leaseId: run.id }
    ),
    updateCloudRunStatement(
      qc.db,
      run.id,
      {
        status: "queued",
        attempt: qc.attempts + 1,
        error_class: error.error_class,
        error_message: error.message.slice(0, 500),
        log: capLog(log),
      },
      now,
      LIVE
    ),
  ]);
  return { action: "retry", delaySeconds };
}

interface Collected {
  aiCalls: number;
  aiCostMicroUsd: number;
  aiItems: number;
  closed: number;
  ingest: IngestResult;
  linked: number;
  warnings: CloudWarning[];
}

interface AiOutcome {
  calls: number;
  costMicroUsd: number;
  items: number;
}

const NO_AI: AiOutcome = { calls: 0, costMicroUsd: 0, items: 0 };

function addIngest(into: IngestResult, more: IngestResult): void {
  into.found += more.found;
  into.new += more.new;
  into.updated += more.updated;
  into.unchanged += more.unchanged;
  into.invalid += more.invalid;
  into.newPostingIds.push(...more.newPostingIds);
}

/** The AI fallback over the scraper's candidates (24 §4.3). */
async function runAiFallback(
  qc: CloudContext,
  source: CloudSourceRecord,
  run: CloudRunRecord,
  response: ScrapeEnvelope,
  ingest: IngestResult,
  warnings: CloudWarning[],
  log: CloudLogEntry[]
): Promise<AiOutcome> {
  const budget = new CloudAiBudget(qc.db, qc.env, qc.now());
  const ai = await extractWithAi(
    qc.ai(),
    budget,
    source,
    response.ai_candidates,
    { minConfidence: minConfidence(qc.env), now: qc.now() }
  );
  warnings.push(...ai.warnings);
  let items = 0;
  if (ai.items.length > 0) {
    const aiIngest = await ingestItems(qc.db, {
      items: ai.items,
      now: qc.now(),
      runId: run.id,
      source,
    });
    items = aiIngest.new + aiIngest.updated + aiIngest.unchanged;
    addIngest(ingest, aiIngest);
  }
  log.push(
    logLine(
      qc.now(),
      "info",
      "ai_fallback",
      `${response.ai_candidates.length} page(s) read by AI, ${ai.items.length} job(s) accepted, ${budget.calls} call(s)`
    )
  );
  return { calls: budget.calls, costMicroUsd: budget.costMicroUsd, items };
}

async function expireAfterCompleteRead(
  qc: CloudContext,
  source: CloudSourceRecord,
  seenSince: number,
  log: CloudLogEntry[]
): Promise<number> {
  const closed = (
    await expireSourcePostings(qc.db, source.id, seenSince, qc.now())
  ).length;
  if (closed > 0) {
    log.push(
      logLine(
        qc.now(),
        "info",
        "expired",
        `${closed} posting(s) closed: missing from two complete runs or past their expiry date`
      )
    );
  }
  return closed;
}

async function collect(
  qc: CloudContext,
  source: CloudSourceRecord,
  run: CloudRunRecord,
  response: ScrapeEnvelope,
  aiAllowed: boolean,
  log: CloudLogEntry[]
): Promise<Collected> {
  const startedAt = run.started_at ?? qc.now();
  const ingest = await ingestItems(qc.db, {
    items: response.items,
    now: qc.now(),
    runId: run.id,
    source,
  });
  log.push(
    logLine(
      qc.now(),
      "info",
      "ingested",
      `${ingest.found} found, ${ingest.new} new, ${ingest.updated} updated, ${ingest.unchanged} unchanged, ${ingest.duplicates} duplicates, ${ingest.invalid} invalid`
    )
  );
  const warnings = [...response.warnings, ...ingest.warnings];
  const candidates = response.ai_candidates.length;
  let ai = NO_AI;
  if (aiAllowed && candidates > 0) {
    ai = await runAiFallback(qc, source, run, response, ingest, warnings, log);
  } else if (candidates > 0) {
    warnings.push({
      code: "ai_skipped",
      message:
        "The scraper found pages only AI could read, but AI extraction is off for this source.",
      count: candidates,
    });
  }
  const closed =
    response.complete && !response.error
      ? await expireAfterCompleteRead(qc, source, startedAt, log)
      : 0;
  const linked = await linkFollowers(
    qc.env,
    qc.db,
    source.id,
    ingest.newPostingIds,
    qc.now()
  );
  if (linked > 0) {
    log.push(
      logLine(
        qc.now(),
        "info",
        "fanout",
        `${linked} inbox entr${linked === 1 ? "y" : "ies"} created for followers`
      )
    );
  }
  return {
    ingest,
    warnings: mergeWarnings(warnings),
    aiCalls: ai.calls,
    aiCostMicroUsd: ai.costMicroUsd,
    aiItems: ai.items,
    closed,
    linked,
  };
}

const EMPTY_INGEST: IngestResult = {
  found: 0,
  new: 0,
  updated: 0,
  unchanged: 0,
  duplicates: 0,
  invalid: 0,
  newPostingIds: [],
  confidenceAvg: null,
  warnings: [],
};

const EMPTY_SCRAPE_STATS: ScrapeEnvelope["stats"] = {
  pages: 0,
  postings_found: 0,
  duplicates: 0,
  invalid: 0,
  relocated: 0,
  robots_skipped: 0,
  details_fetched: 0,
  elapsed_ms: 0,
  fetch_mode: null,
};

function runStatsOf(
  response: ScrapeEnvelope | null,
  collected: Collected | null
): CloudRunRecord["stats"] {
  const ingest = collected?.ingest ?? EMPTY_INGEST;
  const scraped = response?.stats ?? EMPTY_SCRAPE_STATS;
  return {
    pages: scraped.pages,
    postings_found: ingest.found,
    new: ingest.new,
    updated: ingest.updated,
    unchanged: ingest.unchanged,
    duplicates: ingest.duplicates + scraped.duplicates,
    invalid: ingest.invalid + scraped.invalid,
    closed: collected?.closed ?? 0,
    relocated: scraped.relocated,
    robots_skipped: scraped.robots_skipped,
    linked: collected?.linked ?? 0,
    ai_calls: collected?.aiCalls ?? 0,
    ai_items: collected?.aiItems ?? 0,
    ai_cost_micro_usd: collected?.aiCostMicroUsd ?? 0,
    ...(ingest.confidenceAvg === null
      ? {}
      : { confidence_avg: ingest.confidenceAvg }),
    scraper_ms: scraped.elapsed_ms,
  };
}

function engineVersionOf(response: ScrapeEnvelope | null): string | null {
  if (!response) {
    return null;
  }
  const { engine } = response;
  return [
    `pilih-scraper ${engine.scraper}`,
    engine.pilih_jobs ? `pilih-jobs ${engine.pilih_jobs}` : null,
    engine.scrapling ? `scrapling ${engine.scrapling}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function finishLine(
  now: number,
  status: CloudRunRecord["status"],
  error: CloudRunError | null,
  durationMs: number
): CloudLogEntry {
  if (!error) {
    return logLine(
      now,
      "info",
      "finished",
      `${status} in ${Math.round(durationMs / 100) / 10} s`
    );
  }
  return logLine(
    now,
    "error",
    "finished",
    `${status}: ${error.error_class} — ${error.message}`,
    error.http_status ? { http_status: error.http_status } : {}
  );
}

async function finish(
  qc: CloudContext,
  source: CloudSourceRecord,
  run: CloudRunRecord,
  response: ScrapeEnvelope | null,
  error: CloudRunError | null,
  collected: Collected | null,
  log: CloudLogEntry[]
): Promise<void> {
  const now = qc.now();
  const durationMs = Math.max(0, now - (run.started_at ?? now));
  const ingest = collected?.ingest ?? EMPTY_INGEST;
  const outcome = finishOutcome(
    source,
    run,
    {
      error,
      hadItems: ingest.new + ingest.updated + ingest.unchanged > 0,
      durationMs,
      found: ingest.found,
      newCount: ingest.new,
      confidenceAvg: ingest.confidenceAvg,
      warnings: collected?.warnings.length ?? 0,
      aiCalls: collected?.aiCalls ?? 0,
    },
    now
  );
  log.push(finishLine(now, outcome.runStatus, error, durationMs));
  const sourcePatch = response
    ? { ...outcome.patch, cursor_state: response.cursor_state }
    : outcome.patch;
  await runCloudBatch(qc.db, [
    systemUpdateStatement(qc.db, source.id, sourcePatch, now, {
      leaseId: run.id,
    }),
    updateCloudRunStatement(
      qc.db,
      run.id,
      {
        status: outcome.runStatus,
        finished_at: now,
        duration_ms: durationMs,
        attempt: qc.attempts,
        stats: runStatsOf(response, collected),
        error_class: error?.error_class ?? null,
        error_message: error ? error.message.slice(0, 500) : null,
        http_status: error?.http_status ?? null,
        warnings: collected?.warnings ?? [],
        log: capLog(log),
        engine_version: engineVersionOf(response),
      },
      now,
      LIVE
    ),
  ]);
  qc.log("cloud_scrape_finished", {
    source_id: source.id,
    run_id: run.id,
    status: outcome.runStatus,
    error_class: error?.error_class ?? null,
    found: ingest.found,
    new: ingest.new,
    duration_ms: durationMs,
  });
}

const PIPELINE_OFF =
  "Cloud discovery is switched off (JOBS_CLOUD_DISCOVERY_ENABLED).";

/** The run and its source, or null after closing a run that cannot go on. */
async function admit(
  qc: CloudContext,
  runId: string,
  sourceId: string
): Promise<{ run: CloudRunRecord; source: CloudSourceRecord } | null> {
  const run = await liveRun(qc, runId);
  if (!run) {
    return null;
  }
  if (!qc.flags.JOBS_CLOUD_DISCOVERY_ENABLED) {
    await closeRun(qc, runId, "skipped", PIPELINE_OFF);
    return null;
  }
  const source = await getCloudSource(qc.db, sourceId);
  if (!source) {
    await closeRun(qc, runId, "failed", "The source no longer exists.");
    return null;
  }
  return { run, source };
}

function schedulable(source: CloudSourceRecord): boolean {
  return (
    source.enabled &&
    source.strategy !== "none" &&
    source.health !== "UNSUPPORTED"
  );
}

/** Marks the run running and the source leased; returns the run log. */
async function startScrape(
  qc: CloudContext,
  run: CloudRunRecord,
  source: CloudSourceRecord
): Promise<{ log: CloudLogEntry[]; running: CloudRunRecord }> {
  const startedAt = run.started_at ?? qc.now();
  const log: CloudLogEntry[] = [
    ...run.log,
    logLine(
      qc.now(),
      "info",
      "started",
      `Attempt ${qc.attempts}: ${source.strategy} on ${source.canonical_domain}`
    ),
  ];
  await applyCloudRunUpdate(
    qc.db,
    run.id,
    {
      status: "running",
      started_at: startedAt,
      attempt: qc.attempts,
      strategy: source.strategy,
    },
    qc.now(),
    LIVE
  );
  await applySystemUpdate(
    qc.db,
    source.id,
    { last_run_id: run.id, last_run_status: "running", last_run_at: qc.now() },
    qc.now(),
    { leaseId: run.id }
  );
  return { log, running: { ...run, status: "running", started_at: startedAt } };
}

function unavailable(err: unknown): CloudRunError {
  return {
    error_class: "engine_unavailable",
    message:
      err instanceof ScraperUnavailableError
        ? err.message
        : "The scraper call failed.",
    http_status: err instanceof ScraperUnavailableError ? err.status : null,
  };
}

function shouldRetry(qc: CloudContext, response: ScrapeEnvelope): boolean {
  const nothing =
    response.items.length === 0 && response.ai_candidates.length === 0;
  return (
    response.error !== null &&
    isTransient(response.error.error_class) &&
    nothing &&
    qc.attempts < MAX_DELIVERIES
  );
}

/** A read without a stop that still produced nothing means the layout changed. */
function effectiveError(
  response: ScrapeEnvelope,
  collected: Collected
): CloudRunError | null {
  if (
    !response.error &&
    collected.ingest.found === 0 &&
    response.stats.pages > 0
  ) {
    return {
      error_class: "parse_error",
      message: "The pages were read but no job could be extracted.",
    };
  }
  return response.error;
}

/** `scrape_source`: one source, one run. */
export async function handleScrape(
  qc: CloudContext<ScrapeMessage>
): Promise<CloudOutcome> {
  const admitted = await admit(qc, qc.message.run_id, qc.message.source_id);
  if (!admitted) {
    return CLOUD_ACK;
  }
  const { run, source } = admitted;
  if (!schedulable(source)) {
    await closeRun(
      qc,
      run.id,
      "skipped",
      "The source is disabled, unsupported or has no strategy."
    );
    return CLOUD_ACK;
  }
  const leased = await acquireLease(
    qc.db,
    source.id,
    run.id,
    qc.now(),
    LEASE_TTL_MS
  );
  if (!leased) {
    await closeRun(
      qc,
      run.id,
      "skipped",
      `Another run of this source is in progress (${source.last_run_id ?? "unknown"}); runs never overlap.`
    );
    return CLOUD_ACK;
  }
  const { log, running } = await startScrape(qc, run, leased);
  const aiAllowed = cloudAiEnabled(qc.flags) && leased.ai_enabled;
  let response: ScrapeEnvelope;
  try {
    response = await scrape(qc.env, scrapeRequestOf(leased, run.id, aiAllowed));
  } catch (err) {
    const error = unavailable(err);
    if (qc.attempts < MAX_DELIVERIES) {
      return await retryLater(qc, running, leased, error, log, null);
    }
    await finish(qc, leased, running, null, error, null, log);
    return CLOUD_ACK;
  }
  log.push(...response.log);
  if (shouldRetry(qc, response) && response.error) {
    return await retryLater(
      qc,
      running,
      leased,
      response.error,
      log,
      response.cursor_state
    );
  }
  const collected = await collect(
    qc,
    leased,
    running,
    response,
    aiAllowed,
    log
  );
  const error = effectiveError(response, collected);
  await finish(qc, leased, running, response, error, collected, log);
  return CLOUD_ACK;
}

const PROBE_RUN_STATUS: Readonly<
  Record<CloudSourceRecord["health"], CloudRunRecord["status"]>
> = {
  ACTIVE: "succeeded",
  BLOCKED: "blocked",
  AUTH_REQUIRED: "auth_required",
  UNSUPPORTED: "unsupported",
  FAILED: "failed",
  RATE_LIMITED: "rate_limited",
};

/** The source write of a probe; operator-edited fields are never touched. */
function probePatch(
  source: CloudSourceRecord,
  decision: ReturnType<typeof decideFromProbe>,
  category: CloudSourceRecord["category"]
): Partial<CloudSourceRecord> {
  const locked = new Set(source.user_modified);
  const patch: Partial<CloudSourceRecord> = {
    health: decision.health,
    status_reason: decision.statusReason,
    auth_required: decision.authRequired || source.auth_required,
  };
  if (!locked.has("category")) {
    patch.category = category;
  }
  if (
    decision.strategy &&
    source.strategy === "none" &&
    !locked.has("strategy")
  ) {
    patch.strategy = decision.strategy;
    patch.strategy_config = decision.strategyConfig ?? {};
  }
  // Auto-enable only a verified feed, and never a source an operator switched.
  if (!locked.has("enabled")) {
    patch.enabled = decision.enabled;
  }
  return patch;
}

async function categoryOf(
  qc: CloudContext,
  result: ProbeResponse,
  decided: CloudSourceRecord["category"],
  url: string
): Promise<CloudSourceRecord["category"]> {
  if (decided !== "unknown" || !result.reachable || !cloudAiEnabled(qc.flags)) {
    return decided;
  }
  const budget = new CloudAiBudget(qc.db, qc.env, qc.now());
  return (
    (await classifyWithAi(qc.ai(), budget, {
      url: result.final_url ?? url,
      title: result.title,
      text: result.text_excerpt,
    })) ?? "unknown"
  );
}

/** `probe_source`: classify a site (new directory entry, operator add, re-probe). */
export async function handleProbe(
  qc: CloudContext<ProbeMessage>
): Promise<CloudOutcome> {
  const admitted = await admit(qc, qc.message.run_id, qc.message.source_id);
  if (!admitted) {
    return CLOUD_ACK;
  }
  const { run, source } = admitted;
  const startedAt = qc.now();
  await applyCloudRunUpdate(
    qc.db,
    run.id,
    { status: "running", started_at: startedAt, attempt: qc.attempts },
    startedAt,
    LIVE
  );
  const url = source.listing_url ?? source.homepage_url;
  let result: ProbeResponse;
  try {
    result = await probeSite(
      qc.env,
      { v: SCRAPER_PROTOCOL_VERSION, url },
      PROBE_DEADLINE_MS
    );
  } catch (err) {
    const { message } = unavailable(err);
    if (qc.attempts < MAX_DELIVERIES) {
      await applyCloudRunUpdate(
        qc.db,
        run.id,
        { status: "queued", attempt: qc.attempts + 1, error_message: message },
        qc.now(),
        LIVE
      );
      return {
        action: "retry",
        delaySeconds: retryDelaySeconds(qc.attempts, qc.random),
      };
    }
    await closeRun(qc, run.id, "failed", message, {
      error_class: "engine_unavailable",
    });
    return CLOUD_ACK;
  }
  const decision = decideFromProbe(result);
  const category = await categoryOf(qc, result, decision.category, url);
  const now = qc.now();
  const log: CloudLogEntry[] = [
    ...result.log,
    logLine(
      now,
      "info",
      "classified",
      `${category} → ${decision.health}: ${decision.statusReason}`
    ),
  ];
  await runCloudBatch(qc.db, [
    systemUpdateStatement(
      qc.db,
      source.id,
      probePatch(source, decision, category),
      now
    ),
    updateCloudRunStatement(
      qc.db,
      run.id,
      {
        status: PROBE_RUN_STATUS[decision.health],
        finished_at: now,
        duration_ms: now - startedAt,
        http_status: result.http_status,
        error_class: result.error?.error_class ?? null,
        error_message: result.error ? result.error.message.slice(0, 500) : null,
        stats: { pages: 1 },
        log: capLog(log),
        engine_version: `pilih-scraper ${result.engine.scraper}`,
      },
      now,
      LIVE
    ),
  ]);
  qc.log("cloud_probe_finished", {
    source_id: source.id,
    run_id: run.id,
    health: decision.health,
    category,
  });
  return CLOUD_ACK;
}
