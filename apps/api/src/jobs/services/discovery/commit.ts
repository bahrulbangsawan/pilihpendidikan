// Plan → commit with re-planning (20 §6.2).
//
// Discovery writes are planned from reads (D1 has no interactive
// transactions) and committed as ONE batch with guards. When a concurrent
// request changed what the plan relied on — a guard fails, or another batch
// inserted the same public fingerprint / user link first — the whole batch
// rolled back, so the plan is simply rebuilt from fresh reads (≤ 3 tries).
// The idempotency row rides in the same batch (05 §1.4); a racing duplicate
// with the same key is answered with the winner's stored response.

import type { RouteContext } from "../../core/context";
import { apiError, replayResponse } from "../../core/http";
import { GuardFailedError, UniqueViolationError } from "../../repo/core/db";
import { findIdempotency } from "../../repo/core/idempotency";
import { runDiscoveryBatch } from "../../repo/discovery/sql";

/** Tables whose UNIQUE conflicts mean "someone else wrote first: re-plan". */
const REPLAN_TABLES: ReadonlySet<string> = new Set([
  "job_postings",
  "user_jobs",
  "discovery_run_items",
]);
export const COMMIT_ATTEMPTS = 3;

export interface CommitPlan<T> {
  body: unknown;
  /** Anything the caller needs after a successful commit. */
  extra: T;
  statements: readonly D1PreparedStatement[];
  status: number;
}

export type CommitContext = Pick<
  RouteContext,
  | "db"
  | "idempotency"
  | "idempotencyStatements"
  | "markIdempotencyRecorded"
  | "now"
  | "requestId"
  | "respond"
  | "scope"
>;

function shouldReplan(err: unknown): boolean {
  if (err instanceof GuardFailedError) {
    return true;
  }
  return err instanceof UniqueViolationError && REPLAN_TABLES.has(err.table);
}

async function replayRace(c: CommitContext): Promise<Response> {
  const info = c.idempotency;
  if (!info) {
    throw new Error("replay without an idempotency key");
  }
  const stored = await findIdempotency(c.db, c.scope, info.key, c.now);
  if (!stored || stored.request_hash !== info.requestHash) {
    throw apiError(
      "idempotency_mismatch",
      "This Idempotency-Key was used for a different request."
    );
  }
  return replayResponse(stored.status_code, stored.response_body, c.requestId);
}

/**
 * Runs `plan()` and commits its statements + the idempotency row in one
 * batch, re-planning on a concurrent change. Returns the response and the
 * plan's `extra` (null when a racing duplicate's response was replayed).
 */
export async function commitPlanned<T>(
  c: CommitContext,
  plan: () => Promise<CommitPlan<T>>,
  options: { attempts?: number } = {}
): Promise<{ extra: T | null; response: Response }> {
  const attempts = options.attempts ?? COMMIT_ATTEMPTS;
  for (let attempt = 1; ; attempt++) {
    const planned = await plan();
    const idempotent = c.idempotencyStatements(planned.status, planned.body);
    try {
      await runDiscoveryBatch(c.db, [...planned.statements, ...idempotent]);
    } catch (err) {
      const raced =
        err instanceof UniqueViolationError &&
        err.table === "idempotency_keys" &&
        idempotent.length > 0;
      if (raced) {
        return { extra: null, response: await replayRace(c) };
      }
      if (shouldReplan(err) && attempt < attempts) {
        continue;
      }
      throw err;
    }
    if (idempotent.length > 0) {
      c.markIdempotencyRecorded();
    }
    return {
      extra: planned.extra,
      response: c.respond(planned.body, planned.status),
    };
  }
}
