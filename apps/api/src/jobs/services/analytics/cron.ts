// The daily analytics cron (14 §7, 10 §4): one `rollup_user` message per
// user with activity in the last 48 hours, covering yesterday and today's
// partial day in that user's timezone. Users are read in pages of 200; the
// messages go out with `sendBatch` (≤ 100 each). The queue consumer does the
// work, so the cron stays far inside its wall time at any user count.

import type { JobsAiMessageOf } from "@pilihpendidikan/jobs-contracts/queue";
import type { Env } from "../../../env";
import { DAY_MS, HOUR_MS, localDay } from "../../core/clock";
import { listRollupCandidates } from "../../repo/analytics";
import type { JobsDb } from "../../repo/core/db";
import { zoneOrDefault } from "./rollup";

export const ROLLUP_LOOKBACK_MS = 48 * HOUR_MS;
export const ROLLUP_USER_PAGE = 200;
export const QUEUE_SEND_BATCH = 100;

/** Yesterday and today in `zone` (one day when they coincide). */
export function rollupDays(now: number, zone: string): string[] {
  return [...new Set([localDay(now - DAY_MS, zone), localDay(now, zone)])];
}

/** The `rollup_user` message of one user (idempotent per user and day). */
export function rollupMessage(
  userId: string,
  days: string[]
): JobsAiMessageOf<"rollup_user"> {
  return {
    v: 1,
    type: "rollup_user",
    message_id: `rollup:${userId}:${days.at(-1) ?? ""}`,
    user_id: userId,
    days,
  };
}

export interface RollupCronReport {
  messages: number;
  users: number;
}

/** Enqueues the day's rollups (resumable: pages by user id). */
export async function enqueueDailyRollups(input: {
  db: JobsDb;
  env: Pick<Env, "JOBS_AI_QUEUE">;
  now: number;
}): Promise<RollupCronReport> {
  const report: RollupCronReport = { users: 0, messages: 0 };
  let after = "";
  for (;;) {
    const page = await listRollupCandidates(input.db, {
      afterUserId: after,
      limit: ROLLUP_USER_PAGE,
      since: input.now - ROLLUP_LOOKBACK_MS,
    });
    const messages = page.map((candidate) =>
      rollupMessage(
        candidate.user_id,
        rollupDays(input.now, zoneOrDefault(candidate.timezone))
      )
    );
    for (let i = 0; i < messages.length; i += QUEUE_SEND_BATCH) {
      await input.env.JOBS_AI_QUEUE.sendBatch(
        messages.slice(i, i + QUEUE_SEND_BATCH).map((body) => ({ body }))
      );
    }
    report.users += page.length;
    report.messages += messages.length;
    if (page.length < ROLLUP_USER_PAGE) {
      return report;
    }
    after = page.at(-1)?.user_id ?? after;
  }
}
