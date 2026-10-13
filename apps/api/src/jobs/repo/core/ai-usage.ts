// Per-user AI budget (D-34, 07 §9, 14 §9.4): $3.00 per user per month
// (`JOBS_AI_MONTHLY_BUDGET_USD`), a $0.50 daily sub-cap, a warning at 80 % of
// the month. Shared by every purpose (score, tailor_cv, agent, email_draft).
// No admin exemption. Exhaustion ⇒ `429 ai_budget_exhausted` on synchronous
// AI routes, deterministic-only scores in the consumer, the agent pauses
// (`ai_unavailable`).
//
// Exact accounting from D1 (never the KV limiter):
//   month spend  SUM(ai_usage.cost_micro_usd) for the UTC month (04 §2.7)
//   day spend    analytics_daily.metrics.ai_cost_micro_usd for the user's
//                local day (user_settings.timezone, 10 §5)
//
//   const status = await getAiBudgetStatus(db, scope, { env, now, timezone, estimateMicroUsd });
//   assertAiBudget(status);                          // 429 when exhausted
//   const result = await provider.decide(…);
//   await runBatch(db, [...resultWrites, ...recordAiUsageStatements(db, scope, {
//     purpose: "score", usage: result.usage, now, timezone,
//   })]);                                            // same batch as the result
//
// The analytics rollup (leaf-2.9) recomputes `analytics_daily` from events and
// must carry `ai_cost_micro_usd` over (it is not derivable from events).

import type { AiUsagePurpose } from "@pilihpendidikan/jobs-contracts/enums";
import { AI_USAGE_PURPOSES } from "@pilihpendidikan/jobs-contracts/enums";
import type { Env } from "../../../env";
import { localDay, utcMonth } from "../../core/clock";
import { apiError } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "./db";
import { queryAll, queryFirst, stmt } from "./db";

export const MICRO_USD_PER_USD = 1_000_000;
/** D-34 defaults. */
export const DEFAULT_MONTHLY_BUDGET_MICRO_USD = 3_000_000;
export const DAILY_BUDGET_MICRO_USD = 500_000;
export const BUDGET_WARNING_RATIO = 0.8;

export interface AiBudgetLimits {
  dailyMicroUsd: number;
  monthlyMicroUsd: number;
}

/** Limits from `JOBS_AI_MONTHLY_BUDGET_USD` (default $3.00) + the daily cap. */
export function budgetLimits(
  env: Pick<Env, "JOBS_AI_MONTHLY_BUDGET_USD">
): AiBudgetLimits {
  const usd = Number(env.JOBS_AI_MONTHLY_BUDGET_USD ?? "");
  const monthly =
    Number.isFinite(usd) && usd > 0
      ? Math.round(usd * MICRO_USD_PER_USD)
      : DEFAULT_MONTHLY_BUDGET_MICRO_USD;
  return {
    monthlyMicroUsd: monthly,
    dailyMicroUsd: Math.min(DAILY_BUDGET_MICRO_USD, monthly),
  };
}

export interface PurposeUsage {
  calls: number;
  cost_micro_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface AiBudgetStatus {
  byPurpose: Record<AiUsagePurpose, PurposeUsage>;
  day: string;
  daySpentMicroUsd: number;
  /** Set when a call costing the estimate would cross a cap. */
  exhausted: "monthly" | "daily" | null;
  limits: AiBudgetLimits;
  month: string;
  monthSpentMicroUsd: number;
  /** Month budget left (never negative). */
  remainingMicroUsd: number;
  /** ≥ 80 % of the monthly budget spent (the dashboard / CLI warning). */
  warning: boolean;
}

function emptyUsage(): Record<AiUsagePurpose, PurposeUsage> {
  const out = {} as Record<AiUsagePurpose, PurposeUsage>;
  for (const purpose of AI_USAGE_PURPOSES) {
    out[purpose] = {
      calls: 0,
      cost_micro_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
    };
  }
  return out;
}

/**
 * The user's budget position. `estimateMicroUsd` is the expected cost of the
 * call about to be made; the budget is exhausted when it would cross a cap.
 */
export async function getAiBudgetStatus(
  db: JobsDb,
  scope: UserScope,
  options: {
    env: Pick<Env, "JOBS_AI_MONTHLY_BUDGET_USD">;
    estimateMicroUsd?: number;
    now: number;
    timezone: string;
  }
): Promise<AiBudgetStatus> {
  const limits = budgetLimits(options.env);
  const month = utcMonth(options.now);
  const day = localDay(options.now, options.timezone);
  const rows = await queryAll<{ purpose: AiUsagePurpose } & PurposeUsage>(
    db,
    "SELECT purpose, calls, input_tokens, output_tokens, cost_micro_usd FROM ai_usage WHERE user_id = ? AND month = ?",
    scope.userId,
    month
  );
  const byPurpose = emptyUsage();
  let monthSpent = 0;
  for (const row of rows) {
    if (row.purpose in byPurpose) {
      byPurpose[row.purpose] = {
        calls: row.calls,
        cost_micro_usd: row.cost_micro_usd,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
      };
    }
    monthSpent += row.cost_micro_usd;
  }
  const daily = await queryFirst<{ spent: number | null }>(
    db,
    "SELECT json_extract(metrics, '$.ai_cost_micro_usd') AS spent FROM analytics_daily WHERE user_id = ? AND day = ?",
    scope.userId,
    day
  );
  const daySpent = daily?.spent ?? 0;
  const estimate = Math.max(0, options.estimateMicroUsd ?? 0);
  let exhausted: AiBudgetStatus["exhausted"] = null;
  if (
    monthSpent >= limits.monthlyMicroUsd ||
    monthSpent + estimate > limits.monthlyMicroUsd
  ) {
    exhausted = "monthly";
  } else if (
    daySpent >= limits.dailyMicroUsd ||
    daySpent + estimate > limits.dailyMicroUsd
  ) {
    exhausted = "daily";
  }
  return {
    month,
    day,
    monthSpentMicroUsd: monthSpent,
    daySpentMicroUsd: daySpent,
    limits,
    remainingMicroUsd: Math.max(0, limits.monthlyMicroUsd - monthSpent),
    warning: monthSpent >= limits.monthlyMicroUsd * BUDGET_WARNING_RATIO,
    exhausted,
    byPurpose,
  };
}

/** `429 ai_budget_exhausted` (05 §1.3) when the budget is spent. */
export function assertAiBudget(status: AiBudgetStatus): void {
  if (status.exhausted) {
    throw apiError(
      "ai_budget_exhausted",
      status.exhausted === "monthly"
        ? "This month's AI budget is used up. AI features resume next month."
        : "Today's AI budget is used up. AI features resume tomorrow.",
      {
        details: {
          cap: status.exhausted,
          month_spent_micro_usd: status.monthSpentMicroUsd,
          day_spent_micro_usd: status.daySpentMicroUsd,
          monthly_limit_micro_usd: status.limits.monthlyMicroUsd,
          daily_limit_micro_usd: status.limits.dailyMicroUsd,
        },
      }
    );
  }
}

export interface AiUsageRecord {
  /** Calls to count (default 1). */
  calls?: number;
  costMicroUsd: number;
  inputTokens: number;
  now: number;
  outputTokens: number;
  purpose: AiUsagePurpose;
  /** The user's IANA zone (`user_settings.timezone`) for the daily cap. */
  timezone: string;
}

/**
 * Increments the month counters of one purpose and today's spend. Put these
 * statements in the same batch as the AI result write, so a retried message
 * that does not write its result does not count twice (04 §2.7, 07 T7-07).
 */
export function recordAiUsageStatements(
  db: JobsDb,
  scope: UserScope,
  usage: AiUsageRecord
): D1PreparedStatement[] {
  const cost = Math.max(0, Math.round(usage.costMicroUsd));
  const calls = usage.calls ?? 1;
  return [
    stmt(
      db,
      "INSERT INTO ai_usage (user_id, month, purpose, input_tokens, output_tokens, cost_micro_usd, calls) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, month, purpose) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, cost_micro_usd = cost_micro_usd + excluded.cost_micro_usd, calls = calls + excluded.calls",
      scope.userId,
      utcMonth(usage.now),
      usage.purpose,
      Math.max(0, usage.inputTokens),
      Math.max(0, usage.outputTokens),
      cost,
      calls
    ),
    stmt(
      db,
      "INSERT INTO analytics_daily (user_id, day, metrics) VALUES (?, ?, json_object('ai_cost_micro_usd', ?)) ON CONFLICT(user_id, day) DO UPDATE SET metrics = json_set(metrics, '$.ai_cost_micro_usd', COALESCE(json_extract(metrics, '$.ai_cost_micro_usd'), 0) + ?)",
      scope.userId,
      localDay(usage.now, usage.timezone),
      cost,
      cost
    ),
  ];
}
