// The `jobs-ai` queue contract (14 §6): one discriminated union, `v: 1`,
// discriminated by `type`. Messages stay ≤ 8 KB.
import { z } from "zod";
import { DaySchema } from "./common";
import { CvVariantIdSchema, PostingIdSchema, UserIdSchema } from "./ids";
import { defineSchema } from "./registry";

export const QUEUE_MESSAGE_TYPES = [
  "score_postings",
  "tailor_cv",
  "evaluate_rules",
  "purge_user",
  "rollup_user",
  "rebuild_analytics",
  "export_user",
] as const;
export const QueueMessageTypeSchema = defineSchema(
  "queue",
  "QueueMessageType",
  z.enum(QUEUE_MESSAGE_TYPES)
);
export type QueueMessageType = z.infer<typeof QueueMessageTypeSchema>;

/** Phases of account purge (14 §6, 11 §10). */
export const PURGE_PHASES = ["jobs_db", "r2", "cv_kv"] as const;
export const PurgePhaseSchema = defineSchema(
  "queue",
  "PurgePhase",
  z.enum(PURGE_PHASES)
);

/** Postings per `score_postings` message (07 §7.1, 14 §6). */
export const SCORE_POSTINGS_MAX = 50;
/** Maximum serialized message size (14 §6). */
export const QUEUE_MESSAGE_MAX_BYTES = 8192;

const envelope = {
  v: z.literal(1),
  message_id: z.string().min(1).max(64),
  user_id: UserIdSchema,
};

export const ScorePostingsMessageSchema = defineSchema(
  "queue",
  "ScorePostingsMessage",
  z.object({
    ...envelope,
    type: z.literal("score_postings"),
    posting_ids: z.array(PostingIdSchema).min(1).max(SCORE_POSTINGS_MAX),
    profile_version: z.number().int().min(0),
    rubric_version: z.string().min(1),
  })
);

export const TailorCvMessageSchema = defineSchema(
  "queue",
  "TailorCvMessage",
  z.object({
    ...envelope,
    type: z.literal("tailor_cv"),
    cv_variant_id: CvVariantIdSchema,
  })
);

export const EvaluateRulesMessageSchema = defineSchema(
  "queue",
  "EvaluateRulesMessage",
  z.object({
    ...envelope,
    type: z.literal("evaluate_rules"),
    /** After scoring. */
    posting_ids: z.array(PostingIdSchema).min(1).max(SCORE_POSTINGS_MAX),
  })
);

export const PurgeUserMessageSchema = defineSchema(
  "queue",
  "PurgeUserMessage",
  z.object({
    ...envelope,
    type: z.literal("purge_user"),
    phase: PurgePhaseSchema,
  })
);

export const RollupUserMessageSchema = defineSchema(
  "queue",
  "RollupUserMessage",
  z.object({
    ...envelope,
    type: z.literal("rollup_user"),
    /** YYYY-MM-DD in the user's timezone (10 §4). */
    days: z.array(DaySchema).min(1).max(400),
  })
);

export const RebuildAnalyticsMessageSchema = defineSchema(
  "queue",
  "RebuildAnalyticsMessage",
  z.object({
    ...envelope,
    type: z.literal("rebuild_analytics"),
    reason: z.literal("timezone_change"),
  })
);

export const ExportUserMessageSchema = defineSchema(
  "queue",
  "ExportUserMessage",
  z.object({
    ...envelope,
    type: z.literal("export_user"),
    /** 11 §10. */
    export_id: z.string().min(1).max(64),
  })
);

export const JobsAiMessageSchema = defineSchema(
  "queue",
  "JobsAiMessage",
  z.discriminatedUnion("type", [
    ScorePostingsMessageSchema,
    TailorCvMessageSchema,
    EvaluateRulesMessageSchema,
    PurgeUserMessageSchema,
    RollupUserMessageSchema,
    RebuildAnalyticsMessageSchema,
    ExportUserMessageSchema,
  ])
);
export type JobsAiMessage = z.infer<typeof JobsAiMessageSchema>;
export type JobsAiMessageOf<T extends QueueMessageType> = Extract<
  JobsAiMessage,
  { type: T }
>;

/** UTF-8 size of the serialized message. */
export function queueMessageBytes(message: JobsAiMessage): number {
  return new TextEncoder().encode(JSON.stringify(message)).length;
}

/** Validates a message and its size before `send` / `sendBatch`. */
export function parseQueueMessage(input: unknown): JobsAiMessage {
  const message = JobsAiMessageSchema.parse(input);
  const bytes = queueMessageBytes(message);
  if (bytes > QUEUE_MESSAGE_MAX_BYTES) {
    throw new Error(`Queue message is ${bytes} bytes (max 8192)`);
  }
  return message;
}

/** Splits posting ids into ≤ 50-id chunks for `score_postings` messages. */
export function chunkPostingIds(
  postingIds: readonly string[],
  size: number = SCORE_POSTINGS_MAX
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < postingIds.length; i += size) {
    chunks.push(postingIds.slice(i, i + size));
  }
  return chunks;
}

/**
 * Retry delay for 429/5xx (14 §6): `min(300, 2^attempt × 10 + jitter)`
 * seconds, `jitter` in [0, 10).
 */
export function queueRetryDelaySeconds(
  attempt: number,
  random: () => number = Math.random
): number {
  return Math.min(300, Math.floor(2 ** attempt * 10 + random() * 10));
}

/** Consumer settings (14 §3). */
export const JOBS_AI_QUEUE_CONFIG = {
  queue: "jobs-ai",
  deadLetterQueue: "jobs-ai-dlq",
  maxBatchSize: 10,
  maxBatchTimeout: 5,
  maxRetries: 5,
  maxConcurrency: 10,
} as const;
