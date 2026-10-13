// Submission limits counted from `submit_intent` events (21 §6.5, D-35,
// 11 T-11). A `submit_intent` event is appended in the same batch that
// records `submit_intent_at`, so these counts are exactly "submissions the
// server allowed". Windows are rolling (last 24 h / 30 d).
//
// The counts are read for a fast, explained refusal; the same predicates are
// repeated as GUARDS inside the submit-intent batch, so two concurrent
// intents cannot both slip under a cap (D1 runs batches one at a time).

import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { guard, queryAll, queryFirst } from "../core/db";

export interface IntentCounts {
  /** Every submit_intent of the user in the last 24 h (global cap). */
  global24h: number;
  /** submit_intent events in the last hour (T-11 anomaly signal). */
  lastHour: number;
  /** Intents for this company in the last 30 days (null: no company key). */
  company30d: number | null;
  /** Intents under this rule in the last 24 h (null: no rule). */
  rule24h: number | null;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const COMPANY_WINDOW_MS = 30 * DAY_MS;
export const RULE_WINDOW_MS = DAY_MS;
export const GLOBAL_WINDOW_MS = DAY_MS;

async function count(
  db: JobsDb,
  sql: string,
  ...binds: unknown[]
): Promise<number> {
  const row = await queryFirst<{ n: number }>(db, sql, ...binds);
  return row?.n ?? 0;
}

export async function intentCounts(
  db: JobsDb,
  scope: UserScope,
  input: { companyKey: string | null; now: number; ruleId: string | null }
): Promise<IntentCounts> {
  const global24h = await count(
    db,
    "SELECT COUNT(*) AS n FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND recorded_at > ?",
    scope.userId,
    input.now - GLOBAL_WINDOW_MS
  );
  const lastHour = await count(
    db,
    "SELECT COUNT(*) AS n FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND recorded_at > ?",
    scope.userId,
    input.now - HOUR_MS
  );
  const rule24h = input.ruleId
    ? await count(
        db,
        "SELECT COUNT(*) AS n FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND recorded_at > ? AND json_extract(payload, '$.rule_id') = ?",
        scope.userId,
        input.now - RULE_WINDOW_MS,
        input.ruleId
      )
    : null;
  const company30d = input.companyKey
    ? await count(
        db,
        "SELECT COUNT(*) AS n FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND recorded_at > ? AND json_extract(payload, '$.company_key') = ?",
        scope.userId,
        input.now - COMPANY_WINDOW_MS,
        input.companyKey
      )
    : null;
  return { global24h, lastHour, rule24h, company30d };
}

/** Guard: fewer than `max` submit_intents in the last 24 h (global cap). */
export function guardGlobalCap(
  db: JobsDb,
  scope: UserScope,
  now: number,
  max: number
): D1PreparedStatement {
  return guard(
    db,
    "limit:global",
    "SELECT 1 WHERE (SELECT COUNT(*) FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND recorded_at > ?) < ?",
    scope.userId,
    now - GLOBAL_WINDOW_MS,
    max
  );
}

/** Guard: fewer than `max` intents under `ruleId` in the last 24 h. */
export function guardRuleCap(
  db: JobsDb,
  scope: UserScope,
  ruleId: string,
  now: number,
  max: number
): D1PreparedStatement {
  return guard(
    db,
    "limit:rule",
    "SELECT 1 WHERE (SELECT COUNT(*) FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND recorded_at > ? AND json_extract(payload, '$.rule_id') = ?) < ?",
    scope.userId,
    now - RULE_WINDOW_MS,
    ruleId,
    max
  );
}

/** Guard: fewer than `max` intents for `companyKey` in the last 30 days. */
export function guardCompanyCap(
  db: JobsDb,
  scope: UserScope,
  companyKey: string,
  now: number,
  max: number
): D1PreparedStatement {
  return guard(
    db,
    "limit:company",
    "SELECT 1 WHERE (SELECT COUNT(*) FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND recorded_at > ? AND json_extract(payload, '$.company_key') = ?) < ?",
    scope.userId,
    now - COMPANY_WINDOW_MS,
    companyKey,
    max
  );
}

/** Times an approval already backed a submit_intent (single use, T-06). */
export async function approvalUses(
  db: JobsDb,
  scope: UserScope,
  approvalId: string
): Promise<number> {
  return await count(
    db,
    "SELECT COUNT(*) AS n FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND json_extract(payload, '$.approval_id') = ?",
    scope.userId,
    approvalId
  );
}

/** Guard: the approval has not backed a submit_intent yet. */
export function guardApprovalUnused(
  db: JobsDb,
  scope: UserScope,
  approvalId: string
): D1PreparedStatement {
  return guard(
    db,
    "limit:approval_used",
    "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND json_extract(payload, '$.approval_id') = ?)",
    scope.userId,
    approvalId
  );
}

/** submit_intent events of one task (at most one re-submit, 19 §9.2). */
export async function taskIntentCount(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<number> {
  return await count(
    db,
    "SELECT COUNT(*) AS n FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND task_id = ?",
    scope.userId,
    taskId
  );
}

/** Tasks a rule created in a window (rule path, 21 §4), optionally per company. */
export async function ruleTasksCreated(
  db: JobsDb,
  scope: UserScope,
  input: { companyKey?: string; ruleId: string; since: number }
): Promise<number> {
  if (input.companyKey) {
    return await count(
      db,
      "SELECT COUNT(*) AS n FROM automation_tasks WHERE user_id = ? AND created_by = 'rule' AND created_at > ? AND json_extract(payload, '$.rule_id') = ? AND json_extract(payload, '$.company_key') = ? AND state NOT IN ('cancelled', 'expired')",
      scope.userId,
      input.since,
      input.ruleId,
      input.companyKey
    );
  }
  return await count(
    db,
    "SELECT COUNT(*) AS n FROM automation_tasks WHERE user_id = ? AND created_by = 'rule' AND created_at > ? AND json_extract(payload, '$.rule_id') = ? AND state NOT IN ('cancelled', 'expired')",
    scope.userId,
    input.since,
    input.ruleId
  );
}

/** True when this attempt passed the submit checkpoint (late evidence, 20 §6.3 A). */
export async function attemptHadIntent(
  db: JobsDb,
  scope: UserScope,
  attemptId: string
): Promise<boolean> {
  return (
    (await count(
      db,
      "SELECT COUNT(*) AS n FROM application_events WHERE user_id = ? AND type = 'submit_intent' AND attempt_id = ?",
      scope.userId,
      attemptId
    )) > 0
  );
}

/** Which of these event idempotency keys are already stored. */
export async function existingEventKeys(
  db: JobsDb,
  scope: UserScope,
  keys: readonly string[]
): Promise<Set<string>> {
  if (keys.length === 0) {
    return new Set();
  }
  const rows = await queryAll<{ idempotency_key: string }>(
    db,
    `SELECT idempotency_key FROM application_events WHERE user_id = ? AND idempotency_key IN (${keys.map(() => "?").join(", ")})`,
    scope.userId,
    ...keys
  );
  return new Set(rows.map((row) => row.idempotency_key));
}
