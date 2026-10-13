// Lease-scoped writes (21 §5–§6, §11): heartbeat, step events, submit
// intent, result, release. Every batch starts with the FENCE: the task is
// the caller's, the lease id and the holding device match, the lease is
// unexpired and the state still holds a lease. A failed fence aborts the
// whole batch and the service answers `409 lease_lost` (21 §5.3).

import type {
  AttemptOutcome,
  TaskState,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { SubmissionEvidenceRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import { appendChange } from "../core/change-log";
import type { JobsDb, SqlValue } from "../core/db";
import { encodeJson, guard, stmt } from "../core/db";
import { LEASE_DURATION_MS } from "../core/leases";
import { HOLDING_IN, HOLDING_STATES } from "./records";
import { taskChange } from "./tasks";

/** Guard labels of lease fences start with this (→ 409 lease_lost). */
export const FENCE_LABEL_PREFIX = "fence:";

/** Attempts have no revision column: closing one is change revision 2. */
const ATTEMPT_CLOSED_REVISION = 2;

export interface LeaseRef {
  deviceId: string;
  leaseId: string;
  taskId: string;
}

/**
 * The fence (21 §5.3 rule 1, §11): user, task, lease id, holding device,
 * unexpired lease, a lease-holding state — optionally the exact state read.
 */
export function fenceGuard(
  db: JobsDb,
  scope: UserScope,
  ref: LeaseRef,
  now: number,
  expectedState?: TaskState
): D1PreparedStatement {
  const stateSql = expectedState ? " AND state = ?" : "";
  const binds: unknown[] = [
    ref.taskId,
    scope.userId,
    ref.leaseId,
    ref.deviceId,
    ...HOLDING_STATES,
    now,
  ];
  if (expectedState) {
    binds.push(expectedState);
  }
  return guard(
    db,
    `${FENCE_LABEL_PREFIX}${ref.taskId}:${ref.leaseId}`,
    `SELECT 1 FROM automation_tasks WHERE id = ? AND user_id = ? AND lease_id = ? AND lease_device_id = ? AND state IN (${HOLDING_IN}) AND lease_expires_at > ?${stateSql}`,
    ...binds
  );
}

const COLUMN_RE = /^[a-z_]+$/;

/** A column assignment; `{json}` values are encoded, `{sql}` is trusted SQL. */
export type FieldValue =
  | SqlValue
  | boolean
  | { json: unknown }
  | { sql: string };

function assignments(fields: ReadonlyArray<readonly [string, FieldValue]>): {
  binds: unknown[];
  sql: string;
} {
  const parts: string[] = [];
  const binds: unknown[] = [];
  for (const [column, value] of fields) {
    if (!COLUMN_RE.test(column)) {
      throw new Error(`not a column: ${column}`);
    }
    if (value !== null && typeof value === "object" && "sql" in value) {
      parts.push(`${column} = ${value.sql}`);
    } else if (value !== null && typeof value === "object" && "json" in value) {
      parts.push(`${column} = ?`);
      binds.push(encodeJson(value.json));
    } else {
      parts.push(`${column} = ?`);
      binds.push(value);
    }
  }
  return { sql: parts.join(", "), binds };
}

/** Clears the lease columns (terminal reports, release). */
export const CLEAR_LEASE: ReadonlyArray<readonly [string, FieldValue]> = [
  ["lease_id", null],
  ["lease_device_id", null],
  ["lease_expires_at", null],
];

/**
 * One fenced UPDATE of the task under the caller's lease (revision + 1,
 * updated_at) and its change_log row. `extraWhere` narrows further (e.g.
 * `submit_intent_at IS NULL` on every re-queue, D-19).
 */
export function leaseTaskUpdate(
  db: JobsDb,
  scope: UserScope,
  ref: LeaseRef,
  now: number,
  fields: ReadonlyArray<readonly [string, FieldValue]>,
  options: { extraWhere?: string; logChange?: boolean } = {}
): D1PreparedStatement[] {
  const set = assignments(fields);
  const statements = [
    stmt(
      db,
      `UPDATE automation_tasks SET ${set.sql}, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id = ? AND lease_device_id = ?${options.extraWhere ? ` AND ${options.extraWhere}` : ""}`,
      ...set.binds,
      now,
      ref.taskId,
      scope.userId,
      ref.leaseId,
      ref.deviceId
    ),
  ];
  if (options.logChange !== false) {
    statements.push(taskChange(db, scope, ref.taskId, now));
  }
  return statements;
}

export interface HeartbeatWrite {
  attemptId: string | null;
  /** Clear `resume_requested` (it is delivered by this response). */
  clearResume: boolean;
  localState: string | null;
  /** Append change_log (state or progress.stage changed, 21 §5.2). */
  logChange: boolean;
  now: number;
  progress: unknown;
}

/** 21 §5.2: extend the lease, store progress, `claimed → running`. */
export function heartbeatStatements(
  db: JobsDb,
  scope: UserScope,
  ref: LeaseRef,
  write: HeartbeatWrite
): D1PreparedStatement[] {
  const statements = [
    fenceGuard(db, scope, ref, write.now),
    stmt(
      db,
      `UPDATE automation_tasks SET lease_expires_at = ?, progress = ?, local_state = ?, state = CASE WHEN state = 'claimed' THEN 'running' ELSE state END, resume_requested = CASE WHEN ? = 1 THEN 0 ELSE resume_requested END, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id = ? AND lease_device_id = ? AND state IN (${HOLDING_IN}) AND lease_expires_at > ?`,
      write.now + LEASE_DURATION_MS,
      encodeJson(write.progress),
      write.localState,
      write.clearResume ? 1 : 0,
      write.now,
      ref.taskId,
      scope.userId,
      ref.leaseId,
      ref.deviceId,
      ...HOLDING_STATES,
      write.now
    ),
    stmt(
      db,
      "UPDATE automation_attempts SET last_heartbeat_at = ? WHERE user_id = ? AND task_id = ? AND lease_id = ?",
      write.now,
      scope.userId,
      ref.taskId,
      ref.leaseId
    ),
  ];
  if (write.logChange) {
    statements.push(taskChange(db, scope, ref.taskId, write.now));
  }
  return statements;
}

export interface AttemptClose {
  aiCalls?: number | null;
  attemptId: string;
  errorClass?: string | null;
  logFileId?: string | null;
  now: number;
  outcome: AttemptOutcome;
  stepsCount?: number | null;
}

/** Closes an attempt (21 §6.6): end time, outcome, counters, step log. */
export function closeAttemptStatements(
  db: JobsDb,
  scope: UserScope,
  close: AttemptClose
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE automation_attempts SET ended_at = ?, outcome = ?, error_class = COALESCE(?, error_class), steps_count = MAX(steps_count, COALESCE(?, 0)), ai_calls = MAX(ai_calls, COALESCE(?, 0)), log_file_id = COALESCE(?, log_file_id) WHERE id = ? AND user_id = ? AND ended_at IS NULL",
      close.now,
      close.outcome,
      close.errorClass ?? null,
      close.stepsCount ?? null,
      close.aiCalls ?? null,
      close.logFileId ?? null,
      close.attemptId,
      scope.userId
    ),
    appendChange(db, scope, {
      entity: "attempt",
      entityId: close.attemptId,
      revision: ATTEMPT_CLOSED_REVISION,
      now: close.now,
    }),
  ];
}

/** Late evidence may still attach the step log of a closed attempt. */
export function attachAttemptLogStatements(
  db: JobsDb,
  scope: UserScope,
  attemptId: string,
  logFileId: string
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE automation_attempts SET log_file_id = COALESCE(log_file_id, ?) WHERE id = ? AND user_id = ?",
      logFileId,
      attemptId,
      scope.userId
    ),
  ];
}

/** Append-only evidence row (20 §6.1) + change_log. */
export function insertEvidenceStatements(
  db: JobsDb,
  scope: UserScope,
  evidence: SubmissionEvidenceRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO submission_evidence (id, user_id, application_id, task_id, attempt_id, kind, verdict, signals, final_url, page_title, text_excerpt, screenshot_file_id, form_hash, captured_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      evidence.id,
      scope.userId,
      evidence.application_id,
      evidence.task_id,
      evidence.attempt_id,
      evidence.kind,
      evidence.verdict,
      encodeJson(evidence.signals),
      evidence.final_url,
      evidence.page_title,
      evidence.text_excerpt,
      evidence.screenshot_file_id,
      evidence.form_hash,
      evidence.captured_at,
      evidence.recorded_at
    ),
    appendChange(db, scope, {
      entity: "evidence",
      entityId: evidence.id,
      revision: 1,
      now: evidence.recorded_at,
    }),
  ];
}

/**
 * Unfenced task update for the late-evidence path (20 §6.3 A):
 * `outcome_unknown → submitted`, conditional on the state as read.
 */
export function lateEvidenceTaskStatements(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE automation_tasks SET state = 'submitted', finished_at = COALESCE(finished_at, ?), revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'outcome_unknown'",
      now,
      now,
      taskId,
      scope.userId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'task', id, revision, 'upsert', ? FROM automation_tasks WHERE id = ? AND user_id = ? AND changes() > 0",
      now,
      taskId,
      scope.userId
    ),
  ];
}

/** Links a discovery run to the task that produced it (21 §6.6). */
export function linkRunStatements(
  db: JobsDb,
  scope: UserScope,
  runId: string,
  taskId: string,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE discovery_runs SET task_id = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND task_id IS NULL",
      taskId,
      runId,
      scope.userId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'run', id, revision, 'upsert', ? FROM discovery_runs WHERE id = ? AND user_id = ? AND changes() > 0",
      now,
      runId,
      scope.userId
    ),
  ];
}

/**
 * Guard: the application can still be submitted (21 §6.5): owned, not
 * archived, not withdrawn/rejected/accepted, and not already submitted or of
 * unknown outcome.
 */
export function guardApplicationSubmittable(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): D1PreparedStatement {
  return guard(
    db,
    "intent:application",
    "SELECT 1 FROM applications WHERE id = ? AND user_id = ? AND archived = 0 AND submission_status NOT IN ('submitted_verified', 'submitted_unverified', 'outcome_unknown') AND stage NOT IN ('withdrawn', 'rejected', 'accepted')",
    applicationId,
    scope.userId
  );
}

/** Guard: no other live task of the application holds a submit intent (21 §9). */
export function guardNoOtherIntent(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  taskId: string
): D1PreparedStatement {
  return guard(
    db,
    "intent:other_task",
    "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM automation_tasks WHERE user_id = ? AND application_id = ? AND id <> ? AND submit_intent_at IS NOT NULL AND state IN ('queued', 'claimed', 'running', 'paused', 'awaiting_approval'))",
    scope.userId,
    applicationId,
    taskId
  );
}

/** Guard: no cancel was requested for the task (21 §6.5 "not cancelled"). */
export function guardNotCancelled(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): D1PreparedStatement {
  return guard(
    db,
    "intent:cancel_requested",
    "SELECT 1 FROM automation_tasks WHERE id = ? AND user_id = ? AND cancel_requested = 0",
    taskId,
    scope.userId
  );
}

/**
 * Guard: `submit_intent_at` is still as read (set / not set). A result or a
 * release decided from a pre-intent read can never land after an intent.
 */
export function guardIntentAsRead(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  hadIntent: boolean
): D1PreparedStatement {
  return guard(
    db,
    "lease:intent_as_read",
    "SELECT 1 FROM automation_tasks WHERE id = ? AND user_id = ? AND (submit_intent_at IS NULL) = ?",
    taskId,
    scope.userId,
    hadIntent ? 0 : 1
  );
}
