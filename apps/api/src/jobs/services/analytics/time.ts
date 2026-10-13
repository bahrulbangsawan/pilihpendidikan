// Calendar arithmetic of the statistics (10 §5): local days in the user's
// IANA zone, ISO weeks (Monday first), months, and the `from`/`to`/`tz`
// period of the analytics routes (05 §12).
//
// Days are `YYYY-MM-DD` strings. A local day starts at the first instant whose
// local date is that day (midnight, or the first instant after a DST gap), so
// days are 23, 24 or 25 hours long in zones with daylight saving.

import { DAY_MS, HOUR_MS, localDay, MINUTE_MS } from "../../core/clock";
import { invalidRequest } from "../../core/http";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Default span of a period without `from` (10 §8 stats page: 90 days). */
export const DEFAULT_PERIOD_DAYS = 90;
/** Periods longer than this read the daily rollup instead (10 §4). */
export const LIVE_SUMMARY_MAX_DAYS = 180;
/** Upper bound of one request's span (ten years). */
export const MAX_PERIOD_DAYS = 3660;

/** True for an IANA zone the runtime knows. */
export function isValidTimeZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** `[year, month, day]` of a real calendar day, or null. */
export function parseDay(day: string): [number, number, number] | null {
  const match = DAY_RE.exec(day);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  ) {
    return null;
  }
  return [year, month, date];
}

function dayParts(day: string): [number, number, number] {
  const parts = parseDay(day);
  if (!parts) {
    throw new Error(`not a calendar day: ${day}`);
  }
  return parts;
}

/** The day `n` days after `day` (negative goes back). */
export function addDays(day: string, n: number): string {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date + n))
    .toISOString()
    .slice(0, 10);
}

/** Calendar days from `from` to `to`, both included (1 when equal). */
export function daysInclusive(from: string, to: string): number {
  const [y1, m1, d1] = dayParts(from);
  const [y2, m2, d2] = dayParts(to);
  return (
    Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS) +
    1
  );
}

/** Every day from `from` to `to`, both included. */
export function listDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    out.push(day);
  }
  return out;
}

/** The Monday that starts the ISO week of `day`. */
export function isoWeekStart(day: string): string {
  const [year, month, date] = dayParts(day);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** ISO week label `YYYY-Www` (the year that owns the week's Thursday). */
export function isoWeekLabel(day: string): string {
  const monday = isoWeekStart(day);
  const thursday = addDays(monday, 3);
  const [year] = dayParts(thursday);
  const firstThursday = isoWeekStart(`${year}-01-04`);
  const week = Math.round(daysInclusive(firstThursday, monday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The first day of the month of `day`. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = PART_FORMATTERS.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PART_FORMATTERS.set(zone, formatter);
  }
  return formatter;
}

/** Offset of `zone` from UTC at the instant `utcMs` (local = UTC + offset). */
export function zoneOffsetMs(utcMs: number, zone: string): number {
  const parts = partsFormatter(zone).formatToParts(new Date(utcMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour") % 24,
    value("minute"),
    value("second")
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

const SEARCH_STEP_MS = 15 * MINUTE_MS;
const SEARCH_SPAN_MS = 4 * HOUR_MS;

/** The first instant (UTC ms) of the local `day` in `zone`. */
export function startOfLocalDay(day: string, zone: string): number {
  const [year, month, date] = dayParts(day);
  const midnight = Date.UTC(year, month - 1, date);
  let candidate = midnight - zoneOffsetMs(midnight, zone);
  candidate = midnight - zoneOffsetMs(candidate, zone);
  const startsHere = (instant: number) =>
    localDay(instant, zone) === day && localDay(instant - 1, zone) !== day;
  if (startsHere(candidate)) {
    return candidate;
  }
  // A DST gap at midnight: the day starts at the first existing instant.
  for (
    let instant = midnight - SEARCH_SPAN_MS - 14 * HOUR_MS;
    instant <= midnight + SEARCH_SPAN_MS + 14 * HOUR_MS;
    instant += SEARCH_STEP_MS
  ) {
    if (localDay(instant, zone) === day) {
      // Narrow the 15-minute window down to the millisecond.
      let low = instant - SEARCH_STEP_MS;
      let high = instant;
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (localDay(mid, zone) === day) {
          high = mid;
        } else {
          low = mid;
        }
      }
      return high;
    }
  }
  return candidate;
}

/** The instant after the last one of `day` (= the start of the next day). */
export function endOfLocalDay(day: string, zone: string): number {
  return startOfLocalDay(addDays(day, 1), zone);
}

/** A resolved `from` / `to` / `tz` period (10 §5). */
export interface Period {
  /** Calendar days covered (both ends included). */
  days: number;
  from: string;
  /** First instant of `from` (UTC ms, inclusive). */
  fromMs: number;
  to: string;
  /** First instant after `to` (UTC ms, exclusive). */
  toMs: number;
  tz: string;
}

export interface PeriodQuery {
  from?: string;
  to?: string;
  tz?: string;
}

/**
 * Resolves the query of an analytics route. `tz` defaults to the user's
 * timezone; `to` to today there; `from` to `DEFAULT_PERIOD_DAYS` days before
 * `to`. Invalid zones, impossible dates, `from > to` and spans over ten years
 * answer 400.
 */
export function resolvePeriod(
  query: PeriodQuery,
  options: { defaultDays?: number; now: number; userTimeZone: string }
): Period {
  const tz = query.tz ?? options.userTimeZone;
  if (!isValidTimeZone(tz)) {
    throw invalidRequest(`Unknown time zone "${tz}".`, [
      { path: ["tz"], message: "not an IANA time zone" },
    ]);
  }
  for (const key of ["from", "to"] as const) {
    const value = query[key];
    if (value !== undefined && !parseDay(value)) {
      throw invalidRequest(`"${key}" is not a calendar day.`, [
        { path: [key], message: "expected an existing YYYY-MM-DD day" },
      ]);
    }
  }
  const to = query.to ?? localDay(options.now, tz);
  const from =
    query.from ??
    addDays(to, -((options.defaultDays ?? DEFAULT_PERIOD_DAYS) - 1));
  if (from > to) {
    throw invalidRequest('"from" is after "to".', [
      { path: ["from"], message: "must not be after to" },
    ]);
  }
  const days = daysInclusive(from, to);
  if (days > MAX_PERIOD_DAYS) {
    throw invalidRequest(`The period is longer than ${MAX_PERIOD_DAYS} days.`, [
      { path: ["from"], message: "period too long" },
    ]);
  }
  return {
    from,
    to,
    tz,
    days,
    fromMs: startOfLocalDay(from, tz),
    toMs: endOfLocalDay(to, tz),
  };
}

/** True when `at` falls inside the period. */
export function inPeriod(period: Pick<Period, "fromMs" | "toMs">, at: number) {
  return at >= period.fromMs && at < period.toMs;
}
