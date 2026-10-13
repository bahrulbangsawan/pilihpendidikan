// The kernel's time source. Every `/api/v1` request, queue batch and cron run
// reads "now" once from a `Clock` and hands it down explicitly (`c.now`,
// `qc.now`, `cc.now`), so repo functions take `now` as a parameter and tests
// control time with the fake clock in test/fakes.ts (`createFakeClock`).
//
// Timestamps are epoch milliseconds everywhere (PLAN C2).

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** `YYYY-MM` of `now` in UTC (the `ai_usage.month` key, 04 §2.7). */
export function utcMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** `YYYY-MM-DD` of `now` in UTC. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

const DAY_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = DAY_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    DAY_FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * `YYYY-MM-DD` of `now` in an IANA time zone (the `analytics_daily.day` key,
 * 10 §5). An unknown zone falls back to UTC rather than throwing, because the
 * zone comes from user settings.
 */
export function localDay(now: number, timeZone: string): string {
  try {
    return dayFormatter(timeZone).format(new Date(now));
  } catch {
    return utcDay(now);
  }
}
