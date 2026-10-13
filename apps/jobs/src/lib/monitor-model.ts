// The live run monitor's model (12 §6.3, 21 §6, 03 §7.2): the stepper built
// from the task and its events, the executor status, the heartbeat age, one
// prompt per canonical PauseReason, the step log, when polling stops, and the
// throttle that keeps the aria-live step log to one announcement per 5 s.

import type {
  PauseReason,
  ProgressStage,
  TaskKind,
  TaskState,
} from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationEventRecord,
  AutomationAttemptRecord,
  AutomationTaskRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { PollPolicy } from "./polling";
import { pollInterval } from "./polling";

// ── Terminal states and polling ─────────────────────────────────────────────

export const TERMINAL_TASK_STATES = [
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
] as const satisfies readonly TaskState[];

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_TASK_STATES);

export function isTerminalTask(state: TaskState | null | undefined): boolean {
  return state !== null && state !== undefined && TERMINAL.has(state);
}

/** States the user can cancel (21 §12: queued … awaiting approval). */
export function isCancellable(state: TaskState): boolean {
  return (
    state === "queued" ||
    state === "claimed" ||
    state === "running" ||
    state === "paused" ||
    state === "awaiting_approval"
  );
}

/**
 * The monitor's `refetchInterval`: 2 s visible / 10 s hidden while the task
 * runs (backing off on failures), and nothing once it is terminal.
 */
export function monitorPollInterval(
  state: TaskState | undefined,
  policy: PollPolicy,
  poll: { hidden: boolean; failures: number }
): number | false {
  if (isTerminalTask(state)) {
    return false;
  }
  return pollInterval(policy, poll);
}

// ── Stepper ─────────────────────────────────────────────────────────────────

/** The apply stepper of 12 §6.3, in order. */
export const APPLY_STEPS = [
  "claimed",
  "preparing_cv",
  "opening",
  "filling",
  "reviewing",
  "awaiting_approval",
  "submitting",
  "verifying",
  "done",
] as const satisfies readonly ProgressStage[];

const DISCOVER_STEPS = [
  "claimed",
  "discovering",
  "done",
] as const satisfies readonly ProgressStage[];
const RENDER_STEPS = [
  "claimed",
  "rendering",
  "done",
] as const satisfies readonly ProgressStage[];

export type StepId = ProgressStage;

/** Progress stages without their own step fold into a neighbour. */
const STEP_OF: Readonly<Record<ProgressStage, ProgressStage>> = {
  claimed: "claimed",
  preparing_cv: "preparing_cv",
  rendering: "rendering",
  opening: "opening",
  inspecting: "opening",
  filling: "filling",
  uploading: "filling",
  reviewing: "reviewing",
  awaiting_approval: "awaiting_approval",
  submitting: "submitting",
  verifying: "verifying",
  discovering: "discovering",
  done: "done",
};

export function stepsFor(kind: TaskKind): readonly StepId[] {
  if (kind === "discover") {
    return DISCOVER_STEPS;
  }
  if (kind === "render_cv") {
    return RENDER_STEPS;
  }
  return APPLY_STEPS;
}

export type StepStatus =
  | "done"
  | "current"
  | "paused"
  | "failed"
  | "unknown"
  | "skipped"
  | "pending";

export interface StepView {
  id: StepId;
  status: StepStatus;
  /** When the run first reached this step, if known. */
  at: number | null;
}

/** The task's progress stage, if it reported one. */
export function progressStage(
  task: Pick<AutomationTaskRecord, "progress">
): ProgressStage | null {
  return "stage" in task.progress ? task.progress.stage : null;
}

/** Event payload fields the step log and the stepper read. */
export interface TaskEventPayload {
  message?: string;
  pause_reason?: PauseReason;
  stage?: ProgressStage;
  state?: TaskState;
  step?: number;
}

function payloadOf(event: ApplicationEventRecord): TaskEventPayload {
  return event.payload as TaskEventPayload;
}

const TASK_EVENT_TYPES: ReadonlySet<string> = new Set([
  "automation_task_created",
  "automation_task_claimed",
  "automation_task_progress",
  "automation_task_paused",
  "automation_task_finished",
  "approval_requested",
  "approval_decided",
  "submit_intent",
]);

/** This task's events, oldest first. */
export function taskEvents(
  events: readonly ApplicationEventRecord[],
  taskId: string
): ApplicationEventRecord[] {
  return events
    .filter(
      (event) => event.task_id === taskId && TASK_EVENT_TYPES.has(event.type)
    )
    .sort((a, b) => a.recorded_at - b.recorded_at);
}

/** The step an event moves the run to, if any. */
function eventStep(event: ApplicationEventRecord): StepId | null {
  if (event.type === "automation_task_claimed") {
    return "claimed";
  }
  if (event.type === "approval_requested") {
    return "awaiting_approval";
  }
  if (event.type === "submit_intent") {
    return "submitting";
  }
  const stage = payloadOf(event).stage;
  return stage ? STEP_OF[stage] : null;
}

/** First time each step was reached, from the events (and the claim). */
export function stepTimes(
  events: readonly ApplicationEventRecord[],
  claimedAt: number | null
): Partial<Record<StepId, number>> {
  const times: Partial<Record<StepId, number>> = {};
  if (claimedAt !== null) {
    times.claimed = claimedAt;
  }
  for (const event of events) {
    const step = eventStep(event);
    if (step && times[step] === undefined) {
      times[step] = event.recorded_at;
    }
  }
  return times;
}

/** Index of the furthest step the run reached. */
function reachedIndex(
  steps: readonly StepId[],
  task: Pick<AutomationTaskRecord, "state" | "progress" | "submit_intent_at">,
  times: Partial<Record<StepId, number>>
): number {
  let index = -1;
  for (const [at, step] of steps.entries()) {
    if (times[step] !== undefined) {
      index = at;
    }
  }
  const stage = progressStage(task);
  if (stage) {
    index = Math.max(index, steps.indexOf(STEP_OF[stage]));
  }
  if (task.state === "awaiting_approval") {
    index = Math.max(index, steps.indexOf("awaiting_approval"));
  }
  if (task.submit_intent_at !== null) {
    index = Math.max(index, steps.indexOf("submitting"));
  }
  if (task.state !== "queued") {
    index = Math.max(index, 0);
  }
  return index;
}

/**
 * The stepper of a task: done steps before the current one, the current one
 * (paused / failed / unknown at a stop), pending after it. Steps the run
 * passed without visiting (an assisted run never awaits approval) read as
 * skipped. A submitted or succeeded task has every step done.
 */
export function buildStepper(
  task: Pick<
    AutomationTaskRecord,
    "kind" | "state" | "progress" | "submit_intent_at"
  >,
  events: readonly ApplicationEventRecord[],
  claimedAt: number | null
): StepView[] {
  const steps = stepsFor(task.kind);
  const times = stepTimes(events, claimedAt);
  const finished = task.state === "submitted" || task.state === "succeeded";
  const current = finished
    ? steps.length - 1
    : reachedIndex(steps, task, times);
  return steps.map((id, index) => {
    const at = times[id] ?? null;
    if (finished) {
      return { id, status: "done", at };
    }
    if (index < current) {
      const skipped = at === null && id === "awaiting_approval";
      return { id, status: skipped ? "skipped" : "done", at };
    }
    if (index === current) {
      return { id, status: currentStatus(task.state), at };
    }
    return { id, status: "pending", at: null };
  });
}

function currentStatus(state: TaskState): StepStatus {
  switch (state) {
    case "paused":
      return "paused";
    case "failed":
    case "cancelled":
    case "expired":
      return "failed";
    case "outcome_unknown":
      return "unknown";
    default:
      return "current";
  }
}

// ── Executor status, heartbeat ──────────────────────────────────────────────

export type ExecutorStatus =
  | { kind: "waiting" }
  | { kind: "running" }
  | { kind: "paused"; reason: PauseReason | null }
  | { kind: "awaiting_approval" }
  | { kind: "sync_pending" }
  | { kind: "finished"; state: TaskState };

export function executorStatus(
  task: Pick<AutomationTaskRecord, "state" | "pause_reason" | "local_state">
): ExecutorStatus {
  if (isTerminalTask(task.state)) {
    return { kind: "finished", state: task.state };
  }
  if (task.local_state === "sync_pending") {
    return { kind: "sync_pending" };
  }
  if (task.state === "paused") {
    return { kind: "paused", reason: task.pause_reason };
  }
  if (task.state === "awaiting_approval") {
    return { kind: "awaiting_approval" };
  }
  if (task.state === "queued") {
    return { kind: "waiting" };
  }
  return { kind: "running" };
}

/** A device that has not been heard from for this long is "not responding". */
export const HEARTBEAT_STALE_MS = 60_000;

/** The attempt currently running (the newest one without an end). */
export function currentAttempt(
  attempts: readonly AutomationAttemptRecord[]
): AutomationAttemptRecord | null {
  const sorted = [...attempts].sort((a, b) => b.attempt_no - a.attempt_no);
  return (
    sorted.find((attempt) => attempt.ended_at === null) ?? sorted[0] ?? null
  );
}

export interface HeartbeatView {
  /** Seconds since the last heartbeat. */
  ageSeconds: number;
  /** When the server releases the lease (lease_expires_at). */
  releaseAt: number | null;
  stale: boolean;
}

/** The heartbeat age of a live attempt, or null when nothing is running. */
export function heartbeatView(
  task: Pick<AutomationTaskRecord, "state" | "lease_expires_at">,
  attempt: Pick<
    AutomationAttemptRecord,
    "last_heartbeat_at" | "ended_at"
  > | null,
  nowMs: number
): HeartbeatView | null {
  if (!attempt || attempt.ended_at !== null || isTerminalTask(task.state)) {
    return null;
  }
  const age = Math.max(0, nowMs - attempt.last_heartbeat_at);
  return {
    ageSeconds: Math.floor(age / 1000),
    stale: age > HEARTBEAT_STALE_MS,
    releaseAt: task.lease_expires_at,
  };
}

/** The agent's per-attempt budget (19 §8.4: 60 actions, 25 AI calls). */
export const ATTEMPT_BUDGET = { actions: 60, aiCalls: 25 } as const;

// ── Pause prompts ───────────────────────────────────────────────────────────

/** How each canonical PauseReason (03 §7.2) asks the user to act (12 §6.3). */
export type PauseGroup =
  | "login"
  | "challenge"
  | "answer"
  | "takeover"
  | "injection"
  | "explain";

export const PAUSE_GROUP: Readonly<Record<PauseReason, PauseGroup>> = {
  login_required: "login",
  account_creation_required: "login",
  mfa_required: "login",
  credential_field: "login",
  captcha_or_challenge: "challenge",
  protected_question: "answer",
  missing_information: "answer",
  unknown_question: "answer",
  off_domain_navigation: "takeover",
  unsupported_form: "takeover",
  unclear_page: "takeover",
  low_confidence: "takeover",
  validation_unresolved: "takeover",
  stuck_loop: "takeover",
  injection_suspected: "injection",
  needs_headed_restart: "explain",
  payment_requested: "explain",
  network_offline: "explain",
  resource_exhausted: "explain",
  ai_unavailable: "explain",
  user_requested: "explain",
};

export interface PausePromptKeys {
  /** What to do (shared by the reasons of one group). */
  action: string;
  /** Why it stopped (one per reason). */
  detail: string;
  group: PauseGroup;
  /** Short heading (one per reason). */
  title: string;
}

/** The i18n keys of the prompt shown for `reason`. */
export function pausePromptKeys(reason: PauseReason): PausePromptKeys {
  const group = PAUSE_GROUP[reason];
  return {
    group,
    title: `monitor.pauseTitles.${reason}`,
    detail: `pauseReasons.${reason}`,
    action: `monitor.pauseActions.${group}`,
  };
}

/** Groups whose run continues after the user acts and presses Resume. */
export function canResume(group: PauseGroup): boolean {
  return group !== "answer";
}

/** The excerpt the device flagged (the latest paused event's message). */
export function flaggedExcerpt(
  events: readonly ApplicationEventRecord[]
): string | null {
  for (const event of [...events].reverse()) {
    if (event.type === "automation_task_paused") {
      const message = payloadOf(event).message;
      return message && message.trim().length > 0 ? message : null;
    }
  }
  return null;
}

// ── Step log ────────────────────────────────────────────────────────────────

export interface LogEntry {
  at: number;
  id: string;
  message: string | null;
  pauseReason: PauseReason | null;
  stage: ProgressStage | null;
  state: TaskState | null;
  step: number | null;
  type: ApplicationEventRecord["type"];
}

/** The redacted step log (21 §6.1): what the device reported, by source. */
export function stepLog(events: readonly ApplicationEventRecord[]): LogEntry[] {
  return events.map((event) => {
    const payload = payloadOf(event);
    return {
      id: event.id,
      at: event.recorded_at,
      type: event.type,
      stage: payload.stage ?? null,
      step: typeof payload.step === "number" ? payload.step : null,
      message:
        typeof payload.message === "string" && payload.message.trim()
          ? payload.message
          : null,
      state: payload.state ?? null,
      pauseReason: payload.pause_reason ?? null,
    };
  });
}

// ── aria-live throttle (12 §12: at most one announcement per 5 s) ───────────

export const ANNOUNCE_GAP_MS = 5000;

export interface AnnounceState {
  /** Entries already covered by an announcement. */
  announced: number;
  lastAt: number | null;
}

export const INITIAL_ANNOUNCE_STATE: AnnounceState = {
  announced: 0,
  lastAt: null,
};

export type AnnouncePlan =
  | { kind: "idle"; state: AnnounceState }
  | { kind: "wait"; delayMs: number; state: AnnounceState }
  | { kind: "announce"; newEntries: number; state: AnnounceState };

/**
 * Whether to announce now: never more often than every `gapMs`; when entries
 * arrive faster, the next announcement summarizes all of them ("3 new steps,
 * latest: …"). The first render announces nothing (only what happens next).
 */
export function planAnnouncement(
  state: AnnounceState,
  total: number,
  nowMs: number,
  gapMs: number = ANNOUNCE_GAP_MS
): AnnouncePlan {
  if (total <= state.announced) {
    return { kind: "idle", state: { ...state, announced: total } };
  }
  if (state.lastAt !== null && nowMs - state.lastAt < gapMs) {
    return { kind: "wait", delayMs: gapMs - (nowMs - state.lastAt), state };
  }
  return {
    kind: "announce",
    newEntries: total - state.announced,
    state: { announced: total, lastAt: nowMs },
  };
}
