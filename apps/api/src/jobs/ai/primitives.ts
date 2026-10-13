// Shared building blocks of the AI layer (19 §12, D-12): models and prices,
// usage accounting and cost estimates, the two primitive request/response
// shapes (Decisions and Responses Structured Outputs), the request limits we
// self-impose, the Zod shapes of the provider envelopes (T7-11) and
// `AiProviderError`. provider.ts builds the full `AiProvider` on top; fake.ts
// and openai.ts implement `AiPrimitives`.

import { z } from "zod";

export type AiProviderId = "openai" | "anthropic" | "fake";

/** Server-configured models (19 §6.1, 07 §4.1, 08). */
export const AI_MODELS = {
  decisions: "gpt-6-luna",
  structured: "gpt-6.1-sol",
  structuredEscalation: "gpt-6-astra",
} as const;

/** USD per 1M tokens [VERIFIED 14 §9.2, 19 §1.2]. Decisions bills input only. */
export const MODEL_PRICES_PER_MILLION: Readonly<
  Record<string, { input: number; output: number }>
> = {
  "gpt-6-luna": { input: 0.1, output: 0 },
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6-astra": { input: 10, output: 50 },
};
// Unknown models are priced like the most expensive known one (budget-safe).
const FALLBACK_PRICE = { input: 10, output: 50 };

/** 19 §1.1: self-imposed Decisions limits (the API documents none, A-01). */
export const DECISION_LIMITS = {
  questionsPerRequest: 6,
  choicesPerQuestion: 40,
  imagesPerRequest: 1,
} as const;

/** 19 §13 [ASSUMPTION]: one image ≈ 1.5k input tokens on Decisions. */
export const IMAGE_TOKEN_ESTIMATE = 1500;

/** Request timeouts (07 §7.2, 19 §1). */
export const DECISIONS_TIMEOUT_MS = 10_000;
export const RESPONSES_TIMEOUT_MS = 60_000;

export interface AiUsage {
  cost_micro_usd: number;
  input_tokens: number;
  model: string;
  output_tokens: number;
}

/** Cost in micro-USD (USD per 1M tokens × tokens = micro-USD). */
export function costMicroUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price = MODEL_PRICES_PER_MILLION[model] ?? FALLBACK_PRICE;
  return Math.ceil(
    Math.max(0, inputTokens) * price.input +
      Math.max(0, outputTokens) * price.output
  );
}

/** 07 §9: estimated input tokens = ceil(chars / 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function usageOf(
  model: string,
  inputTokens: number,
  outputTokens: number
): AiUsage {
  return {
    model,
    input_tokens: Math.max(0, Math.round(inputTokens)),
    output_tokens: Math.max(0, Math.round(outputTokens)),
    cost_micro_usd: costMicroUsd(model, inputTokens, outputTokens),
  };
}

/** Sums usages of several calls (the model of the first, or `model`). */
export function sumUsage(parts: readonly AiUsage[], model?: string): AiUsage {
  return {
    model: model ?? parts[0]?.model ?? AI_MODELS.decisions,
    input_tokens: parts.reduce((total, part) => total + part.input_tokens, 0),
    output_tokens: parts.reduce((total, part) => total + part.output_tokens, 0),
    cost_micro_usd: parts.reduce(
      (total, part) => total + part.cost_micro_usd,
      0
    ),
  };
}

export const ZERO_USAGE: AiUsage = Object.freeze({
  model: AI_MODELS.decisions,
  input_tokens: 0,
  output_tokens: 0,
  cost_micro_usd: 0,
});

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type DecisionContentPart =
  | { text: string; type: "input_text" }
  | { image_url: string; type: "input_image" };

export type DecisionInput =
  | string
  | Array<{ content: DecisionContentPart[]; role: "user" }>;

export type DecisionQuestion =
  | { instructions: string; name: string; type: "predicate" }
  | {
      choices: Array<{ description: string; value: string }>;
      instructions: string;
      name: string;
      type: "choice";
    }
  | {
      instructions: string;
      levels: Array<{ description: string; label: string }>;
      name: string;
      type: "score";
    };

export type DecisionAnswer =
  | { name: string; probability: number; type: "predicate" }
  | {
      choice: string;
      confidence: number | null;
      name: string;
      probabilities: Array<{ probability: number; value: string }>;
      type: "choice";
    }
  | {
      confidence: number | null;
      name: string;
      probabilities: Array<{
        label: string;
        probability: number;
        value: number;
      }>;
      score: number;
      type: "score";
    }
  | { name: string; refusal: string; type: "refusal" };

export interface DecisionRequest {
  /**
   * Deterministic answer the fake provider gives for a question (never used
   * live). The domain methods (compose.ts) supply input-dependent ones.
   */
  fake?: (question: DecisionQuestion) => DecisionAnswer | undefined;
  input: DecisionInput;
  model?: string;
  questions: DecisionQuestion[];
}

export interface DecisionResponse {
  answers: DecisionAnswer[];
  id: string | null;
  model: string;
  usage: AiUsage;
}

export interface StructuredRequest<T> {
  /** Deterministic output the fake provider returns (never used live). */
  fake?: () => T;
  /** Untrusted + trusted user content. */
  input: string;
  /** System instructions (trusted). */
  instructions: string;
  maxOutputTokens?: number;
  model?: string;
  /** Schema name sent to the API. */
  name: string;
  /** Strict JSON schema (every property required, no extra properties). */
  schema: Record<string, unknown>;
  /** The Zod schema the output must satisfy. */
  validator: z.ZodType<T>;
}

export interface StructuredResponse<T> {
  model: string;
  /** null when the model refused. */
  output: T | null;
  refusal: string | null;
  usage: AiUsage;
}

export interface AiPrimitives {
  readonly id: AiProviderId;
  decide(request: DecisionRequest): Promise<DecisionResponse>;
  structured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AiErrorKind =
  | "rate_limited"
  | "upstream"
  | "timeout"
  | "bad_request"
  | "invalid_output"
  | "unavailable";

const RETRYABLE: Readonly<Record<AiErrorKind, boolean>> = {
  rate_limited: true,
  upstream: true,
  timeout: true,
  bad_request: false,
  invalid_output: false,
  unavailable: false,
};

export class AiProviderError extends Error {
  readonly kind: AiErrorKind;
  readonly retryable: boolean;
  /** Seconds from a 429 `Retry-After`, when the provider sent one. */
  readonly retryAfterSeconds: number | null;
  readonly status: number | null;

  constructor(
    kind: AiErrorKind,
    message: string,
    status: number | null = null,
    retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = "AiProviderError";
    this.kind = kind;
    this.status = status;
    this.retryable = RETRYABLE[kind];
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isAiProviderError(value: unknown): value is AiProviderError {
  return value instanceof AiProviderError;
}

// ---------------------------------------------------------------------------
// Request validation and estimates
// ---------------------------------------------------------------------------

const DATA_URL_RE =
  /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function inputParts(input: DecisionInput): DecisionContentPart[] {
  if (typeof input === "string") {
    return [{ type: "input_text", text: input }];
  }
  return input.flatMap((message) => message.content);
}

/**
 * Enforces the self-imposed Decisions limits (19 §1.1): ≤ 6 questions, ≤ 40
 * choices each, unique names and values, ≥ 2 score levels, ≤ 1 image that is
 * an inline base64 data URL (hosted URLs are not supported). Throws a
 * non-retryable `bad_request` before anything leaves the Worker.
 */
export function assertDecisionRequest(request: DecisionRequest): void {
  assertQuestions(request.questions);
  assertImages(request.input);
}

function invalidDecision(message: string): never {
  throw new AiProviderError("bad_request", `Decisions request: ${message}`);
}

function assertQuestion(question: DecisionQuestion): void {
  if (question.type === "choice") {
    if (
      question.choices.length < 1 ||
      question.choices.length > DECISION_LIMITS.choicesPerQuestion
    ) {
      invalidDecision(
        `"${question.name}" has ${question.choices.length} choices (1–${DECISION_LIMITS.choicesPerQuestion})`
      );
    }
    const values = new Set(question.choices.map((choice) => choice.value));
    if (values.size !== question.choices.length) {
      invalidDecision(`"${question.name}" repeats a choice value`);
    }
  }
  if (question.type === "score" && question.levels.length < 2) {
    invalidDecision(`"${question.name}" needs at least two levels`);
  }
}

function assertQuestions(questions: readonly DecisionQuestion[]): void {
  if (questions.length === 0) {
    invalidDecision("no questions");
  }
  if (questions.length > DECISION_LIMITS.questionsPerRequest) {
    invalidDecision(
      `${questions.length} questions (max ${DECISION_LIMITS.questionsPerRequest})`
    );
  }
  const names = new Set<string>();
  for (const question of questions) {
    if (!question.name || names.has(question.name)) {
      invalidDecision(`question name "${question.name}" is empty or repeated`);
    }
    names.add(question.name);
    assertQuestion(question);
  }
}

function assertImages(input: DecisionInput): void {
  const images = inputParts(input).filter(
    (part) => part.type === "input_image"
  );
  if (images.length > DECISION_LIMITS.imagesPerRequest) {
    invalidDecision(
      `${images.length} images (max ${DECISION_LIMITS.imagesPerRequest})`
    );
  }
  for (const image of images) {
    if (image.type === "input_image" && !DATA_URL_RE.test(image.image_url)) {
      invalidDecision("images must be inline base64 data URLs");
    }
  }
}

/** Text of a Decisions request as billed (input + questions), for estimates. */
function decisionText(request: DecisionRequest): string {
  const text = inputParts(request.input)
    .map((part) => (part.type === "input_text" ? part.text : ""))
    .join("\n");
  return `${text}\n${JSON.stringify(request.questions)}`;
}

/** Estimated input tokens of a Decisions request (07 §9, 19 §13). */
export function estimateDecisionTokens(request: DecisionRequest): number {
  const images = inputParts(request.input).filter(
    (part) => part.type === "input_image"
  ).length;
  return estimateTokens(decisionText(request)) + images * IMAGE_TOKEN_ESTIMATE;
}

/** Estimated cost of a Decisions request in micro-USD (budget pre-check). */
export function estimateDecisionCost(request: DecisionRequest): number {
  return costMicroUsd(
    request.model ?? AI_MODELS.decisions,
    estimateDecisionTokens(request),
    0
  );
}

/** Default output cap of a Responses call when the caller sets none. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/**
 * Worst-case cost of a Responses call in micro-USD: estimated input plus the
 * full output cap (budget pre-check, 14 §9.4).
 */
export function estimateStructuredCost(
  request: Pick<
    StructuredRequest<unknown>,
    "input" | "instructions" | "maxOutputTokens" | "model" | "schema"
  >
): number {
  const model = request.model ?? AI_MODELS.structured;
  const input = estimateTokens(
    `${request.instructions}\n${request.input}\n${JSON.stringify(request.schema)}`
  );
  return costMicroUsd(
    model,
    input,
    request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  );
}

// ---------------------------------------------------------------------------
// Provider envelopes (A-01: validated, T7-11 checks the live shape)
// ---------------------------------------------------------------------------

const probability = z.number().min(0).max(1);

/** One entry of Decisions `answers[]` as the API returns it (19 §1.1). */
export const DecisionsAnswerEnvelopeSchema = z.looseObject({
  name: z.string().min(1),
  type: z.string().optional(),
  probability: probability.optional(),
  choice: z.string().optional(),
  score: z.number().min(0).optional(),
  confidence: probability.nullable().optional(),
  probabilities: z
    .array(
      z.looseObject({
        probability,
        value: z.union([z.string(), z.number()]).optional(),
        label: z.string().optional(),
      })
    )
    .optional(),
  refusal: z.string().optional(),
});

/** `POST /v1/decisions` response (19 §1.1; `id`/`usage` unverified, A-01). */
export const DecisionsResponseEnvelopeSchema = z.looseObject({
  id: z.string().optional(),
  model: z.string().optional(),
  answers: z.array(DecisionsAnswerEnvelopeSchema),
  usage: z
    .looseObject({
      input_tokens: z.number().int().min(0).optional(),
      output_tokens: z.number().int().min(0).optional(),
      total_tokens: z.number().int().min(0).optional(),
    })
    .nullable()
    .optional(),
});
export type DecisionsResponseEnvelope = z.infer<
  typeof DecisionsResponseEnvelopeSchema
>;

/** `POST /v1/responses` response, the parts we read (19 §1.2). */
export const ResponsesEnvelopeSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string().optional(),
  output: z
    .array(
      z.looseObject({
        type: z.string().optional(),
        content: z
          .array(
            z.looseObject({
              type: z.string(),
              text: z.string().optional(),
              refusal: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
  incomplete_details: z
    .looseObject({ reason: z.string().optional() })
    .nullable()
    .optional(),
  error: z.unknown().optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().int().min(0).optional(),
      output_tokens: z.number().int().min(0).optional(),
    })
    .nullable()
    .optional(),
});
export type ResponsesEnvelope = z.infer<typeof ResponsesEnvelopeSchema>;

type AnswerEnvelope = z.infer<typeof DecisionsAnswerEnvelopeSchema>;

function confidenceOf(entry: AnswerEnvelope): number | null {
  return typeof entry.confidence === "number" ? entry.confidence : null;
}

function refusal(name: string, text: string): DecisionAnswer {
  return { type: "refusal", name, refusal: text };
}

function choiceAnswer(
  question: Extract<DecisionQuestion, { type: "choice" }>,
  entry: AnswerEnvelope
): DecisionAnswer {
  const allowed = new Set(question.choices.map((choice) => choice.value));
  if (typeof entry.choice !== "string" || !allowed.has(entry.choice)) {
    return refusal(question.name, "choice outside the supplied values");
  }
  return {
    type: "choice",
    name: question.name,
    choice: entry.choice,
    confidence: confidenceOf(entry),
    probabilities: (entry.probabilities ?? [])
      .filter(
        (p): p is typeof p & { value: string } =>
          typeof p.value === "string" && allowed.has(p.value)
      )
      .map((p) => ({ value: p.value, probability: p.probability })),
  };
}

function scoreAnswer(
  question: Extract<DecisionQuestion, { type: "score" }>,
  entry: AnswerEnvelope
): DecisionAnswer {
  const top = question.levels.length - 1;
  if (typeof entry.score !== "number" || entry.score > top) {
    return refusal(question.name, "score outside the rubric levels");
  }
  return {
    type: "score",
    name: question.name,
    score: entry.score,
    confidence: confidenceOf(entry),
    probabilities: (entry.probabilities ?? []).map((p, i) => ({
      value: typeof p.value === "number" ? p.value : i,
      label: p.label ?? question.levels[i]?.label ?? String(i),
      probability: p.probability,
    })),
  };
}

/**
 * Maps a validated envelope onto the questions asked: every question gets an
 * answer (a missing or unreadable one becomes a refusal, so callers treat it
 * as "no signal"); answers to questions we did not ask are ignored.
 */
export function answersFor(
  questions: readonly DecisionQuestion[],
  envelope: DecisionsResponseEnvelope
): DecisionAnswer[] {
  const byName = new Map(envelope.answers.map((entry) => [entry.name, entry]));
  return questions.map((question) => {
    const entry = byName.get(question.name);
    if (!entry) {
      return refusal(question.name, "no answer returned");
    }
    if (entry.type === "refusal" || typeof entry.refusal === "string") {
      return refusal(question.name, entry.refusal ?? "refused");
    }
    switch (question.type) {
      case "predicate":
        return typeof entry.probability === "number"
          ? {
              type: "predicate",
              name: question.name,
              probability: entry.probability,
            }
          : refusal(question.name, "predicate without a probability");
      case "choice":
        return choiceAnswer(question, entry);
      default:
        return scoreAnswer(question, entry);
    }
  });
}
