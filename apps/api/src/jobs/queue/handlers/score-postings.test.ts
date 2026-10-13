import { describe, expect, it } from "bun:test";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import { getAiProvider } from "../../ai/provider";
import { utcMonth } from "../../core/clock";
import { trustedScope } from "../../core/scope";
import { recordAiUsageStatements } from "../../repo/core/ai-usage";
import { jobsDb } from "../../repo/core/db";
import { commitScore, readyScoreStatements } from "../../repo/scoring";
import {
  insertFact,
  scoreRows,
  scoringWorld,
  setConsent,
  trackedPosting,
  usageRows,
} from "../../routes/scoring/fixtures.test";
import type { ScoringWorld } from "../../routes/scoring/fixtures.test";

async function requestAll(world: ScoringWorld, ids: string[]): Promise<void> {
  const res = await world.web.post("/api/v1/scores:request", {
    posting_ids: ids,
  });
  expect(res.status).toBe(200);
}

const failing = (
  fail:
    | "rate_limited"
    | "upstream"
    | "timeout"
    | "bad_request"
    | "invalid_output"
) => ({
  ai: (env: Parameters<typeof getAiProvider>[0]) =>
    getAiProvider(env, { fake: { fail } }),
});

describe("T7-07 consumer idempotency (07 §7.2, 14 §6)", () => {
  it("T7-07 a redelivered message neither writes a second row nor counts the budget twice", async () => {
    const world = await scoringWorld();
    const ids = [trackedPosting(world, 0), trackedPosting(world, 1)];
    await requestAll(world, ids);
    const message = world.t.queue.sent[0].body;
    await world.drain();
    const rows = scoreRows(world);
    const usage = usageRows(world);
    const changes = world.t.jobsSqlite
      .query(
        "SELECT COUNT(*) AS n FROM change_log WHERE user_id = ? AND entity = 'score'"
      )
      .get(world.userId) as { n: number };
    expect(usage.score.calls).toBe(2);
    await world.t.env.JOBS_AI_QUEUE.send(message);
    await world.t.env.JOBS_AI_QUEUE.send(message);
    const report = await world.drain();
    expect(report.acked).toBe(2);
    expect(scoreRows(world)).toEqual(rows);
    expect(usageRows(world)).toEqual(usage);
    const after = world.t.jobsSqlite
      .query(
        "SELECT COUNT(*) AS n FROM change_log WHERE user_id = ? AND entity = 'score'"
      )
      .get(world.userId) as { n: number };
    expect(after.n).toBe(changes.n);
  });

  it("T7-07 a racing duplicate write is refused by the guard with its usage (one batch)", async () => {
    const world = await scoringWorld();
    const id = trackedPosting(world, 0);
    const db = jobsDb(world.t.env);
    const scope = trustedScope(world.userId, "script");
    const now = world.clock.now();
    const write = () => [
      ...readyScoreStatements(db, scope, {
        id: newId("scr", now),
        postingId: id,
        profileVersion: 1,
        rubricVersion: "r1",
        model: "gpt-6-luna",
        score: 70,
        confidence: 0.6,
        components: {},
        explanation: "70",
        now,
      }),
      ...recordAiUsageStatements(db, scope, {
        purpose: "score",
        inputTokens: 500,
        outputTokens: 0,
        costMicroUsd: 50,
        now,
        timezone: "Asia/Jakarta",
      }),
    ];
    expect(await commitScore(db, write())).toBe("written");
    expect(await commitScore(db, write())).toBe("already_ready");
    expect(usageRows(world).score).toEqual({ calls: 1, cost_micro_usd: 50 });
    expect(scoreRows(world)).toHaveLength(1);
  });
});

describe("T7-08 retries with backoff, then the DLQ writes a deterministic score", () => {
  it("T7-08 429 retries with min(300, 2^attempt * 10 + jitter) and the DLQ scores deterministically", async () => {
    const world = await scoringWorld();
    const ids = [trackedPosting(world, 0), trackedPosting(world, 3)];
    await requestAll(world, ids);
    const report = await world.drain(failing("rate_limited"));
    expect(report.retried).toBe(6);
    expect(report.deadLettered).toBe(1);
    const delays = world.t.queue.retries.map((r) => r.delaySeconds ?? -1);
    const bands = [
      [20, 30],
      [40, 50],
      [80, 90],
      [160, 170],
      [300, 300],
      [300, 300],
    ];
    delays.forEach((delay, i) => {
      expect(delay).toBeGreaterThanOrEqual(bands[i][0]);
      expect(delay).toBeLessThanOrEqual(bands[i][1]);
    });
    const rows = scoreRows(world);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "ready",
        model: "deterministic-only",
        confidence: null,
      });
      expect((row.components as { ai: { status: string } }).ai.status).toBe(
        "dlq"
      );
      expect(String(row.explanation)).toContain(
        "AI off: deterministic score only"
      );
      expect(Number(row.score)).toBeGreaterThan(0);
    }
    expect(usageRows(world).score).toBeUndefined();
  });

  it("T7-08 5xx and timeouts retry too; written postings are skipped on redelivery", async () => {
    const world = await scoringWorld();
    const ids = [trackedPosting(world, 0), trackedPosting(world, 1)];
    await requestAll(world, ids);
    let calls = 0;
    const flaky = {
      ai: (env: Parameters<typeof getAiProvider>[0]) => {
        calls += 1;
        return getAiProvider(env, {
          fake: calls === 1 ? { fail: "upstream" } : {},
        });
      },
    };
    const report = await world.drain(flaky);
    expect(report.retried).toBe(1);
    expect(report.deadLettered).toBe(0);
    expect(scoreRows(world).every((row) => row.model === "gpt-6-luna")).toBe(
      true
    );
    expect(usageRows(world).score.calls).toBe(2);
  });

  it("T7-08 a 400 / invalid output is not retried: deterministic score with ai.status error", async () => {
    for (const fail of ["bad_request", "invalid_output"] as const) {
      const world = await scoringWorld();
      await requestAll(world, [trackedPosting(world, 0)]);
      const report = await world.drain(failing(fail));
      expect(report.retried).toBe(0);
      const [row] = scoreRows(world);
      expect((row.components as { ai: { status: string } }).ai.status).toBe(
        "error"
      );
      expect(row.model).toBe("deterministic-only");
    }
  });
});

describe("T7-09 budget exhaustion switches to deterministic-only (D-34)", () => {
  it("T7-09 a spent month gives deterministic-only scores labelled 'AI matching paused'", async () => {
    const world = await scoringWorld();
    world.t.jobsSqlite
      .query(
        "INSERT INTO ai_usage (user_id, month, purpose, cost_micro_usd, calls) VALUES (?, ?, 'tailor_cv', 3000000, 10)"
      )
      .run(world.userId, utcMonth(world.clock.now()));
    await requestAll(world, [
      trackedPosting(world, 0),
      trackedPosting(world, 1),
    ]);
    await world.drain();
    for (const row of scoreRows(world)) {
      expect((row.components as { ai: { status: string } }).ai.status).toBe(
        "budget"
      );
      expect(String(row.explanation)).toContain(
        "AI matching paused for this month"
      );
      expect(row.status).toBe("ready");
    }
    expect(usageRows(world).score).toBeUndefined();
  });

  it("T7-09 the daily sub-cap applies too, and a nearly spent budget is never overdrawn", async () => {
    const world = await scoringWorld();
    const day = world.t.jobsSqlite;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(world.clock.now()));
    day
      .query(
        "INSERT INTO analytics_daily (user_id, day, metrics) VALUES (?, ?, ?)"
      )
      .run(world.userId, today, JSON.stringify({ ai_cost_micro_usd: 499_900 }));
    const ids = Array.from({ length: 6 }, (_, i) => trackedPosting(world, i));
    await requestAll(world, ids);
    await world.drain();
    const rows = scoreRows(world);
    const statuses = rows.map(
      (row) => (row.components as { ai: { status: string } }).ai.status
    );
    expect(statuses).toContain("budget");
    const spent = usageRows(world).score?.cost_micro_usd ?? 0;
    expect(499_900 + spent).toBeLessThanOrEqual(500_000);
    expect(statuses.filter((s) => s === "ok")).toHaveLength(
      usageRows(world).score?.calls ?? 0
    );
  });
});

describe("TAI-DISABLED scoring without AI (D-33, 11 §11)", () => {
  it("TAI-DISABLED AI_DISABLED or no consent → deterministic-only 'disabled', no spend", async () => {
    const flagged = await scoringWorld();
    await flagged.t.setFlag("AI_DISABLED", true);
    await requestAll(flagged, [trackedPosting(flagged, 0)]);
    await flagged.drain();
    const [row] = scoreRows(flagged);
    expect((row.components as { ai: { status: string } }).ai.status).toBe(
      "disabled"
    );
    expect(String(row.explanation)).toContain("AI matching is turned off");
    expect(usageRows(flagged)).toEqual({});

    const noConsent = await scoringWorld({ consent: false });
    await requestAll(noConsent, [trackedPosting(noConsent, 0)]);
    await noConsent.drain();
    expect(
      (scoreRows(noConsent)[0].components as { ai: { status: string } }).ai
        .status
    ).toBe("disabled");
    expect(usageRows(noConsent)).toEqual({});
  });

  it("TAI-DISABLED a thin profile skips the AI (status skipped, confidence null)", async () => {
    const world = await scoringWorld();
    world.t.jobsSqlite
      .query("DELETE FROM applicant_facts WHERE user_id = ?")
      .run(world.userId);
    setConsent(world.t, world.userId, world.clock.now());
    await requestAll(world, [trackedPosting(world, 0)]);
    await world.drain();
    const [row] = scoreRows(world);
    expect((row.components as { ai: { status: string } }).ai.status).toBe(
      "skipped"
    );
    expect(row.confidence).toBeNull();
    expect(
      (row.components as { features: { skills_overlap: unknown } }).features
        .skills_overlap
    ).toBeNull();
  });
});

describe("score_postings consumer housekeeping", () => {
  it("drops placeholders of an outdated profile_version and hands ready postings to evaluate_rules", async () => {
    const world = await scoringWorld();
    const stale = trackedPosting(world, 0);
    await requestAll(world, [stale]);
    world.clock.advance(1000);
    insertFact(
      world.t,
      world.userId,
      "skills.extra",
      ["Go"],
      world.clock.now()
    );
    await world.drain();
    expect(scoreRows(world)).toHaveLength(0);

    const now = world.clock.now();
    world.t.jobsSqlite
      .query(
        "INSERT INTO automation_rules (id, user_id, name, enabled, mode, criteria, limits, created_at, updated_at) VALUES (?, ?, 'r', 1, 'approval', '{}', '{}', ?, ?)"
      )
      .run(newId("rul", now), world.userId, now, now);
    const fresh = trackedPosting(world, 1);
    await requestAll(world, [stale, fresh]);
    const evaluated: string[][] = [];
    await world.drain(
      {},
      {
        handlers: {
          evaluate_rules: (qc) => {
            evaluated.push(qc.message.posting_ids);
            return Promise.resolve({ action: "ack" });
          },
        },
      }
    );
    expect(evaluated).toHaveLength(1);
    expect(evaluated[0].sort()).toEqual([stale, fresh].sort());
  });
});
