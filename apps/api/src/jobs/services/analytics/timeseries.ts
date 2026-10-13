// `GET /api/v1/analytics/timeseries` (10 §4, §6): reads only
// `analytics_daily` and buckets it by day, ISO week (Monday labels) or month
// (first-day labels). Empty buckets are zero. `ai_cost` is in micro-USD like
// every other cost of the API.

import type {
  AnalyticsInterval,
  AnalyticsMetric,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { DailyRow } from "../../repo/analytics";
import { addDays, isoWeekStart, monthStart } from "./time";

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The value of one metric in one rollup row. */
export function metricValue(
  metrics: Record<string, unknown>,
  metric: AnalyticsMetric
): number {
  switch (metric) {
    case "applied":
      return num(metrics.applied);
    case "interviews":
      return num(metrics.interviews_scheduled);
    case "offers":
      return num(metrics.offers);
    case "rejected": {
      const map = metrics.rejected;
      if (!map || typeof map !== "object") {
        return 0;
      }
      return Object.values(map as Record<string, unknown>).reduce<number>(
        (total, value) => total + num(value),
        0
      );
    }
    case "discovered":
      return num(metrics.discovered);
    case "ai_cost":
      return num(metrics.ai_cost_micro_usd);
    default:
      return 0;
  }
}

/** The bucket label of `day`. */
export function bucketOf(day: string, interval: AnalyticsInterval): string {
  if (interval === "week") {
    return isoWeekStart(day);
  }
  if (interval === "month") {
    return monthStart(day);
  }
  return day;
}

function nextBucket(bucket: string, interval: AnalyticsInterval): string {
  if (interval === "week") {
    return addDays(bucket, 7);
  }
  if (interval === "month") {
    const year = Number(bucket.slice(0, 4));
    const month = Number(bucket.slice(5, 7));
    return month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  }
  return addDays(bucket, 1);
}

/** Zero-filled `{bucket, value}` points covering `from`..`to`. */
export function bucketize(
  rows: readonly DailyRow[],
  input: {
    from: string;
    interval: AnalyticsInterval;
    metric: AnalyticsMetric;
    to: string;
  }
): Array<{ bucket: string; value: number }> {
  const values = new Map<string, number>();
  for (
    let bucket = bucketOf(input.from, input.interval);
    bucket <= input.to;
    bucket = nextBucket(bucket, input.interval)
  ) {
    values.set(bucket, 0);
  }
  for (const row of rows) {
    if (row.day < input.from || row.day > input.to) {
      continue;
    }
    const bucket = bucketOf(row.day, input.interval);
    values.set(
      bucket,
      (values.get(bucket) ?? 0) + metricValue(row.metrics, input.metric)
    );
  }
  return [...values.entries()].map(([bucket, value]) => ({ bucket, value }));
}
