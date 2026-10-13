import { beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import type { TestEnv } from "../../../../test/fakes";
import { createCtx, createTestEnv } from "../../../../test/fakes";
import { runAnalyticsCron } from "../../cron/handlers/analytics";
import type { CronContext } from "../../cron/types";
import { trustedScope } from "../../core/scope";
import { recordAiUsageStatements } from "../../repo/core/ai-usage";
import { jobsDb, runBatch } from "../../repo/core/db";
import { rollupDays, rollupMessage } from "./cron";
import { rebuildUserAnalytics, rollupUserDays } from "./rollup";
import {
  DAY,
  dailyRows,
  HOUR,
  insertEvent,
  seedApp,
  seedDiscovered,
  seedFinishedTask,
  Story,
} from "./support.test";

const ALICE = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
const BOB = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0B";

let t: TestEnv;

function setTimezone(sqlite: Database, userId: string, zone: string): void {
  sqlite
    .query(
      "INSERT INTO user_settings (user_id, timezone, updated_at) VALUES (?, ?, 0) ON CONFLICT(user_id) DO UPDATE SET timezone = excluded.timezone"
    )
    .run(userId, zone);
}

async function spendAi(
  userId: string,
  at: number,
  micro: number,
  zone: string
) {
  const db = jobsDb(t.env);
  await runBatch(
    db,
    recordAiUsageStatements(db, trustedScope(userId, "script"), {
      purpose: "score",
      inputTokens: 10,
      outputTokens: 0,
      costMicroUsd: micro,
      now: at,
      timezone: zone,
    })
  );
}

/** One day of the T10-07 fixture (recorded during that day). */
async function dayOfActivity(
  stories: Story[],
  day: number,
  at: number,
  zone: string
): Promise<void> {
  if (day % 3 === 0) {
    stories.push(
      new Story(t.jobsSqlite, ALICE, { createdAt: at }).to("ready", at + HOUR)
    );
  }
  const pending = stories.find((s) => s.stage === "ready");
  if (day % 2 === 0 && pending) {
    pending.to("applied", at + 2 * HOUR);
    pending.submission(
      day % 4 === 0 ? "submitted_unverified" : "submitted_verified",
      at + 2 * HOUR
    );
  }
  const applied = stories.filter((s) => s.stage === "applied");
  if (day % 5 === 0 && applied[0]) {
    applied[0].interview(1, at + 3 * HOUR).to("interviewing", at + 3 * HOUR);
  }
  const interviewing = stories.find((s) => s.stage === "interviewing");
  if (day % 7 === 0 && interviewing) {
    interviewing.to(day % 14 === 0 ? "rejected" : "offer", at + 4 * HOUR);
  }
  if (day % 6 === 0 && applied[1]) {
    seedPausedTask(applied[1].id, at, day % 12 === 0);
  }
  if (day % 4 === 1) {
    seedDiscovered(t.jobsSqlite, ALICE, at + 6 * HOUR);
    await spendAi(ALICE, at + 6 * HOUR, 1000 + day, zone);
  }
}

function seedPausedTask(applicationId: string, at: number, failed: boolean) {
  const task = seedFinishedTask(
    t.jobsSqlite,
    ALICE,
    applicationId,
    at + 5 * HOUR,
    {
      state: failed ? "failed" : "submitted",
      errorClass: failed ? "captcha" : undefined,
      verified: !failed,
    }
  );
  insertEvent(t.jobsSqlite, ALICE, applicationId, at + 4.5 * HOUR, {
    type: "automation_task_paused",
    attemptId: task.attemptId,
    taskId: task.taskId,
    payload: { pause_reason: "challenge" },
  });
}

beforeEach(() => {
  t = createTestEnv();
});

describe("daily rollup (10 §4, 14 §6)", () => {
  it("T10-06 rollup is idempotent, late-event tolerant and keeps the AI spend", async () => {
    const zone = "Asia/Jakarta";
    setTimezone(t.jobsSqlite, ALICE, zone);
    // Local days 2026-10-10 and 2026-10-11 in Jakarta (UTC+7).
    const yesterday = Date.UTC(2026, 9, 10, 3);
    const today = Date.UTC(2026, 9, 11, 3);
    const story = new Story(t.jobsSqlite, ALICE, { createdAt: yesterday })
      .to("applied", yesterday + HOUR)
      .submission("submitted_unverified", yesterday + HOUR);
    seedDiscovered(t.jobsSqlite, ALICE, yesterday + 2 * HOUR);
    await spendAi(ALICE, yesterday + 3 * HOUR, 41_200, zone);
    await spendAi(ALICE, today + HOUR, 900, zone); // a day with AI only
    const db = jobsDb(t.env);
    const scope = trustedScope(ALICE, "queue");
    const days = ["2026-10-10", "2026-10-11"];
    await rollupUserDays(db, scope, { days, now: today + 2 * HOUR });
    const first = dailyRows(t.jobsSqlite, ALICE);
    expect(first["2026-10-10"]).toMatchObject({
      tracked: 1,
      applied: 1,
      applied_unverified: 1,
      discovered: 1,
      ai_cost_micro_usd: 41_200,
    });
    expect(first["2026-10-11"]).toEqual({ ai_cost_micro_usd: 900 });
    // Re-running for the same days writes the same rows.
    await rollupUserDays(db, scope, { days, now: today + 3 * HOUR });
    expect(dailyRows(t.jobsSqlite, ALICE)).toEqual(first);
    // A late CLI event arrives (recorded now, occurred yesterday): it lands
    // on today by server time; yesterday is unchanged.
    insertEvent(t.jobsSqlite, ALICE, story.id, today + 4 * HOUR, {
      type: "interview_scheduled",
      occurredAt: yesterday,
    });
    story.to("interviewing", today + 4 * HOUR);
    await rollupUserDays(db, scope, { days, now: today + 5 * HOUR });
    const second = dailyRows(t.jobsSqlite, ALICE);
    expect(second["2026-10-10"]).toEqual(first["2026-10-10"]);
    expect(second["2026-10-11"]).toMatchObject({
      interviews_scheduled: 1,
      interviewing: 1,
      responded: 1,
      ai_cost_micro_usd: 900,
    });
    // The AI budget keeps adding to the row after the rollup.
    await spendAi(ALICE, today + 6 * HOUR, 100, zone);
    await rollupUserDays(db, scope, { days, now: today + 7 * HOUR });
    expect(
      dailyRows(t.jobsSqlite, ALICE)["2026-10-11"]?.ai_cost_micro_usd
    ).toBe(1000);
  });

  it("T10-07 a rebuild equals the incremental rollup on a 90-day fixture", async () => {
    const zone = "Europe/Amsterdam"; // includes a DST change (2026-10-25)
    setTimezone(t.jobsSqlite, ALICE, zone);
    const db = jobsDb(t.env);
    const scope = trustedScope(ALICE, "queue");
    const start = Date.UTC(2026, 7, 1, 10);
    const stories: Story[] = [];
    for (let day = 0; day < 90; day++) {
      const at = start + day * DAY;
      // Each day's activity is recorded during that day…
      await dayOfActivity(stories, day, at, zone);
      // …and the 03:00 UTC cron of the next day rolls up yesterday + today.
      const cronAt = start + (day + 1) * DAY - 7 * HOUR;
      await rollupUserDays(db, scope, {
        days: rollupDays(cronAt, zone),
        now: cronAt,
      });
    }
    const incremental = dailyRows(t.jobsSqlite, ALICE);
    expect(Object.keys(incremental).length).toBeGreaterThan(60);
    // Clutter the table, then rebuild from scratch.
    t.jobsSqlite
      .query(
        "INSERT INTO analytics_daily (user_id, day, metrics) VALUES (?, '2020-01-01', '{\"applied\": 9}')"
      )
      .run(ALICE);
    t.jobsSqlite
      .query(
        "UPDATE analytics_daily SET metrics = json_set(metrics, '$.applied', 99) WHERE user_id = ? AND day = '2026-08-03'"
      )
      .run(ALICE);
    await rebuildUserAnalytics(db, scope, { now: start + 91 * DAY });
    expect(dailyRows(t.jobsSqlite, ALICE)).toEqual(incremental);
  });

  it("a rebuild after a timezone change re-buckets the days and keeps AI spend", async () => {
    setTimezone(t.jobsSqlite, ALICE, "UTC");
    const db = jobsDb(t.env);
    const scope = trustedScope(ALICE, "queue");
    // 2026-10-01 20:00 UTC = 2026-10-02 03:00 in Jakarta.
    const at = Date.UTC(2026, 9, 1, 20);
    new Story(t.jobsSqlite, ALICE, { createdAt: at }).to(
      "applied",
      at + 60_000
    );
    await spendAi(ALICE, Date.UTC(2026, 9, 1, 8), 5000, "UTC");
    await rollupUserDays(db, scope, {
      days: ["2026-10-01", "2026-10-02"],
      now: at + HOUR,
    });
    expect(dailyRows(t.jobsSqlite, ALICE)["2026-10-01"]).toMatchObject({
      applied: 1,
      ai_cost_micro_usd: 5000,
    });
    setTimezone(t.jobsSqlite, ALICE, "Asia/Jakarta");
    await t.queue.queue.send({
      v: 1,
      type: "rebuild_analytics",
      message_id: "rebuild-1",
      user_id: ALICE,
      reason: "timezone_change",
    });
    const report = await t.queue.drain(t.env);
    expect(report.acked).toBe(1);
    const rows = dailyRows(t.jobsSqlite, ALICE);
    // The spend cannot move (it is not in the events); the counters do.
    expect(rows["2026-10-01"]).toEqual({ ai_cost_micro_usd: 5000 });
    expect(rows["2026-10-02"]).toMatchObject({ applied: 1, tracked: 1 });
  });

  it("the daily cron enqueues one rollup_user message per recently active user (yesterday + today in their zone)", async () => {
    const now = Date.UTC(2026, 9, 12, 3); // 03:00 UTC
    setTimezone(t.jobsSqlite, ALICE, "America/Los_Angeles");
    const recent = new Story(t.jobsSqlite, ALICE, {
      createdAt: now - 20 * HOUR,
    });
    recent.to("applied", now - 10 * HOUR);
    // Bob was active 3 days ago only: no message.
    seedApp(t.jobsSqlite, BOB, { createdAt: now - 3 * DAY });
    // Carol only discovered jobs (no application events): still rolled up.
    const carol = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0C";
    seedDiscovered(t.jobsSqlite, carol, now - 5 * HOUR);
    const cc: CronContext = {
      env: t.env,
      ctx: createCtx(),
      db: jobsDb(t.env),
      cron: "0 3 * * *",
      now,
      log: () => undefined,
    };
    await runAnalyticsCron(cc);
    const bodies = t.queue.sent.map((message) => message.body);
    expect(bodies).toEqual([
      rollupMessage(ALICE, ["2026-10-10", "2026-10-11"]),
      rollupMessage(carol, ["2026-10-11", "2026-10-12"]),
    ]);
    // Los Angeles is still on Oct 11 at 03:00 UTC.
    expect(rollupDays(now, "America/Los_Angeles")).toEqual([
      "2026-10-10",
      "2026-10-11",
    ]);
    const report = await t.queue.drain(t.env);
    expect(report.acked).toBe(2);
    expect(dailyRows(t.jobsSqlite, ALICE)["2026-10-11"]).toMatchObject({
      applied: 1,
    });
    expect(dailyRows(t.jobsSqlite, carol)["2026-10-12"]).toMatchObject({
      discovered: 1,
    });
    expect(dailyRows(t.jobsSqlite, BOB)).toEqual({});
  });

  it("the cron pages through more than 200 users with sendBatch ≤ 100", async () => {
    const now = Date.UTC(2026, 9, 12, 3);
    const users = Array.from(
      { length: 205 },
      (_, i) => `usr_01JA6V8M3W8Z1T6Q4Y2B${String(i).padStart(4, "0")}`
    );
    for (const user of users) {
      seedDiscovered(t.jobsSqlite, user, now - HOUR);
    }
    const cc: CronContext = {
      env: t.env,
      ctx: createCtx(),
      db: jobsDb(t.env),
      cron: "0 3 * * *",
      now,
      log: () => undefined,
    };
    await runAnalyticsCron(cc);
    expect(t.queue.sent).toHaveLength(205);
    expect(new Set(t.queue.sent.map((m) => m.body.user_id)).size).toBe(205);
  });

  it("a rollup message for a user without data writes nothing and creates no settings row", async () => {
    await t.queue.queue.send({
      v: 1,
      type: "rollup_user",
      message_id: "rollup-ghost",
      user_id: BOB,
      days: ["2026-10-10", "2026-10-11"],
    });
    const report = await t.queue.drain(t.env);
    expect(report.acked).toBe(1);
    expect(dailyRows(t.jobsSqlite, BOB)).toEqual({});
    const settings = t.jobsSqlite
      .query("SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?")
      .get(BOB) as { n: number };
    expect(settings.n).toBe(0);
  });
});
