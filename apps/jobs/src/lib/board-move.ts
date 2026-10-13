// Moving a card (06 §2): local validation against the contracts' stage
// machine, the confirmation dialogs of §2.2, and the request itself — sent
// with one Idempotency-Key that every retry reuses, the optimistic overlay
// kept while it is in flight and removed (rolled back) unless the API
// confirms.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import { canTransition } from "@pilihpendidikan/jobs-contracts/stage";
import { isApiError } from "./api-client";
import type { PendingMove } from "./board-model";

/** Network retries after the first try: 1 s, 2 s, 4 s (06 §2.1). */
export const MOVE_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/** Task states that hold a live automation run for the card. */
const LIVE_TASK_STATES = new Set([
  "queued",
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
]);

/** What a move needs to know about the card (a board card or a detail page). */
export type MoveSubject = Pick<
  BoardCard,
  "id" | "stage" | "revision" | "submission_status" | "live_task"
>;

export function hasLiveTask(card: MoveSubject): boolean {
  return card.live_task !== null && LIVE_TASK_STATES.has(card.live_task.state);
}

/**
 * The web is a user surface (03 §5.1): moves are validated for the `user`
 * actor with the contracts' `canTransition`, the same table the API uses.
 */
export function canMoveTo(from: Stage, to: Stage): boolean {
  return from === to || canTransition(from, to, "user");
}

export type MoveCheck =
  /** Same column: a reorder, always allowed (rank conflicts auto-resolve). */
  | { kind: "reorder" }
  | { kind: "ok" }
  /** Not in the 03 §5.1 graph: snap back, caption "Can't move from …". */
  | { kind: "illegal" }
  /** The run is past submit_intent (06 §2.3). */
  | { kind: "submission_in_flight" }
  /** Any → applied while not_started: "Did you submit this application?" */
  | { kind: "confirm_applied" }
  /** → rejected / withdrawn with a live run: "Cancel the running automation first?" */
  | { kind: "confirm_cancel_task"; taskId: string }
  /** ready → saved / preparing with an approval pending: "Discard the pending approval?" */
  | { kind: "confirm_discard_approval" };

/** Decides what dropping `card` on `target` needs (06 §2.2–§2.3). */
export function checkMove(card: MoveSubject, target: Stage): MoveCheck {
  if (card.stage === target) {
    return { kind: "reorder" };
  }
  if (!canTransition(card.stage, target, "user")) {
    return { kind: "illegal" };
  }
  if (card.live_task?.submit_intent_at) {
    return { kind: "submission_in_flight" };
  }
  if (target === "applied" && card.submission_status === "not_started") {
    return { kind: "confirm_applied" };
  }
  if (
    (target === "rejected" || target === "withdrawn") &&
    card.live_task &&
    hasLiveTask(card)
  ) {
    return { kind: "confirm_cancel_task", taskId: card.live_task.id };
  }
  if (
    card.stage === "ready" &&
    (target === "saved" || target === "preparing") &&
    card.live_task?.state === "awaiting_approval"
  ) {
    return { kind: "confirm_discard_approval" };
  }
  return { kind: "ok" };
}

/** Other cards in Offer when one moves to Accepted (06 §2.2, informational). */
export function otherOffers(
  cards: readonly BoardCard[],
  movingId: string
): number {
  return cards.filter((card) => card.stage === "offer" && card.id !== movingId)
    .length;
}

export type MoveOutcome =
  | { kind: "moved"; application: ApplicationRecord; attempts: number }
  /** 409 revision_conflict: roll back to the server's card. */
  | { kind: "conflict"; current: unknown; attempts: number }
  /** 422 invalid_transition / policy refusals. */
  | {
      kind: "invalid";
      reason: string | null;
      message: string;
      attempts: number;
    }
  /** No answer after every retry: roll back, say so. */
  | { kind: "network_failed"; attempts: number }
  | { kind: "failed"; status: number; message: string; attempts: number };

export interface MoveTransport {
  /** Sends the move with this Idempotency-Key; resolves to the application. */
  send: (idempotencyKey: string) => Promise<ApplicationRecord>;
  sleep: (ms: number) => Promise<void>;
  delays?: readonly number[];
}

/**
 * Sends one move. A network failure (or 429 / 5xx) is retried with the SAME
 * key after 1 s, 2 s and 4 s, so a request that did land is not applied twice;
 * any other answer ends it.
 */
/** The outcome of a final (non-retried) error. */
function finalOutcome(error: unknown, attempts: number): MoveOutcome {
  if (!isApiError(error)) {
    return { kind: "failed", status: 0, message: String(error), attempts };
  }
  if (error.isRevisionConflict) {
    return { kind: "conflict", current: error.current ?? null, attempts };
  }
  if (error.status === 422) {
    const reason = error.details?.reason;
    return {
      kind: "invalid",
      reason: typeof reason === "string" ? reason : null,
      message: error.message,
      attempts,
    };
  }
  return {
    kind: "failed",
    status: error.status,
    message: error.message,
    attempts,
  };
}

export async function sendMoveWithRetry(
  transport: MoveTransport,
  idempotencyKey: string
): Promise<MoveOutcome> {
  const delays = transport.delays ?? MOVE_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    const attempts = attempt + 1;
    try {
      const application = await transport.send(idempotencyKey);
      return { kind: "moved", application, attempts };
    } catch (error) {
      const retryable = isApiError(error) && error.isRetryable;
      if (!retryable) {
        return finalOutcome(error, attempts);
      }
      const delay = delays[attempt];
      if (delay === undefined) {
        return { kind: "network_failed", attempts };
      }
      await transport.sleep(delay);
    }
  }
}

export interface PendingStore {
  add: (move: PendingMove) => void;
  remove: (cardId: string) => void;
}

export interface RunMoveOptions extends MoveTransport {
  afterId: string | null;
  beforeId: string | null;
  card: MoveSubject;
  /** Writes the confirmed application into the board cache. */
  commit: (application: ApplicationRecord) => void;
  idempotencyKey: string;
  pending: PendingStore;
  target: Stage;
}

/**
 * The optimistic move of 06 §2.1: show the card in its new place, send, and
 * keep the overlay only until the API answers. On success the confirmed row
 * replaces it; on any failure removing the overlay is the rollback.
 */
export async function runMove(options: RunMoveOptions): Promise<MoveOutcome> {
  const { card, target, beforeId, afterId, pending } = options;
  pending.add({ cardId: card.id, stage: target, beforeId, afterId });
  let outcome: MoveOutcome;
  try {
    outcome = await sendMoveWithRetry(options, options.idempotencyKey);
  } catch (error) {
    pending.remove(card.id);
    throw error;
  }
  if (outcome.kind === "moved") {
    options.commit(outcome.application);
  }
  pending.remove(card.id);
  return outcome;
}
