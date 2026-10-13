// Application stage and submission-status transitions — the one place that
// enforces 03 §5.1 (stage graph + actors), 03 §5.2 / 20 §6.2 (forward-only
// submission statuses), 20 §6.2 (automation precedence) and 06 §2.3
// (no moves while a submission is in flight). Used by every area that moves a
// card or records a submission: board routes (leaf-2.3), task results and
// late evidence (leaf-2.7), email hand-off (leaf-2.9), CV variants
// (leaf-2.6), the legacy facade (leaf-2.10) and lease effects (leases.ts).
//
//   const plan = await planApplicationTransition(c.db, c.scope, {
//     applicationId, actor: "user", source: c.changeSource, now: c.now,
//     baseRevision, stage: { to: "applied", reason: "manual" },
//     submission: { to: "submitted_verified", evidenceId, method: "manual" },
//   });
//   return await c.commit([...evidenceStatements, ...plan.statements], {
//     status: 200, body: { application: plan.after },
//   });
//
// The plan's statements start with a revision guard, so a concurrent write
// between planning and commit aborts the batch (`GuardFailedError`); re-plan
// with `retryOnGuardFailure`.
//
// Outcomes
// --------
// stage.result:
//   "applied"   the stage moves; `stage_changed` event (applied_to_state = 1)
//   "conflict"  automation only: the move is illegal from the CURRENT stage,
//               the current stage is outside the task's expected set, or the
//               user/MCP changed the stage after the task was created
//               (20 §6.2). Stage unchanged; `stage_changed` is stored with
//               applied_to_state = 0 plus a `conflict_recorded` event (the
//               dashboard notice, 20 §6.3 A).
//   "skipped"   system only: the automatic move does not apply (no event)
//   "unchanged" target equals the current stage (no event)
// Illegal user/MCP moves throw 422 invalid_transition; a stale
// `baseRevision` throws 409 revision_conflict with `details.current`.
//
// submission.result:
//   "applied"   status changes; `submission_status_changed` event
//   "ignored"   automation/system tried to move it backwards or sideways
//               (20 §6.2: facts win, status only moves forward; the retry
//               edge failed → in_progress and the evidence edge
//               outcome_unknown → submitted_unverified count as forward,
//               `isForwardSubmission`); the event is stored with
//               applied_to_state = 0
//   "unchanged" target equals the current status (no event)

import type {
  ActorKind,
  ChangeSource,
  Stage,
  SubmissionMethod,
  SubmissionStatus,
} from "@pilihpendidikan/jobs-contracts/enums";
import { TASK_LIVE_STATES } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  canChangeSubmissionStatus,
  canTransition,
  stageActorFor,
} from "@pilihpendidikan/jobs-contracts/stage";
import { invalidTransition, notFound, revisionConflict } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { appendChange } from "./change-log";
import type { JobsDb } from "./db";
import { decodeRow, guardRevision, queryFirst, stmt } from "./db";
import { appendEvent } from "./events";

/** Stages from which automation may report `applied` by default (20 §6.2). */
export const AUTOMATION_EXPECTED_FROM: readonly Stage[] = [
  "saved",
  "preparing",
  "ready",
];

const SUBMITTED: readonly SubmissionStatus[] = [
  "submitted_verified",
  "submitted_unverified",
];
const CLEARS_SUBMITTED_AT: readonly SubmissionStatus[] = [
  "not_started",
  "in_progress",
  "failed",
];

/** The full application row (API representation). */
export async function loadApplication(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<ApplicationRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM applications WHERE id = ? AND user_id = ?",
    applicationId,
    scope.userId
  );
  return row ? decodeRow<ApplicationRecord>("applications", row) : null;
}

/** A live task of this application past `submit_intent` (06 §2.3), or null. */
export async function liveSubmitIntentTask(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<{ id: string; state: string; submit_intent_at: number } | null> {
  const live = TASK_LIVE_STATES.map(() => "?").join(", ");
  return await queryFirst(
    db,
    `SELECT id, state, submit_intent_at FROM automation_tasks WHERE user_id = ? AND application_id = ? AND submit_intent_at IS NOT NULL AND state IN (${live}) LIMIT 1`,
    scope.userId,
    applicationId,
    ...TASK_LIVE_STATES
  );
}

/**
 * The latest user-set stage change after `since` (20 §6.2 "user-set": an
 * applied `stage_changed` event with actor_kind user or mcp).
 */
export async function userStageChangeSince(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  since: number
): Promise<{
  id: string;
  recorded_at: number;
  to_value: string | null;
} | null> {
  return await queryFirst(
    db,
    "SELECT id, to_value, recorded_at FROM application_events WHERE user_id = ? AND application_id = ? AND type = 'stage_changed' AND actor_kind IN ('user', 'mcp') AND applied_to_state = 1 AND recorded_at > ? ORDER BY recorded_at DESC LIMIT 1",
    scope.userId,
    applicationId,
    since
  );
}

export interface AutomationOrigin {
  attemptId?: string | null;
  /** Stages the task may move from (default: saved, preparing, ready). */
  expectedFrom?: readonly Stage[];
  /** `automation_tasks.created_at` of the reporting task. */
  taskCreatedAt: number;
  taskId: string;
}

export interface TransitionInput {
  /** Device that acted (CLI under a lease, or the caller's device). */
  actorDeviceId?: string | null;
  actor: ActorKind;
  /** Bypass the in-flight submission refusal (06 §2.3) for user moves. */
  allowDuringSubmission?: boolean;
  applicationId: string;
  /** Required for automation stage moves (20 §6.2 precedence). */
  automation?: AutomationOrigin;
  /** Strict optimistic check (D-21); omit only for precedence-ruled writes. */
  baseRevision?: number | null;
  /** Prefix for the events' idempotency keys (`<prefix>:stage`, …). */
  eventKeyPrefix?: string;
  now: number;
  occurredAt?: number;
  /** `applications.last_change_source`. */
  source: ChangeSource;
  stage?: { reason?: string; to: Stage };
  submission?: {
    evidenceId?: string | null;
    method?: SubmissionMethod | null;
    submittedAt?: number | null;
    to: SubmissionStatus;
    via?: "assisted_user_click" | "late_evidence";
  };
}

export interface StageOutcome {
  conflictEventId?: string;
  eventId?: string;
  from: Stage;
  reason?: string;
  result: "applied" | "conflict" | "skipped" | "unchanged";
  to: Stage;
}

export interface SubmissionOutcome {
  eventId?: string;
  from: SubmissionStatus;
  result: "applied" | "ignored" | "unchanged";
  to: SubmissionStatus;
}

export interface TransitionPlan {
  /** The application after the batch commits. */
  after: ApplicationRecord;
  /** The application as read. */
  before: ApplicationRecord;
  /** True when the application row itself is updated. */
  changed: boolean;
  stage: StageOutcome | null;
  /** Guard + UPDATE + events + change_log, in batch order. */
  statements: D1PreparedStatement[];
  submission: SubmissionOutcome | null;
}

interface PlanState {
  after: ApplicationRecord;
  app: ApplicationRecord;
  events: D1PreparedStatement[];
  input: TransitionInput;
}

function eventKey(input: TransitionInput, suffix: string): string | undefined {
  return input.eventKeyPrefix ? `${input.eventKeyPrefix}:${suffix}` : undefined;
}

function pushEvent(
  db: JobsDb,
  scope: UserScope,
  state: PlanState,
  event: Parameters<typeof appendEvent>[2]
): string {
  const appended = appendEvent(db, scope, event, state.input.now);
  state.events.push(...appended.statements);
  return appended.id;
}

function eventBase(state: PlanState) {
  const { app, input } = state;
  return {
    applicationId: app.id,
    actorKind: input.actor,
    actorDeviceId: input.actorDeviceId ?? null,
    taskId: input.automation?.taskId ?? null,
    attemptId: input.automation?.attemptId ?? null,
    occurredAt: input.occurredAt,
  };
}

// User and MCP moves: the 03 §5.1 graph, and never during a submission.
async function assertUserMove(
  db: JobsDb,
  scope: UserScope,
  state: PlanState,
  from: Stage,
  to: Stage
): Promise<void> {
  if (!canTransition(from, to, "user")) {
    throw invalidTransition(`Moving from ${from} to ${to} is not allowed.`, {
      from,
      to,
    });
  }
  if (state.input.allowDuringSubmission) {
    return;
  }
  const inFlight = await liveSubmitIntentTask(db, scope, state.app.id);
  if (inFlight) {
    throw invalidTransition("A submission for this application is in flight.", {
      reason: "submission_in_flight",
      task_id: inFlight.id,
    });
  }
}

// 20 §6.2: why an automation move must not apply, or null when it may.
async function automationConflict(
  db: JobsDb,
  scope: UserScope,
  state: PlanState,
  from: Stage,
  to: Stage
): Promise<string | null> {
  const origin = state.input.automation;
  if (!origin) {
    throw new Error("automation stage moves need the reporting task (20 §6.2)");
  }
  const userChange = await userStageChangeSince(
    db,
    scope,
    state.app.id,
    origin.taskCreatedAt
  );
  if (userChange) {
    return "user_stage_change_after_task";
  }
  const expected = origin.expectedFrom ?? AUTOMATION_EXPECTED_FROM;
  if (!(expected.includes(from) && canTransition(from, to, "automation"))) {
    return "unexpected_current_stage";
  }
  return null;
}

function recordConflict(
  db: JobsDb,
  scope: UserScope,
  state: PlanState,
  from: Stage,
  to: Stage,
  reason: string
): StageOutcome {
  const eventId = pushEvent(db, scope, state, {
    ...eventBase(state),
    type: "stage_changed",
    fromValue: from,
    toValue: to,
    appliedToState: false,
    payload: { from, to, reason },
    idempotencyKey: eventKey(state.input, "stage"),
  });
  const conflictEventId = pushEvent(db, scope, state, {
    ...eventBase(state),
    type: "conflict_recorded",
    fromValue: from,
    toValue: to,
    payload: { attempted: to, current: from, reason },
    idempotencyKey: eventKey(state.input, "conflict"),
  });
  return { result: "conflict", from, to, reason, eventId, conflictEventId };
}

async function planStage(
  db: JobsDb,
  scope: UserScope,
  state: PlanState
): Promise<StageOutcome | null> {
  const { app, input } = state;
  if (!input.stage) {
    return null;
  }
  const from = app.stage;
  const to = input.stage.to;
  if (from === to) {
    return { result: "unchanged", from, to };
  }
  const actor = stageActorFor(input.actor);
  if (actor === "system" && !canTransition(from, to, "system")) {
    return { result: "skipped", from, to };
  }
  if (actor === "user") {
    await assertUserMove(db, scope, state, from, to);
  }
  if (actor === "automation") {
    const reason = await automationConflict(db, scope, state, from, to);
    if (reason) {
      return recordConflict(db, scope, state, from, to, reason);
    }
  }
  const eventId = pushEvent(db, scope, state, {
    ...eventBase(state),
    type: "stage_changed",
    fromValue: from,
    toValue: to,
    // `mode` is the application's mode when the move happened, so analytics
    // can break applications down by mode at the time of applying (10 §2.6).
    payload: input.stage.reason
      ? { from, to, mode: state.app.mode, reason: input.stage.reason }
      : { from, to, mode: state.app.mode },
    idempotencyKey: eventKey(input, "stage"),
  });
  state.after.stage = to;
  state.after.stage_changed_at = input.now;
  return { result: "applied", from, to, eventId };
}

function planSubmission(
  db: JobsDb,
  scope: UserScope,
  state: PlanState
): SubmissionOutcome | null {
  const { app, input } = state;
  const change = input.submission;
  if (!change) {
    return null;
  }
  const from = app.submission_status;
  const to = change.to;
  if (from === to) {
    return { result: "unchanged", from, to };
  }
  const allowed = canChangeSubmissionStatus(from, to, input.actor);
  const payload: Record<string, unknown> = { from, to };
  if (change.evidenceId) {
    payload.evidence_id = change.evidenceId;
  }
  if (change.via) {
    payload.via = change.via;
  }
  const eventId = pushEvent(db, scope, state, {
    applicationId: app.id,
    type: "submission_status_changed",
    fromValue: from,
    toValue: to,
    payload,
    appliedToState: allowed,
    actorKind: input.actor,
    actorDeviceId: input.actorDeviceId ?? null,
    taskId: input.automation?.taskId ?? null,
    attemptId: input.automation?.attemptId ?? null,
    occurredAt: input.occurredAt,
    idempotencyKey: eventKey(input, "submission"),
  });
  if (!allowed) {
    return { result: "ignored", from, to, eventId };
  }
  state.after.submission_status = to;
  if (SUBMITTED.includes(to)) {
    state.after.submitted_at =
      change.submittedAt ?? app.submitted_at ?? input.now;
  } else if (CLEARS_SUBMITTED_AT.includes(to)) {
    state.after.submitted_at = null;
  }
  if (change.method) {
    state.after.submission_method = change.method;
  }
  return { result: "applied", from, to, eventId };
}

/**
 * Plans one stage and/or submission-status change of an application. Reads
 * the current row and the precedence facts; returns the batch statements and
 * the outcome. Nothing is written until the caller runs the statements.
 */
export async function planApplicationTransition(
  db: JobsDb,
  scope: UserScope,
  input: TransitionInput
): Promise<TransitionPlan> {
  const app = await loadApplication(db, scope, input.applicationId);
  if (!app) {
    throw notFound("Application not found.");
  }
  if (
    input.baseRevision !== undefined &&
    input.baseRevision !== null &&
    input.baseRevision !== app.revision
  ) {
    throw revisionConflict(
      app,
      `Application changed since revision ${input.baseRevision} (now ${app.revision}).`
    );
  }
  const state: PlanState = { app, input, after: { ...app }, events: [] };
  const stage = await planStage(db, scope, state);
  const submission = planSubmission(db, scope, state);
  const changed =
    stage?.result === "applied" || submission?.result === "applied";
  const statements: D1PreparedStatement[] = [
    guardRevision(db, scope, "applications", app.id, app.revision),
  ];
  if (changed) {
    const { after } = state;
    after.revision = app.revision + 1;
    after.updated_at = input.now;
    after.last_change_source = input.source;
    statements.push(
      stmt(
        db,
        "UPDATE applications SET stage = ?, stage_changed_at = ?, submission_status = ?, submitted_at = ?, submission_method = ?, last_change_source = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?",
        after.stage,
        after.stage_changed_at,
        after.submission_status,
        after.submitted_at,
        after.submission_method,
        after.last_change_source,
        input.now,
        app.id,
        scope.userId,
        app.revision
      ),
      appendChange(db, scope, {
        entity: "application",
        entityId: app.id,
        revision: after.revision,
        now: input.now,
      })
    );
  }
  statements.push(...state.events);
  return {
    before: app,
    after: state.after,
    changed,
    stage,
    submission,
    statements,
  };
}
