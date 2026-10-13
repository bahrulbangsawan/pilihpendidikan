// The deterministic fake AI provider (`JOBS_AI_MODE=fake`): dev, tests and e2e
// never touch the network. Same input ⇒ same output, with realistic usage and
// cost (estimated exactly like the live provider, so the D-34 budget behaves
// as in production), and the same request limits (19 §1.1).
//
// Answers, in order of precedence:
//   1. `options.answer(question, request)` / `options.structured[name]`:
//      test scripts;
//   2. the request's own `fake` hook: the domain methods (compose.ts) attach
//      input-dependent heuristics (fake-answers.ts): page kinds from page
//      markers, next actions from candidate role hints, question matches from
//      word overlap, verification from confirmation / error markers, fit
//      scores from skill and title overlap, field plans that only cite the
//      facts and answers the server supplied;
//   3. the conservative default: predicate 0, the first choice, the middle
//      score level; structured output without a fixture is a refusal (the
//      fake never invents content).

import type {
  AiPrimitives,
  DecisionAnswer,
  DecisionQuestion,
  DecisionRequest,
  DecisionResponse,
  StructuredRequest,
  StructuredResponse,
} from "./primitives";
import {
  AI_MODELS,
  AiProviderError,
  assertDecisionRequest,
  estimateDecisionTokens,
  estimateTokens,
  usageOf,
} from "./primitives";

export interface FakeAiOptions {
  /** Scripted answer for a question; undefined → the request's fake hook. */
  answer?: (
    question: DecisionQuestion,
    request: DecisionRequest
  ) => DecisionAnswer | undefined;
  /** Make every call fail with this error kind (retry / DLQ tests). */
  fail?:
    | "rate_limited"
    | "upstream"
    | "timeout"
    | "bad_request"
    | "invalid_output"
    | "unavailable";
  /** Called with every request (assertions on what would be sent). */
  onDecide?: (request: DecisionRequest) => void;
  onStructured?: (request: StructuredRequest<unknown>) => void;
  /** Scripted structured output by schema name (a function sees the request). */
  structured?: Record<
    string,
    unknown | ((request: StructuredRequest<unknown>) => unknown)
  >;
}

/** The conservative default answer of a question. */
export function defaultFakeAnswer(question: DecisionQuestion): DecisionAnswer {
  switch (question.type) {
    case "predicate":
      return { type: "predicate", name: question.name, probability: 0 };
    case "choice": {
      const first = question.choices[0]?.value ?? "";
      return {
        type: "choice",
        name: question.name,
        choice: first,
        confidence: 1,
        probabilities: question.choices.map((c) => ({
          value: c.value,
          probability: c.value === first ? 1 : 0,
        })),
      };
    }
    default: {
      const middle = Math.floor((question.levels.length - 1) / 2);
      return {
        type: "score",
        name: question.name,
        score: middle,
        confidence: 1,
        probabilities: question.levels.map((level, i) => ({
          value: i,
          label: level.label,
          probability: i === middle ? 1 : 0,
        })),
      };
    }
  }
}

function maybeFail(options: FakeAiOptions): void {
  if (options.fail) {
    throw new AiProviderError(options.fail, `fake provider: ${options.fail}`);
  }
}

export function createFakePrimitives(
  options: FakeAiOptions = {}
): AiPrimitives {
  return {
    id: "fake",
    async decide(request: DecisionRequest): Promise<DecisionResponse> {
      await Promise.resolve();
      assertDecisionRequest(request);
      options.onDecide?.(request);
      maybeFail(options);
      const model = request.model ?? AI_MODELS.decisions;
      return {
        id: null,
        model,
        answers: request.questions.map(
          (question) =>
            options.answer?.(question, request) ??
            request.fake?.(question) ??
            defaultFakeAnswer(question)
        ),
        usage: usageOf(model, estimateDecisionTokens(request), 0),
      };
    },
    async structured<T>(
      request: StructuredRequest<T>
    ): Promise<StructuredResponse<T>> {
      await Promise.resolve();
      options.onStructured?.(request as StructuredRequest<unknown>);
      maybeFail(options);
      const model = request.model ?? AI_MODELS.structured;
      const scripted = options.structured?.[request.name];
      const candidate =
        typeof scripted === "function"
          ? (scripted as (r: StructuredRequest<unknown>) => unknown)(
              request as StructuredRequest<unknown>
            )
          : (scripted ?? request.fake?.());
      const inputTokens = estimateTokens(
        `${request.instructions}\n${request.input}`
      );
      if (candidate === undefined) {
        return {
          model,
          output: null,
          refusal: `The fake AI provider has no fixture for "${request.name}".`,
          usage: usageOf(model, inputTokens, 0),
        };
      }
      const parsed = request.validator.safeParse(candidate);
      if (!parsed.success) {
        throw new AiProviderError(
          "invalid_output",
          `fake structured output for "${request.name}" fails its schema`
        );
      }
      return {
        model,
        output: parsed.data,
        refusal: null,
        usage: usageOf(
          model,
          inputTokens,
          estimateTokens(JSON.stringify(parsed.data))
        ),
      };
    },
  };
}
