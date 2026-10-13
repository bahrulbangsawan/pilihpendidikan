// Order statistics of the analytics (10 §2.4): medians and P75 instead of
// means (long tails), cohort rates that stay hidden below 5 (10 §2.2).

import { MIN_COHORT_FOR_RATES } from "@pilihpendidikan/jobs-contracts/api";

/** `{median, p75, n}` in milliseconds (contracts `DurationStat`). */
export interface DurationStat {
  median: number | null;
  n: number;
  p75: number | null;
}

/**
 * The q-quantile of ascending `sorted` values by linear interpolation between
 * the closest ranks (Hyndman–Fan type 7, the spreadsheet / numpy default):
 * the median of [1, 2, 3, 4] is 2.5, its P75 is 3.25.
 */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return low + (high - low) * (position - lower);
}

/** Median, P75 and count of durations (negative or non-finite are dropped). */
export function durationStat(values: readonly number[]): DurationStat {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const p75 = quantile(sorted, 0.75);
  return {
    median: median === null ? null : Math.round(median),
    p75: p75 === null ? null : Math.round(p75),
    n: sorted.length,
  };
}

/** `numerator / denominator`, or null when the denominator is 0. */
export function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, numerator / denominator));
}

/** True when a cohort is large enough to show percentages (10 §2.2). */
export function showsRates(cohortSize: number): boolean {
  return cohortSize >= MIN_COHORT_FOR_RATES;
}
