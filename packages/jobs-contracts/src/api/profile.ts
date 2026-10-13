// 05 §10 — Profile: fact sheet and answer bank (03 §9, 19 §6).
import { z } from "zod";
import {
  DeletedResponseSchema,
  JsonValueSchema,
  PageQuerySchema,
  paginated,
  RevisionSchema,
} from "../common";
import {
  AnswerKindSchema,
  AutoUseSchema,
  FactSourceSchema,
  SensitivitySchema,
} from "../enums";
import {
  ApplicantFactRecordSchema,
  ScreeningAnswerRecordSchema,
} from "../records";
import { defineSchema } from "../registry";
import { route } from "./route";
import { DeleteQuerySchema } from "./views";

const FactKeySchema = z.string().min(1).max(120);

export const FactSheetResponseSchema = defineSchema(
  "api",
  "FactSheetResponse",
  z.object({
    facts: z.array(ApplicantFactRecordSchema),
    /** max(revision) over facts + CV hash (07 §2.1); keys score caching. */
    profile_version: z.number().int().min(0),
  })
);
export type FactSheetResponse = z.infer<typeof FactSheetResponseSchema>;

/** Bulk upsert with per-fact `base_revision` (absent = create). */
export const PutFactsRequestSchema = defineSchema(
  "api",
  "PutFactsRequest",
  z.object({
    facts: z
      .array(
        z.object({
          key: FactKeySchema,
          value: JsonValueSchema,
          source: FactSourceSchema.optional(),
          cv_id: z.string().nullable().optional(),
          cv_entry_id: z.string().nullable().optional(),
          base_revision: RevisionSchema.optional(),
        })
      )
      .max(200),
    delete_keys: z.array(FactKeySchema).max(200).optional(),
  })
);
export type PutFactsRequest = z.infer<typeof PutFactsRequestSchema>;

export const PutFactsResponseSchema = defineSchema(
  "api",
  "PutFactsResponse",
  z.object({
    facts: z.array(ApplicantFactRecordSchema),
    results: z.array(
      z.object({
        key: z.string(),
        status: z.enum([
          "created",
          "updated",
          "deleted",
          "unchanged",
          "conflict",
          "invalid",
        ]),
        fact: ApplicantFactRecordSchema.optional(),
        /** The current row on `conflict`. */
        current: ApplicantFactRecordSchema.optional(),
        error: z.string().optional(),
      })
    ),
    profile_version: z.number().int().min(0),
  })
);
export type PutFactsResponse = z.infer<typeof PutFactsResponseSchema>;

export const ImportCvFactsRequestSchema = defineSchema(
  "api",
  "ImportCvFactsRequest",
  z.object({ cv_id: z.string().min(1) })
);

/** Proposals for user review; nothing is written (05 §10). */
export const ImportCvFactsResponseSchema = defineSchema(
  "api",
  "ImportCvFactsResponse",
  z.object({
    proposals: z.array(
      z.object({
        key: z.string(),
        value: JsonValueSchema,
        source: z.literal("cv_import"),
        cv_id: z.string(),
        cv_entry_id: z.string().nullable(),
        current: ApplicantFactRecordSchema.nullable(),
      })
    ),
  })
);
export type ImportCvFactsResponse = z.infer<typeof ImportCvFactsResponseSchema>;

export const ScreeningAnswerPageSchema = paginated(
  "api",
  "ScreeningAnswer",
  ScreeningAnswerRecordSchema
);

const answerFields = {
  match_patterns: z.array(z.string().max(300)).max(50).optional(),
  answer: z.string().max(4000),
  answer_kind: AnswerKindSchema,
  sensitivity: SensitivitySchema,
  /** `protected` + `always` ⇒ `422 policy_violation`. */
  auto_use: AutoUseSchema,
};

export const CreateAnswerRequestSchema = defineSchema(
  "api",
  "CreateAnswerRequest",
  z.object({ question_key: z.string().min(1).max(120), ...answerFields })
);
export type CreateAnswerRequest = z.infer<typeof CreateAnswerRequestSchema>;

export const UpdateAnswerRequestSchema = defineSchema(
  "api",
  "UpdateAnswerRequest",
  z.object({
    base_revision: RevisionSchema,
    question_key: z.string().min(1).max(120).optional(),
    match_patterns: answerFields.match_patterns,
    answer: answerFields.answer.optional(),
    answer_kind: answerFields.answer_kind.optional(),
    sensitivity: answerFields.sensitivity.optional(),
    auto_use: answerFields.auto_use.optional(),
  })
);
export type UpdateAnswerRequest = z.infer<typeof UpdateAnswerRequestSchema>;

export const AnswerResponseSchema = defineSchema(
  "api",
  "AnswerResponse",
  z.object({ answer: ScreeningAnswerRecordSchema })
);

const ANSWERS = "/api/v1/profile/answers";

export const profileRoutes = {
  "GET /api/v1/profile/facts": route({
    method: "GET",
    path: "/api/v1/profile/facts",
    operation: "getFacts",
    section: "05 §10",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: FactSheetResponseSchema,
  }),
  "PUT /api/v1/profile/facts": route({
    method: "PUT",
    path: "/api/v1/profile/facts",
    operation: "putFacts",
    section: "05 §10",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: PutFactsRequestSchema,
    response: PutFactsResponseSchema,
  }),
  "POST /api/v1/profile/facts:import-cv": route({
    method: "POST",
    path: "/api/v1/profile/facts:import-cv",
    operation: "importCvFacts",
    section: "05 §10",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: ImportCvFactsRequestSchema,
    response: ImportCvFactsResponseSchema,
  }),
  "GET /api/v1/profile/answers": route({
    method: "GET",
    path: ANSWERS,
    operation: "listAnswers",
    section: "05 §10",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: PageQuerySchema,
    response: ScreeningAnswerPageSchema,
  }),
  "POST /api/v1/profile/answers": route({
    method: "POST",
    path: ANSWERS,
    operation: "createAnswer",
    section: "05 §10",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: CreateAnswerRequestSchema,
    response: AnswerResponseSchema,
  }),
  "GET /api/v1/profile/answers/{ans_id}": route({
    method: "GET",
    path: "/api/v1/profile/answers/{ans_id}",
    operation: "getAnswer",
    section: "05 §10",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: AnswerResponseSchema,
  }),
  "PATCH /api/v1/profile/answers/{ans_id}": route({
    method: "PATCH",
    path: "/api/v1/profile/answers/{ans_id}",
    operation: "updateAnswer",
    section: "05 §10",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: UpdateAnswerRequestSchema,
    response: AnswerResponseSchema,
  }),
  "DELETE /api/v1/profile/answers/{ans_id}": route({
    method: "DELETE",
    path: "/api/v1/profile/answers/{ans_id}",
    operation: "deleteAnswer",
    section: "05 §10",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: null,
    query: DeleteQuerySchema,
    response: DeletedResponseSchema,
  }),
} as const;
