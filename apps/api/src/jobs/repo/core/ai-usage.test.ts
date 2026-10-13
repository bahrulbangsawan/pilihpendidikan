import { beforeEach, describe, expect, it } from "bun:test";
import type { TestEnv } from "../../../../test/fakes";
import { createTestEnv } from "../../../../test/fakes";
import { costMicroUsd, estimateTokens } from "../../ai/primitives";
import { ApiError } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { trustedScope } from "../../core/scope";
import {
  assertAiBudget,
  budgetLimits,
  getAiBudgetStatus,
  recordAiUsageStatements,
} from "./ai-usage";
import type { JobsDb } from "./db";
import { jobsDb, runBatch } from "./db";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
// 2026-10-12 20:00 UTC = 2026-10-13 03:00 in Jakarta.
const NOW = Date.UTC(2026, 9, 12, 20);
const TZ = "Asia/Jakarta";

let t: TestEnv;
let db: JobsDb;
let scope: UserScope;

beforeEach(() => {
  t = createTestEnv();
  db = jobsDb(t.env);
  scope = trustedScope(USER, "script");
});

async function spend(
  purpose: "score" | "tailor_cv" | "agent" | "email_draft",
  micro: number,
  now = NOW
) {
  await runBatch(
    db,
    recordAiUsageStatements(db, scope, {
      purpose,
      inputTokens: 1000,
      outputTokens: 10,
      costMicroUsd: micro,
      now,
      timezone: TZ,
    })
  );
}

const status = (estimate = 0, now = NOW) =>
  getAiBudgetStatus(db, scope, {
    env: t.env,
    now,
    timezone: TZ,
    estimateMicroUsd: estimate,
  });

describe("TCORE-BUDGET per-user AI budget (D-34)", () => {
  it("TCORE-BUDGET defaults: $3.00 a month, $0.50 a day, env override", () => {
    expect(budgetLimits({})).toEqual({
      monthlyMicroUsd: 3_000_000,
      dailyMicroUsd: 500_000,
    });
    expect(budgetLimits({ JOBS_AI_MONTHLY_BUDGET_USD: "10" })).toEqual({
      monthlyMicroUsd: 10_000_000,
      dailyMicroUsd: 500_000,
    });
    expect(
      budgetLimits({ JOBS_AI_MONTHLY_BUDGET_USD: "0.2" }).dailyMicroUsd
    ).toBe(200_000);
    expect(
      budgetLimits({ JOBS_AI_MONTHLY_BUDGET_USD: "junk" }).monthlyMicroUsd
    ).toBe(3_000_000);
  });

  it("TCORE-BUDGET counts per purpose, per UTC month and per local day", async () => {
    await spend("score", 200);
    await spend("score", 300);
    await spend("tailor_cv", 36_000);
    const s = await status();
    expect(s.month).toBe("2026-10");
    expect(s.day).toBe("2026-10-13");
    expect(s.monthSpentMicroUsd).toBe(36_500);
    expect(s.daySpentMicroUsd).toBe(36_500);
    expect(s.byPurpose.score).toEqual({
      calls: 2,
      input_tokens: 2000,
      output_tokens: 20,
      cost_micro_usd: 500,
    });
    expect(s.byPurpose.agent.calls).toBe(0);
    expect(s.exhausted).toBeNull();
    expect(s.warning).toBe(false);
    const metrics = t.jobsSqlite
      .query("SELECT metrics FROM analytics_daily WHERE user_id = ?")
      .get(USER) as {
      metrics: string;
    };
    expect(JSON.parse(metrics.metrics)).toEqual({ ai_cost_micro_usd: 36_500 });
  });

  it("TCORE-BUDGET the daily sub-cap and the monthly cap exhaust (429 ai_budget_exhausted)", async () => {
    await spend("agent", 499_900);
    expect((await status()).exhausted).toBeNull();
    expect((await status(200)).exhausted).toBe("daily");
    await spend("agent", 100);
    const daily = await status();
    expect(daily.exhausted).toBe("daily");
    let code: string | null = null;
    try {
      assertAiBudget(daily);
    } catch (err) {
      code = err instanceof ApiError ? `${err.code}:${err.status}` : "other";
    }
    expect(code).toBe("ai_budget_exhausted:429");
    // Next local day: fresh daily budget, same month.
    const tomorrow = NOW + 86_400_000;
    expect((await status(0, tomorrow)).exhausted).toBeNull();
    for (let day = 1; day <= 5; day++) {
      await spend("agent", 499_000, NOW + day * 86_400_000);
    }
    const month = await status(0, NOW + 6 * 86_400_000);
    expect(month.monthSpentMicroUsd).toBe(3_000_000 - 5000);
    expect(month.warning).toBe(true);
    expect((await status(6000, NOW + 6 * 86_400_000)).exhausted).toBe(
      "monthly"
    );
  });

  it("TCORE-BUDGET usage written in a failed batch is not counted", async () => {
    const statements = [
      ...recordAiUsageStatements(db, scope, {
        purpose: "score",
        inputTokens: 1,
        outputTokens: 0,
        costMicroUsd: 999,
        now: NOW,
        timezone: TZ,
      }),
      // The result write fails: the whole batch rolls back (07 T7-07).
      ...recordAiUsageStatements(db, scope, {
        purpose: "bogus" as "score",
        inputTokens: 1,
        outputTokens: 0,
        costMicroUsd: 1,
        now: NOW,
        timezone: TZ,
      }),
    ];
    await expect(runBatch(db, statements)).rejects.toThrow();
    expect((await status()).monthSpentMicroUsd).toBe(0);
  });

  it("TCORE-BUDGET prices calls in micro-USD", () => {
    expect(costMicroUsd("gpt-6-luna", 1_000_000, 0)).toBe(100_000);
    expect(costMicroUsd("gpt-6.1-sol", 8000, 2000)).toBe(36_000);
    expect(costMicroUsd("unknown-model", 1000, 0)).toBe(10_000);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});
