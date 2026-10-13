// Bulk actions on the board (06 §9): a series of single-application requests
// run client-side, four at a time, each with its own base_revision and
// Idempotency-Key, and a result per card. No server bulk endpoint in v1.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { isApiError } from "./api-client";
import { canMoveTo, hasLiveTask } from "./board-move";

export const BULK_CONCURRENCY = 4;
/** CV variant generation is capped per action (06 §9). */
export const BULK_CV_LIMIT = 20;

export type BulkStatus = "ok" | "skipped" | "conflict" | "failed";

export interface BulkItemResult {
  id: string;
  /** Why it was skipped or failed (an API message or a local reason). */
  message?: string;
  /** Machine reason: e.g. `invalid_transition`, `same_stage`, `manual_mode`. */
  reason?: string;
  status: BulkStatus;
}

/** Thrown by a worker to report a skip instead of a failure. */
export class BulkSkip extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "BulkSkip";
    this.reason = reason;
  }
}

/**
 * Thrown by a worker to report "changed elsewhere" with its own (localised)
 * message, e.g. an approval whose form changed since it was shown.
 */
export class BulkConflict extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "BulkConflict";
    this.reason = reason;
  }
}

function resultFromError(id: string, error: unknown): BulkItemResult {
  if (error instanceof BulkConflict) {
    return {
      id,
      status: "conflict",
      reason: error.reason,
      message: error.message,
    };
  }
  if (error instanceof BulkSkip) {
    return {
      id,
      status: "skipped",
      reason: error.reason,
      message: error.message,
    };
  }
  if (isApiError(error)) {
    if (error.isRevisionConflict) {
      return {
        id,
        status: "conflict",
        reason: error.code,
        message: error.message,
      };
    }
    const detailReason = error.details?.reason;
    return {
      id,
      status: error.status === 422 ? "skipped" : "failed",
      reason: typeof detailReason === "string" ? detailReason : error.code,
      message: error.message,
    };
  }
  return {
    id,
    status: "failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Runs `worker` for every id with at most `concurrency` in flight. Results
 * keep the input order; one failure never stops the others.
 */
export async function runBulk(
  ids: readonly string[],
  worker: (id: string) => Promise<void>,
  options: {
    concurrency?: number;
    onSettled?: (result: BulkItemResult) => void;
  } = {}
): Promise<BulkItemResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? BULK_CONCURRENCY);
  const results: BulkItemResult[] = new Array(ids.length);
  let cursor = 0;
  async function lane(): Promise<void> {
    while (cursor < ids.length) {
      const index = cursor++;
      const id = ids[index] as string;
      let result: BulkItemResult;
      try {
        await worker(id);
        result = { id, status: "ok" };
      } catch (error) {
        result = resultFromError(id, error);
      }
      results[index] = result;
      options.onSettled?.(result);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, () => lane())
  );
  return results;
}

export interface BulkSummary {
  conflict: number;
  failed: number;
  ok: number;
  skipped: number;
}

export function summarizeBulk(results: readonly BulkItemResult[]): BulkSummary {
  const summary: BulkSummary = { ok: 0, skipped: 0, conflict: 0, failed: 0 };
  for (const result of results) {
    summary[result.status] += 1;
  }
  return summary;
}

/**
 * Local validation of a bulk move: cards already in `target` or without a
 * legal edge to it (03 §5.1) are skipped and reported, never sent.
 */
export function bulkMoveSkip(card: BoardCard, target: Stage): BulkSkip | null {
  if (card.stage === target) {
    return new BulkSkip("same_stage", "Already in this column.");
  }
  if (!canMoveTo(card.stage, target)) {
    return new BulkSkip("invalid_transition", `${card.stage} → ${target}`);
  }
  if (card.live_task?.submit_intent_at) {
    return new BulkSkip("submission_in_flight", "Submission in progress.");
  }
  return null;
}

/** Why a card can't be purged in bulk (null: it can). */
export type BulkPurgeBlock = "live_task" | "submission_in_flight";

/**
 * A permanent delete never runs over automation: a card with a live task or
 * a submission in progress is skipped (the user cancels the run first, on
 * the card itself).
 */
export function bulkPurgeBlock(card: BoardCard): BulkPurgeBlock | null {
  if (
    card.live_task?.submit_intent_at ||
    card.submission_status === "in_progress"
  ) {
    return "submission_in_flight";
  }
  if (hasLiveTask(card)) {
    return "live_task";
  }
  return null;
}

/**
 * The archive toggle on a mixed selection: archive (or unarchive) only the
 * cards not already in that state; the others are reported as skipped and
 * never written (a no-op PATCH would still bump their revision).
 */
export function bulkArchiveTarget(
  cards: readonly Pick<BoardCard, "archived">[]
): boolean {
  return !cards.every((card) => card.archived);
}

/**
 * `auto` mode is only for applications an enabled `auto` rule matched (06 §9,
 * 19 §8) — the same test as the detail page's mode select. The board card
 * does not carry the rule, so the bulk path reads the application first.
 */
export function autoModeAllowed(application: {
  automation_rule_id: string | null;
  mode: string;
}): boolean {
  return application.automation_rule_id !== null || application.mode === "auto";
}

/**
 * Why a bulk "Use it" change skips an answer (null: send it). A protected
 * answer is never `always` (03 §9, 05 §10; the API refuses it too).
 */
export function answerAutoUseBlock(
  answer: { auto_use: string; sensitivity: string },
  target: string
): "protected_always" | "unchanged" | null {
  if (target === "always" && answer.sensitivity === "protected") {
    return "protected_always";
  }
  if (answer.auto_use === target) {
    return "unchanged";
  }
  return null;
}
