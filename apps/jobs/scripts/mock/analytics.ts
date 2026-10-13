// Mock api routes for Stats (05 §12, 10 §6): summary, timeseries and
// breakdown. The series honours from / to / interval (one bucket per week,
// month or day inside the range) and every `by` of the breakdown answers.

import type { AnalyticsBreakdown } from "@pilihpendidikan/jobs-contracts/enums";
import {
  ANALYTICS_BREAKDOWNS,
  ANALYTICS_INTERVALS,
  ANALYTICS_METRICS,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  makeAnalyticsSummary,
  makeBreakdown,
  makeTimeseries,
} from "../../src/test/fixtures-rest";
import type { MockRequest, MockRoute } from "./types";
import { apiError, ok } from "./types";

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_POINTS = 120;
/** Weekly applications of the sample (repeated over long ranges). */
const SAMPLE = [1, 3, 2, 4, 0, 5, 3, 2, 6, 1, 2, 4, 3];
const METRIC_SCALE: Record<string, number> = {
  applied: 1,
  interviews: 0.4,
  offers: 0.15,
  rejected: 0.5,
  discovered: 9,
  ai_cost: 0.3,
};

function day(value: string | null, fallback: string): string {
  return value && DAY_RE.test(value) ? value : fallback;
}

function utc(dayText: string): number {
  return Date.parse(`${dayText}T00:00:00Z`);
}

/** The bucket starts of [from, to]: Mondays, firsts of the month or days. */
function buckets(from: string, to: string, interval: string): string[] {
  const start = new Date(utc(from));
  if (interval === "week") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  } else if (interval === "month") {
    start.setUTCDate(1);
  }
  const end = utc(to);
  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end && out.length < MAX_POINTS) {
    out.push(cursor.toISOString().slice(0, 10));
    if (interval === "month") {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + (interval === "week" ? 7 : 1));
    }
  }
  return out;
}

function timeseries(request: MockRequest) {
  const params = request.url.searchParams;
  const metric = params.get("metric") ?? "";
  if (!(ANALYTICS_METRICS as readonly string[]).includes(metric)) {
    return apiError(400, "invalid_request", "Unknown metric");
  }
  const interval = params.get("interval") ?? "week";
  if (!(ANALYTICS_INTERVALS as readonly string[]).includes(interval)) {
    return apiError(400, "invalid_request", "Unknown interval");
  }
  const today = new Date().toISOString().slice(0, 10);
  const to = day(params.get("to"), today);
  const from = day(
    params.get("from"),
    new Date(utc(to) - 89 * DAY_MS).toISOString().slice(0, 10)
  );
  const scale = METRIC_SCALE[metric] ?? 1;
  const perBucket = interval === "month" ? 4 : 1;
  const days = buckets(from, to, interval);
  const base = makeTimeseries(metric as (typeof ANALYTICS_METRICS)[number]);
  return ok({
    ...base,
    interval,
    tz: params.get("tz") ?? base.tz,
    points: days.map((bucket, index) => ({
      bucket,
      value:
        Math.round(
          (SAMPLE[index % SAMPLE.length] ?? 0) * perBucket * scale * 10
        ) / 10,
    })),
  });
}

function breakdown(request: MockRequest) {
  const by = request.url.searchParams.get("by") ?? "";
  if (!(ANALYTICS_BREAKDOWNS as readonly string[]).includes(by)) {
    return apiError(400, "invalid_request", "Unknown breakdown");
  }
  return ok(makeBreakdown(by as AnalyticsBreakdown));
}

export const routes: MockRoute[] = [
  (request) => {
    if (
      request.method !== "GET" ||
      request.path !== "/api/v1/analytics/summary"
    ) {
      return null;
    }
    const from = request.url.searchParams.get("from") ?? "2026-07-14";
    const to = request.url.searchParams.get("to") ?? "2026-10-12";
    const tz = request.url.searchParams.get("tz") ?? "Asia/Jakarta";
    return ok(makeAnalyticsSummary({ from, to, tz }));
  },
  (request) =>
    request.method === "GET" && request.path === "/api/v1/analytics/timeseries"
      ? timeseries(request)
      : null,
  (request) =>
    request.method === "GET" && request.path === "/api/v1/analytics/breakdown"
      ? breakdown(request)
      : null,
];
