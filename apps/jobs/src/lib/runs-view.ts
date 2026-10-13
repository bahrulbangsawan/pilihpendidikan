// Helpers of the Runs tab (12 §6.3): the state filter in the URL, what a
// row may do (retry, settle the outcome, cancel), its duration, and the
// state badge's tone.

import type { TaskState } from "@pilihpendidikan/jobs-contracts/enums";
import { TASK_STATES } from "@pilihpendidikan/jobs-contracts/enums";
import type { AutomationTaskRecord } from "@pilihpendidikan/jobs-contracts/records";
import { isCancellable } from "./monitor-model";

export interface RunsSearch {
  state?: TaskState;
}

export function validateRunsSearch(
  search: Record<string, unknown>
): RunsSearch {
  const state = search.state;
  return typeof state === "string" &&
    (TASK_STATES as readonly string[]).includes(state)
    ? { state: state as TaskState }
    : {};
}

export type RunAction = "retry" | "settle" | "cancel" | null;

/**
 * The row action: Retry a failed task, settle an `outcome_unknown` one
 * ("Did this application go through?", 21 §8 — never a blind retry), or
 * cancel a live one.
 */
export function runAction(
  task: Pick<AutomationTaskRecord, "state" | "cancel_requested">
): RunAction {
  if (task.state === "failed") {
    return "retry";
  }
  if (task.state === "outcome_unknown") {
    return "settle";
  }
  if (isCancellable(task.state) && !task.cancel_requested) {
    return "cancel";
  }
  return null;
}

/**
 * How long it has run: from creation until it finished, or until now while
 * live; null for a task still waiting in the queue.
 */
export function runDurationMs(
  task: Pick<AutomationTaskRecord, "created_at" | "finished_at" | "state">,
  nowMs: number
): number | null {
  if (task.state === "queued") {
    return null;
  }
  const end = task.finished_at ?? nowMs;
  return Math.max(0, end - task.created_at);
}

/** "45 s", "3 min", "1 h 12 min". */
export function formatDuration(
  ms: number,
  units: { s: string; min: string; h: string }
): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds} ${units.s}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${units.min}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0
    ? `${hours} ${units.h} ${rest} ${units.min}`
    : `${hours} ${units.h}`;
}

export type StateTone = "live" | "attention" | "good" | "bad" | "neutral";

/** How a task state is drawn; always paired with its icon and text. */
export function stateTone(state: TaskState): StateTone {
  switch (state) {
    case "claimed":
    case "running":
      return "live";
    case "paused":
    case "awaiting_approval":
    case "outcome_unknown":
      return "attention";
    case "submitted":
    case "succeeded":
      return "good";
    case "failed":
    case "expired":
      return "bad";
    default:
      return "neutral";
  }
}

/** The filter options of the Runs tab, most useful first. */
export const RUN_FILTERS: readonly (TaskState | "all")[] = [
  "all",
  "running",
  "paused",
  "awaiting_approval",
  "queued",
  "outcome_unknown",
  "failed",
  "submitted",
  "succeeded",
  "cancelled",
  "expired",
  "claimed",
];
