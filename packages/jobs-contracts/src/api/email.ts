// 05 §13 — Email applications (09).
import { z } from "zod";
import { Sha256HexSchema, TimestampSchema } from "../common";
import { EMAIL_LIMITS } from "../email";
import { EmailDeliverySchema, LocaleSchema } from "../enums";
import { FileIdSchema } from "../ids";
import {
  ApplicationRecordSchema,
  ApprovalRecordSchema,
  EmailApplicationRecordSchema,
  SubmissionEvidenceRecordSchema,
} from "../records";
import { defineSchema } from "../registry";
import { route } from "./route";

/**
 * `to`, `subject`, `body_text` and `attachment_file_ids` are optional
 * (additive, 09 §10): `to` defaults to a `mailto:` apply link, subject and
 * body to the 09 §5.1 template, attachments to the attached CV variant's PDF
 * (`[]` = none).
 */
export const CreateEmailRequestSchema = defineSchema(
  "api",
  "CreateEmailRequest",
  z.object({
    to: z.string().email().max(EMAIL_LIMITS.recipientLength).optional(),
    subject: z.string().min(1).max(300).optional(),
    body_text: z.string().min(1).max(EMAIL_LIMITS.bodyBytes).optional(),
    attachment_file_ids: z
      .array(FileIdSchema)
      .max(EMAIL_LIMITS.attachments)
      .optional(),
    delivery: EmailDeliverySchema,
    locale: LocaleSchema.optional(),
    /** "I confirm this address belongs to the employer" (09 §1). */
    recipient_confirmed: z.boolean().optional(),
    /** The paragraph came from the AI draft (09 §5.2). */
    ai_drafted: z.boolean().optional(),
    /** Ask the AI for the optional paragraph (09 §5.2; templated body only). */
    draft_paragraph: z.boolean().optional(),
    /** Fills the template greeting. */
    recipient_name: z.string().min(1).max(120).optional(),
  })
);
export type CreateEmailRequest = z.infer<typeof CreateEmailRequestSchema>;

/** Outcome of the AI paragraph (09 §5.2), without its usage. */
export const EmailParagraphOutcomeSchema = defineSchema(
  "api",
  "EmailParagraphOutcome",
  z.object({
    status: z.enum([
      "drafted",
      "rejected",
      "refused",
      "ai_disabled",
      "consent_required",
      "budget_exhausted",
      "unavailable",
      "no_sources",
    ]),
    paragraph: z.string().nullable(),
    source_bullet_ids: z.array(z.string()),
    source_fact_keys: z.array(z.string()),
    violations: z.array(z.string()),
  })
);

/** What the draft response asks the user to review (09 §1, §4). */
export const EmailDraftReviewSchema = defineSchema(
  "api",
  "EmailDraftReview",
  z.object({
    /** Echo it in `POST /emails/{eml_id}/approve`. */
    payload_hash: Sha256HexSchema,
    locale: LocaleSchema,
    templated: z.object({ subject: z.boolean(), body: z.boolean() }),
    recipient: z.object({
      address: z.string(),
      domain: z.string(),
      employerDomains: z.array(z.string()),
      freeMail: z.boolean(),
      matchesEmployer: z.boolean(),
      ownDomain: z.boolean(),
      /** The user must tick "this address belongs to the employer". */
      confirmationRequired: z.boolean(),
      confirmed: z.boolean(),
    }),
    warnings: z.array(z.string()),
    ai_paragraph: EmailParagraphOutcomeSchema.nullable(),
  })
);

/** `approval` and `review` are additive (create only). */
export const EmailResponseSchema = defineSchema(
  "api",
  "EmailResponse",
  z.object({
    email: EmailApplicationRecordSchema,
    approval: ApprovalRecordSchema.optional(),
    review: EmailDraftReviewSchema.optional(),
  })
);

/** `pilih-jobs email show` (09 §10). */
export const EmailDetailResponseSchema = defineSchema(
  "api",
  "EmailDetailResponse",
  z.object({
    email: EmailApplicationRecordSchema,
    /** The approval of the current content, else the newest one, else null. */
    approval: ApprovalRecordSchema.nullable(),
    /** What an approve call must echo; null when an attachment is gone. */
    payload_hash: Sha256HexSchema.nullable(),
  })
);

/** Approval binds the exact content via `payload_hash` (09 §4). */
export const ApproveEmailRequestSchema = defineSchema(
  "api",
  "ApproveEmailRequest",
  z.object({
    payload_hash: Sha256HexSchema,
    recipient_confirmed: z.boolean().optional(),
  })
);

/** `server_send` sends immediately; `local_handoff` releases the draft. */
export const ApproveEmailResponseSchema = defineSchema(
  "api",
  "ApproveEmailResponse",
  z.object({
    email: EmailApplicationRecordSchema,
    approval: ApprovalRecordSchema,
    application: ApplicationRecordSchema,
    evidence: SubmissionEvidenceRecordSchema.nullable(),
    /** Additive, server_send only: whether the provider accepted it. */
    delivery: z
      .object({ ok: z.boolean(), error: z.string().optional() })
      .optional(),
  })
);

/** The CLI reports the user's hand-off answer (09 §6.1, §9). */
export const EmailHandedOffRequestSchema = defineSchema(
  "api",
  "EmailHandedOffRequest",
  z.object({
    sent_confirmed: z.boolean(),
    sent_at: TimestampSchema.optional(),
  })
);

export const EmailHandedOffResponseSchema = defineSchema(
  "api",
  "EmailHandedOffResponse",
  z.object({
    email: EmailApplicationRecordSchema,
    application: ApplicationRecordSchema,
    evidence: SubmissionEvidenceRecordSchema.nullable(),
  })
);

export const emailRoutes = {
  "POST /api/v1/applications/{app_id}/emails": route({
    method: "POST",
    path: "/api/v1/applications/{app_id}/emails",
    operation: "createEmail",
    section: "05 §13",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: CreateEmailRequestSchema,
    response: EmailResponseSchema,
  }),
  "GET /api/v1/emails/{eml_id}": route({
    method: "GET",
    path: "/api/v1/emails/{eml_id}",
    operation: "getEmail",
    section: "05 §13",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: EmailDetailResponseSchema,
  }),
  "POST /api/v1/emails/{eml_id}/approve": route({
    method: "POST",
    path: "/api/v1/emails/{eml_id}/approve",
    operation: "approveEmail",
    section: "05 §13",
    scope: "automation:manage",
    idempotency: "optional",
    status: 200,
    request: ApproveEmailRequestSchema,
    response: ApproveEmailResponseSchema,
  }),
  "POST /api/v1/emails/{eml_id}/handed-off": route({
    method: "POST",
    path: "/api/v1/emails/{eml_id}/handed-off",
    operation: "emailHandedOff",
    section: "05 §13",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: EmailHandedOffRequestSchema,
    response: EmailHandedOffResponseSchema,
  }),
} as const;
