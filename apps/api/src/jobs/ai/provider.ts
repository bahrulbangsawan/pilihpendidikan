// The AI provider abstraction (19 §12, D-12, D-13). Only src/jobs/ai/** talks
// to a model; everything else calls an `AiProvider`.
//
// Two generic primitives carry every call:
//   decide(request)      OpenAI Decisions API (`POST /v1/decisions`,
//                        `gpt-6-luna`): predicate / choice / score questions,
//                        typed answers with probabilities, refusals.
//   structured(request)  OpenAI Responses API Structured Outputs
//                        (`POST /v1/responses`, strict JSON schema,
//                        `store: false`, `tools: []`): generated objects,
//                        validated with Zod before they leave the provider.
// The six domain methods of 19 §12 (classifyPage, chooseAction,
// matchQuestions, planFields, verifySubmission, scorePosting) are built on
// those primitives in compose.ts, so a provider implements two functions.
//
// `getAiProvider(env)` returns the deterministic fake when
// `JOBS_AI_MODE=fake` (dev, tests: never the network), else the live provider
// `JOBS_AI_PROVIDER` names: "openai" (default, openai.ts) or "openrouter"
// (openrouter.ts: Chat Completions with the Decisions API emulated, ZDR
// routing). Every result carries `usage` (tokens + cost in micro-USD) and
// `calls` (provider requests made) for the D-34 budget
// (src/jobs/repo/core/ai-usage.ts).
//
// Errors are `AiProviderError` (primitives.ts): `retryable` ones (429, 5xx,
// timeouts, network) become `503 upstream_unavailable` on synchronous routes
// and `message.retry()` in the queue; the others fail the operation.
//
// What callers must do themselves (the provider does not): check the
// `AI_DISABLED` flag, the user's AI consent and the budget before a call, and
// record `usage` afterwards in the same batch as the result.

import type {
  CandidateAction,
  FieldPlan,
  PageKind,
  PageObservation,
} from "@pilihpendidikan/jobs-contracts/agent";
import type {
  AnswerKind,
  AutoUse,
  Sensitivity,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { ScoringProfile } from "@pilihpendidikan/jobs-contracts/scoring";
import type { Env } from "../../env";
import { composeProvider } from "./compose";
import type { FakeAiOptions } from "./fake";
import { createFakePrimitives } from "./fake";
import { createOpenAiPrimitives } from "./openai";
import type { OpenRouterEnv } from "./openrouter";
import { createOpenRouterPrimitives } from "./openrouter";
import type { AiPrimitives, AiUsage } from "./primitives";

// ---------------------------------------------------------------------------
// Domain methods (19 §12)
// ---------------------------------------------------------------------------

export interface ClassifyInput {
  observation: PageObservation;
  /** Attach the observation's screenshot (19 §4.3: retry or verification). */
  withScreenshot?: boolean;
}

export interface ClassifyResult {
  calls: number;
  confidence: number;
  form_requires_upload: number | null;
  injection_suspected: number | null;
  page_kind: PageKind;
  probabilities: Partial<Record<PageKind, number>>;
  refused: string[];
  usage: AiUsage;
}

/** The page context of a next-action call (from the step's observation). */
export interface ChoosePage {
  title: string;
  url: string;
  visible_text_excerpt: string;
}

export interface ChooseInput {
  candidates: CandidateAction[];
  /** Fixed-template description per candidate id (19 §5.2). */
  descriptions: Record<string, string>;
  /** null when the server no longer holds the step's observation. */
  observation: ChoosePage | null;
  pageKind: PageKind;
  state: { errors: number; required_remaining: number; step: number };
}

export interface ChoiceResult {
  calls: number;
  /** A candidate id, "pause" or "stop". */
  choice: string;
  confidence: number | null;
  refused: boolean;
  usage: AiUsage;
}

export interface QuestionMatchInput {
  /** The user's saved question keys (≤ 38 per request, 19 §6.2). */
  keys: Array<{ description: string; value: string }>;
  questions: Array<{ id: string; options?: string[]; text: string }>;
}

export interface QuestionMatch {
  confidence: number | null;
  id: string;
  /** Matched key, or null for "none" / refusal. */
  question_key: string | null;
  refused: boolean;
}

export interface QuestionMatchResult {
  calls: number;
  matches: QuestionMatch[];
  usage: AiUsage;
}

/** One fact of the trusted block (`key | value | source`, 19 §6.1). */
export interface PlanFact {
  key: string;
  sensitivity: Sensitivity;
  source: string;
  /** Rendered value (text). */
  value: string;
}

/** One answer of the trusted block (19 §6.1). */
export interface PlanAnswer {
  answer: string;
  answer_kind: AnswerKind;
  auto_use: AutoUse;
  id: string;
  patterns: string[];
  question_key: string;
  sensitivity: Sensitivity;
}

/** An answer whose existence is reported but whose value is not sent. */
export interface WithheldAnswer {
  question_key: string;
  reason: "never" | "protected";
}

/** The server-built trusted context of a field plan (19 §6.1, 11 §11). */
export interface FieldPlanContext {
  answers: PlanAnswer[];
  facts: PlanFact[];
  fileSlots: { cover_letter_file: boolean; cv_file: boolean };
  generatedTextAllowed: boolean;
  /** Question → answer-bank matches at ≥ 0.80 (binding hints, 19 §6.2). */
  hints: Array<{ answer_id: string; question_key: string; ref: string }>;
  /** Fact keys that exist but are not sent (protected values). */
  withheldFacts: string[];
  withheldAnswers: WithheldAnswer[];
}

export interface FieldPlanInput {
  /** 1 = default model, 2 = escalation model (19 §6.1). */
  attempt: 1 | 2;
  context: FieldPlanContext;
  observation: PageObservation;
}

export interface FieldPlanResult {
  calls: number;
  model: string;
  plan: FieldPlan | null;
  refusal: string | null;
  usage: AiUsage;
}

export interface VerifyInput {
  final_url: string;
  page_title: string;
  /** Inline base64 data URL (Decisions accepts no hosted images). */
  screenshotDataUrl?: string | null;
  text_excerpt: string;
}

export interface VerifyResult {
  application_received: number | null;
  calls: number;
  refused: string[];
  still_form_or_error: number | null;
  usage: AiUsage;
}

/** The posting fields the AI rubric sees (07 §2.2): no URLs, no HTML. */
export interface ScorePostingView {
  department?: string | null;
  description_text: string;
  employment_type?: string | null;
  locations: string[];
  requirements: string[];
  seniority?: string | null;
  title: string;
  workplace_type?: string | null;
}

export interface ScoreInput {
  /** false ⇒ the work-authorization predicate is not asked (07 §8). */
  askSensitive: boolean;
  posting: ScorePostingView;
  /** The AI view of the profile (`aiProfileView`), never identity. */
  profile: ScoringProfile;
}

export interface ScoreResult {
  calls: number;
  overall_fit: { confidence: number | null; score: number } | null;
  predicates: {
    requires_degree_user_lacks: number | null;
    requires_onsite_outside_user_locations: number | null;
    requires_unavailable_work_authorization?: number | null;
  };
  refused: string[];
  usage: AiUsage;
}

export interface AiProvider extends AiPrimitives {
  chooseAction(input: ChooseInput): Promise<ChoiceResult>;
  classifyPage(input: ClassifyInput): Promise<ClassifyResult>;
  matchQuestions(input: QuestionMatchInput): Promise<QuestionMatchResult>;
  planFields(input: FieldPlanInput): Promise<FieldPlanResult>;
  scorePosting(input: ScoreInput): Promise<ScoreResult>;
  verifySubmission(input: VerifyInput): Promise<VerifyResult>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface AiProviderOptions {
  /** Test hooks for the fake provider. */
  fake?: FakeAiOptions;
  /** `fetch` used by the live provider (tests may stub it). */
  fetch?: typeof fetch;
}

/** "fake" when JOBS_AI_MODE=fake, else "live". */
export function aiMode(env: Pick<Env, "JOBS_AI_MODE">): "fake" | "live" {
  return env.JOBS_AI_MODE?.trim().toLowerCase() === "fake" ? "fake" : "live";
}

/** The live provider: "openrouter" when JOBS_AI_PROVIDER says so, else "openai". */
export function liveAiProvider(
  env: Pick<Env, "JOBS_AI_PROVIDER">
): "openai" | "openrouter" {
  return env.JOBS_AI_PROVIDER?.trim().toLowerCase() === "openrouter"
    ? "openrouter"
    : "openai";
}

/** The provider for this environment (19 §12). */
export function getAiProvider(
  env: Pick<
    Env,
    "JOBS_AI_MODE" | "JOBS_AI_PROVIDER" | "OPENAI_API_KEY" | "OPENAI_BASE_URL"
  > &
    OpenRouterEnv,
  options: AiProviderOptions = {}
): AiProvider {
  if (aiMode(env) === "fake") {
    return composeProvider(createFakePrimitives(options.fake));
  }
  if (liveAiProvider(env) === "openrouter") {
    return composeProvider(createOpenRouterPrimitives(env, options.fetch));
  }
  return composeProvider(createOpenAiPrimitives(env, options.fetch));
}
