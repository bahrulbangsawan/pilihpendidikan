// Lease effects (21 §5.4, §7, §10): what happens to a task when the lease of
// its current holder ends without a terminal report — the lease expired (cron
// reaper every 5 min, and lazily at the start of every claim) or the holding
// device was revoked.
//
// | condition (first match)            | task                         | attempt          |
// |------------------------------------|------------------------------|------------------|
// | `submit_intent_at` set (D-19)      | outcome_unknown, never       | outcome_unknown  |
// |                                    | re-queued; app submission →  |                  |
// |                                    | outcome_unknown (forward)    |                  |
// | state = awaiting_approval          | stays awaiting_approval, no  | lease_expired    |
// |                                    | lease (resumes on decision)  |                  |
// | attempt_count < max_attempts       | queued, not_before = now +   | lease_expired    |
// |                                    | 2^attempts min (revoked:     |                  |
// |                                    | target_device_id cleared)    |                  |
// | otherwise                          | failed (lease_expired)       | lease_expired    |
//
// Every statement is fenced on the old `lease_id`: a guard aborts the batch
// when the lease changed since it was read, so a late heartbeat or a new
// claim can never be clobbered.
//
//   const tasks = await listExpiredLeases(db, { now, limit: 200 });     // cron
//   for (const task of tasks) {
//     const scope = trustedScope(task.user_id, "cron");
//     const plan = await planLeaseLoss(db, scope, { task, cause: "expired", now });
//     await runBatch(db, plan.statements);   // GuardFailedError → skip, it moved on
//   }

import type { TaskState } from "@pilihpendidikan/jobs-contracts/enums";
import type { UserScope } from "../../core/scope";
import { planApplicationTransition } from "./application-state";
import { appendChange, appendChangeFromRow } from "./change-log";
import type { JobsDb } from "./db";
import { guard, queryAll, queryFirst, stmt } from "./db";
import { appendEvent } from "./events";

/** Lease length from the last heartbeat (21 §5.4). */
export const LEASE_DURATION_MS = 120_000;
/** Heartbeat interval the server hands out (21 §5.4). */
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Queued tasks expire after 72 h (04 §2.6). */
export const TASK_QUEUE_TTL_MS = 72 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;

/** Lease-holding states (the only ones that can carry `submit_intent_at`). */
export const LEASE_HOLDING_STATES = [
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
] as const satisfies readonly TaskState[];

/** Retry backoff of 21 §8: `2^attempt` minutes (2, 4, … after attempts 1, 2). */
export function retryBackoffMs(attemptCount: number): number {
  return 2 ** Math.max(1, attemptCount) * MINUTE_MS;
}

export interface LeaseTaskRow {
  application_id: string | null;
  attempt_count: number;
  /** 0/1: the user asked to cancel while the task held the lease. */
  cancel_requested: number;
  created_at: number;
  id: string;
  kind: string;
  lease_device_id: string | null;
  lease_expires_at: number | null;
  lease_id: string | null;
  max_attempts: number;
  revision: number;
  state: TaskState;
  submit_intent_at: number | null;
  target_device_id: string | null;
  user_id: string;
}

const LEASE_TASK_COLUMNS =
  "id, user_id, kind, state, application_id, lease_id, lease_device_id, lease_expires_at, submit_intent_at, cancel_requested, attempt_count, max_attempts, target_device_id, revision, created_at";

export type LeaseLossCause = "expired" | "device_revoked";

export type LeaseEffect =
  | "outcome_unknown"
  | "awaiting_approval_unleased"
  | "cancelled"
  | "requeued"
  | "failed";

/** The effect of losing the lease (21 §7.1 table, first match wins). */
export function decideLeaseEffect(
  task: Pick<
    LeaseTaskRow,
    "attempt_count" | "max_attempts" | "state" | "submit_intent_at"
  > & { cancel_requested?: number | boolean }
): LeaseEffect {
  if (task.submit_intent_at !== null) {
    return "outcome_unknown";
  }
  // A cancel requested while the lease was held wins over a retry: the
  // user asked to stop, and nothing was submitted (no intent).
  if (task.cancel_requested) {
    return "cancelled";
  }
  if (task.state === "awaiting_approval") {
    return "awaiting_approval_unleased";
  }
  if (task.attempt_count < task.max_attempts) {
    return "requeued";
  }
  return "failed";
}

/** One user's task by id, with the lease columns. */
export async function loadLeaseTask(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<LeaseTaskRow | null> {
  return await queryFirst<LeaseTaskRow>(
    db,
    `SELECT ${LEASE_TASK_COLUMNS} FROM automation_tasks WHERE id = ? AND user_id = ?`,
    taskId,
    scope.userId
  );
}

const HOLDING = LEASE_HOLDING_STATES.map(() => "?").join(", ");

/**
 * Tasks whose lease expired at `now`: for one user (lazy reaping before a
 * claim) or across users (the `*\/5` cron, system statement).
 */
export async function listExpiredLeases(
  db: JobsDb,
  options: { limit: number; now: number; scope?: UserScope }
): Promise<LeaseTaskRow[]> {
  if (options.scope) {
    return await queryAll<LeaseTaskRow>(
      db,
      `SELECT ${LEASE_TASK_COLUMNS} FROM automation_tasks WHERE user_id = ? AND state IN (${HOLDING}) AND lease_id IS NOT NULL AND lease_expires_at <= ? ORDER BY lease_expires_at LIMIT ?`,
      options.scope.userId,
      ...LEASE_HOLDING_STATES,
      options.now,
      options.limit
    );
  }
  // sql-allow: system — the cron reaper scans every user's expired leases (21 §7.1)
  return await queryAll<LeaseTaskRow>(
    db,
    `SELECT ${LEASE_TASK_COLUMNS} FROM automation_tasks WHERE state IN (${HOLDING}) AND lease_id IS NOT NULL AND lease_expires_at <= ? ORDER BY lease_expires_at LIMIT ?`,
    ...LEASE_HOLDING_STATES,
    options.now,
    options.limit
  );
}

/** Live leases a device holds (device revocation, 21 §10). */
export async function listDeviceLeases(
  db: JobsDb,
  scope: UserScope,
  deviceId: string
): Promise<LeaseTaskRow[]> {
  return await queryAll<LeaseTaskRow>(
    db,
    `SELECT ${LEASE_TASK_COLUMNS} FROM automation_tasks WHERE user_id = ? AND lease_device_id = ? AND lease_id IS NOT NULL AND state IN (${HOLDING})`,
    scope.userId,
    deviceId,
    ...LEASE_HOLDING_STATES
  );
}

export interface LeaseLossPlan {
  effect: LeaseEffect;
  /** Fence guard first; then attempt, task, application, events, change_log. */
  statements: D1PreparedStatement[];
}

const ATTEMPT_CLOSED_REVISION = 2;

function messageFor(effect: LeaseEffect, cause: LeaseLossCause): string {
  const lost =
    cause === "device_revoked"
      ? "The device was revoked"
      : "The device stopped responding";
  switch (effect) {
    case "outcome_unknown":
      return `${lost} after the submit checkpoint. Check your email or the job site for a confirmation, then mark Applied or Not submitted.`;
    case "awaiting_approval_unleased":
      return `${lost} while waiting for approval; the task resumes after the decision.`;
    case "requeued":
      return `${lost}; the task will be retried.`;
    case "cancelled":
      return `${lost} after you asked to cancel; the task is cancelled.`;
    default:
      return `${lost} and no attempts are left.`;
  }
}

function taskUpdate(
  db: JobsDb,
  scope: UserScope,
  task: LeaseTaskRow,
  effect: LeaseEffect,
  cause: LeaseLossCause,
  now: number
): D1PreparedStatement {
  const errorClass =
    cause === "device_revoked" ? "device_revoked" : "lease_expired";
  // Each statement spells out its fence (`id`, `user_id`, old `lease_id`)
  // so the T11-SQL lint can see the user_id predicate.
  const clearLease =
    "lease_id = NULL, lease_device_id = NULL, lease_expires_at = NULL";
  switch (effect) {
    case "outcome_unknown":
      return stmt(
        db,
        `UPDATE automation_tasks SET state = 'outcome_unknown', ${clearLease}, error_class = COALESCE(error_class, ?), finished_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id = ?`,
        errorClass,
        now,
        now,
        task.id,
        scope.userId,
        task.lease_id
      );
    case "awaiting_approval_unleased":
      return stmt(
        db,
        `UPDATE automation_tasks SET ${clearLease}, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id = ? AND state = 'awaiting_approval'`,
        now,
        task.id,
        scope.userId,
        task.lease_id
      );
    case "requeued":
      return stmt(
        db,
        `UPDATE automation_tasks SET state = 'queued', ${clearLease}, not_before = ?, error_class = ?, pause_reason = NULL, resume_requested = 0, local_state = NULL, target_device_id = CASE WHEN ? = 1 AND target_device_id = ? THEN NULL ELSE target_device_id END, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id = ? AND submit_intent_at IS NULL AND cancel_requested = 0`,
        now + retryBackoffMs(task.attempt_count),
        errorClass,
        cause === "device_revoked" ? 1 : 0,
        task.lease_device_id,
        now,
        task.id,
        scope.userId,
        task.lease_id
      );
    case "cancelled":
      return stmt(
        db,
        `UPDATE automation_tasks SET state = 'cancelled', ${clearLease}, error_class = COALESCE(error_class, ?), finished_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id = ? AND submit_intent_at IS NULL`,
        errorClass,
        now,
        now,
        task.id,
        scope.userId,
        task.lease_id
      );
    default:
      return stmt(
        db,
        `UPDATE automation_tasks SET state = 'failed', ${clearLease}, error_class = ?, finished_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id = ? AND submit_intent_at IS NULL`,
        errorClass,
        now,
        now,
        task.id,
        scope.userId,
        task.lease_id
      );
  }
}

// The fence re-checks everything the effect was decided from, so a
// heartbeat (lease extended), a submit-intent or a cancel that lands between
// the read and the batch aborts the plan instead of being overwritten
// (D-19: nothing past submit_intent is ever re-queued).
function leaseFence(
  db: JobsDb,
  scope: UserScope,
  task: LeaseTaskRow,
  cause: LeaseLossCause,
  now: number
): D1PreparedStatement {
  const expired = cause === "expired";
  return guard(
    db,
    `lease:${task.id}:${task.lease_id}`,
    `SELECT 1 FROM automation_tasks WHERE id = ? AND user_id = ? AND lease_id = ? AND state IN (${HOLDING}) AND (submit_intent_at IS NULL) = ? AND cancel_requested = ?${
      expired ? " AND lease_expires_at <= ?" : ""
    }`,
    task.id,
    scope.userId,
    task.lease_id,
    ...LEASE_HOLDING_STATES,
    task.submit_intent_at === null ? 1 : 0,
    task.cancel_requested ? 1 : 0,
    ...(expired ? [now] : [])
  );
}

function attemptOutcomeFor(
  effect: LeaseEffect
): "outcome_unknown" | "cancelled" | "lease_expired" {
  if (effect === "outcome_unknown" || effect === "cancelled") {
    return effect;
  }
  return "lease_expired";
}

function eventStateFor(effect: LeaseEffect): string {
  if (effect === "awaiting_approval_unleased") {
    return "awaiting_approval";
  }
  if (effect === "requeued") {
    return "queued";
  }
  return effect;
}

/**
 * Plans the effects of losing `task`'s current lease. The caller runs the
 * statements in one batch (a `GuardFailedError` means the lease moved on and
 * there is nothing to do).
 */
export async function planLeaseLoss(
  db: JobsDb,
  scope: UserScope,
  input: { cause: LeaseLossCause; now: number; task: LeaseTaskRow }
): Promise<LeaseLossPlan> {
  const { task, cause, now } = input;
  if (task.lease_id === null) {
    throw new Error(`task ${task.id} holds no lease`);
  }
  const effect = decideLeaseEffect(task);
  const attemptOutcome = attemptOutcomeFor(effect);
  const statements: D1PreparedStatement[] = [
    leaseFence(db, scope, task, cause, now),
  ];
  const attempt = await queryFirst<{ id: string }>(
    db,
    "SELECT id FROM automation_attempts WHERE user_id = ? AND task_id = ? AND lease_id = ?",
    scope.userId,
    task.id,
    task.lease_id
  );
  if (attempt) {
    statements.push(
      stmt(
        db,
        "UPDATE automation_attempts SET ended_at = ?, outcome = ?, error_class = COALESCE(error_class, ?) WHERE id = ? AND user_id = ? AND ended_at IS NULL",
        now,
        attemptOutcome,
        cause === "device_revoked" ? "device_revoked" : "lease_expired",
        attempt.id,
        scope.userId
      ),
      appendChange(db, scope, {
        entity: "attempt",
        entityId: attempt.id,
        revision: ATTEMPT_CLOSED_REVISION,
        now,
      })
    );
  }
  statements.push(
    taskUpdate(db, scope, task, effect, cause, now),
    appendChangeFromRow(db, scope, {
      entity: "task",
      table: "automation_tasks",
      id: task.id,
      now,
    })
  );
  if (task.application_id) {
    if (effect === "outcome_unknown") {
      const transition = await planApplicationTransition(db, scope, {
        applicationId: task.application_id,
        actor: "system",
        source: "system",
        now,
        submission: { to: "outcome_unknown" },
        automation: {
          taskId: task.id,
          taskCreatedAt: task.created_at,
          attemptId: attempt?.id ?? null,
        },
        eventKeyPrefix: `lease:${task.lease_id}`,
      });
      statements.push(...transition.statements);
    }
    const finished =
      effect === "outcome_unknown" ||
      effect === "failed" ||
      effect === "cancelled";
    const eventState = eventStateFor(effect);
    statements.push(
      ...appendEvent(
        db,
        scope,
        {
          applicationId: task.application_id,
          type: finished
            ? "automation_task_finished"
            : "automation_task_progress",
          actorKind: "system",
          taskId: task.id,
          attemptId: attempt?.id ?? null,
          payload: {
            task_id: task.id,
            ...(attempt ? { attempt_id: attempt.id } : {}),
            state: eventState,
            message: messageFor(effect, cause),
          },
          idempotencyKey: `lease:${task.lease_id}:${cause}`,
        },
        now
      ).statements
    );
  }
  return { effect, statements };
}
