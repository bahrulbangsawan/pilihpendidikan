// 14 §7 / 04 §4 daily retention: TP-RETENTION.

import { describe, expect, it, spyOn } from "bun:test";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { TestEnv } from "../../../../test/fakes";
import {
  createCtx,
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import {
  seedApplication,
  seedPosting,
  seedUserJob,
} from "../../../../test/seed-jobs";
import { DAY_MS } from "../../core/clock";
import { CRON_DAILY, runScheduled } from "../../cron/index";
import type { CronContext } from "../../cron/types";
import { jobsDb } from "../../repo/core/db";
import { exportIndexKey, writeDeletionRecord } from "../account/records";
import {
  CAPACITY_ERROR_BYTES,
  CAPACITY_WARN_BYTES,
  checkCapacity,
  monthsBefore,
  runRetention,
} from "./retention";

const NOW = Date.UTC(2026, 9, 12);

function ctxOf(t: TestEnv, now = NOW): CronContext {
  return {
    env: t.env,
    ctx: createCtx(),
    db: jobsDb(t.env),
    cron: CRON_DAILY,
    now,
    log: () => undefined,
  };
}

function n(t: TestEnv, sql: string, ...binds: Array<string | number>): number {
  return (t.jobsSqlite.query(sql).get(...binds) as { n: number }).n;
}

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0D";

describe("TP-RETENTION daily retention (14 §7, 04 §4)", () => {
  it("TP-RETENTION purges expired idempotency keys only", async () => {
    const t = createTestEnv();
    const q = t.jobsSqlite.query(
      "INSERT INTO idempotency_keys (user_id, key, request_hash, status_code, response_body, created_at, expires_at) VALUES (?, ?, 'h', 200, '{}', 0, ?)"
    );
    q.run(USER, "old", NOW - 1);
    q.run(USER, "live", NOW + DAY_MS);
    const report = await runRetention(ctxOf(t));
    expect(report.idempotency).toBe(1);
    expect(n(t, "SELECT COUNT(*) AS n FROM idempotency_keys")).toBe(1);
  });

  it("TP-RETENTION trims change_log older than 30 days as a contiguous prefix", async () => {
    const t = createTestEnv();
    const q = t.jobsSqlite.query(
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) VALUES (?, 'rule', 'r', 1, 'upsert', ?)"
    );
    q.run(USER, NOW - 40 * DAY_MS);
    q.run(USER, NOW - 31 * DAY_MS);
    q.run(USER, NOW - 2 * DAY_MS);
    q.run(USER, NOW - 35 * DAY_MS); // late commit with an older timestamp
    const report = await runRetention(ctxOf(t));
    expect(report.change_log).toBe(2);
    const seqs = (
      t.jobsSqlite
        .query("SELECT seq FROM change_log ORDER BY seq")
        .all() as Array<{
        seq: number;
      }>
    ).map((r) => r.seq);
    expect(seqs).toEqual([3, 4]);
    // Everything older: the newest row stays as the floor marker.
    const t2 = createTestEnv();
    t2.jobsSqlite
      .query(
        "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) VALUES (?, 'rule', 'r', 1, 'upsert', ?), (?, 'rule', 'r', 2, 'upsert', ?)"
      )
      .run(USER, NOW - 50 * DAY_MS, USER, NOW - 45 * DAY_MS);
    await runRetention(ctxOf(t2));
    expect(n(t2, "SELECT COUNT(*) AS n FROM change_log")).toBe(1);
  });

  it("TP-RETENTION deletes closed postings after 180 days unless a user still links them", async () => {
    const t = createTestEnv();
    const closedOld = { status: "closed", closed_at: NOW - 200 * DAY_MS };
    const orphan = seedPosting(t.jobsSqlite, closedOld);
    const linked = seedPosting(t.jobsSqlite, closedOld);
    seedUserJob(t.jobsSqlite, USER, { posting_id: linked.id });
    const recent = seedPosting(t.jobsSqlite, {
      status: "closed",
      closed_at: NOW - 10 * DAY_MS,
    });
    const open = seedPosting(t.jobsSqlite);
    await runRetention(ctxOf(t));
    const left = (
      t.jobsSqlite.query("SELECT id FROM job_postings").all() as Array<{
        id: string;
      }>
    ).map((r) => r.id);
    expect(left).not.toContain(orphan.id);
    expect(left).toEqual(
      expect.arrayContaining([linked.id, recent.id, open.id])
    );
  });

  it("TP-RETENTION deletes untracked user_jobs unseen for 90 days with a delete change and their scores", async () => {
    const t = createTestEnv();
    const old = NOW - 100 * DAY_MS;
    const stalePosting = seedPosting(t.jobsSqlite, { last_seen_at: old });
    const stale = seedUserJob(t.jobsSqlite, USER, {
      posting_id: stalePosting.id,
      inbox_state: "dismissed",
      updated_at: old,
    });
    t.jobsSqlite
      .query(
        "INSERT INTO match_scores (id, user_id, posting_id, profile_version, rubric_version, model, score, components, created_at) VALUES (?, ?, ?, 1, 'r1', 'm', 10, '{}', 0)"
      )
      .run(newId("scr"), USER, stalePosting.id);
    const tracked = seedUserJob(t.jobsSqlite, USER, {
      posting_id: seedPosting(t.jobsSqlite, { last_seen_at: old }).id,
      inbox_state: "tracked",
      updated_at: old,
    });
    const applied = seedApplication(t.jobsSqlite, USER, {
      user_job_id: seedUserJob(t.jobsSqlite, USER, {
        posting_id: seedPosting(t.jobsSqlite, { last_seen_at: old }).id,
        inbox_state: "seen",
        updated_at: old,
      }).id,
    });
    const fresh = seedUserJob(t.jobsSqlite, USER, { inbox_state: "new" });
    const report = await runRetention(ctxOf(t));
    expect(report.user_jobs).toBe(1);
    const left = (
      t.jobsSqlite.query("SELECT id FROM user_jobs").all() as Array<{
        id: string;
      }>
    ).map((r) => r.id);
    expect(left).not.toContain(stale.id);
    expect(left).toEqual(
      expect.arrayContaining([tracked.id, applied.user_job_id, fresh.id])
    );
    expect(n(t, "SELECT COUNT(*) AS n FROM match_scores")).toBe(0);
    expect(
      t.jobsSqlite
        .query(
          "SELECT entity, entity_id, revision, op FROM change_log WHERE user_id = ?"
        )
        .all(USER)
    ).toEqual([
      { entity: "user_job", entity_id: stale.id, revision: 2, op: "delete" },
    ]);
  });

  it("TP-RETENTION deletes discovery_run_items of runs older than 90 days", async () => {
    const t = createTestEnv();
    const run = (id: string, at: number) =>
      t.jobsSqlite
        .query(
          "INSERT INTO discovery_runs (id, user_id, device_id, sources, status, started_at, engine_version) VALUES (?, ?, 'dev_x', '[]', 'completed', ?, '0.1.0')"
        )
        .run(id, USER, at);
    run("run_old", NOW - 91 * DAY_MS);
    run("run_new", NOW - DAY_MS);
    const item = t.jobsSqlite.query(
      "INSERT INTO discovery_run_items (run_id, posting_id, user_id, outcome) VALUES (?, ?, ?, 'new')"
    );
    item.run("run_old", "pst_a", USER);
    item.run("run_new", "pst_b", USER);
    await runRetention(ctxOf(t));
    expect(
      t.jobsSqlite.query("SELECT run_id FROM discovery_run_items").all()
    ).toEqual([{ run_id: "run_new" }]);
  });

  it("TP-RETENTION drops telemetry after 90 days and ai_usage after 13 months", async () => {
    const t = createTestEnv();
    const tel = t.jobsSqlite.query(
      "INSERT INTO telemetry_daily (day, install_hash, cli_version, platform, counters) VALUES (?, 'abcdefgh', '0.1.0', 'macos', '{}')"
    );
    tel.run("2026-06-01");
    tel.run("2026-10-01");
    const ai = t.jobsSqlite.query(
      "INSERT INTO ai_usage (user_id, month, purpose) VALUES (?, ?, 'score')"
    );
    ai.run(USER, "2025-08");
    ai.run(USER, "2025-09");
    ai.run(USER, "2026-10");
    expect(monthsBefore(NOW, 13)).toBe("2025-09");
    await runRetention(ctxOf(t));
    expect(t.jobsSqlite.query("SELECT day FROM telemetry_daily").all()).toEqual(
      [{ day: "2026-10-01" }]
    );
    expect(
      t.jobsSqlite.query("SELECT month FROM ai_usage ORDER BY month").all()
    ).toEqual([{ month: "2025-09" }, { month: "2026-10" }]);
  });

  it("TP-RETENTION sweeps crash reports after 30 days and expired exports", async () => {
    const t = createTestEnv();
    await t.env.JOBS_FILES.put("telemetry/crash/2026-09-01/a.json", "{}");
    await t.env.JOBS_FILES.put("telemetry/crash/2026-10-10/b.json", "{}");
    const user = USER;
    const gone = "exp_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
    const kept = "exp_01JA6V8M3W8Z1T6Q4Y2B7K9C0B";
    for (const id of [gone, kept]) {
      await t.env.JOBS_FILES.put(`u/${user}/export/${id}.zip`, "zip");
      await t.env.JOBS_FILES.put(`u/${user}/export/${id}.json`, "{}");
    }
    await t.env.JOBS_FILES.put(exportIndexKey(NOW - 1, user, gone), "");
    await t.env.JOBS_FILES.put(exportIndexKey(NOW + DAY_MS, user, kept), "");
    const report = await runRetention(ctxOf(t));
    expect(report.crash_reports).toBe(1);
    expect(report.exports).toBe(1);
    const keys = [...t.r2.objects.keys()].sort();
    expect(keys).toEqual(
      [
        "telemetry/crash/2026-10-10/b.json",
        `u/${user}/export/${kept}.zip`,
        `u/${user}/export/${kept}.json`,
        exportIndexKey(NOW + DAY_MS, user, kept),
      ].sort()
    );
  });

  it("TP-RETENTION hard-deletes accounts tombstoned 30 days ago and re-drives unfinished purges", async () => {
    const t = createTestEnv();
    const clock = createFakeClock(NOW - 31 * DAY_MS);
    const client = createV1Client(t, { clock });
    const old = await client.cliSession("old@example.com");
    const recent = await client.cliSession("recent@example.com");
    const oldId = old.userId as string;
    const recentId = recent.userId as string;
    seedApplication(t.jobsSqlite, oldId);
    await t.env.JOBS_FILES.put(`u/${oldId}/run_log/x.jsonl`, "{}");
    await t.env.CV_KV.put("cv:old-cv-t-0123456789", "{}");
    await t.env.CV_KV.put("owner:cv:old-cv-t-0123456789", "old@example.com");
    t.sqlite
      .query("UPDATE users SET deleted_at = ? WHERE id = ?")
      .run(NOW - 31 * DAY_MS, oldId);
    t.sqlite
      .query("UPDATE users SET deleted_at = ? WHERE id = ?")
      .run(NOW - 7 * 3_600_000, recentId);
    for (const [id, email, at] of [
      [oldId, "old@example.com", NOW - 31 * DAY_MS],
      [recentId, "recent@example.com", NOW - 7 * 3_600_000],
    ] as const) {
      await writeDeletionRecord(t.env.JOBS_FILES, {
        user_id: id,
        email,
        also_delete_cvs: false,
        requested_at: at,
        confirmed_at: at,
        phases_done: [],
        completed_at: null,
        redrives: 0,
      });
    }
    const report = await runRetention(ctxOf(t));
    expect(report.hard_delete).toBe(1);
    expect(
      t.sqlite.query("SELECT id FROM users WHERE id = ?").get(oldId)
    ).toBeNull();
    for (const table of ["oauth_grants", "devices"]) {
      expect(
        (
          t.sqlite
            .query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`)
            .get(oldId) as {
            n: number;
          }
        ).n
      ).toBe(0);
    }
    expect(
      n(t, "SELECT COUNT(*) AS n FROM applications WHERE user_id = ?", oldId)
    ).toBe(0);
    expect(t.r2.objects.has(`u/${oldId}/run_log/x.jsonl`)).toBe(false);
    expect(t.r2.objects.has(`account-deletions/${oldId}.json`)).toBe(false);
    expect(await t.env.CV_KV.get("cv:old-cv-t-0123456789")).toBeNull();
    // The recent one is still tombstoned and its purge was re-sent.
    expect(
      t.sqlite.query("SELECT deleted_at FROM users WHERE id = ?").get(recentId)
    ).toBeTruthy();
    expect(report.purge_redrive).toBe(1);
    const redrive = t.queue.sent.filter((m) => m.body.type === "purge_user");
    expect(redrive.map((m) => m.body.user_id)).toEqual([recentId]);
  });

  it("TP-RETENTION capacity check logs a warning at 6 GB and an error at 8 GB", async () => {
    const t = createTestEnv();
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(
        await checkCapacity(ctxOf(t), () =>
          Promise.resolve(CAPACITY_WARN_BYTES + 1)
        )
      ).toBe(CAPACITY_WARN_BYTES + 1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(0);
      await checkCapacity(ctxOf(t), () =>
        Promise.resolve(CAPACITY_ERROR_BYTES)
      );
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[0]).toMatchObject({
        evt: "jobs_db_capacity",
        level: "error",
      });
      const real = await checkCapacity(ctxOf(t));
      expect(real).toBeGreaterThan(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("TP-RETENTION runs as part of the daily cron schedule", async () => {
    const t = createTestEnv();
    t.jobsSqlite
      .query(
        "INSERT INTO idempotency_keys (user_id, key, request_hash, status_code, response_body, created_at, expires_at) VALUES (?, 'k', 'h', 200, '{}', 0, 1)"
      )
      .run(USER);
    const report = await runScheduled(
      { cron: CRON_DAILY },
      t.env,
      createCtx(),
      {
        clock: createFakeClock(NOW),
      }
    );
    expect(report.ran).toContain("retention");
    expect(report.failed).not.toContain("retention");
    expect(n(t, "SELECT COUNT(*) AS n FROM idempotency_keys")).toBe(0);
  });
});
