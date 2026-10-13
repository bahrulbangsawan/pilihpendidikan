// The Stats date range (12 §9, 10 §5): presets or a custom from/to, kept in
// the URL so a range can be linked. Days are local calendar days
// (`YYYY-MM-DD`) that the api interprets in the browser's time zone (`tz`).

import type {
  AnalyticsBreakdown,
  AnalyticsInterval,
  AnalyticsMetric,
} from "@pilihpendidikan/jobs-contracts/enums";
import { ANALYTICS_BREAKDOWNS } from "@pilihpendidikan/jobs-contracts/enums";
import { DAY_MS, isoDay } from "./board-model";

export const RANGE_PRESETS = ["30d", "90d", "year", "all", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const DEFAULT_RANGE: RangePreset = "90d";

/**
 * "All time" starts before any tracker data can exist: the oldest records
 * are legacy jobs imported from the builders, which launched after 2020.
 */
export const ALL_TIME_FROM = "2020-01-01";

/**
 * Metrics the weekly series offers. `ai_cost` stays under Settings → Usage,
 * never on the main dashboard (10 §2.8).
 */
export const SERIES_METRICS = [
  "applied",
  "interviews",
  "offers",
  "rejected",
  "discovered",
] as const satisfies readonly AnalyticsMetric[];
export type SeriesMetric = (typeof SERIES_METRICS)[number];

/** The breakdown switcher: the four of 10 §8 first, then the rest. */
export const BREAKDOWN_ORDER = [
  "source",
  "mode",
  "cv_variant",
  "score_band",
  "company",
  "method",
  "workplace_type",
] as const satisfies readonly AnalyticsBreakdown[];

export interface StatsSearch {
  by?: AnalyticsBreakdown;
  from?: string;
  metric?: SeriesMetric;
  range?: RangePreset;
  to?: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Spans longer than this use monthly buckets instead of weekly ones. */
const WEEKLY_MAX_DAYS = 366;

/** True for a real calendar day in `YYYY-MM-DD`. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function oneOf<T extends string>(
  values: readonly T[],
  value: unknown
): T | undefined {
  return (values as readonly unknown[]).includes(value)
    ? (value as T)
    : undefined;
}

/** `validateSearch` of /stats: unknown or malformed values are dropped. */
export function validateStatsSearch(
  search: Record<string, unknown>
): StatsSearch {
  const result: StatsSearch = {};
  const range = oneOf(RANGE_PRESETS, search.range);
  if (range) {
    result.range = range;
  }
  if (isDay(search.from)) {
    result.from = search.from;
  }
  if (isDay(search.to)) {
    result.to = search.to;
  }
  const metric = oneOf(SERIES_METRICS, search.metric);
  if (metric) {
    result.metric = metric;
  }
  const by = oneOf(ANALYTICS_BREAKDOWNS, search.by);
  if (by) {
    result.by = by;
  }
  return result;
}

export interface ResolvedRange {
  from: string;
  preset: RangePreset;
  to: string;
}

/** Local midnight of `day`, as epoch ms. */
export function dayStartMs(day: string): number {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date).getTime();
}

function daysBefore(nowMs: number, days: number): string {
  const date = new Date(nowMs);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return isoDay(date);
}

/**
 * The from/to days of a search at `nowMs`. "Last 30 days" includes today
 * (from = today − 29). A custom range must be two valid days with from ≤ to
 * and to ≤ today; anything else falls back to the default preset.
 */
export function resolveRange(
  search: Pick<StatsSearch, "range" | "from" | "to">,
  nowMs: number
): ResolvedRange {
  const today = isoDay(new Date(nowMs));
  const preset = search.range ?? DEFAULT_RANGE;
  switch (preset) {
    case "30d":
      return { preset, from: daysBefore(nowMs, 29), to: today };
    case "year":
      return { preset, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return { preset, from: ALL_TIME_FROM, to: today };
    case "custom": {
      const { from, to } = search;
      if (isDay(from) && isDay(to) && from <= to && to <= today) {
        return { preset, from, to };
      }
      return resolveRange({ range: DEFAULT_RANGE }, nowMs);
    }
    default:
      return { preset: "90d", from: daysBefore(nowMs, 89), to: today };
  }
}

/** Calendar days covered by a range, both ends included. */
export function rangeDays(range: Pick<ResolvedRange, "from" | "to">): number {
  return (
    Math.round((dayStartMs(range.to) - dayStartMs(range.from)) / DAY_MS) + 1
  );
}

/** Weekly buckets up to a year, monthly beyond (10 §2.5 "per ISO week"). */
export function intervalFor(
  range: Pick<ResolvedRange, "from" | "to">
): AnalyticsInterval {
  return rangeDays(range) > WEEKLY_MAX_DAYS ? "month" : "week";
}
