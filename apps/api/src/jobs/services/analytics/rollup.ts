// The daily rollup and the rebuild of `analytics_daily` (10 §4, §5; 14 §6).
//
//   rollupUserDays     recompute the given local days (the cron sends
//                      yesterday + today) and upsert them; a replay writes the
//                      same rows
//   rebuildUserAnalytics   recompute every day from the events: rows of days
//                      that no longer have activity are removed (a timezone
//                      change moves day boundaries), AI spend is always kept
//   planRebuild        the same computation without writing (the
//                      analytics:rebuild dry run)

import type { UserScope } from "../../core/scope";
import type { AnalyticsData } from "../../repo/analytics";
import {
  clearOtherDaysStatements,
  loadAnalyticsData,
  readUserTimezone,
  runDailyWrites,
  writeDayStatements,
} from "../../repo/analytics";
import type { JobsDb } from "../../repo/core/db";
import { USER_SETTINGS_DEFAULTS } from "../../repo/core/settings";
import type { DailyMetrics } from "./daily";
import { computeDailyMetrics } from "./daily";
import { buildTimelines } from "./model";
import {
  endOfLocalDay,
  isValidTimeZone,
  parseDay,
  startOfLocalDay,
} from "./time";

/** The zone of a user without settings (04 §2.7 default, 10 §5). */
export const FALLBACK_ZONE: string = USER_SETTINGS_DEFAULTS.timezone;

/** A usable zone: `zone` when the runtime knows it, else the default. */
export function zoneOrDefault(zone: string | null | undefined): string {
  return zone && isValidTimeZone(zone) ? zone : FALLBACK_ZONE;
}

/** The user's analytics zone (`user_settings.timezone`, 10 §5). */
export async function analyticsZone(
  db: JobsDb,
  scope: UserScope
): Promise<string> {
  return zoneOrDefault(await readUserTimezone(db, scope));
}

export interface RollupResult {
  /** Days written (with activity) and cleared (none). */
  cleared: string[];
  written: string[];
  zone: string;
}

/** Counters of `days` (or of every day when `days` is null). */
export function dailyMetricsOf(
  data: AnalyticsData,
  zone: string,
  days: ReadonlySet<string> | null
): Map<string, DailyMetrics> {
  return computeDailyMetrics(data, buildTimelines(data), zone, days);
}

/** 10 §4: recompute `days` (YYYY-MM-DD in the user's zone) and upsert them. */
export async function rollupUserDays(
  db: JobsDb,
  scope: UserScope,
  input: { days: readonly string[]; now: number; zone?: string }
): Promise<RollupResult> {
  const zone = input.zone ?? (await analyticsZone(db, scope));
  const days = [...new Set(input.days.filter((day) => parseDay(day)))].sort();
  if (days.length === 0) {
    return { zone, written: [], cleared: [] };
  }
  const data = await loadAnalyticsData(db, scope, {
    fromMs: startOfLocalDay(days[0] as string, zone),
    toMs: endOfLocalDay(days.at(-1) as string, zone),
  });
  const metrics = dailyMetricsOf(data, zone, new Set(days));
  const statements: D1PreparedStatement[] = [];
  const written: string[] = [];
  const cleared: string[] = [];
  for (const day of days) {
    const counters = metrics.get(day) ?? null;
    statements.push(
      ...writeDayStatements(
        db,
        scope,
        day,
        counters as Record<string, unknown> | null
      )
    );
    (counters ? written : cleared).push(day);
  }
  await runDailyWrites(db, statements);
  return { zone, written, cleared };
}

export interface RebuildPlan {
  metrics: Map<string, DailyMetrics>;
  zone: string;
}

/** Every day's counters from the full history (no writes). */
export async function planRebuild(
  db: JobsDb,
  scope: UserScope,
  input: { now: number; zone?: string }
): Promise<RebuildPlan> {
  const zone = input.zone ?? (await analyticsZone(db, scope));
  const data = await loadAnalyticsData(db, scope, {
    fromMs: 0,
    toMs: Number.MAX_SAFE_INTEGER,
  });
  return { zone, metrics: dailyMetricsOf(data, zone, null) };
}

/**
 * 14 §6 `rebuild_analytics`: deletes and recomputes the user's rows in one
 * pass. A replay recomputes the same values.
 */
export async function rebuildUserAnalytics(
  db: JobsDb,
  scope: UserScope,
  input: { now: number; zone?: string }
): Promise<RollupResult> {
  const plan = await planRebuild(db, scope, input);
  const days = [...plan.metrics.keys()].sort();
  const statements: D1PreparedStatement[] = [
    ...clearOtherDaysStatements(db, scope, days),
  ];
  for (const day of days) {
    statements.push(
      ...writeDayStatements(
        db,
        scope,
        day,
        plan.metrics.get(day) as unknown as Record<string, unknown>
      )
    );
  }
  await runDailyWrites(db, statements);
  return { zone: plan.zone, written: days, cleared: [] };
}
