// The analytics service (10, 05 §12): what the routes, the queue handlers,
// the cron and the rebuild script call. Per-user only (10 §7): every read
// goes through the caller's `UserScope`; there is no cross-user aggregate.
//
//   getSummary(db, scope, {query, now})      live ≤ 180 days, else rollups
//   getTimeseries(db, scope, {query, now})   analytics_daily only
//   getBreakdown(db, scope, {query, now})    live, cohort-based
//   rollupUserDays / rebuildUserAnalytics / planRebuild   (rollup.ts)
//   enqueueDailyRollups(cc)                  the daily cron (cron.ts)

import type {
  AnalyticsBreakdownResponse,
  AnalyticsTimeseriesResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  AnalyticsBreakdown,
  AnalyticsInterval,
  AnalyticsMetric,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { UserScope } from "../../core/scope";
import type { ScoreFactRow } from "../../repo/analytics";
import {
  countFollowUpsDue,
  countUnconfirmed,
  listDailyRows,
  loadAnalyticsData,
  loadApplicationPostings,
  loadApplicationScores,
  loadAttachedVariants,
  loadSources,
  loadTimelineData,
} from "../../repo/analytics";
import type { JobsDb } from "../../repo/core/db";
import type { BreakdownRow } from "./breakdown";
import { computeBreakdown } from "./breakdown";
import { buildTimelines } from "./model";
import { analyticsZone } from "./rollup";
import type { SummaryBody } from "./summary";
import { computeSummary, summaryFromRollups } from "./summary";
import type { PeriodQuery } from "./time";
import { inPeriod, LIVE_SUMMARY_MAX_DAYS, resolvePeriod } from "./time";
import { bucketize } from "./timeseries";

/** `Cache-Control` of every analytics answer (10 §6). */
export const ANALYTICS_CACHE_CONTROL = "private, max-age=60";

interface Request<Q> {
  now: number;
  query: Q;
}

/** GET /analytics/summary (10 §6). */
export async function getSummary(
  db: JobsDb,
  scope: UserScope,
  input: Request<PeriodQuery>
): Promise<SummaryBody> {
  const zone = await analyticsZone(db, scope);
  const period = resolvePeriod(input.query, {
    now: input.now,
    userTimeZone: zone,
  });
  if (period.days > LIVE_SUMMARY_MAX_DAYS) {
    const [rows, unconfirmed, followUpsDue] = await Promise.all([
      listDailyRows(db, scope, period.from, period.to),
      countUnconfirmed(db, scope, period),
      countFollowUpsDue(db, scope, period),
    ]);
    return summaryFromRollups(rows, period, { unconfirmed, followUpsDue });
  }
  const data = await loadAnalyticsData(db, scope, period);
  return computeSummary(data, buildTimelines(data), period, input.now);
}

export type TimeseriesBody = AnalyticsTimeseriesResponse;

/**
 * GET /analytics/timeseries: reads only analytics_daily (10 §4). Rows are
 * keyed by the user's settings timezone, which the response echoes; `tz`
 * only decides "today" for a period without `to`.
 */
export async function getTimeseries(
  db: JobsDb,
  scope: UserScope,
  input: Request<
    PeriodQuery & { interval?: AnalyticsInterval; metric: AnalyticsMetric }
  >
): Promise<TimeseriesBody> {
  const zone = await analyticsZone(db, scope);
  const period = resolvePeriod(input.query, {
    now: input.now,
    userTimeZone: zone,
  });
  const interval = input.query.interval ?? "week";
  const rows = await listDailyRows(db, scope, period.from, period.to);
  return {
    metric: input.query.metric,
    interval,
    tz: zone,
    points: bucketize(rows, {
      from: period.from,
      to: period.to,
      interval,
      metric: input.query.metric,
    }),
  };
}

export type BreakdownBody = Omit<AnalyticsBreakdownResponse, "rows"> & {
  from: string;
  rows: BreakdownRow[];
  to: string;
  tz: string;
};

function groupScores(
  rows: readonly ScoreFactRow[]
): Map<string, ScoreFactRow[]> {
  const out = new Map<string, ScoreFactRow[]>();
  for (const row of rows) {
    const list = out.get(row.posting_id);
    if (list) {
      list.push(row);
    } else {
      out.set(row.posting_id, [row]);
    }
  }
  return out;
}

/** GET /analytics/breakdown (10 §2.6): live, over the period's cohort. */
export async function getBreakdown(
  db: JobsDb,
  scope: UserScope,
  input: Request<PeriodQuery & { by: AnalyticsBreakdown }>
): Promise<BreakdownBody> {
  const zone = await analyticsZone(db, scope);
  const period = resolvePeriod(input.query, {
    now: input.now,
    userTimeZone: zone,
  });
  const by = input.query.by;
  const [data, postings, sources, scores, variants] = await Promise.all([
    loadTimelineData(db, scope),
    by === "company" || by === "source" || by === "workplace_type"
      ? loadApplicationPostings(db, scope)
      : Promise.resolve([]),
    by === "source" ? loadSources(db, scope) : Promise.resolve([]),
    by === "score_band"
      ? loadApplicationScores(db, scope)
      : Promise.resolve([]),
    by === "cv_variant" ? loadAttachedVariants(db, scope) : Promise.resolve([]),
  ]);
  const cohort = buildTimelines(data).filter(
    (timeline) =>
      timeline.firsts.applied !== undefined &&
      inPeriod(period, timeline.firsts.applied)
  );
  return {
    by,
    from: period.from,
    to: period.to,
    tz: period.tz,
    rows: computeBreakdown(by, cohort, {
      postings: new Map(postings.map((row) => [row.id, row])),
      sources: new Map(sources.map((row) => [row.id, row])),
      scores: groupScores(scores),
      variants: new Map(variants.map((row) => [row.id, row])),
    }),
  };
}
