// The atomic claim (21 §5.1, 04 §3, D-11).
//
// The claim is ONE conditional `UPDATE … WHERE id = (SELECT … LIMIT 1) AND
// state = 'queued' … RETURNING *` — the 04 §3 statement, with the candidate
// pinned by id and revision so the response (task + context bundle) can be
// computed before the batch and stored with it for idempotent replay. D1
// executes batches serially, so of two racing claims for the same row only
// one UPDATE matches; the loser's batch aborts on the guard that follows the
// UPDATE (nothing else is written) and the service tries the next candidate.
//
// Eligibility inside the statement (21 §3): the user, `queued`,
// `not_before ≤ now < expires_at`, the target device (NULL or this one),
// `required_capabilities ⊆ capabilities`, the kinds this device may claim
// now (one live lease per kind and device, 21 §3 concurrency), no pending
// cancel, and — when the auto kill switch is off — no `auto` apply tasks.

import type { TaskKind } from "@pilihpendidikan/jobs-contracts/enums";
import type { AutomationTaskRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import { appendChange } from "../core/change-log";
import type { JobsDb } from "../core/db";
import { guard, queryAll, stmt } from "../core/db";
import { appendEvent } from "../core/events";
import type { Row } from "./records";
import { HOLDING_IN, HOLDING_STATES, placeholders, toTask } from "./records";

export interface ClaimFilter {
  capabilities: readonly string[];
  deviceId: string;
  /** Exclude apply tasks whose payload.mode is auto (flag off). */
  excludeAutoApply: boolean;
  /** Kinds this device may claim now (never empty). */
  kinds: readonly TaskKind[];
  now: number;
}

/** The 21 §3 predicates after `t.user_id = ?` (callers spell that out). */
function eligibility(filter: ClaimFilter): { binds: unknown[]; sql: string } {
  const parts = [
    "t.state = 'queued'",
    "t.not_before <= ?",
    "t.expires_at > ?",
    "t.cancel_requested = 0",
    "t.submit_intent_at IS NULL",
    "(t.target_device_id IS NULL OR t.target_device_id = ?)",
    "NOT EXISTS (SELECT 1 FROM json_each(t.required_capabilities) rc WHERE rc.value NOT IN (SELECT value FROM json_each(?)))",
    `t.kind IN (${placeholders(filter.kinds.length)})`,
    `NOT EXISTS (SELECT 1 FROM automation_tasks h WHERE h.user_id = t.user_id AND h.lease_device_id = ? AND h.kind = t.kind AND h.lease_id IS NOT NULL AND h.lease_expires_at > ? AND h.state IN (${HOLDING_IN}))`,
  ];
  const binds: unknown[] = [
    filter.now,
    filter.now,
    filter.deviceId,
    JSON.stringify([...filter.capabilities]),
    ...filter.kinds,
    filter.deviceId,
    filter.now,
    ...HOLDING_STATES,
  ];
  if (filter.excludeAutoApply) {
    parts.push(
      "NOT (t.kind = 'apply' AND json_extract(t.payload, '$.mode') = 'auto')"
    );
  }
  return { sql: parts.join(" AND "), binds };
}

/** Claimable tasks in claim order (priority, then age). */
export async function listClaimCandidates(
  db: JobsDb,
  scope: UserScope,
  filter: ClaimFilter,
  limit: number
): Promise<AutomationTaskRecord[]> {
  if (filter.kinds.length === 0) {
    return [];
  }
  const where = eligibility(filter);
  const rows = await queryAll<Row>(
    db,
    `SELECT t.* FROM automation_tasks t WHERE t.user_id = ? AND ${where.sql} ORDER BY t.priority DESC, t.created_at, t.id LIMIT ?`,
    scope.userId,
    ...where.binds,
    limit
  );
  return rows.map(toTask);
}

/** Kinds of the live, unexpired leases a device holds (21 §3 slots). */
export async function heldLeaseKinds(
  db: JobsDb,
  scope: UserScope,
  deviceId: string,
  now: number
): Promise<TaskKind[]> {
  const rows = await queryAll<{ kind: TaskKind }>(
    db,
    `SELECT DISTINCT kind FROM automation_tasks WHERE user_id = ? AND lease_device_id = ? AND lease_id IS NOT NULL AND lease_expires_at > ? AND state IN (${HOLDING_IN})`,
    scope.userId,
    deviceId,
    now,
    ...HOLDING_STATES
  );
  return rows.map((row) => row.kind);
}

export interface ClaimLease {
  attemptId: string;
  cliVersion: string;
  expiresAt: number;
  leaseId: string;
}

/** The claim label of the effect guard (→ the candidate was lost). */
export const CLAIM_LOST_LABEL = "claim:lost";

/**
 * The claim batch: the conditional UPDATE … RETURNING (statement 0), the
 * guard that it took effect, the attempt row, the `_claimed` event and the
 * change_log rows (21 §5.1 step 4). The caller appends the idempotency row.
 */
export function claimStatements(
  db: JobsDb,
  scope: UserScope,
  filter: ClaimFilter,
  candidate: AutomationTaskRecord,
  lease: ClaimLease
): D1PreparedStatement[] {
  const where = eligibility(filter);
  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      `UPDATE automation_tasks SET state = 'claimed', lease_id = ?, lease_device_id = ?, lease_expires_at = ?, attempt_count = attempt_count + 1, pause_reason = NULL, resume_requested = 0, local_state = NULL, progress = '{}', error_class = NULL, error_message = NULL, revision = revision + 1, updated_at = ? WHERE id = (SELECT t.id FROM automation_tasks t WHERE t.user_id = ? AND ${where.sql} AND t.id = ? AND t.revision = ? ORDER BY t.priority DESC, t.created_at LIMIT 1) AND user_id = ? AND state = 'queued' RETURNING *`,
      lease.leaseId,
      filter.deviceId,
      lease.expiresAt,
      filter.now,
      scope.userId,
      ...where.binds,
      candidate.id,
      candidate.revision,
      scope.userId
    ),
    guard(
      db,
      CLAIM_LOST_LABEL,
      "SELECT 1 FROM automation_tasks WHERE id = ? AND user_id = ? AND lease_id = ? AND state = 'claimed'",
      candidate.id,
      scope.userId,
      lease.leaseId
    ),
    stmt(
      db,
      "INSERT INTO automation_attempts (id, task_id, user_id, device_id, lease_id, attempt_no, started_at, last_heartbeat_at, cli_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      lease.attemptId,
      candidate.id,
      scope.userId,
      filter.deviceId,
      lease.leaseId,
      candidate.attempt_count + 1,
      filter.now,
      filter.now,
      lease.cliVersion
    ),
    appendChange(db, scope, {
      entity: "attempt",
      entityId: lease.attemptId,
      revision: 1,
      now: filter.now,
    }),
    appendChange(db, scope, {
      entity: "task",
      entityId: candidate.id,
      revision: candidate.revision + 1,
      now: filter.now,
    }),
  ];
  if (candidate.application_id) {
    statements.push(
      ...appendEvent(
        db,
        scope,
        {
          applicationId: candidate.application_id,
          type: "automation_task_claimed",
          actorKind: "automation",
          actorDeviceId: filter.deviceId,
          taskId: candidate.id,
          attemptId: lease.attemptId,
          payload: {
            task_id: candidate.id,
            attempt_id: lease.attemptId,
            state: "claimed",
          },
          idempotencyKey: `task:${candidate.id}:claimed:${lease.leaseId}`,
        },
        filter.now
      ).statements
    );
  }
  return statements;
}
