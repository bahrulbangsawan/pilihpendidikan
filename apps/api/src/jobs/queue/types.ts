// Types shared by the `jobs-ai` consumer (consumer.ts) and its handlers
// (handlers/<type>.ts). Kept apart from consumer.ts so handler modules never
// import the dispatcher that imports them.

import type {
  JobsAiMessage,
  JobsAiMessageOf,
  QueueMessageType,
} from "@pilihpendidikan/jobs-contracts/queue";
import type { Env } from "../../env";
import type { AiProvider } from "../ai/provider";
import type { UserScope } from "../core/scope";
import type { JobsDb } from "../repo/core/db";

export interface QueueContext<M extends JobsAiMessage = JobsAiMessage> {
  ai(): AiProvider;
  /** Delivery attempt, 1-based (Workers `message.attempts`). */
  readonly attempts: number;
  readonly ctx: ExecutionContext;
  readonly db: JobsDb;
  /** True when the message came from `jobs-ai-dlq` (14 §6). */
  readonly deadLetter: boolean;
  readonly env: Env;
  /** Structured log line (never message bodies or PII). */
  log(event: string, fields?: Record<string, unknown>): void;
  /**
   * Per-batch memo (e.g. load one ScoringProfile per user per batch, 07 §7.2).
   */
  memo<V>(key: string, compute: () => Promise<V>): Promise<V>;
  readonly message: M;
  readonly now: number;
  /**
   * Scope of `message.user_id` (11 §6.1 rule 2): load the referenced record
   * WITH this scope; a miss means the message is stale or forged → ack.
   */
  readonly scope: UserScope;
}

/** What to do with the message after the handler ran. */
export type QueueOutcome =
  | { action: "ack" }
  | {
      action: "retry";
      /** Default: `min(300, 2^attempt × 10 + jitter)` (14 §6). */
      delaySeconds?: number;
    };

export type QueueHandler<T extends QueueMessageType> = (
  qc: QueueContext<JobsAiMessageOf<T>>
) => Promise<QueueOutcome>;

/** The `jobs-ai-dlq` handler sees every message type. */
export type DeadLetterHandler = (
  qc: QueueContext<JobsAiMessage>
) => Promise<QueueOutcome>;

export const ACK: QueueOutcome = Object.freeze({ action: "ack" });
