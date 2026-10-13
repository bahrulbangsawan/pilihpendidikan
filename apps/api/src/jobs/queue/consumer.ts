// The `jobs-ai` queue consumer (14 §6, D-06). The Worker's `queue` export
// (src/app.ts) hands every batch here.
//
// Per message:
//   1. validate against `JobsAiMessageSchema` (contracts); an invalid body is
//      logged and acked (a poison message never retries);
//   2. `jobs-ai-dlq` messages go to `handlers/dlq.ts`, everything else to the
//      handler registered for `message.type` below;
//   3. the handler returns `{action: "ack"}` or `{action: "retry",
//      delaySeconds?}`; a thrown error retries with the canonical backoff
//      `min(300, 2^attempt × 10 + jitter)` s. After `max_retries: 5` the
//      platform moves the message to `jobs-ai-dlq` (wrangler.jsonc).
//
// Delivery is at-least-once: handlers must be idempotent (14 §6 table).
// Handlers construct nothing from `user_id` but `qc.scope`, and load the
// referenced record with it (11 §6.1 rule 2).

import type {
  JobsAiMessage,
  QueueMessageType,
} from "@pilihpendidikan/jobs-contracts/queue";
import {
  JobsAiMessageSchema,
  queueRetryDelaySeconds,
} from "@pilihpendidikan/jobs-contracts/queue";
import type { Env } from "../../env";
import { getAiProvider } from "../ai/provider";
import { systemClock } from "../core/clock";
import type { KernelDeps } from "../core/deps";
import { trustedScope } from "../core/scope";
import { jobsDb } from "../repo/core/db";
import { handleDeadLetter } from "./handlers/dlq";
import { handleEvaluateRules } from "./handlers/evaluate-rules";
import { handleExportUser } from "./handlers/export-user";
import { handlePurgeUser } from "./handlers/purge-user";
import { handleRebuildAnalytics } from "./handlers/rebuild-analytics";
import { handleRollupUser } from "./handlers/rollup-user";
import { handleScorePostings } from "./handlers/score-postings";
import { handleTailorCv } from "./handlers/tailor-cv";
import type {
  DeadLetterHandler,
  QueueContext,
  QueueHandler,
  QueueOutcome,
} from "./types";

export const JOBS_AI_QUEUE = "jobs-ai";
export const JOBS_AI_DLQ = "jobs-ai-dlq";

/** One handler per `JobsAiMessage` type (owners: PLAN C5). */
export const QUEUE_HANDLERS: {
  readonly [T in QueueMessageType]: QueueHandler<T>;
} = {
  score_postings: handleScorePostings,
  tailor_cv: handleTailorCv,
  evaluate_rules: handleEvaluateRules,
  purge_user: handlePurgeUser,
  rollup_user: handleRollupUser,
  rebuild_analytics: handleRebuildAnalytics,
  export_user: handleExportUser,
};

export interface QueueBatchReport {
  acked: number;
  dropped: number;
  retried: number;
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evt: event, ...fields }));
}

/** Handler overrides (tests exercise retry / DLQ paths with them). */
export interface ConsumerOverrides {
  deadLetter?: DeadLetterHandler;
  handlers?: Partial<{ [T in QueueMessageType]: QueueHandler<T> }>;
}

function dispatch(
  qc: QueueContext<JobsAiMessage>,
  overrides: ConsumerOverrides
): Promise<QueueOutcome> {
  if (qc.deadLetter) {
    return (overrides.deadLetter ?? handleDeadLetter)(qc);
  }
  const type = qc.message.type;
  const handler = (overrides.handlers?.[type] ??
    QUEUE_HANDLERS[type]) as QueueHandler<QueueMessageType>;
  return handler(qc as never);
}

/** Processes one queue batch (the Worker `queue` handler). */
export async function handleJobsAiBatch(
  batch: MessageBatch<unknown>,
  env: Env,
  ctx: ExecutionContext,
  deps: KernelDeps = {},
  overrides: ConsumerOverrides = {}
): Promise<QueueBatchReport> {
  const report: QueueBatchReport = { acked: 0, retried: 0, dropped: 0 };
  const deadLetter = batch.queue === JOBS_AI_DLQ;
  const memo = new Map<string, Promise<unknown>>();
  const db = jobsDb(env);
  for (const message of batch.messages) {
    const parsed = JobsAiMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      log("queue_invalid_message", { queue: batch.queue, id: message.id });
      message.ack();
      report.dropped += 1;
      continue;
    }
    const body = parsed.data;
    const qc: QueueContext<JobsAiMessage> = {
      env,
      ctx,
      db,
      message: body,
      scope: trustedScope(body.user_id, "queue"),
      now: (deps.clock ?? systemClock).now(),
      attempts: message.attempts,
      deadLetter,
      ai: () => (deps.ai ?? getAiProvider)(env),
      memo: <V>(key: string, compute: () => Promise<V>): Promise<V> => {
        let value = memo.get(key);
        if (!value) {
          value = compute();
          memo.set(key, value);
        }
        return value as Promise<V>;
      },
      log: (event, fields = {}) =>
        log(event, { type: body.type, message_id: body.message_id, ...fields }),
    };
    let outcome: QueueOutcome;
    try {
      outcome = await dispatch(qc, overrides);
    } catch (err) {
      log("queue_handler_error", {
        type: body.type,
        message_id: body.message_id,
        attempts: message.attempts,
        dead_letter: deadLetter,
        error:
          err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      outcome = { action: "retry" };
    }
    if (outcome.action === "ack") {
      message.ack();
      report.acked += 1;
    } else {
      message.retry({
        delaySeconds:
          outcome.delaySeconds ?? queueRetryDelaySeconds(message.attempts),
      });
      report.retried += 1;
    }
  }
  return report;
}
