// 05 §6 — Scoring (07).
import { z } from "zod";
import { PostingIdSchema, UserJobIdSchema } from "../ids";
import { MatchScoreRecordSchema } from "../records";
import { defineSchema } from "../registry";
import { route } from "./route";

/** Ids per `scores:request` (05 §6). */
export const SCORES_REQUEST_MAX = 500;

/** Exactly one of `posting_ids` / `user_job_ids` (05 §6). */
export const RequestScoresRequestSchema = defineSchema(
  "api",
  "RequestScoresRequest",
  z
    .object({
      posting_ids: z
        .array(PostingIdSchema)
        .min(1)
        .max(SCORES_REQUEST_MAX)
        .optional(),
      user_job_ids: z
        .array(UserJobIdSchema)
        .min(1)
        .max(SCORES_REQUEST_MAX)
        .optional(),
    })
    .refine(
      (body) =>
        (body.posting_ids === undefined) !== (body.user_job_ids === undefined),
      { message: "send exactly one of posting_ids or user_job_ids" }
    )
);
export type RequestScoresRequest = z.infer<typeof RequestScoresRequestSchema>;

/** Posting ids enqueued vs. already scored for the current profile_version (07 §6). */
export const RequestScoresResponseSchema = defineSchema(
  "api",
  "RequestScoresResponse",
  z.object({
    queued: z.array(PostingIdSchema),
    cached: z.array(PostingIdSchema),
  })
);
export type RequestScoresResponse = z.infer<typeof RequestScoresResponseSchema>;

/** The score for the caller's current profile_version; null if none yet. */
export const GetScoreResponseSchema = defineSchema(
  "api",
  "GetScoreResponse",
  z.object({
    score: MatchScoreRecordSchema.nullable(),
    profile_version: z.number().int().min(0),
  })
);
export type GetScoreResponse = z.infer<typeof GetScoreResponseSchema>;

export const scoringRoutes = {
  "POST /api/v1/scores:request": route({
    method: "POST",
    path: "/api/v1/scores:request",
    operation: "requestScores",
    section: "05 §6",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: RequestScoresRequestSchema,
    response: RequestScoresResponseSchema,
  }),
  "GET /api/v1/scores/{posting_id}": route({
    method: "GET",
    path: "/api/v1/scores/{posting_id}",
    operation: "getScore",
    section: "05 §6",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: GetScoreResponseSchema,
  }),
} as const;
