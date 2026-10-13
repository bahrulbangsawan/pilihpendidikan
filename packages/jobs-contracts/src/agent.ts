// AI application agent contract (19 §3–§9): what the CLI observes, the closed
// candidate-action set, the field plan, and the four AI proxy calls.
//
// The object schemas below follow 19 §3 field for field, limits included.
// They are written once here and generated into Pydantic for the CLI (D-20).
import { z } from "zod";
import { LeaseIdSchema, TaskIdSchema } from "./ids";
import type { VerificationVerdict } from "./enums";
import {
  PauseReasonSchema,
  SensitivitySchema,
  VerificationVerdictSchema,
} from "./enums";
import { defineSchema } from "./registry";

// ---------------------------------------------------------------------------
// 3.1 PageObservation (CLI → API)
// ---------------------------------------------------------------------------

export const FIELD_KINDS = [
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "month",
  "textarea",
  "select",
  "radio_group",
  "checkbox",
  "checkbox_group",
  "file",
  "combobox",
  "contenteditable",
] as const;
export const FieldKindSchema = defineSchema(
  "agent",
  "FieldKind",
  z.enum(FIELD_KINDS)
);
export type FieldKind = z.infer<typeof FieldKindSchema>;

const FIELD_REF_RE = /^(fr\d+:)?f\d+$/;

export const ObservedFieldOptionSchema = defineSchema(
  "agent",
  "ObservedFieldOption",
  z.object({
    value: z.string().max(200),
    label: z.string().max(200),
    selected: z.boolean(),
    disabled: z.boolean(),
  })
);

export const ObservedFieldSchema = defineSchema(
  "agent",
  "ObservedField",
  z.object({
    ref: z.string().regex(FIELD_REF_RE),
    signature: z.string().length(16),
    kind: FieldKindSchema,
    /** Resolved label (18 §6.2). UNTRUSTED page text. */
    label: z.string().max(300),
    label_sources: z.array(z.string()).max(8),
    /** UNTRUSTED page text. */
    description: z.string().max(300),
    required: z.boolean(),
    options: z.array(ObservedFieldOptionSchema).max(200),
    options_dynamic: z.boolean(),
    /** File inputs only. */
    accept: z.string().max(200).nullable(),
    multiple: z.boolean(),
    /** Never the raw value. */
    has_value: z.boolean(),
    /** Set during a human pause (18 §8). */
    user_touched: z.boolean(),
    invalid: z.boolean(),
    validation_message: z.string().max(300).nullable(),
    /** Nearest heading / legend. */
    section: z.string().max(120).nullable(),
  })
);
export type ObservedField = z.infer<typeof ObservedFieldSchema>;

export const CONTROL_KINDS = ["button", "link", "submit"] as const;
export const ControlKindSchema = defineSchema(
  "agent",
  "ControlKind",
  z.enum(CONTROL_KINDS)
);

export const CONTROL_ROLE_HINTS = [
  "next",
  "previous",
  "submit",
  "add_section",
  "remove_section",
  "upload_trigger",
  "apply_entry",
  "login",
  "sign_up",
  "cookie_consent_accept",
  "cookie_consent_reject",
  "navigation",
  "other",
] as const;
export const ControlRoleHintSchema = defineSchema(
  "agent",
  "ControlRoleHint",
  z.enum(CONTROL_ROLE_HINTS)
);
export type ControlRoleHint = z.infer<typeof ControlRoleHintSchema>;

export const ObservedControlSchema = defineSchema(
  "agent",
  "ObservedControl",
  z.object({
    ref: z.string(),
    kind: ControlKindSchema,
    /** UNTRUSTED page text. */
    text: z.string().max(120),
    role_hint: ControlRoleHintSchema,
    enabled: z.boolean(),
    in_viewport: z.boolean(),
  })
);
export type ObservedControl = z.infer<typeof ObservedControlSchema>;

/** Limits of a PageObservation (19 §3.1). */
export const OBSERVATION_LIMITS = {
  ariaSnapshot: 24_576,
  visibleTextExcerpt: 8192,
  fields: 300,
  controls: 80,
  errors: 30,
  opaqueRegions: 10,
  screenshotB64: 2_000_000,
} as const;

export const PageObservationSchema = defineSchema(
  "agent",
  "PageObservation",
  z.object({
    /** obs_<ULID> */
    observation_id: z.string(),
    attempt_id: z.string(),
    step: z.number().int(),
    url: z.string().url(),
    origin: z.string(),
    registrable_domain: z.string(),
    allowlisted: z.boolean(),
    title: z.string().max(200),
    http_status: z.number().int().nullable(),
    /** UNTRUSTED, truncated. */
    aria_snapshot: z.string().max(OBSERVATION_LIMITS.ariaSnapshot),
    /** UNTRUSTED, PII-redacted (19 §11). */
    visible_text_excerpt: z.string().max(OBSERVATION_LIMITS.visibleTextExcerpt),
    fields: z.array(ObservedFieldSchema).max(OBSERVATION_LIMITS.fields),
    controls: z.array(ObservedControlSchema).max(OBSERVATION_LIMITS.controls),
    errors: z
      .array(
        z.object({ ref: z.string().nullable(), text: z.string().max(300) })
      )
      .max(OBSERVATION_LIMITS.errors),
    opaque_regions: z
      .array(z.object({ origin: z.string(), title: z.string().max(120) }))
      .max(OBSERVATION_LIMITS.opaqueRegions),
    challenge: z.object({
      detected: z.boolean(),
      kind: z.string().nullable(),
    }),
    form_hash: z.string().length(64),
    /** Only when 19 §4.3 allows. */
    screenshot_jpeg_b64: z
      .string()
      .max(OBSERVATION_LIMITS.screenshotB64)
      .nullable(),
  })
);
export type PageObservation = z.infer<typeof PageObservationSchema>;

// ---------------------------------------------------------------------------
// 3.2 CandidateAction (closed set)
// ---------------------------------------------------------------------------

/** Role hints a `click_ref` candidate may carry (19 §3.2). */
export const CLICK_ROLE_HINTS = [
  "next",
  "previous",
  "submit",
  "add_section",
  "remove_section",
  "upload_trigger",
  "apply_entry",
  "cookie_consent_reject",
  "cookie_consent_accept",
] as const;

export const CANDIDATE_ACTION_TYPES = [
  "fill_field",
  "select_option",
  "set_checkbox",
  "upload_file",
  "click_ref",
  "scroll",
  "wait_for",
  "pause_for_human",
  "stop",
] as const;
export type CandidateActionType = (typeof CANDIDATE_ACTION_TYPES)[number];

/**
 * Executor-enumerated actions (19 §3.2). Ids are `c1`, `c2`, … per step;
 * field-fill candidates carry plan_item ids of the validated FieldPlan and
 * never raw values.
 */
export const CandidateActionSchema = defineSchema(
  "agent",
  "CandidateAction",
  z.discriminatedUnion("type", [
    z.object({
      id: z.string(),
      type: z.literal("fill_field"),
      ref: z.string(),
      plan_item: z.string(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("select_option"),
      ref: z.string(),
      plan_item: z.string(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("set_checkbox"),
      ref: z.string(),
      plan_item: z.string(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("upload_file"),
      ref: z.string(),
      file_id: z.string(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("click_ref"),
      ref: z.string(),
      role_hint: z.enum(CLICK_ROLE_HINTS),
      /**
       * The control's visible text (UNTRUSTED), so next-action can quote it
       * (19 §5.2) without remembering the observation; the server quotes at
       * most 60 characters with newlines and markers stripped.
       */
      text: z.string().max(120).optional(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("scroll"),
      ref: z.string().nullable(),
      direction: z.enum(["down", "up"]),
    }),
    z.object({
      id: z.string(),
      type: z.literal("wait_for"),
      condition: z.enum(["network_idle", "url_change"]),
      timeout_ms: z.number().max(15_000),
    }),
    z.object({
      id: z.string(),
      type: z.literal("pause_for_human"),
      reason: PauseReasonSchema,
      message: z.string().max(300),
    }),
    z.object({
      id: z.string(),
      type: z.literal("stop"),
      outcome: z.enum(["failed", "cancelled"]),
      error_class: z.string(),
    }),
  ])
);
export type CandidateAction = z.infer<typeof CandidateActionSchema>;

// ---------------------------------------------------------------------------
// 3.3 FieldPlan (Responses API Structured Output)
// ---------------------------------------------------------------------------

export const PLAN_ACTIONS = [
  "fill",
  "select",
  "check",
  "uncheck",
  "upload",
  "skip",
] as const;
export const PlanActionSchema = defineSchema(
  "agent",
  "PlanAction",
  z.enum(PLAN_ACTIONS)
);

export const VALUE_SOURCES = [
  "fact",
  "answer",
  "option",
  "cv_file",
  "cover_letter_file",
  "generated_text",
  "none",
] as const;
export const ValueSourceSchema = defineSchema(
  "agent",
  "ValueSource",
  z.enum(VALUE_SOURCES)
);
export type ValueSource = z.infer<typeof ValueSourceSchema>;

export const FieldPlanItemSchema = defineSchema(
  "agent",
  "FieldPlanItem",
  z.object({
    /** "p1", "p2", … (one per ObservedField considered). */
    plan_item: z.string(),
    ref: z.string(),
    signature: z.string(),
    action: PlanActionSchema,
    value_source: ValueSourceSchema,
    /** applicant_facts.key when value_source = fact. */
    fact_key: z.string().nullable(),
    /** screening_answers.id when value_source = answer. */
    answer_id: z.string().nullable(),
    /** Must be one of the field's options. */
    option_value: z.string().nullable(),
    /** Proposed literal; the validator recomputes it (19 §6.4). */
    value: z.string().max(4000).nullable(),
    confidence: z.number().min(0).max(1),
    sensitivity: SensitivitySchema,
    needs_human: z.boolean(),
    /** Canonical key for screening questions. */
    question_key: z.string().nullable(),
    /** Short rationale (logged, never shown as fact). */
    reason: z.string().max(300),
  })
);
export type FieldPlanItem = z.infer<typeof FieldPlanItemSchema>;

export const FieldPlanSchema = defineSchema(
  "agent",
  "FieldPlan",
  z.object({
    items: z.array(FieldPlanItemSchema),
    missing: z.array(
      z.object({
        ref: z.string(),
        label: z.string(),
        question_key: z.string().nullable(),
        why: z.string().max(200),
      })
    ),
  })
);
export type FieldPlan = z.infer<typeof FieldPlanSchema>;

const nullableString = { type: ["string", "null"] } as const;

/**
 * The strict JSON schema sent with the field-plan Responses call (19 §3.3):
 * every property required, nullable values as `["string","null"]`,
 * `additionalProperties: false`.
 */
export const FIELD_PLAN_JSON_SCHEMA = {
  name: "field_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items", "missing"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "plan_item",
            "ref",
            "signature",
            "action",
            "value_source",
            "fact_key",
            "answer_id",
            "option_value",
            "value",
            "confidence",
            "sensitivity",
            "needs_human",
            "question_key",
            "reason",
          ],
          properties: {
            plan_item: { type: "string" },
            ref: { type: "string" },
            signature: { type: "string" },
            action: { type: "string", enum: [...PLAN_ACTIONS] },
            value_source: { type: "string", enum: [...VALUE_SOURCES] },
            fact_key: nullableString,
            answer_id: nullableString,
            option_value: nullableString,
            value: { type: ["string", "null"], maxLength: 4000 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            sensitivity: {
              type: "string",
              enum: ["none", "personal", "protected"],
            },
            needs_human: { type: "boolean" },
            question_key: nullableString,
            reason: { type: "string", maxLength: 300 },
          },
        },
      },
      missing: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ref", "label", "question_key", "why"],
          properties: {
            ref: { type: "string" },
            label: { type: "string" },
            question_key: nullableString,
            why: { type: "string", maxLength: 200 },
          },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// AI proxy requests and responses (05 §9, 19 §4–§6, §9)
// ---------------------------------------------------------------------------

/** Binds an AI call to a live lease of the calling device (21 §11). */
export const LeaseRefSchema = defineSchema(
  "agent",
  "LeaseRef",
  z.object({ task_id: TaskIdSchema, lease_id: LeaseIdSchema })
);
export type LeaseRef = z.infer<typeof LeaseRefSchema>;

/** Page kinds of the classification choice (19 §4.1). */
export const PAGE_KINDS = [
  "job_description",
  "application_form",
  "login_required",
  "account_creation_required",
  "captcha_or_challenge",
  "review_page",
  "confirmation",
  "error_page",
  "email_instructions",
  "external_redirect",
  "unrelated",
  "other",
] as const;
export const PageKindSchema = defineSchema(
  "agent",
  "PageKind",
  z.enum(PAGE_KINDS)
);
export type PageKind = z.infer<typeof PageKindSchema>;

const probability = z.number().min(0).max(1);

export const PageClassifyRequestSchema = defineSchema(
  "agent",
  "PageClassifyRequest",
  z.object({
    lease_ref: LeaseRefSchema,
    observation: PageObservationSchema,
  })
);
export type PageClassifyRequest = z.infer<typeof PageClassifyRequestSchema>;

/**
 * `{page_kind, confidence, injection_suspected, form_present}` (19 §2) plus
 * the per-choice probabilities, the upload predicate and refused question
 * names. Predicates are probabilities (null when refused).
 */
export const PageClassifyResponseSchema = defineSchema(
  "agent",
  "PageClassifyResponse",
  z.object({
    page_kind: PageKindSchema,
    confidence: probability,
    probabilities: z.partialRecord(PageKindSchema, probability).optional(),
    injection_suspected: probability.nullable(),
    form_requires_upload: probability.nullable(),
    form_present: z.boolean(),
    refused: z.array(z.string()),
  })
);
export type PageClassifyResponse = z.infer<typeof PageClassifyResponseSchema>;

export const NextActionRequestSchema = defineSchema(
  "agent",
  "NextActionRequest",
  z.object({
    lease_ref: LeaseRefSchema,
    observation_id: z.string(),
    step: z.number().int().min(0),
    page_kind: PageKindSchema,
    state: z.object({
      required_remaining: z.number().int().min(0),
      errors: z.number().int().min(0),
      form_hash: z.string().length(64),
    }),
    candidates: z.array(CandidateActionSchema).min(1).max(40),
  })
);
export type NextActionRequest = z.infer<typeof NextActionRequestSchema>;

/** `choice` is a candidate id, `pause` or `stop` (19 §5.2). */
export const NextActionResponseSchema = defineSchema(
  "agent",
  "NextActionResponse",
  z.object({
    choice: z.string().min(1),
    confidence: probability.nullable(),
    refused: z.boolean(),
  })
);
export type NextActionResponse = z.infer<typeof NextActionResponseSchema>;

/**
 * The CLI sends the observation plus the fact keys it wants considered, never
 * fact values (05 §9); the server injects facts and answers itself.
 */
export const FieldPlanRequestSchema = defineSchema(
  "agent",
  "FieldPlanRequest",
  z.object({
    lease_ref: LeaseRefSchema,
    observation: PageObservationSchema,
    fact_keys: z.array(z.string().max(120)).max(200).optional(),
    file_slots: z.object({
      cv_file: z.boolean(),
      cover_letter_file: z.boolean(),
    }),
    /** 2 escalates the model once per form hash (19 §6.1). */
    attempt: z.number().int().min(1).max(2).optional(),
  })
);
export type FieldPlanRequest = z.infer<typeof FieldPlanRequestSchema>;

/**
 * Deterministic evidence signals (18 §10, 19 §9.1) and the signal keys other
 * evidence kinds record (09 §6, 06 §12.3). Stored as
 * `submission_evidence.signals`; unknown keys are preserved.
 */
export const EvidenceSignalsSchema = defineSchema(
  "agent",
  "EvidenceSignals",
  z.looseObject({
    url_match: z.boolean().optional(),
    dom_marker: z.boolean().optional(),
    negative_marker: z.boolean().optional(),
    xhr_2xx: z.boolean().optional(),
    form_gone: z.boolean().optional(),
    http_status: z.number().int().nullable().optional(),
    application_received: probability.nullable().optional(),
    still_form_or_error: probability.nullable().optional(),
    method: z.string().max(40).optional(),
    user_confirmed: z.boolean().optional(),
    provider_accepted: z.boolean().optional(),
    message_id: z.string().max(300).optional(),
    source: z.string().max(60).optional(),
    inferred: z.boolean().optional(),
  })
);
export type EvidenceSignals = z.infer<typeof EvidenceSignalsSchema>;

export const VerifySubmissionRequestSchema = defineSchema(
  "agent",
  "VerifySubmissionRequest",
  z.object({
    lease_ref: LeaseRefSchema,
    observation_id: z.string().nullable(),
    final_url: z.string().url(),
    page_title: z.string().max(200),
    /** ≤ 2 KB, redacted (18 §10). */
    text_excerpt: z.string().max(2048),
    screenshot_jpeg_b64: z
      .string()
      .max(OBSERVATION_LIMITS.screenshotB64)
      .nullable(),
    signals: EvidenceSignalsSchema,
  })
);
export type VerifySubmissionRequest = z.infer<
  typeof VerifySubmissionRequestSchema
>;

export const VerifySubmissionResponseSchema = defineSchema(
  "agent",
  "VerifySubmissionResponse",
  z.object({
    application_received: probability.nullable(),
    still_form_or_error: probability.nullable(),
    verdict: VerificationVerdictSchema,
    refused: z.array(z.string()),
  })
);
export type VerifySubmissionResponse = z.infer<
  typeof VerifySubmissionResponseSchema
>;

// ---------------------------------------------------------------------------
// Thresholds and the verification algorithm (19 §4.2, §5.3, §6.4, §8, §9)
// ---------------------------------------------------------------------------

export const AGENT_THRESHOLDS = {
  /** `page_kind` / next-action choice below this pauses (`low_confidence`). */
  choiceConfidence: 0.7,
  /** Field plan items below this become `needs_human`. */
  fieldConfidence: 0.75,
  /** Text-only classification below this is retried once with a screenshot. */
  screenshotRetry: 0.85,
  /** `auto` requires page-kind confidence at least this. */
  autoPageKind: 0.85,
  /** `injection_suspected` probability that flags (and stops `auto`). */
  injection: 0.5,
  /** Question → answer-bank match binding hint. */
  questionMatch: 0.8,
  verifyReceived: 0.85,
  verifyStillFormMax: 0.3,
  verifyNegative: 0.7,
} as const;

/** Per-attempt budgets (19 §8.1). */
export const AGENT_BUDGETS = {
  actions: 60,
  aiCalls: 25,
  wallMs: 900_000,
} as const;

/**
 * The verification algorithm of 19 §9.1. `ai` is null when the AI call was
 * not made or failed; a refused predicate is null.
 */
export function computeVerificationVerdict(
  signals: Pick<
    EvidenceSignals,
    "url_match" | "dom_marker" | "negative_marker" | "xhr_2xx" | "form_gone"
  >,
  ai: {
    application_received: number | null;
    still_form_or_error: number | null;
  } | null
): VerificationVerdict {
  if (signals.negative_marker === true) {
    return "negative";
  }
  const deterministicPositive =
    signals.url_match === true ||
    (signals.dom_marker === true && signals.form_gone === true);
  const received = ai?.application_received ?? null;
  const stillForm = ai?.still_form_or_error ?? null;
  const aiPositive =
    received !== null &&
    stillForm !== null &&
    received >= AGENT_THRESHOLDS.verifyReceived &&
    stillForm < AGENT_THRESHOLDS.verifyStillFormMax;
  if (deterministicPositive && aiPositive) {
    return "verified";
  }
  if (deterministicPositive || aiPositive) {
    return "unverified";
  }
  if (stillForm !== null && stillForm >= AGENT_THRESHOLDS.verifyNegative) {
    return "negative";
  }
  return signals.xhr_2xx === true ? "unverified" : "outcome_unknown";
}
