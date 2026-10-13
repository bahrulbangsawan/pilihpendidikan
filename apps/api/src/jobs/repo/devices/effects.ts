// What devices mean for JOBS_DB (21 §1.1, §3, §10, 04 §1):
//
//   - presence: a device is `active` when it holds a live lease whose attempt
//     heartbeat is ≤ 90 s old (computed at read time, no writes);
//   - device heartbeat: which of the leases the CLI reports it must stop
//     (`cancel_lease_ids`) and the signals of the poll interval;
//   - revocation (and refresh-token reuse, 17 §7.2): every live lease of the
//     device loses it through the kernel's `planLeaseLoss` (21 §10), queued
//     tasks pinned to a revoked device are cancelled, and a `device` change
//     is appended so the dashboard and other CLIs refresh.
//
// Every statement carries the `user_id` predicate of the caller's scope.

import type { Env } from "../../../env";
import type { UserScope } from "../../core/scope";
import { appendChange } from "../core/change-log";
import type { JobsDb } from "../core/db";
import {
  GuardFailedError,
  jobsDb,
  queryAll,
  queryFirst,
  runBatch,
  stmt,
} from "../core/db";
import { appendEvent } from "../core/events";
import type { LeaseEffect } from "../core/leases";
import {
  LEASE_HOLDING_STATES,
  listDeviceLeases,
  planLeaseLoss,
} from "../core/leases";

const HOLDING = LEASE_HOLDING_STATES.map(() => "?").join(", ");

/** Heartbeat age under which a lease holder counts as `active` (04 §1). */
export const ACTIVE_HEARTBEAT_MS = 90_000;

/** Devices of the user holding a live lease with a heartbeat ≤ 90 s. */
export async function activeDeviceIds(
  db: JobsDb,
  scope: UserScope,
  now: number
): Promise<Set<string>> {
  const rows = await queryAll<{ device_id: string }>(
    db,
    `SELECT DISTINCT t.lease_device_id AS device_id FROM automation_tasks t JOIN automation_attempts a ON a.lease_id = t.lease_id AND a.user_id = t.user_id WHERE t.user_id = ? AND t.lease_id IS NOT NULL AND t.lease_device_id IS NOT NULL AND t.state IN (${HOLDING}) AND t.lease_expires_at > ? AND a.ended_at IS NULL AND a.last_heartbeat_at >= ?`,
    scope.userId,
    ...LEASE_HOLDING_STATES,
    now,
    now - ACTIVE_HEARTBEAT_MS
  );
  return new Set(rows.map((row) => row.device_id));
}

/** `user_settings.automation_paused` without creating the row. */
export async function isAutomationPaused(
  db: JobsDb,
  scope: UserScope
): Promise<boolean> {
  const row = await queryFirst<{ automation_paused: number }>(
    db,
    "SELECT automation_paused FROM user_settings WHERE user_id = ?",
    scope.userId
  );
  return row?.automation_paused === 1;
}

interface ReportedLeaseRow {
  cancel_requested: number;
  kind: string;
  lease_id: string;
  state: string;
  submit_intent_at: number | null;
}

/** Most lease ids a heartbeat is checked against (a device runs ≤ 3). */
export const MAX_REPORTED_LEASES = 50;

/**
 * Which of the leases a device reports it must stop (05 §3 heartbeat):
 * leases it no longer holds (expired, reaped, re-claimed, terminal), leases
 * whose task has `cancel_requested`, and — while the user's account-wide
 * "pause all" is on — apply leases before `submit_intent` (19 kill switch).
 */
export async function leasesToCancel(
  db: JobsDb,
  scope: UserScope,
  input: { deviceId: string; leaseIds: readonly string[]; paused: boolean }
): Promise<string[]> {
  const reported = [...new Set(input.leaseIds)].slice(0, MAX_REPORTED_LEASES);
  if (reported.length === 0) {
    return [];
  }
  const rows = await queryAll<ReportedLeaseRow>(
    db,
    `SELECT lease_id, state, kind, cancel_requested, submit_intent_at FROM automation_tasks WHERE user_id = ? AND lease_device_id = ? AND lease_id IN (${reported.map(() => "?").join(", ")})`,
    scope.userId,
    input.deviceId,
    ...reported
  );
  const held = new Map(rows.map((row) => [row.lease_id, row]));
  const holding = new Set<string>(LEASE_HOLDING_STATES);
  return reported.filter((leaseId) => {
    const row = held.get(leaseId);
    if (!(row && holding.has(row.state))) {
      return true;
    }
    if (row.cancel_requested === 1) {
      return true;
    }
    return (
      input.paused && row.kind === "apply" && row.submit_intent_at === null
    );
  });
}

export interface PollSignals {
  /** Start of the device's latest attempt (its last claim), or null. */
  lastClaimAt: number | null;
  /** A task was created for this user at or after `since`. */
  recentTask: boolean;
}

/** Inputs of the server-guided poll interval (21 §1.1). */
export async function pollSignals(
  db: JobsDb,
  scope: UserScope,
  input: { deviceId: string; since: number }
): Promise<PollSignals> {
  const recent = await queryFirst<{ hit: number }>(
    db,
    "SELECT 1 AS hit FROM automation_tasks WHERE user_id = ? AND created_at >= ? LIMIT 1",
    scope.userId,
    input.since
  );
  const claim = await queryFirst<{ last: number | null }>(
    db,
    "SELECT MAX(started_at) AS last FROM automation_attempts WHERE user_id = ? AND device_id = ?",
    scope.userId,
    input.deviceId
  );
  return { recentTask: recent !== null, lastClaimAt: claim?.last ?? null };
}

/** change_log row for a device (entity `device`, its `revision`). */
export function deviceChange(
  db: JobsDb,
  scope: UserScope,
  input: { deviceId: string; now: number; revision: number }
): D1PreparedStatement {
  return appendChange(db, scope, {
    entity: "device",
    entityId: input.deviceId,
    revision: input.revision,
    now: input.now,
  });
}

export interface LeaseLossCounts {
  /** awaiting_approval leases → lease cleared, approval kept. */
  awaiting_approval: number;
  /** Queued tasks pinned to the revoked device → cancelled. */
  cancelled: number;
  /** No attempts left → failed (lease_expired). */
  failed: number;
  /** Leases past submit_intent → outcome_unknown (D-19). */
  outcome_unknown: number;
  /** Leases before submit_intent → queued, target cleared. */
  requeued: number;
}

const EFFECT_COUNTER: Readonly<Record<LeaseEffect, keyof LeaseLossCounts>> = {
  outcome_unknown: "outcome_unknown",
  awaiting_approval_unleased: "awaiting_approval",
  requeued: "requeued",
  cancelled: "cancelled",
  failed: "failed",
};

interface PinnedTask {
  application_id: string | null;
  id: string;
}

const PINNED_MESSAGE =
  "The device this task was assigned to was revoked; the task was cancelled.";

function cancelPinnedStatements(
  db: JobsDb,
  scope: UserScope,
  task: PinnedTask,
  deviceId: string,
  now: number
): D1PreparedStatement[] {
  const statements = [
    stmt(
      db,
      "UPDATE automation_tasks SET state = 'cancelled', error_class = 'device_revoked', error_message = ?, finished_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'queued' AND target_device_id = ?",
      PINNED_MESSAGE,
      now,
      now,
      task.id,
      scope.userId,
      deviceId
    ),
    // Only when the UPDATE above applied (state + finished_at = now).
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'task', id, revision, 'upsert', ? FROM automation_tasks WHERE id = ? AND user_id = ? AND state = 'cancelled' AND finished_at = ?",
      now,
      task.id,
      scope.userId,
      now
    ),
  ];
  if (task.application_id) {
    statements.push(
      ...appendEvent(
        db,
        scope,
        {
          applicationId: task.application_id,
          type: "automation_task_finished",
          actorKind: "system",
          taskId: task.id,
          payload: {
            task_id: task.id,
            state: "cancelled",
            error_class: "device_revoked",
            message: PINNED_MESSAGE,
          },
          idempotencyKey: `device-revoked:${deviceId}:${task.id}`,
        },
        now
      ).statements
    );
  }
  return statements;
}

async function pinnedQueuedTasks(
  db: JobsDb,
  scope: UserScope,
  deviceId: string
): Promise<PinnedTask[]> {
  return await queryAll<PinnedTask>(
    db,
    "SELECT id, application_id FROM automation_tasks WHERE user_id = ? AND target_device_id = ? AND state = 'queued'",
    scope.userId,
    deviceId
  );
}

function emptyCounts(): LeaseLossCounts {
  return {
    outcome_unknown: 0,
    requeued: 0,
    awaiting_approval: 0,
    failed: 0,
    cancelled: 0,
  };
}

export interface DeviceLeaseLossInput {
  /** Cancel queued tasks pinned to the device (revocation, not reuse). */
  cancelPinned: boolean;
  deviceId: string;
  /**
   * Statements committed with the effects (the device change, the
   * idempotency row); they see the counts the batch applies.
   */
  extra: (counts: LeaseLossCounts) => readonly D1PreparedStatement[];
  now: number;
}

/**
 * Applies 21 §10 to every live lease the device holds, in ONE JOBS_DB batch
 * together with `extra`. Each lease effect is fenced on its old `lease_id`;
 * when one lease moved on concurrently (its guard fails) the effects are
 * re-applied lease by lease, skipping the ones that moved, and `extra` is
 * committed last with the counts that really applied.
 */
export async function applyDeviceLeaseLoss(
  db: JobsDb,
  scope: UserScope,
  input: DeviceLeaseLossInput
): Promise<LeaseLossCounts> {
  const { deviceId, now } = input;
  const tasks = await listDeviceLeases(db, scope, deviceId);
  const plans = await Promise.all(
    tasks.map((task) =>
      planLeaseLoss(db, scope, { task, cause: "device_revoked", now })
    )
  );
  const pinned = input.cancelPinned
    ? await pinnedQueuedTasks(db, scope, deviceId)
    : [];
  const pinnedStatements = pinned.flatMap((task) =>
    cancelPinnedStatements(db, scope, task, deviceId, now)
  );
  const planned = emptyCounts();
  planned.cancelled = pinned.length;
  for (const plan of plans) {
    planned[EFFECT_COUNTER[plan.effect]] += 1;
  }
  try {
    await runBatch(db, [
      ...plans.flatMap((plan) => plan.statements),
      ...pinnedStatements,
      ...input.extra(planned),
    ]);
    return planned;
  } catch (err) {
    if (!(err instanceof GuardFailedError) || plans.length === 0) {
      throw err;
    }
  }
  const applied = emptyCounts();
  applied.cancelled = pinned.length;
  for (const plan of plans) {
    try {
      await runBatch(db, plan.statements);
      applied[EFFECT_COUNTER[plan.effect]] += 1;
    } catch (err) {
      if (!(err instanceof GuardFailedError)) {
        throw err;
      }
    }
  }
  await runBatch(db, [...pinnedStatements, ...input.extra(applied)]);
  return applied;
}

/**
 * A `device` change outside a /api/v1 route (the token endpoint re-bound the
 * device to a new grant, 17 §6 step 6), so the dashboard refreshes it.
 */
export async function recordDeviceChange(
  env: Pick<Env, "JOBS_DB">,
  scope: UserScope,
  input: { deviceId: string; now: number; revision: number }
): Promise<void> {
  const db = jobsDb(env);
  await runBatch(db, [deviceChange(db, scope, input)]);
}

/**
 * Device revocation outside a /api/v1 route (`/oauth/revoke` with
 * `forget_device`, 17 §8): 21 §10 effects incl. pinned tasks + the change.
 */
export async function applyDeviceRevocationEffects(
  env: Pick<Env, "JOBS_DB">,
  scope: UserScope,
  input: { deviceId: string; deviceRevision: number; now: number }
): Promise<LeaseLossCounts> {
  const db = jobsDb(env);
  return await applyDeviceLeaseLoss(db, scope, {
    deviceId: input.deviceId,
    now: input.now,
    cancelPinned: true,
    extra: () => [
      deviceChange(db, scope, {
        deviceId: input.deviceId,
        revision: input.deviceRevision,
        now: input.now,
      }),
    ],
  });
}

/**
 * Refresh-token reuse (17 §7.2 step 4, D-30): the grant family is revoked in
 * `DB`; here the device's live leases fail as for a revocation (21 §10) and a
 * `device` change is appended. Pinned queued tasks stay: the device itself is
 * not revoked and may sign in again (`device_hint`).
 */
export async function failDeviceLeasesAfterReuse(
  env: Pick<Env, "JOBS_DB">,
  scope: UserScope,
  input: { deviceId: string; deviceRevision: number; now: number }
): Promise<LeaseLossCounts> {
  const db = jobsDb(env);
  return await applyDeviceLeaseLoss(db, scope, {
    deviceId: input.deviceId,
    now: input.now,
    cancelPinned: false,
    extra: () => [
      deviceChange(db, scope, {
        deviceId: input.deviceId,
        revision: input.deviceRevision,
        now: input.now,
      }),
    ],
  });
}
