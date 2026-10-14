// The scheduler fallback (24 §6.6). Cloudflare Cron Triggers added to this
// Worker after 2026-10-06 were never dispatched (Cloudflare incident "Cron
// Trigger Activation Issues", 2026-10-13/14), so the scraper Worker runs a
// Durable Object alarm clock that calls `CloudScheduler.tick(cron)` (a private
// RPC entrypoint in src/index.ts) every 5 minutes and on the hour.
//
// Only the 5-minute and hourly schedules can be ticked this way; the daily
// jobs keep their (working) cron. Running a tick twice is harmless: the lease
// reaper and expiry jobs are idempotent, and the cloud dispatch moves each
// source's `next_run_at` forward when it enqueues it.

import type { Env } from "../../env";
import type { KernelDeps } from "../core/deps";
import type { CronRunReport } from "./index";
import { CRON_EVERY_FIVE_MINUTES, CRON_HOURLY, runScheduled } from "./index";

export const FALLBACK_CRONS: readonly string[] = [
  CRON_EVERY_FIVE_MINUTES,
  CRON_HOURLY,
];

/** Runs one schedule for the fallback clock; refuses any other cron. */
export async function runSchedulerTick(
  cron: string,
  env: Env,
  ctx: ExecutionContext,
  deps: KernelDeps = {}
): Promise<CronRunReport> {
  if (!FALLBACK_CRONS.includes(cron)) {
    throw new Error(`the scheduler fallback does not run "${cron}"`);
  }
  return await runScheduled({ cron }, env, ctx, deps);
}

/** Minimum gap between two clock-ensure calls from one isolate. */
export const CLOCK_ENSURE_INTERVAL_MS = 10 * 60_000;
const ensuredAt = new WeakMap<object, number>();

/**
 * Asks the scraper Worker to make sure its alarm clock is armed (cheap and
 * idempotent there). Called from API traffic and the daily cron, at most once
 * per isolate every 10 minutes; skipped in dev when the scraper is the local
 * Python service (SCRAPER_FALLBACK_URL), which has no clock.
 */
export async function maybeEnsureSchedulerClock(
  env: Pick<Env, "SCRAPER" | "SCRAPER_FALLBACK_URL">,
  now: number
): Promise<boolean> {
  const scraper = env.SCRAPER;
  if (!scraper || env.SCRAPER_FALLBACK_URL) {
    return false;
  }
  const last = ensuredAt.get(scraper);
  if (last !== undefined && now - last < CLOCK_ENSURE_INTERVAL_MS) {
    return false;
  }
  ensuredAt.set(scraper, now);
  try {
    const res = await scraper.fetch("https://scraper.internal/clock/ensure", {
      method: "POST",
    });
    return res.ok;
  } catch (err) {
    console.warn(
      JSON.stringify({
        evt: "scheduler_clock_ensure_failed",
        error: err instanceof Error ? err.name : String(err),
      })
    );
    return false;
  }
}
