// JOBS_DB access of the AI proxy (05 §9, 19 §6, 21 §11): the lease an AI
// call is bound to, the user's facts and answers for field planning, and the
// usage write (`ai_usage` + `automation_attempts.ai_calls`). Every statement
// is scoped by `user_id` (T11-SQL).

import type {
  AnswerKind,
  AutoUse,
  Sensitivity,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeJson, queryAll, queryFirst, runBatch, stmt } from "../core/db";

/** Task states that keep a lease (21 §5–§7). */
export const LEASED_STATES = [
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
] as const;

export interface TaskLease {
  application_id: string | null;
  attempt_id: string | null;
  kind: string;
  lease_device_id: string | null;
  lease_expires_at: number | null;
  lease_id: string | null;
  /** `payload.mode` of the task (assisted / approval / auto), if set. */
  mode: string | null;
  state: string;
  task_id: string;
}

/** The task (owned by the user) and the attempt of its current lease. */
export async function findTaskLease(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<TaskLease | null> {
  const row = await queryFirst<{
    application_id: string | null;
    attempt_id: string | null;
    id: string;
    kind: string;
    lease_device_id: string | null;
    lease_expires_at: number | null;
    lease_id: string | null;
    payload: string;
    state: string;
  }>(
    db,
    "SELECT t.id, t.kind, t.state, t.application_id, t.lease_id, t.lease_device_id, t.lease_expires_at, t.payload, a.id AS attempt_id FROM automation_tasks t LEFT JOIN automation_attempts a ON a.lease_id = t.lease_id AND a.user_id = t.user_id WHERE t.id = ? AND t.user_id = ?",
    taskId,
    scope.userId
  );
  if (!row) {
    return null;
  }
  const payload = decodeJson<{ mode?: unknown }>(row.payload, {});
  return {
    task_id: row.id,
    kind: row.kind,
    state: row.state,
    application_id: row.application_id,
    lease_id: row.lease_id,
    lease_device_id: row.lease_device_id,
    lease_expires_at: row.lease_expires_at,
    attempt_id: row.attempt_id,
    mode: typeof payload.mode === "string" ? payload.mode : null,
  };
}

/** `ai_calls + n` on the attempt of a lease (19 §11, 11 §9). */
export function attemptAiCallsStatement(
  db: JobsDb,
  scope: UserScope,
  lease: { leaseId: string; taskId: string },
  calls: number
): D1PreparedStatement {
  return stmt(
    db,
    "UPDATE automation_attempts SET ai_calls = ai_calls + ? WHERE lease_id = ? AND task_id = ? AND user_id = ?",
    calls,
    lease.leaseId,
    lease.taskId,
    scope.userId
  );
}

/** Runs usage statements on their own (a call that failed after spending). */
export async function recordUsageNow(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  await runBatch(db, statements);
}

export interface StoredFact {
  cv_entry_id: string | null;
  cv_id: string | null;
  id: string;
  key: string;
  source: string;
  /** Parsed JSON value. */
  value: unknown;
}

export interface StoredAnswer {
  answer: string;
  answer_kind: AnswerKind;
  auto_use: AutoUse;
  id: string;
  match_patterns: string[];
  question_key: string;
  sensitivity: Sensitivity;
}

/** The user's applicant facts and screening answers (19 §6.1). */
export async function loadFactsAndAnswers(
  db: JobsDb,
  scope: UserScope
): Promise<{ answers: StoredAnswer[]; facts: StoredFact[] }> {
  const facts = await queryAll<{
    cv_entry_id: string | null;
    cv_id: string | null;
    id: string;
    key: string;
    source: string;
    value: string;
  }>(
    db,
    "SELECT id, key, value, source, cv_id, cv_entry_id FROM applicant_facts WHERE user_id = ? ORDER BY key",
    scope.userId
  );
  const answers = await queryAll<{
    answer: string;
    answer_kind: AnswerKind;
    auto_use: AutoUse;
    id: string;
    match_patterns: string;
    question_key: string;
    sensitivity: Sensitivity;
  }>(
    db,
    "SELECT id, question_key, match_patterns, answer, answer_kind, sensitivity, auto_use FROM screening_answers WHERE user_id = ? ORDER BY question_key",
    scope.userId
  );
  return {
    facts: facts.map((fact) => ({
      ...fact,
      value: decodeJson<unknown>(fact.value, null),
    })),
    answers: answers.map((answer) => {
      const patterns = decodeJson<unknown>(answer.match_patterns, []);
      return {
        ...answer,
        match_patterns: Array.isArray(patterns)
          ? patterns.filter((p): p is string => typeof p === "string")
          : [],
      };
    }),
  };
}
