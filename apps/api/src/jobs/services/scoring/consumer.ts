// The `score_postings` consumer (07 §7.2, 14 §6), shared by the `jobs-ai`
// handler and the `jobs-ai-dlq` handler.
//
// Per message:
//   1. the user's context once per batch (`qc.memo`): profile, version,
//      AI availability, budget;
//   2. a stale `profile_version` (the profile changed after enqueueing):
//      drop its queued placeholders and ack, the new version is scored;
//   3. idempotency: postings whose row is already `ready` are skipped;
//      untracked postings lose their placeholder;
//   4. score the rest, five at a time; each write is ONE batch: guard (not
//      ready yet) + upsert ready + change_log + the AI usage, so a redelivery
//      neither writes twice nor counts the budget twice (T7-07);
//   5. a retryable provider error → retry the message (backoff
//      `min(300, 2^attempt × 10 + jitter)`, the consumer default); written
//      rows stay and are skipped on redelivery;
//   6. ack, and when the user has an enabled automation rule, hand the ready
//      postings to `evaluate_rules` (07 §10, 14 §6).
// In DLQ mode every remaining posting gets a deterministic-only score with
// `components.ai.status = "dlq"`, so no posting stays queued forever.

import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { JobsAiMessageOf } from "@pilihpendidikan/jobs-contracts/queue";
import { parseQueueMessage } from "@pilihpendidikan/jobs-contracts/queue";
import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import { isAiProviderError } from "../../ai/primitives";
import type { QueueContext, QueueOutcome } from "../../queue/types";
import { ACK } from "../../queue/types";
import { recordAiUsageStatements } from "../../repo/core/ai-usage";
import {
  commitScore,
  deleteQueuedPlaceholders,
  hasEnabledRules,
  loadPostingsForScoring,
  readyScoreStatements,
  scoreStatuses,
} from "../../repo/scoring";
import type { UserScoringContext } from "./context";
import { loadUserScoringContext } from "./context";
import type { AiMode } from "./engine";
import { computeScore } from "./engine";
import type { PostingForScoring } from "./features";

/** Decisions calls in flight per consumer invocation (07 §7.2). */
export const SCORING_CONCURRENCY = 5;

export type ScoreMessageContext = QueueContext<
  JobsAiMessageOf<"score_postings">
>;

/** Runs `task` over `items` with at most `limit` in flight. */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<unknown[]> {
  const errors: unknown[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await task(item);
      } catch (err) {
        errors.push(err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return errors;
}

async function writeScore(
  qc: ScoreMessageContext,
  ctx: UserScoringContext,
  posting: PostingForScoring,
  mode: AiMode
): Promise<"written" | "already_ready"> {
  const computed = await computeScore(ctx, posting, {
    ai: () => qc.ai(),
    mode,
    now: qc.now,
  });
  const statements = readyScoreStatements(qc.db, qc.scope, {
    id: newId("scr", qc.now),
    postingId: posting.id,
    profileVersion: qc.message.profile_version,
    rubricVersion: qc.message.rubric_version,
    model: computed.model,
    score: computed.score,
    confidence: computed.confidence,
    components: computed.components,
    explanation: computed.explanation,
    now: qc.now,
  });
  if (computed.usage) {
    statements.push(
      ...recordAiUsageStatements(qc.db, qc.scope, {
        purpose: "score",
        inputTokens: computed.usage.input_tokens,
        outputTokens: computed.usage.output_tokens,
        costMicroUsd: computed.usage.cost_micro_usd,
        now: qc.now,
        timezone: ctx.timezone,
      })
    );
  }
  return await commitScore(qc.db, statements);
}

async function handOffToRules(
  qc: ScoreMessageContext,
  postingIds: readonly string[]
): Promise<void> {
  if (postingIds.length === 0 || !(await hasEnabledRules(qc.db, qc.scope))) {
    return;
  }
  try {
    await qc.env.JOBS_AI_QUEUE.send(
      parseQueueMessage({
        v: 1,
        type: "evaluate_rules",
        message_id: crypto.randomUUID(),
        user_id: qc.scope.userId,
        posting_ids: [...postingIds],
      })
    );
  } catch (err) {
    // The scores are written; rules re-evaluate on the next scoring or claim.
    qc.log("score_rules_handoff_failed", {
      error: err instanceof Error ? err.name : "error",
    });
  }
}

/** Processes one `score_postings` message (normal or dead-letter). */
export async function processScorePostings(
  qc: ScoreMessageContext,
  mode: AiMode
): Promise<QueueOutcome> {
  const message = qc.message;
  const key = {
    profileVersion: message.profile_version,
    rubricVersion: message.rubric_version,
  };
  if (message.rubric_version !== RUBRIC_VERSION) {
    qc.log("score_unknown_rubric", { rubric_version: message.rubric_version });
    return ACK;
  }
  const ctx = await qc.memo(`scoring:${qc.scope.userId}`, () =>
    loadUserScoringContext(qc.env, qc.db, qc.scope, qc.now)
  );
  if (!ctx) {
    qc.log("score_user_missing");
    return ACK;
  }
  if (ctx.profileVersion !== message.profile_version) {
    await deleteQueuedPlaceholders(qc.db, qc.scope, message.posting_ids, key);
    qc.log("score_stale_profile_version", {
      postings: message.posting_ids.length,
    });
    return ACK;
  }
  const statuses = await scoreStatuses(
    qc.db,
    qc.scope,
    message.posting_ids,
    key
  );
  const pending = message.posting_ids.filter(
    (id) => statuses.get(id) !== "ready"
  );
  const postings = await loadPostingsForScoring(qc.db, qc.scope, pending);
  const loaded = new Set(postings.map((posting) => posting.id));
  const untracked = pending.filter((id) => !loaded.has(id));
  if (untracked.length > 0) {
    await deleteQueuedPlaceholders(qc.db, qc.scope, untracked, key);
  }
  let written = 0;
  const errors = await pool(postings, SCORING_CONCURRENCY, async (posting) => {
    if ((await writeScore(qc, ctx, posting, mode)) === "written") {
      written += 1;
    }
  });
  const retryable = errors.filter(
    (err) => isAiProviderError(err) && err.retryable
  );
  const fatal = errors.find(
    (err) => !(isAiProviderError(err) && err.retryable)
  );
  qc.log(mode === "dlq" ? "score_dlq_written" : "score_batch", {
    postings: message.posting_ids.length,
    written,
    skipped_ready: message.posting_ids.length - pending.length,
    untracked: untracked.length,
    retryable_errors: retryable.length,
    attempts: qc.attempts,
  });
  if (fatal) {
    throw fatal;
  }
  if (retryable.length > 0) {
    return { action: "retry" };
  }
  const ready = await scoreStatuses(qc.db, qc.scope, message.posting_ids, key);
  await handOffToRules(
    qc,
    message.posting_ids.filter((id) => ready.get(id) === "ready")
  );
  return ACK;
}
