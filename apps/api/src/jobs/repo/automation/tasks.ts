// `automation_tasks` / `automation_attempts` / `submission_evidence` reads
// and the task writes that are not lease-scoped (05 §8 create, list,
// detail, cancel, retry, resume; 21 §4, §8, §12).
//
// D-19 invariant: every statement here that moves a task to `queued`
// carries `submit_intent_at IS NULL`, so no write can re-queue a task past
// its submit checkpoint even when it races the device.

import type {
  TaskKind,
  TaskState,
} from "@pilihpendidikan/jobs-contracts/enums";
import type {
  AutomationAttemptRecord,
  AutomationTaskRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { CursorKey, Page, PageRequest } from "../../core/pagination";
import { keysetAfter, pageOf } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import { appendChange, appendChangeFromRow } from "../core/change-log";
import type { JobsDb } from "../core/db";
import { encodeJson, guard, queryAll, queryFirst, stmt } from "../core/db";
import type { Row } from "./records";
import {
  HOLDING_IN,
  HOLDING_STATES,
  toAttempt,
  toEvidence,
  toTask,
} from "./records";

export async function loadTask(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<AutomationTaskRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT * FROM automation_tasks WHERE id = ? AND user_id = ?",
    taskId,
    scope.userId
  );
  return row ? toTask(row) : null;
}

export async function findTaskByIdempotencyKey(
  db: JobsDb,
  scope: UserScope,
  key: string
): Promise<AutomationTaskRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT * FROM automation_tasks WHERE user_id = ? AND idempotency_key = ?",
    scope.userId,
    key
  );
  return row ? toTask(row) : null;
}

/** The live apply task of an application (`ux_tasks_live_apply`), if any. */
export async function findLiveApplyTask(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<AutomationTaskRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT * FROM automation_tasks WHERE user_id = ? AND application_id = ? AND kind = 'apply' AND state IN ('queued', 'claimed', 'running', 'paused', 'awaiting_approval') LIMIT 1",
    scope.userId,
    applicationId
  );
  return row ? toTask(row) : null;
}

/** Another live task of the application already past submit_intent (21 §9). */
export async function otherIntentHolder(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  taskId: string
): Promise<string | null> {
  const row = await queryFirst<{ id: string }>(
    db,
    "SELECT id FROM automation_tasks WHERE user_id = ? AND application_id = ? AND id <> ? AND submit_intent_at IS NOT NULL AND state IN ('queued', 'claimed', 'running', 'paused', 'awaiting_approval') LIMIT 1",
    scope.userId,
    applicationId,
    taskId
  );
  return row?.id ?? null;
}

export interface TaskFilter {
  applicationId?: string;
  kind?: TaskKind;
  state?: TaskState;
}

/** Newest first. */
export async function listTasks(
  db: JobsDb,
  scope: UserScope,
  filter: TaskFilter,
  page: PageRequest
): Promise<Page<AutomationTaskRecord>> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.state) {
    where.push("state = ?");
    binds.push(filter.state);
  }
  if (filter.applicationId) {
    where.push("application_id = ?");
    binds.push(filter.applicationId);
  }
  if (filter.kind) {
    where.push("kind = ?");
    binds.push(filter.kind);
  }
  const after = keysetAfter(["created_at", "id"], page.cursor, "desc");
  if (after.sql) {
    where.push(after.sql);
    binds.push(...after.binds);
  }
  const rows = await queryAll<Row>(
    db,
    `SELECT * FROM automation_tasks WHERE user_id = ?${where.map((w) => ` AND ${w}`).join("")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    scope.userId,
    ...binds,
    page.limit + 1
  );
  return pageOf(
    rows.map(toTask),
    page.limit,
    (task): CursorKey => [task.created_at, task.id]
  );
}

export async function attemptsOfTask(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<AutomationAttemptRecord[]> {
  const rows = await queryAll<Row>(
    db,
    "SELECT * FROM automation_attempts WHERE user_id = ? AND task_id = ? ORDER BY attempt_no",
    scope.userId,
    taskId
  );
  return rows.map(toAttempt);
}

export async function loadAttempt(
  db: JobsDb,
  scope: UserScope,
  attemptId: string
): Promise<AutomationAttemptRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT * FROM automation_attempts WHERE id = ? AND user_id = ?",
    attemptId,
    scope.userId
  );
  return row ? toAttempt(row) : null;
}

/** The attempt row of a lease. */
export async function attemptOfLease(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  leaseId: string
): Promise<AutomationAttemptRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT * FROM automation_attempts WHERE user_id = ? AND task_id = ? AND lease_id = ?",
    scope.userId,
    taskId,
    leaseId
  );
  return row ? toAttempt(row) : null;
}

export async function evidenceOfTask(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<SubmissionEvidenceRecord[]> {
  const rows = await queryAll<Row>(
    db,
    "SELECT * FROM submission_evidence WHERE user_id = ? AND task_id = ? ORDER BY recorded_at, id",
    scope.userId,
    taskId
  );
  return rows.map(toEvidence);
}

/** True when the user created a task after `since` (21 §1.1 poll interval). */
export async function taskCreatedSince(
  db: JobsDb,
  scope: UserScope,
  since: number
): Promise<boolean> {
  const row = await queryFirst<{ one: number }>(
    db,
    "SELECT 1 AS one FROM automation_tasks WHERE user_id = ? AND created_at > ? LIMIT 1",
    scope.userId,
    since
  );
  return row !== null;
}

/** INSERT of a new queued task + change_log. */
export function insertTaskStatements(
  db: JobsDb,
  scope: UserScope,
  task: AutomationTaskRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO automation_tasks (id, user_id, kind, application_id, cv_variant_id, payload, state, target_device_id, required_capabilities, priority, not_before, expires_at, attempt_count, max_attempts, retry_of, created_by, idempotency_key, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)",
      task.id,
      scope.userId,
      task.kind,
      task.application_id,
      task.cv_variant_id,
      encodeJson(task.payload),
      task.target_device_id,
      encodeJson(task.required_capabilities),
      task.priority,
      task.not_before,
      task.expires_at,
      task.max_attempts,
      task.retry_of,
      task.created_by,
      task.idempotency_key,
      task.created_at,
      task.updated_at
    ),
    appendChange(db, scope, {
      entity: "task",
      entityId: task.id,
      revision: 1,
      now: task.created_at,
    }),
  ];
}

/** The task's change_log row, reading the revision stored by this batch. */
export function taskChange(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  now: number
): D1PreparedStatement {
  return appendChangeFromRow(db, scope, {
    entity: "task",
    table: "automation_tasks",
    id: taskId,
    now,
  });
}

/** Guard: the task is still at `revision` (web-side writes). */
export function guardTaskRevision(
  db: JobsDb,
  scope: UserScope,
  task: Pick<AutomationTaskRecord, "id" | "revision">
): D1PreparedStatement {
  return guard(
    db,
    `task:${task.id}:revision`,
    "SELECT 1 FROM automation_tasks WHERE id = ? AND user_id = ? AND revision = ?",
    task.id,
    scope.userId,
    task.revision
  );
}

/**
 * A finished state for a task that holds no lease (queued, or
 * awaiting_approval after release): cancelled / expired. Guarded by the
 * revision that was read.
 */
export function finishUnleasedTaskStatements(
  db: JobsDb,
  scope: UserScope,
  task: Pick<AutomationTaskRecord, "id" | "revision" | "state">,
  input: {
    errorClass: string;
    now: number;
    reason?: string;
    state: "cancelled" | "expired";
  }
): D1PreparedStatement[] {
  return [
    guardTaskRevision(db, scope, task),
    stmt(
      db,
      "UPDATE automation_tasks SET state = ?, error_class = ?, payload = CASE WHEN ? IS NULL THEN payload ELSE json_set(payload, '$.cancel_reason', ?) END, finished_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ? AND lease_id IS NULL AND state = ?",
      input.state,
      input.errorClass,
      input.reason ?? null,
      input.reason ?? null,
      input.now,
      input.now,
      task.id,
      scope.userId,
      task.revision,
      task.state
    ),
    taskChange(db, scope, task.id, input.now),
  ];
}

/** Web cancel of a running task (pre-intent): the flag the heartbeat delivers. */
export function requestCancelStatements(
  db: JobsDb,
  scope: UserScope,
  task: Pick<AutomationTaskRecord, "id" | "lease_id">,
  now: number
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `task:${task.id}:cancel`,
      `SELECT 1 FROM automation_tasks WHERE id = ? AND user_id = ? AND lease_id = ? AND submit_intent_at IS NULL AND state IN (${HOLDING_IN})`,
      task.id,
      scope.userId,
      task.lease_id,
      ...HOLDING_STATES
    ),
    stmt(
      db,
      "UPDATE automation_tasks SET cancel_requested = 1, payload = json_set(payload, '$.cancel_reason', 'user'), revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id = ? AND submit_intent_at IS NULL",
      now,
      task.id,
      scope.userId,
      task.lease_id
    ),
    taskChange(db, scope, task.id, now),
  ];
}

/** Web "Resume" of a paused task (03 §7.2): delivered by the next heartbeat. */
export function requestResumeStatements(
  db: JobsDb,
  scope: UserScope,
  task: Pick<AutomationTaskRecord, "id" | "revision">,
  now: number
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `task:${task.id}:resume`,
      "SELECT 1 FROM automation_tasks WHERE id = ? AND user_id = ? AND state = 'paused'",
      task.id,
      scope.userId
    ),
    stmt(
      db,
      "UPDATE automation_tasks SET resume_requested = 1, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'paused'",
      now,
      task.id,
      scope.userId
    ),
    taskChange(db, scope, task.id, now),
  ];
}

/**
 * An unleased `awaiting_approval` task whose approval was approved returns
 * to `queued` with `payload.resume_from_approval` (21 §6.4). Never past
 * submit_intent (D-19); the claim that follows may exceed max_attempts by
 * one, because waiting for a human is not a failed attempt.
 */
export function resumeFromApprovalStatements(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  approvalId: string,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE automation_tasks SET state = 'queued', payload = json_set(payload, '$.resume_from_approval', ?), not_before = ?, expires_at = MAX(expires_at, ?), max_attempts = MAX(max_attempts, attempt_count + 1), pause_reason = NULL, resume_requested = 0, local_state = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'awaiting_approval' AND lease_id IS NULL AND submit_intent_at IS NULL AND cancel_requested = 0",
      approvalId,
      now,
      now + 72 * 3_600_000,
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

/**
 * An unleased `awaiting_approval` task whose approval was rejected or
 * expired ends `cancelled` (21 §6.3): conditional, no-op otherwise.
 */
export function cancelUnleasedApprovalTaskStatements(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  errorClass: "approval_rejected" | "approval_expired" | "cancelled",
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE automation_tasks SET state = 'cancelled', error_class = ?, finished_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'awaiting_approval' AND lease_id IS NULL AND submit_intent_at IS NULL",
      errorClass,
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

/**
 * A leased task whose approval was rejected / expired: the flag makes the
 * holder stop at its next heartbeat (21 §6.3; the device reports
 * `cancelled`). Conditional and pre-intent only.
 */
export function flagCancelLeasedStatements(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  reason: string,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      `UPDATE automation_tasks SET cancel_requested = 1, payload = json_set(payload, '$.cancel_reason', ?), revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id IS NOT NULL AND submit_intent_at IS NULL AND cancel_requested = 0 AND state IN (${HOLDING_IN})`,
      reason,
      now,
      taskId,
      scope.userId,
      ...HOLDING_STATES
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

/** Sets `applications.mode` (and the rule) for a new task (21 §12 "app mode set"). */
export function setApplicationModeStatements(
  db: JobsDb,
  scope: UserScope,
  input: {
    applicationId: string;
    mode: string;
    now: number;
    ruleId: string | null;
    source: string;
  }
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE applications SET mode = ?, automation_rule_id = COALESCE(?, automation_rule_id), last_change_source = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND (mode <> ? OR (? IS NOT NULL AND COALESCE(automation_rule_id, '') <> ?))",
      input.mode,
      input.ruleId,
      input.source,
      input.now,
      input.applicationId,
      scope.userId,
      input.mode,
      input.ruleId,
      input.ruleId ?? ""
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'application', id, revision, 'upsert', ? FROM applications WHERE id = ? AND user_id = ? AND changes() > 0",
      input.now,
      input.applicationId,
      scope.userId
    ),
  ];
}
