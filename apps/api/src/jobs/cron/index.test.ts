import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../app";
import { createCtx, createTestEnv } from "../../../test/fakes";
import {
  CRON_DAILY,
  CRON_HOURLY,
  CRON_EVERY_FIVE_MINUTES,
  CRON_JOBS,
  runScheduled,
} from "./index";

const noMcp = { fetch: () => new Response("", { status: 404 }) };

describe("TCORE-CRON scheduled dispatch (14 §7)", () => {
  it("TCORE-CRON registers exactly the wrangler.jsonc triggers", () => {
    const wrangler = readFileSync(
      join(import.meta.dir, "..", "..", "..", "wrangler.jsonc"),
      "utf8"
    );
    for (const cron of Object.keys(CRON_JOBS)) {
      expect(wrangler).toContain(`"${cron}"`);
    }
    expect(Object.keys(CRON_JOBS).sort()).toEqual(
      [CRON_DAILY, CRON_EVERY_FIVE_MINUTES, CRON_HOURLY].sort()
    );
    expect(CRON_JOBS[CRON_EVERY_FIVE_MINUTES].map((j) => j.name)).toEqual([
      "leases",
      "cloud-reaper",
    ]);
    expect(CRON_JOBS[CRON_HOURLY].map((j) => j.name)).toEqual([
      "cloud-dispatch",
    ]);
    expect(CRON_JOBS[CRON_DAILY].map((j) => j.name)).toEqual([
      "request-log",
      "retention",
      "file-retention",
      "analytics",
    ]);
  });

  it("TCORE-CRON the 5-minute trigger runs the lease jobs only (request_log untouched)", async () => {
    const t = createTestEnv();
    t.sqlite.run(
      "INSERT INTO request_log (ts, caller_email, tool, category, status, retention_until) VALUES (1, 'a@x', 'cv_get', 'cv', 'ok', 2)"
    );
    const report = await runScheduled(
      { cron: CRON_EVERY_FIVE_MINUTES },
      t.env,
      createCtx()
    );
    expect(report).toEqual({
      cron: CRON_EVERY_FIVE_MINUTES,
      ran: ["leases", "cloud-reaper"],
      failed: [],
    });
    expect(
      t.sqlite.query("SELECT COUNT(*) AS n FROM request_log").get()
    ).toEqual({ n: 1 });
  });

  it("TCORE-CRON the daily trigger keeps the request_log purge and runs every daily job", async () => {
    const t = createTestEnv();
    t.sqlite.run(
      "INSERT INTO request_log (ts, caller_email, tool, category, status, retention_until) VALUES (1, 'a@x', 'cv_get', 'cv', 'ok', 2), (1, 'a@x', 'cv_get', 'cv', 'ok', 99999999999999)"
    );
    const ctx = createCtx();
    createApp({ sse: noMcp, streamable: noMcp }).scheduled(
      { cron: CRON_DAILY } as ScheduledController,
      t.env,
      ctx
    );
    await ctx.drain();
    expect(
      t.sqlite.query("SELECT COUNT(*) AS n FROM request_log").get()
    ).toEqual({ n: 1 });
    const report = await runScheduled({ cron: CRON_DAILY }, t.env, createCtx());
    expect(report.ran).toEqual([
      "request-log",
      "retention",
      "file-retention",
      "analytics",
    ]);
  });

  it("TCORE-CRON a failing job does not stop the others; unknown schedules run nothing", async () => {
    const t = createTestEnv();
    const broken = {
      ...t.env,
      DB: {
        prepare: () => {
          throw new Error("db down");
        },
      } as unknown as D1Database,
    };
    const report = await runScheduled(
      { cron: CRON_DAILY },
      broken,
      createCtx()
    );
    expect(report.failed).toEqual(["request-log"]);
    expect(report.ran).toEqual(["retention", "file-retention", "analytics"]);
    expect(
      await runScheduled({ cron: "1 1 1 1 1" }, t.env, createCtx())
    ).toEqual({ cron: "1 1 1 1 1", ran: [], failed: [] });
  });
});
