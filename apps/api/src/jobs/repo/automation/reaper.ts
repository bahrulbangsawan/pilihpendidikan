// The reaper's reads and fences (21 §7.1, 14 §7). The cron scans across
// users with system statements (`sql-allow: system`); every write it then
// makes is per user and carries the user predicate. The lazy reaper at
// claim time runs the same per-task logic for one user.

import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { guard, queryAll, queryFirst, stmt } from "../core/db";
import type { LeaseTaskRow } from "../core/leases";

export interface QueuedTaskRow {
  application_id: string | null;
  id: string;
  revision: number;
  state: "queued";
  user_id: string;
}

/** Queued tasks past `expires_at` (→ expired), across users. */
export async function listExpiredQueued(
  db: JobsDb,
  options: { limit: number; now: number }
): Promise<QueuedTaskRow[]> {
  // sql-allow: system — the cron expires every user's stale queued tasks (21 §7.1)
  return await queryAll<QueuedTaskRow>(
    db,
    "SELECT id, user_id, application_id, revision, state FROM automation_tasks WHERE state = 'queued' AND expires_at <= ? ORDER BY expires_at LIMIT ?",
    options.now,
    options.limit
  );
}

/** Queued tasks that carry a pending cancel (re-queued by a lease loss). */
export async function listCancelRequestedQueued(
  db: JobsDb,
  options: { limit: number }
): Promise<QueuedTaskRow[]> {
  // sql-allow: system — the cron cancels queued tasks whose cancel was requested (21 §12)
  return await queryAll<QueuedTaskRow>(
    db,
    "SELECT id, user_id, application_id, revision, state FROM automation_tasks WHERE state = 'queued' AND cancel_requested = 1 LIMIT ?",
    options.limit
  );
}

export interface UnleasedApprovalTaskRow {
  id: string;
  user_id: string;
}

/**
 * Unleased `awaiting_approval` tasks whose newest submit/answer approval is
 * no longer pending (approved / rejected / expired) — they must move on.
 */
export async function listSettleableApprovalTasks(
  db: JobsDb,
  options: { limit: number; scope?: UserScope }
): Promise<UnleasedApprovalTaskRow[]> {
  const decided =
    "EXISTS (SELECT 1 FROM approvals a WHERE a.user_id = t.user_id AND a.task_id = t.id AND a.kind IN ('submit', 'answer') AND a.state <> 'pending' AND NOT EXISTS (SELECT 1 FROM approvals p WHERE p.user_id = t.user_id AND p.task_id = t.id AND p.kind IN ('submit', 'answer') AND p.state = 'pending'))";
  if (options.scope) {
    return await queryAll<UnleasedApprovalTaskRow>(
      db,
      `SELECT t.id, t.user_id FROM automation_tasks t WHERE t.user_id = ? AND t.state = 'awaiting_approval' AND t.lease_id IS NULL AND ${decided} LIMIT ?`,
      options.scope.userId,
      options.limit
    );
  }
  // sql-allow: system — the cron settles released approval waits of every user (21 §6.4)
  return await queryAll<UnleasedApprovalTaskRow>(
    db,
    `SELECT t.id, t.user_id FROM automation_tasks t WHERE t.state = 'awaiting_approval' AND t.lease_id IS NULL AND ${decided} LIMIT ?`,
    options.limit
  );
}

/** Whether a leased task still has a pending cancel (read at reap time). */
export async function leaseExtras(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<{ cancel_requested: number; payload: string } | null> {
  return await queryFirst<{ cancel_requested: number; payload: string }>(
    db,
    "SELECT cancel_requested, payload FROM automation_tasks WHERE id = ? AND user_id = ?",
    taskId,
    scope.userId
  );
}

/**
 * The reaper's own fence, prepended to the kernel's lease-loss plan: the
 * lease is still the one read, still EXPIRED at `now` (a heartbeat that
 * landed in between wins), and `submit_intent_at` / `cancel_requested` are
 * as read (an intent that landed in between turns a re-queue into a
 * refusal: the batch aborts and the next run sees the intent, D-19).
 */
export function reapFence(
  db: JobsDb,
  scope: UserScope,
  task: Pick<LeaseTaskRow, "id" | "lease_id" | "submit_intent_at">,
  cancelRequested: boolean,
  now: number
): D1PreparedStatement {
  return guard(
    db,
    `reap:${task.id}:${task.lease_id}`,
    "SELECT 1 FROM automation_tasks WHERE id = ? AND user_id = ? AND lease_id = ? AND lease_expires_at <= ? AND (submit_intent_at IS NULL) = ? AND cancel_requested = ?",
    task.id,
    scope.userId,
    task.lease_id,
    now,
    task.submit_intent_at === null ? 1 : 0,
    cancelRequested ? 1 : 0
  );
}

export interface UserCountRow {
  n: number;
  user_id: string;
}

/** Users with more than `threshold` outcome_unknown tasks since `since` (21 §15). */
export async function outcomeUnknownBursts(
  db: JobsDb,
  options: { since: number; threshold: number }
): Promise<UserCountRow[]> {
  // sql-allow: system — the alert scan counts outcome_unknown tasks per user (21 §15)
  return await queryAll<UserCountRow>(
    db,
    "SELECT user_id, COUNT(*) AS n FROM automation_tasks WHERE state = 'outcome_unknown' AND finished_at > ? GROUP BY user_id HAVING COUNT(*) > ? LIMIT 100",
    options.since,
    options.threshold
  );
}

/** Users with more than `threshold` submit_intents since `since` (11 T-11). */
export async function submissionBursts(
  db: JobsDb,
  options: { since: number; threshold: number }
): Promise<UserCountRow[]> {
  // sql-allow: system — the anomaly alert counts submit_intent events per user (11 T-11)
  return await queryAll<UserCountRow>(
    db,
    "SELECT user_id, COUNT(*) AS n FROM application_events WHERE type = 'submit_intent' AND recorded_at > ? GROUP BY user_id HAVING COUNT(*) > ? LIMIT 100",
    options.since,
    options.threshold
  );
}

/**
 * An expired lease whose cancel was requested (pre-intent) ends
 * `cancelled` instead of being re-queued (21 §12 "cancel requested").
 */
export function cancelExpiredLeaseStatement(
  db: JobsDb,
  scope: UserScope,
  task: Pick<LeaseTaskRow, "id" | "lease_id">,
  now: number
): D1PreparedStatement {
  return stmt(
    db,
    "UPDATE automation_tasks SET state = 'cancelled', lease_id = NULL, lease_device_id = NULL, lease_expires_at = NULL, error_class = 'cancelled', finished_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND lease_id = ? AND submit_intent_at IS NULL",
    now,
    now,
    task.id,
    scope.userId,
    task.lease_id
  );
}
