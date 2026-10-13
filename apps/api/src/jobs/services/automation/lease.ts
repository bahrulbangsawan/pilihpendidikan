// Lease-scoped protocol, part 1 (21 §5.2–§6.1, §11): resolving a lease path,
// the heartbeat and the batched step events. The submit gate is intent.ts,
// result and release are result.ts, late evidence is late-evidence.ts.
//
// Authorization on every lease route (21 §11): the task belongs to the
// caller (404 otherwise), the path lease is the task's current lease, held
// by the calling device, unexpired, in a lease-holding state (409
// `lease_lost` otherwise). Each write batch re-checks the same fence first.

import type {
  LeaseEvent,
  LeaseHeartbeatRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import type { TaskState } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  AutomationAttemptRecord,
  AutomationTaskRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import { notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { FieldValue, LeaseRef } from "../../repo/automation/lease";
import {
  fenceGuard,
  heartbeatStatements,
  leaseTaskUpdate,
} from "../../repo/automation/lease";
import { existingEventKeys } from "../../repo/automation/limits";
import { HOLDING_STATES } from "../../repo/automation/records";
import { attemptOfLease, loadTask } from "../../repo/automation/tasks";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import { LEASE_DURATION_MS } from "../../repo/core/leases";
import { getUserSettings } from "../../repo/core/settings";
import { leaseLost, pollIntervalMs } from "./shared";

export interface LeaseState {
  attempt: AutomationAttemptRecord | null;
  task: AutomationTaskRecord;
}

/**
 * Resolves a lease path (21 §11): 404 when the task is not the caller's,
 * 409 lease_lost when the lease, device, expiry or state does not match.
 */
export async function requireLease(
  db: JobsDb,
  scope: UserScope,
  ref: LeaseRef,
  now: number
): Promise<LeaseState> {
  const task = await loadTask(db, scope, ref.taskId);
  if (!task) {
    throw notFound("Task not found.");
  }
  const holding = (HOLDING_STATES as readonly string[]).includes(task.state);
  if (
    task.lease_id !== ref.leaseId ||
    task.lease_device_id !== ref.deviceId ||
    !holding ||
    task.lease_expires_at === null ||
    task.lease_expires_at <= now
  ) {
    throw leaseLost();
  }
  const attempt = await attemptOfLease(db, scope, task.id, ref.leaseId);
  return { task, attempt };
}

function progressStage(progress: unknown): string | null {
  if (progress && typeof progress === "object" && "stage" in progress) {
    const stage = (progress as { stage?: unknown }).stage;
    return typeof stage === "string" ? stage : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Heartbeat (21 §5.2)
// ---------------------------------------------------------------------------

export interface HeartbeatResponse {
  cancel_requested: boolean;
  lease_expires_at: number;
  poll_interval_ms: number;
  resume_requested: boolean;
  server_time: number;
}

export async function planHeartbeat(
  db: JobsDb,
  scope: UserScope,
  env: Pick<Env, "AUTH_KV">,
  ref: LeaseRef,
  body: LeaseHeartbeatRequest,
  now: number
): Promise<{ response: HeartbeatResponse; statements: D1PreparedStatement[] }> {
  const { task, attempt } = await requireLease(db, scope, ref, now);
  const settings = await getUserSettings(db, scope, now);
  const stateChanges = task.state === "claimed";
  const stageChanges =
    progressStage(task.progress) !== progressStage(body.progress);
  const statements = heartbeatStatements(db, scope, ref, {
    attemptId: attempt?.id ?? null,
    clearResume: task.resume_requested,
    localState: body.local_state,
    logChange: stateChanges || stageChanges,
    now,
    progress: body.progress,
  });
  // 19 §8.3: the kill switch cancels live leases before submit_intent.
  const paused =
    settings.automation_paused &&
    task.kind === "apply" &&
    task.submit_intent_at === null;
  return {
    statements,
    response: {
      lease_expires_at: now + LEASE_DURATION_MS,
      cancel_requested: task.cancel_requested || paused,
      resume_requested: task.resume_requested,
      poll_interval_ms: await pollIntervalMs(env, db, scope, now),
      server_time: now,
    },
  };
}

// ---------------------------------------------------------------------------
// Step events (21 §6.1)
// ---------------------------------------------------------------------------

interface EventResult {
  error?: string;
  event_id?: string;
  idempotency_key: string;
  status: "recorded" | "duplicate" | "rejected";
}

export interface LeaseEventsPlan {
  response: { results: EventResult[]; task_state: TaskState };
  statements: D1PreparedStatement[];
}

interface EventWalk {
  pauseReason: AutomationTaskRecord["pause_reason"];
  progress: AutomationTaskRecord["progress"];
  resumeCleared: boolean;
  state: TaskState;
}

function applyEvent(
  walk: EventWalk,
  event: LeaseEvent
): { error?: string; ok: boolean } {
  switch (event.type) {
    case "started":
      if (walk.state === "claimed") {
        walk.state = "running";
      }
      return { ok: true };
    case "progress":
      walk.progress = event.progress;
      if (walk.state === "claimed") {
        walk.state = "running";
      }
      return { ok: true };
    case "paused":
      if (walk.state === "awaiting_approval") {
        return { ok: false, error: "awaiting_approval" };
      }
      walk.state = "paused";
      walk.pauseReason = event.pause_reason;
      return { ok: true };
    case "resumed":
      if (walk.state === "paused" || walk.state === "awaiting_approval") {
        walk.state = "running";
        walk.pauseReason = null;
        walk.resumeCleared = true;
      } else if (walk.state === "claimed") {
        walk.state = "running";
      }
      return { ok: true };
    case "log":
      return { ok: true };
    default:
      return { ok: false, error: "use_dedicated_route" };
  }
}

function eventRecord(
  db: JobsDb,
  scope: UserScope,
  task: AutomationTaskRecord,
  input: {
    attemptId: string | null;
    deviceId: string;
    event: LeaseEvent;
    key: string;
    walk: EventWalk;
  },
  now: number
): { id: string | null; statements: D1PreparedStatement[] } {
  const { event, walk } = input;
  if (event.type === "log" || !task.application_id) {
    return { id: null, statements: [] };
  }
  const payload: Record<string, unknown> = {
    task_id: task.id,
    state: walk.state,
  };
  if (input.attemptId) {
    payload.attempt_id = input.attemptId;
  }
  let type: "automation_task_progress" | "automation_task_paused" =
    "automation_task_progress";
  if (event.type === "progress") {
    payload.stage = event.progress.stage;
    payload.step = event.progress.step;
    payload.message = event.progress.message.slice(0, 300);
  } else if (event.type === "paused") {
    type = "automation_task_paused";
    payload.pause_reason = event.pause_reason;
    if (event.message) {
      payload.message = event.message.slice(0, 300);
    }
  } else {
    payload.message = event.type;
  }
  const appended = appendEvent(
    db,
    scope,
    {
      applicationId: task.application_id,
      type,
      actorKind: "automation",
      actorDeviceId: input.deviceId,
      taskId: task.id,
      attemptId: input.attemptId,
      occurredAt: event.occurred_at,
      payload,
      idempotencyKey: input.key,
    },
    now
  );
  return { id: appended.id, statements: appended.statements };
}

/** POST …/events: ≤ 50 step events, each deduplicated by its key. */
export async function planLeaseEvents(
  db: JobsDb,
  scope: UserScope,
  ref: LeaseRef,
  events: readonly LeaseEvent[],
  now: number
): Promise<LeaseEventsPlan> {
  const { task, attempt } = await requireLease(db, scope, ref, now);
  const keyOf = (event: LeaseEvent) =>
    `task:${task.id}:evt:${event.idempotency_key}`.slice(0, 128);
  const stored = task.application_id
    ? await existingEventKeys(db, scope, events.map(keyOf))
    : new Set<string>();
  const walk: EventWalk = {
    state: task.state,
    pauseReason: task.pause_reason,
    progress: task.progress,
    resumeCleared: false,
  };
  const seen = new Set<string>();
  const results: EventResult[] = [];
  const eventStatements: D1PreparedStatement[] = [];
  for (const event of events) {
    const key = keyOf(event);
    if (stored.has(key) || seen.has(key)) {
      results.push({
        idempotency_key: event.idempotency_key,
        status: "duplicate",
      });
      continue;
    }
    seen.add(key);
    const applied = applyEvent(walk, event);
    if (!applied.ok) {
      results.push({
        idempotency_key: event.idempotency_key,
        status: "rejected",
        error: applied.error,
      });
      continue;
    }
    const record = eventRecord(
      db,
      scope,
      task,
      {
        attemptId: attempt?.id ?? null,
        deviceId: ref.deviceId,
        event,
        key,
        walk,
      },
      now
    );
    eventStatements.push(...record.statements);
    results.push({
      idempotency_key: event.idempotency_key,
      status: "recorded",
      ...(record.id ? { event_id: record.id } : {}),
    });
  }
  const stateChanged = walk.state !== task.state;
  const stageChanged =
    progressStage(walk.progress) !== progressStage(task.progress);
  const fields: Array<readonly [string, FieldValue]> = [];
  if (stateChanged) {
    fields.push(["state", walk.state]);
  }
  if (walk.pauseReason !== task.pause_reason) {
    fields.push(["pause_reason", walk.pauseReason]);
  }
  if (walk.progress !== task.progress) {
    fields.push(["progress", { json: walk.progress }]);
  }
  if (walk.resumeCleared && task.resume_requested) {
    fields.push(["resume_requested", 0]);
  }
  const statements: D1PreparedStatement[] = [
    fenceGuard(db, scope, ref, now, task.state),
  ];
  if (fields.length > 0) {
    statements.push(
      ...leaseTaskUpdate(db, scope, ref, now, fields, {
        logChange: stateChanged || stageChanged,
      })
    );
  }
  statements.push(...eventStatements);
  return { statements, response: { results, task_state: walk.state } };
}
