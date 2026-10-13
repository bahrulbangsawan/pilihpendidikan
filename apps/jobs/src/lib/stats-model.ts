// View models of the Stats page (12 §9, 10 §2, §8): the stat cells, every
// chart's series and the equivalent data table (T10-10), all derived from the
// analytics responses. Pure functions over an injected translate function so
// the chart and its table always show the same numbers.

import type {
  AnalyticsBreakdownResponse,
  AnalyticsSummaryResponse,
  AnalyticsTimeseriesResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import { MIN_COHORT_FOR_RATES } from "@pilihpendidikan/jobs-contracts/api";
import type {
  AnalyticsInterval,
  Locale,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { Translate } from "@/i18n";
import { intlLocale } from "@/i18n";
import { DAY_MS } from "./board-model";
import { formatNumber, formatPercent } from "./format";
import { stageLabel, taskErrorLabel, taskStateLabel } from "./labels";
import { dayStartMs } from "./stats-range";

const HOUR_MS = 3_600_000;
export const DASH = "—";

type Summary = AnalyticsSummaryResponse;

/** One data table: what a chart shows, as rows (T10-10). */
export interface TableModel {
  caption: string;
  columns: readonly { key: string; label: string; numeric: boolean }[];
  rows: readonly { key: string; header: string; cells: readonly string[] }[];
}

// ── Rates and durations ────────────────────────────────────────────────────

/** Rates exist only for cohorts of 5 or more (10 §2.2). */
export function ratesVisible(summary: Pick<Summary, "rates" | "cohort_size">) {
  return summary.rates !== null && summary.cohort_size >= MIN_COHORT_FOR_RATES;
}

/** A rate as "33 %" (locale), or the dash when hidden or unknown. */
export function formatRate(
  rate: number | null | undefined,
  locale: Locale
): string {
  return rate === null || rate === undefined
    ? DASH
    : formatPercent(rate, locale);
}

function decimal(value: number, locale: Locale, digits: number): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * A duration in words: "6 d", "1.5 d", "18 h", "< 1 h". Null stays null so
 * the caller says "Not enough data" instead of inventing a zero.
 */
export function formatDuration(
  ms: number | null,
  t: Translate,
  locale: Locale
): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return null;
  }
  if (ms >= DAY_MS) {
    const days = ms / DAY_MS;
    return t("stats.units.days", {
      value: decimal(days, locale, days < 10 ? 1 : 0),
    });
  }
  if (ms >= HOUR_MS) {
    return t("stats.units.hours", {
      value: decimal(Math.round(ms / HOUR_MS), locale, 0),
    });
  }
  return t("stats.units.lessThanHour");
}

/** Milliseconds as days with one decimal (the time chart's axis unit). */
export function toDays(ms: number): number {
  return Math.round((ms / DAY_MS) * 10) / 10;
}

// ── Stat cells ─────────────────────────────────────────────────────────────

export interface StatCell {
  key: "applications" | "responseRate" | "interviews" | "offers";
  label: string;
  /** Muted line under the value: context or why a rate is hidden. */
  note: string | null;
  value: string;
}

/** The four cells at the top (12 §9): numbers in the title role. */
export function statCells(
  summary: Summary,
  t: Translate,
  locale: Locale
): StatCell[] {
  const rates = ratesVisible(summary) ? summary.rates : null;
  const hidden = t("stats.ratesLater", { count: MIN_COHORT_FOR_RATES });
  return [
    {
      key: "applications",
      label: t("stats.cells.applications"),
      value: formatNumber(summary.funnel.applied, locale),
      note: t("stats.cells.tracked", {
        count: formatNumber(summary.funnel.tracked, locale),
      }),
    },
    {
      key: "responseRate",
      label: t("stats.cells.responseRate"),
      value: formatRate(rates?.response_rate, locale),
      note: rates
        ? t("stats.cells.cohort", {
            count: formatNumber(summary.cohort_size, locale),
          })
        : hidden,
    },
    {
      key: "interviews",
      label: t("stats.cells.interviews"),
      value: formatNumber(summary.funnel.interviewing, locale),
      note: rates
        ? t("stats.cells.interviewRate", {
            rate: formatRate(rates.interview_rate, locale),
          })
        : null,
    },
    {
      key: "offers",
      label: t("stats.cells.offers"),
      value: formatNumber(summary.funnel.offer, locale),
      note: rates
        ? t("stats.cells.offerRate", {
            rate: formatRate(rates.offer_rate, locale),
          })
        : null,
    },
  ];
}

/** Nothing tracked or applied in the range: show the empty state. */
export function isEmptySummary(summary: Summary): boolean {
  const { funnel } = summary;
  return (
    funnel.tracked === 0 &&
    funnel.applied === 0 &&
    funnel.interviewing === 0 &&
    funnel.offer === 0 &&
    funnel.accepted === 0 &&
    funnel.rejected_total === 0 &&
    funnel.withdrawn_total === 0
  );
}

// ── Funnel (10 §2.1) ───────────────────────────────────────────────────────

export const FUNNEL_STEPS = [
  "tracked",
  "applied",
  "interviewing",
  "offer",
  "accepted",
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface BarRow {
  key: string;
  label: string;
  value: number;
}

export function funnelRows(summary: Summary, t: Translate): BarRow[] {
  return FUNNEL_STEPS.map((step) => ({
    key: step,
    label: step === "tracked" ? t("stats.funnel.tracked") : stageLabel(t, step),
    value: summary.funnel[step],
  }));
}

function countTable(
  caption: string,
  firstColumn: string,
  valueColumn: string,
  rows: readonly BarRow[],
  locale: Locale
): TableModel {
  return {
    caption,
    columns: [
      { key: "label", label: firstColumn, numeric: false },
      { key: "value", label: valueColumn, numeric: true },
    ],
    rows: rows.map((row) => ({
      key: row.key,
      header: row.label,
      cells: [formatNumber(row.value, locale)],
    })),
  };
}

export function funnelTable(
  rows: readonly BarRow[],
  t: Translate,
  locale: Locale
): TableModel {
  return countTable(
    t("stats.funnel.caption"),
    t("stats.funnel.step"),
    t("stats.funnel.count"),
    rows,
    locale
  );
}

function listSummary(rows: readonly BarRow[], locale: Locale): string {
  return rows
    .map((row) => `${row.label} ${formatNumber(row.value, locale)}`)
    .join(", ");
}

export function funnelSummary(
  rows: readonly BarRow[],
  t: Translate,
  locale: Locale
): string {
  return t("stats.funnel.summary", { list: listSummary(rows, locale) });
}

// ── Rejection by stage (10 §2.3) ───────────────────────────────────────────

export function rejectionRows(summary: Summary, t: Translate): BarRow[] {
  const byStage = summary.rejection_by_stage;
  const rounds = [...byStage.after_interview].sort((a, b) => a.round - b.round);
  return [
    {
      key: "before_applying",
      label: t("stats.rejection.beforeApplying"),
      value: byStage.before_applying,
    },
    {
      key: "after_applying",
      label: t("stats.rejection.afterApplying"),
      value: byStage.after_applying,
    },
    ...rounds.map((entry) => ({
      key: `after_interview_${entry.round}`,
      label: t("stats.rejection.afterInterview", { round: entry.round }),
      value: entry.count,
    })),
    {
      key: "after_offer",
      label: t("stats.rejection.afterOffer"),
      value: byStage.after_offer,
    },
  ];
}

export function rejectionTable(
  rows: readonly BarRow[],
  t: Translate,
  locale: Locale
): TableModel {
  return countTable(
    t("stats.rejection.caption"),
    t("stats.rejection.when"),
    t("stats.rejection.count"),
    rows,
    locale
  );
}

export function rejectionSummary(
  rows: readonly BarRow[],
  t: Translate,
  locale: Locale
): string {
  return t("stats.rejection.summary", { list: listSummary(rows, locale) });
}

// ── Time metrics (10 §2.4): median with a P75 whisker ──────────────────────

export const TIMING_KEYS = [
  "time_to_first_response",
  "time_to_interview",
  "time_to_offer",
  "prep_time",
] as const;
export type TimingKey = (typeof TIMING_KEYS)[number];

export interface TimingRow {
  key: TimingKey;
  label: string;
  median: number | null;
  n: number;
  p75: number | null;
}

export function timingRows(summary: Summary, t: Translate): TimingRow[] {
  return TIMING_KEYS.map((key) => ({
    key,
    label: t(`stats.timing.metrics.${key}`),
    median: summary.time_metrics[key].median,
    p75: summary.time_metrics[key].p75,
    n: summary.time_metrics[key].n,
  }));
}

export interface TimingPoint {
  key: TimingKey;
  label: string;
  /** Median in days. */
  median: number;
  /** P75 in days. */
  p75: number;
  /** Error-bar extent from the median: `[0, p75 − median]` in days. */
  whisker: [number, number];
}

/** The chart's points: only metrics with a median (n > 0). */
export function timingChartData(rows: readonly TimingRow[]): TimingPoint[] {
  return rows.flatMap((row) => {
    if (row.median === null || row.n === 0) {
      return [];
    }
    const median = toDays(row.median);
    const p75 = toDays(Math.max(row.p75 ?? row.median, row.median));
    return [
      {
        key: row.key,
        label: row.label,
        median,
        p75,
        whisker: [0, Math.max(0, Math.round((p75 - median) * 10) / 10)],
      },
    ];
  });
}

export function timingTable(
  rows: readonly TimingRow[],
  t: Translate,
  locale: Locale
): TableModel {
  const none = t("stats.timing.notEnough");
  return {
    caption: t("stats.timing.caption"),
    columns: [
      { key: "label", label: t("stats.timing.metric"), numeric: false },
      { key: "median", label: t("stats.timing.median"), numeric: true },
      { key: "p75", label: t("stats.timing.p75"), numeric: true },
      { key: "n", label: t("stats.timing.n"), numeric: true },
    ],
    rows: rows.map((row) => ({
      key: row.key,
      header: row.label,
      cells: [
        formatDuration(row.median, t, locale) ?? none,
        formatDuration(row.p75, t, locale) ?? none,
        formatNumber(row.n, locale),
      ],
    })),
  };
}

export function timingSummary(
  rows: readonly TimingRow[],
  t: Translate,
  locale: Locale
): string {
  const parts = rows.map((row) => {
    const median = formatDuration(row.median, t, locale);
    const p75 = formatDuration(row.p75, t, locale);
    return median
      ? t("stats.timing.summaryItem", {
          metric: row.label,
          median,
          p75: p75 ?? median,
        })
      : t("stats.timing.summaryNone", { metric: row.label });
  });
  return t("stats.timing.summary", { list: parts.join("; ") });
}

// ── Time series (10 §2.5) ──────────────────────────────────────────────────

export interface SeriesPoint {
  bucket: string;
  label: string;
  value: number;
}

/** "13 Jul" (week) or "Jul 2026" (month) for a bucket's first day. */
export function bucketLabel(
  bucket: string,
  interval: AnalyticsInterval,
  locale: Locale
): string {
  const options: Intl.DateTimeFormatOptions =
    interval === "month"
      ? { month: "short", year: "numeric" }
      : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(
    dayStartMs(bucket)
  );
}

export function seriesPoints(
  series: AnalyticsTimeseriesResponse,
  locale: Locale
): SeriesPoint[] {
  return series.points.map((point) => ({
    bucket: point.bucket,
    label: bucketLabel(point.bucket, series.interval, locale),
    value: point.value,
  }));
}

function bucketColumn(interval: AnalyticsInterval, t: Translate): string {
  if (interval === "month") {
    return t("stats.series.month");
  }
  return interval === "day" ? t("stats.series.day") : t("stats.series.weekOf");
}

export function seriesTable(
  points: readonly SeriesPoint[],
  metricName: string,
  interval: AnalyticsInterval,
  t: Translate,
  locale: Locale
): TableModel {
  return {
    caption: t("stats.series.caption", { metric: metricName }),
    columns: [
      { key: "bucket", label: bucketColumn(interval, t), numeric: false },
      { key: "value", label: metricName, numeric: true },
    ],
    rows: points.map((point) => ({
      key: point.bucket,
      header: point.label,
      cells: [formatNumber(point.value, locale)],
    })),
  };
}

export function seriesSummary(
  points: readonly SeriesPoint[],
  metricName: string,
  t: Translate,
  locale: Locale
): string {
  if (points.length === 0) {
    return t("stats.series.summaryEmpty", { metric: metricName });
  }
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const peak = points.reduce(
    (best, point) => (point.value > best.value ? point : best),
    points[0] as SeriesPoint
  );
  return t("stats.series.summary", {
    metric: metricName,
    total: formatNumber(total, locale),
    peak: formatNumber(peak.value, locale),
    bucket: peak.label,
  });
}

// ── Breakdown (10 §2.6) ────────────────────────────────────────────────────

export function breakdownTable(
  breakdown: AnalyticsBreakdownResponse,
  dimension: string,
  t: Translate,
  locale: Locale
): TableModel {
  return {
    caption: t("stats.breakdown.caption", {
      dimension,
      count: MIN_COHORT_FOR_RATES,
    }),
    columns: [
      { key: "label", label: dimension, numeric: false },
      { key: "applied", label: t("stats.breakdown.applied"), numeric: true },
      {
        key: "interview",
        label: t("stats.breakdown.interviewRate"),
        numeric: true,
      },
      { key: "offer", label: t("stats.breakdown.offerRate"), numeric: true },
      {
        key: "rejection",
        label: t("stats.breakdown.rejectionRate"),
        numeric: true,
      },
      { key: "n", label: t("stats.breakdown.n"), numeric: true },
    ],
    rows: breakdown.rows.map((row) => {
      const hidden = row.n < MIN_COHORT_FOR_RATES;
      const rate = (value: number | null) =>
        hidden ? DASH : formatRate(value, locale);
      return {
        key: row.key,
        header: row.label,
        cells: [
          formatNumber(row.applied, locale),
          rate(row.interview_rate),
          rate(row.offer_rate),
          rate(row.rejection_rate),
          formatNumber(row.n, locale),
        ],
      };
    }),
  };
}

// ── Automation reliability (10 §2.7) ───────────────────────────────────────

export const APPLY_TASK_STATES = [
  "submitted",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
] as const;

export interface AutomationModel {
  failures: { key: string; label: string; value: string }[];
  rates: { key: string; label: string; value: string }[];
  states: { key: string; label: string; value: string }[];
  total: number;
}

export function automationModel(
  summary: Summary,
  t: Translate,
  locale: Locale
): AutomationModel {
  const { automation } = summary;
  const states = APPLY_TASK_STATES.map((state) => ({
    key: state,
    label: taskStateLabel(t, state),
    value: formatNumber(automation.apply_tasks[state], locale),
  }));
  const total = APPLY_TASK_STATES.reduce(
    (sum, state) => sum + automation.apply_tasks[state],
    0
  );
  const failures = Object.entries(automation.failure_classes)
    .filter(([, count]) => count > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([errorClass, count]) => ({
      key: errorClass,
      label: taskErrorLabel(t, errorClass),
      value: formatNumber(count, locale),
    }));
  return {
    total,
    states,
    rates: [
      {
        key: "success",
        label: t("stats.automation.successRate"),
        value: formatRate(automation.apply_success_rate, locale),
      },
      {
        key: "verified",
        label: t("stats.automation.verifiedRatio"),
        value: formatRate(automation.verified_ratio, locale),
      },
      {
        key: "pause",
        label: t("stats.automation.pauseRate"),
        value: formatRate(automation.pause_rate, locale),
      },
    ],
    failures,
  };
}

/** The board link of the unconfirmed callout: "needs attention" filter. */
export const UNCONFIRMED_BOARD_HREF = "/board?attention=1";
