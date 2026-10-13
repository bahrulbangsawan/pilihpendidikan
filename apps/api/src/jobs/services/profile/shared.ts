// Helpers shared by the profile, settings and account services (leaf-2.8).
//
//   canonicalJson          stable JSON (sorted keys) for value comparisons
//   isValidTimeZone        IANA zone check (settings.timezone, prefs.timezone)
//   ownedCvIds             which apps/cv documents the caller owns (D-25:
//                          strict owner stamp, no admin bypass on Job Tracker)
//   scheduleProfileRescore lazy re-score after a profile_version change
//                          (07 §2.1: inbox new/seen + active applications,
//                          ≤ 500), in the background of the request
//   sendRebuildAnalytics   `rebuild_analytics` after a timezone change (10 §5)
//   commitWithReplan       plan → one batch, re-planned on a concurrent change

import type { JobsAiMessage } from "@pilihpendidikan/jobs-contracts/queue";
import { parseQueueMessage } from "@pilihpendidikan/jobs-contracts/queue";
import { normalizeEmail } from "../../../auth";
import type { Env } from "../../../env";
import { resolveOwner } from "../../../ownership";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { GuardFailedError, UniqueViolationError } from "../../repo/core/db";
import { computeProfileVersion } from "../../repo/core/profile-version";
import { enqueueProfileRescore } from "../../repo/core/score-queue";
import { runProfileBatch } from "../../repo/profile/facts";

/** JSON with object keys sorted, for comparing stored values. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(inner).sort()) {
        sorted[key] = (inner as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return inner;
  });
}

/** True for an IANA time zone the runtime knows (e.g. "Asia/Jakarta"). */
export function isValidTimeZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** The subset of `cvIds` whose owner stamp is `email` (no admin bypass). */
export async function ownedCvIds(
  env: Pick<Env, "CV_KV">,
  email: string,
  cvIds: Iterable<string>
): Promise<Set<string>> {
  const owner = normalizeEmail(email);
  const ids = [...new Set(cvIds)];
  const stamps = await Promise.all(
    ids.map(async (id) => ({
      id,
      stamp: await resolveOwner(env as Env, "cv", id),
    }))
  );
  return new Set(
    stamps
      .filter((s) => s.stamp !== null && normalizeEmail(s.stamp) === owner)
      .map((s) => s.id)
  );
}

export interface RescoreContext {
  readonly ctx: ExecutionContext;
  readonly db: JobsDb;
  readonly env: Env;
  readonly now: number;
  readonly requestId: string;
  readonly scope: UserScope;
}

/**
 * Re-queues scoring for the new profile version (07 §2.1) without delaying
 * the response. Pass the version when the caller already computed it.
 */
export function scheduleProfileRescore(
  c: RescoreContext,
  options: { email: string; profileVersion?: number }
): void {
  const run = async () => {
    try {
      const profileVersion =
        options.profileVersion ??
        (await computeProfileVersion(c.env, c.db, c.scope, {
          email: options.email,
        }));
      const result = await enqueueProfileRescore(c.env, c.db, c.scope, {
        now: c.now,
        profileVersion,
      });
      if (result.messages > 0) {
        console.log(
          JSON.stringify({
            evt: "profile_rescore",
            request_id: c.requestId,
            queued: result.queued.length,
            messages: result.messages,
          })
        );
      }
    } catch (err) {
      console.warn({
        evt: "profile_rescore_failed",
        request_id: c.requestId,
        error: err instanceof Error ? err.name : String(err),
      });
    }
  };
  c.ctx.waitUntil(run());
}

/** Sends `rebuild_analytics` (10 §5); a failure is logged, never thrown. */
export async function sendRebuildAnalytics(
  env: Pick<Env, "JOBS_AI_QUEUE">,
  scope: UserScope,
  requestId: string
): Promise<boolean> {
  const message: JobsAiMessage = {
    v: 1,
    type: "rebuild_analytics",
    message_id: crypto.randomUUID(),
    user_id: scope.userId,
    reason: "timezone_change",
  };
  try {
    await env.JOBS_AI_QUEUE.send(parseQueueMessage(message));
    return true;
  } catch (err) {
    console.warn({
      evt: "rebuild_analytics_send_failed",
      request_id: requestId,
      error: err instanceof Error ? err.name : String(err),
    });
    return false;
  }
}

/** Tables whose UNIQUE conflicts mean "a concurrent write won: re-plan". */
const REPLAN_TABLES: ReadonlySet<string> = new Set([
  "applicant_facts",
  "screening_answers",
  "user_settings",
]);
export const COMMIT_ATTEMPTS = 3;

/**
 * Plans and commits one batch; a failed guard or a racing insert of the same
 * key re-plans from fresh reads (≤ 3 tries), then the error propagates (the
 * router answers 409).
 */
export async function commitWithReplan<
  T extends { statements: readonly D1PreparedStatement[] },
>(
  db: JobsDb,
  plan: () => Promise<T>,
  attempts: number = COMMIT_ATTEMPTS
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const planned = await plan();
    try {
      await runProfileBatch(db, planned.statements);
      return planned;
    } catch (err) {
      const replan =
        err instanceof GuardFailedError ||
        (err instanceof UniqueViolationError && REPLAN_TABLES.has(err.table));
      if (!replan || attempt >= attempts) {
        throw err;
      }
    }
  }
}
