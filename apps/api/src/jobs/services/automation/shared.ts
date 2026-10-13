// Small helpers shared by the automation services: the lease-lost error,
// task events on the application timeline (03 §6), version comparison and
// the server-guided poll interval (21 §1.1).

import type {
  ActorKind,
  EventType,
  PauseReason,
  ProgressStage,
  TaskState,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { AutomationTaskRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import type { ApiError } from "../../core/http";
import { apiError } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { compareSemver, parseVersionCore } from "../../core/version";
import { taskCreatedSince } from "../../repo/automation/tasks";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";

/** 409 lease_lost (21 §5.3): the device must stop acting at once. */
export function leaseLost(): ApiError {
  return apiError(
    "lease_lost",
    "This lease is no longer valid. Stop acting on this task and do not report again under it."
  );
}

/** 409 too_late: cancel/release after submit_intent (05 §1.3, 21 §13.3). */
export function tooLate(): ApiError {
  return apiError("too_late", "Submission already in progress.");
}

/** 422 policy_violation with a machine-readable `details.reason`. */
export function refuse(
  message: string,
  reason: string,
  extra: Record<string, unknown> = {}
): ApiError {
  return apiError("policy_violation", message, {
    details: { reason, ...extra },
  });
}

/** 409 duplicate (double-submission prevention, 21 §9). */
export function duplicate(message: string, reason: string): ApiError {
  return apiError("duplicate", message, { details: { reason } });
}

/** `version ≥ min` on the numeric core (05 §1.7); unreadable → false. */
export function versionAtLeast(version: string, min: string): boolean {
  const have = parseVersionCore(version);
  const need = parseVersionCore(min);
  if (!need) {
    return true;
  }
  return have !== null && compareSemver(have, need) >= 0;
}

export interface TaskEventInput {
  actorDeviceId?: string | null;
  actorKind: ActorKind;
  attemptId?: string | null;
  errorClass?: string | null;
  extra?: Record<string, unknown>;
  /** Unique per user; namespaced by task. */
  key: string;
  message?: string;
  occurredAt?: number;
  pauseReason?: PauseReason | null;
  stage?: ProgressStage;
  state: TaskState;
  step?: number;
  type: Extract<
    EventType,
    | "automation_task_created"
    | "automation_task_claimed"
    | "automation_task_progress"
    | "automation_task_paused"
    | "automation_task_finished"
  >;
}

/** An `automation_task_*` event on the task's application (none without one). */
export function taskEvent(
  db: JobsDb,
  scope: UserScope,
  task: Pick<AutomationTaskRecord, "application_id" | "id">,
  input: TaskEventInput,
  now: number
): D1PreparedStatement[] {
  if (!task.application_id) {
    return [];
  }
  const payload: Record<string, unknown> = {
    task_id: task.id,
    state: input.state,
    ...input.extra,
  };
  if (input.attemptId) {
    payload.attempt_id = input.attemptId;
  }
  if (input.step !== undefined) {
    payload.step = input.step;
  }
  if (input.stage) {
    payload.stage = input.stage;
  }
  if (input.message) {
    payload.message = input.message.slice(0, 300);
  }
  if (input.pauseReason) {
    payload.pause_reason = input.pauseReason;
  }
  if (input.errorClass) {
    payload.error_class = input.errorClass.slice(0, 64);
  }
  return appendEvent(
    db,
    scope,
    {
      applicationId: task.application_id,
      type: input.type,
      actorKind: input.actorKind,
      actorDeviceId: input.actorDeviceId ?? null,
      taskId: task.id,
      attemptId: input.attemptId ?? null,
      occurredAt: input.occurredAt,
      payload,
      idempotencyKey: input.key.slice(0, 128),
    },
    now
  ).statements;
}

/** Fast polling while the user is active (21 §1.1). */
export const POLL_ACTIVE_MS = 5000;
export const POLL_IDLE_MS = 30_000;
const ACTIVE_WINDOW_MS = 300_000;

/** The KV key the BFF refreshes while an automation page is open. */
export function watchKey(userId: string): string {
  return `jobs:watch:${userId}`;
}

/**
 * 5 s when a task was created in the last 5 min or an automation page is
 * open (`jobs:watch:<user>` in AUTH_KV), else 30 s. The CLI adds jitter and
 * its own 60 s idle step.
 */
export async function pollIntervalMs(
  env: Pick<Env, "AUTH_KV">,
  db: JobsDb,
  scope: UserScope,
  now: number
): Promise<number> {
  if (await taskCreatedSince(db, scope, now - ACTIVE_WINDOW_MS)) {
    return POLL_ACTIVE_MS;
  }
  try {
    if ((await env.AUTH_KV.get(watchKey(scope.userId))) !== null) {
      return POLL_ACTIVE_MS;
    }
  } catch {
    // KV hiccup: fall back to the idle interval.
  }
  return POLL_IDLE_MS;
}
