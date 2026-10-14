// The scheduler fallback clock (job-tracker-spec/24 §6.6): pure timing rules,
// unit-tested without Workers. The Durable Object in index.ts fires an alarm
// 30 s after every 5-minute boundary (UTC) and ticks the api's schedules:
// always the 5-minute one, plus the hourly one on the hour. The offset keeps it
// clear of the api's own Cron Triggers (they fire at :00 and dispatch moves
// `next_run_at`, so a second dispatch 30 s later finds nothing due).

export const FIVE_MINUTES_MS = 5 * 60_000;
export const CLOCK_OFFSET_MS = 30_000;
export const CRON_EVERY_FIVE_MINUTES = "*/5 * * * *";
export const CRON_HOURLY = "0 * * * *";

/** The next alarm time strictly after `now`: a 5-minute boundary + 30 s. */
export function nextAlarmAt(now: number): number {
  const boundary = Math.floor((now - CLOCK_OFFSET_MS) / FIVE_MINUTES_MS);
  return (boundary + 1) * FIVE_MINUTES_MS + CLOCK_OFFSET_MS;
}

/** The 5-minute boundary an alarm firing at `now` belongs to. */
export function boundaryOf(now: number): number {
  return (
    Math.round((now - CLOCK_OFFSET_MS) / FIVE_MINUTES_MS) * FIVE_MINUTES_MS
  );
}

/** The schedules to tick for a boundary, reaper before dispatch. */
export function ticksFor(boundary: number): string[] {
  const minute = new Date(boundary).getUTCMinutes();
  return minute === 0
    ? [CRON_EVERY_FIVE_MINUTES, CRON_HOURLY]
    : [CRON_EVERY_FIVE_MINUTES];
}
