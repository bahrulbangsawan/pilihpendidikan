// Run outcome → source health, schedule and breaker (24 §6.3). Pure
// functions; the consumer applies their result in one write.
//
//   error class                         run status      health          retry
//   network, timeout, http_5xx,         (retried)       FAILED after    yes (≤ 3, backoff)
//     source_unavailable,                               the last try
//     engine_unavailable
//   access_denied, challenge_detected,  blocked         BLOCKED         no; paused until an
//     robots_disallowed, policy_blocked                                 operator retries
//   rate_limited                        rate_limited    RATE_LIMITED    next ≥ Retry-After, ≥ 2 h
//   auth_required                       auth_required   AUTH_REQUIRED   no; paused
//   everything else (layout, config)    failed          FAILED          next scheduled run
//
// Three consecutive failures open the breaker for min(24 h, 1 h · 2^(n−3)).

import type {
  CloudErrorClass,
  CloudRunStatus,
  CloudSourceHealth,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { CloudRunError } from "@pilihpendidikan/jobs-contracts/cloud-config";
import type {
  CloudSourceRecord,
  CloudRunRecord,
} from "@pilihpendidikan/jobs-contracts/records";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A scrape's lease: longer than the consumer's deadline plus the upsert. */
export const LEASE_TTL_MS = 15 * MINUTE;
/** Wall-clock budget handed to the scraper. */
export const SCRAPE_DEADLINE_MS = 240_000;
/** Probe / directory budgets. */
export const PROBE_DEADLINE_MS = 90_000;
/** Deliveries per message: the first plus `max_retries: 3`. */
export const MAX_DELIVERIES = 4;
export const BREAKER_THRESHOLD = 3;
export const BREAKER_MAX_MS = 24 * HOUR;
export const RATE_LIMIT_MIN_PAUSE_MS = 2 * HOUR;

export const TRANSIENT_CLASSES: ReadonlySet<CloudErrorClass> = new Set([
  "network",
  "timeout",
  "http_5xx",
  "source_unavailable",
  "engine_unavailable",
]);

const BLOCKING_CLASSES: ReadonlySet<CloudErrorClass> = new Set([
  "access_denied",
  "challenge_detected",
  "robots_disallowed",
  "policy_blocked",
]);

/** `min(900, 60 · 2^(attempt−1)) · U(0.8, 1.2)` seconds (24 §6.3). */
export function retryDelaySeconds(
  attempt: number,
  random: () => number = Math.random
): number {
  const base = Math.min(900, 60 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** When the breaker reopens scheduling, or null while it stays closed. */
export function breakerOpenUntil(
  consecutiveFailures: number,
  now: number
): number | null {
  if (consecutiveFailures < BREAKER_THRESHOLD) {
    return null;
  }
  const exponent = consecutiveFailures - BREAKER_THRESHOLD;
  return now + Math.min(BREAKER_MAX_MS, HOUR * 2 ** Math.min(exponent, 10));
}

export function isTransient(errorClass: CloudErrorClass): boolean {
  return TRANSIENT_CLASSES.has(errorClass);
}

export interface Disposition {
  health: CloudSourceHealth;
  runStatus: CloudRunStatus;
}

/** Health and run status of a fatal (non-retried) error. */
export function dispositionOf(errorClass: CloudErrorClass): Disposition {
  if (BLOCKING_CLASSES.has(errorClass)) {
    return { health: "BLOCKED", runStatus: "blocked" };
  }
  if (errorClass === "rate_limited") {
    return { health: "RATE_LIMITED", runStatus: "rate_limited" };
  }
  if (errorClass === "auth_required") {
    return { health: "AUTH_REQUIRED", runStatus: "auth_required" };
  }
  return { health: "FAILED", runStatus: "failed" };
}

function hostOf(url: string | null | undefined, fallback: string): string {
  if (!url) {
    return fallback;
  }
  try {
    return new URL(url).host;
  } catch {
    return fallback;
  }
}

function at(ms: number): string {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

/**
 * The actionable note shown with a failed source (24 §8.6): what happened,
 * what Pilih will and will not do, what an operator can do.
 */
export function diagnosticMessage(
  error: CloudRunError,
  source: Pick<CloudSourceRecord, "canonical_domain" | "strategy">,
  nextAttemptAt: number | null
): string {
  const host = hostOf(error.url, source.canonical_domain);
  const status = error.http_status ? ` (HTTP ${error.http_status})` : "";
  const detail = error.message ? ` Detail: ${error.message}` : "";
  switch (error.error_class) {
    case "challenge_detected":
      return `${host} showed a bot challenge to our honest crawler${status}. Pilih never solves or bypasses challenges; the source is paused until an operator retries.${detail}`;
    case "access_denied":
      return `${host} refused access${status}. The source is paused; check whether the site offers an official feed or API, then retry.${detail}`;
    case "robots_disallowed":
      return `robots.txt on ${host} disallows this page for our crawler, so it is not fetched. Use a path robots.txt allows (a feed or API), or disable the source.${detail}`;
    case "policy_blocked":
      return `Pilih's discovery policy refused the request to ${host}: an excluded platform (D-17) or an address that is not public (SSRF guard).${detail}`;
    case "rate_limited":
      return `${host} asked us to slow down${status}.${nextAttemptAt ? ` Next attempt after ${at(nextAttemptAt)}.` : ""}${detail}`;
    case "auth_required":
      return `Listings on ${host} need a signed-in account${status}. Pilih does not log in or collect credentials for discovery; follow the board on the site itself or use its official feed if it has one.${detail}`;
    case "parse_error":
    case "schema_invalid":
    case "selector_drift":
    case "unsupported_content":
      return `The page layout or feed format on ${host} changed: the ${source.strategy} extraction found no usable jobs. Update the strategy or selectors.${detail}`;
    case "invalid_config":
      return `The ${source.strategy} configuration of this source is not usable. Fix the strategy config.${detail}`;
    case "source_closed":
    case "not_found":
      return `The listing page on ${host} no longer exists${status}. Update the listing URL or disable the source.${detail}`;
    case "engine_unavailable":
      return `The scraper service did not answer. The run will be retried automatically.${detail}`;
    case "network":
    case "timeout":
    case "http_5xx":
    case "source_unavailable":
      return `${host} could not be reached reliably${status}. Retried with backoff; the next scheduled run tries again.${detail}`;
    default:
      return `${error.error_class}${status}.${detail}`;
  }
}

export interface RunSummary {
  aiCalls: number;
  confidenceAvg: number | null;
  durationMs: number;
  /** Null on success. */
  error: CloudRunError | null;
  found: number;
  /** Items were stored despite the error (partial run). */
  hadItems: boolean;
  newCount: number;
  warnings: number;
}

export interface SourceOutcome {
  patch: Partial<CloudSourceRecord>;
  runStatus: CloudRunStatus;
}

function statsAfter(
  source: CloudSourceRecord,
  summary: RunSummary,
  success: boolean
): CloudSourceRecord["stats"] {
  const stats = source.stats ?? {};
  return {
    ...stats,
    runs: (stats.runs ?? 0) + 1,
    successes: (stats.successes ?? 0) + (success ? 1 : 0),
    failures: (stats.failures ?? 0) + (success ? 0 : 1),
    total_duration_ms: (stats.total_duration_ms ?? 0) + summary.durationMs,
    jobs_found_last_run: summary.found,
    jobs_new_last_run: summary.newCount,
    ...(summary.confidenceAvg === null
      ? {}
      : { confidence_avg_last_run: summary.confidenceAvg }),
    warnings_last_run: summary.warnings,
    ai_calls: (stats.ai_calls ?? 0) + summary.aiCalls,
  };
}

/**
 * The source write after a finished scrape (success, partial or a final
 * failure) and the run's status.
 */
export function finishOutcome(
  source: CloudSourceRecord,
  run: Pick<CloudRunRecord, "id">,
  summary: RunSummary,
  now: number
): SourceOutcome {
  const interval = source.interval_minutes * MINUTE;
  const base: Partial<CloudSourceRecord> = {
    lease_id: null,
    lease_expires_at: null,
    last_run_id: run.id,
    last_run_at: now,
  };
  const error = summary.error;
  // A transient stop after items were stored still counts as a good run.
  const success =
    error === null || (summary.hadItems && isTransient(error.error_class));
  if (success) {
    const runStatus: CloudRunStatus = error ? "partial" : "succeeded";
    return {
      runStatus,
      patch: {
        ...base,
        health: "ACTIVE",
        status_reason: null,
        last_run_status: runStatus,
        last_success_at: now,
        last_error_class: error?.error_class ?? null,
        last_error_message: error
          ? diagnosticMessage(error, source, null)
          : null,
        consecutive_failures: 0,
        circuit_open_until: null,
        next_run_at: Math.max(source.next_run_at ?? 0, now + interval),
        stats: statsAfter(source, summary, true),
      },
    };
  }
  const failures = source.consecutive_failures + 1;
  const disposition = isTransient(error.error_class)
    ? { health: "FAILED" as const, runStatus: "failed" as const }
    : dispositionOf(error.error_class);
  let nextRunAt = Math.max(source.next_run_at ?? 0, now + interval);
  if (disposition.health === "RATE_LIMITED") {
    const retryAfterMs = (error.retry_after_s ?? 0) * 1000;
    nextRunAt = now + Math.max(RATE_LIMIT_MIN_PAUSE_MS, retryAfterMs, interval);
  }
  const runStatus =
    summary.hadItems && disposition.runStatus === "failed"
      ? "partial"
      : disposition.runStatus;
  return {
    runStatus,
    patch: {
      ...base,
      health: disposition.health,
      status_reason: diagnosticMessage(error, source, nextRunAt),
      last_run_status: runStatus,
      last_error_class: error.error_class,
      last_error_message: error.message.slice(0, 500),
      consecutive_failures: failures,
      circuit_open_until: breakerOpenUntil(failures, now),
      next_run_at: nextRunAt,
      stats: statsAfter(source, summary, false),
    },
  };
}
