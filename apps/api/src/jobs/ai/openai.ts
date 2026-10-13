// Live OpenAI primitives (D-12): the Decisions API and the Responses API with
// Structured Outputs, over plain `fetch` (no SDK in the Worker bundle).
//
//   decide      POST {base}/v1/decisions   model gpt-6-luna, 10 s timeout;
//                                          input = string or user messages
//                                          with input_text / input_image
//                                          (base64 data URLs only)
//   structured  POST {base}/v1/responses   strict json_schema, store: false,
//                                          tools: [], 60 s timeout
//
// `OPENAI_API_KEY` is a secret only this module reads; `OPENAI_BASE_URL`
// selects a data-residency endpoint (07 §8). Prompts and responses are never
// logged (11 §8.6). Status mapping: 429 → rate_limited, 5xx → upstream, 408 /
// network / abort → timeout (all retryable); 400/422 and other 4xx →
// bad_request; 401/403/404 → unavailable (key or endpoint wrong; A-01); a body
// that does not match the envelope (primitives.ts) or the caller's Zod schema
// → invalid_output (not retryable, 14 §6).
//
// Usage: Decisions bills input tokens only ($0.10 / 1M); when the envelope
// carries no `usage` the input is estimated as ceil(chars / 4) plus 1.5k per
// image (07 §9, A-01). Responses usage is read from `usage`; a missing figure
// is estimated the same way.

import type { Env } from "../../env";
import type {
  AiPrimitives,
  DecisionRequest,
  DecisionResponse,
  StructuredRequest,
  StructuredResponse,
} from "./primitives";
import {
  AI_MODELS,
  AiProviderError,
  answersFor,
  assertDecisionRequest,
  DECISIONS_TIMEOUT_MS,
  DecisionsResponseEnvelopeSchema,
  estimateDecisionTokens,
  estimateTokens,
  RESPONSES_TIMEOUT_MS,
  ResponsesEnvelopeSchema,
  usageOf,
} from "./primitives";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const TRAILING_SLASH_RE = /\/+$/;
const DETAIL_MAX = 200;

function retryAfter(response: Response): number | null {
  const value = response.headers.get("Retry-After");
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

function errorForStatus(response: Response, detail: string): AiProviderError {
  const status = response.status;
  if (status === 429) {
    return new AiProviderError(
      "rate_limited",
      `OpenAI rate limit: ${detail}`,
      status,
      retryAfter(response)
    );
  }
  if (status >= 500) {
    return new AiProviderError(
      "upstream",
      `OpenAI ${status}: ${detail}`,
      status
    );
  }
  if (status === 408) {
    return new AiProviderError("timeout", "OpenAI request timed out", status);
  }
  if (status === 401 || status === 403 || status === 404) {
    return new AiProviderError(
      "unavailable",
      `OpenAI rejected the request (${status}): ${detail}`,
      status
    );
  }
  return new AiProviderError(
    "bad_request",
    `OpenAI ${status}: ${detail}`,
    status
  );
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    // Error messages may quote the request; keep a short prefix only.
    const message = parsed.error?.code ?? parsed.error?.message ?? "";
    return message.slice(0, DETAIL_MAX) || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function post(
  doFetch: typeof fetch,
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number
): Promise<unknown> {
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AiProviderError(
      "timeout",
      `OpenAI request failed: ${err instanceof Error ? err.name : "network error"}`
    );
  }
  if (!response.ok) {
    throw errorForStatus(response, await errorDetail(response));
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AiProviderError("invalid_output", "OpenAI returned non-JSON");
  }
}

/** The Decisions request body exactly as sent (07 §4.1, 19 §4.1, §5.2). */
export function decisionsBody(request: DecisionRequest): {
  input: DecisionRequest["input"];
  model: string;
  questions: DecisionRequest["questions"];
} {
  return {
    model: request.model ?? AI_MODELS.decisions,
    input: request.input,
    questions: request.questions,
  };
}

/** The Responses request body exactly as sent (19 §1.2, §6.1, 08 §4.3). */
export function responsesBody(request: StructuredRequest<unknown>): {
  input: string;
  instructions: string;
  max_output_tokens?: number;
  model: string;
  store: false;
  text: {
    format: {
      name: string;
      schema: Record<string, unknown>;
      strict: true;
      type: "json_schema";
    };
  };
  tools: [];
} {
  return {
    model: request.model ?? AI_MODELS.structured,
    store: false,
    tools: [],
    instructions: request.instructions,
    input: request.input,
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: request.maxOutputTokens }),
    text: {
      format: {
        type: "json_schema",
        name: request.name,
        schema: request.schema,
        strict: true,
      },
    },
  };
}

function outputParts(
  envelope: ReturnType<typeof ResponsesEnvelopeSchema.parse>
): Array<{ refusal?: string; text?: string; type: string }> {
  return (envelope.output ?? []).flatMap((item) => item.content ?? []);
}

export function createOpenAiPrimitives(
  env: Pick<Env, "OPENAI_API_KEY" | "OPENAI_BASE_URL">,
  doFetch: typeof fetch = fetch
): AiPrimitives {
  const base = (env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL).replace(
    TRAILING_SLASH_RE,
    ""
  );
  const apiKey = (): string => {
    const key = env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new AiProviderError(
        "unavailable",
        "OPENAI_API_KEY is not configured"
      );
    }
    return key;
  };
  return {
    id: "openai",
    async decide(request: DecisionRequest): Promise<DecisionResponse> {
      assertDecisionRequest(request);
      const body = decisionsBody(request);
      const raw = await post(
        doFetch,
        `${base}/v1/decisions`,
        apiKey(),
        body,
        DECISIONS_TIMEOUT_MS
      );
      const parsed = DecisionsResponseEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new AiProviderError(
          "invalid_output",
          "Decisions response does not match the expected envelope"
        );
      }
      const usage = parsed.data.usage ?? {};
      return {
        id: parsed.data.id ?? null,
        model: body.model,
        answers: answersFor(request.questions, parsed.data),
        usage: usageOf(
          body.model,
          usage.input_tokens ?? estimateDecisionTokens(request),
          // Decisions bills no output tokens (19 §1.1).
          0
        ),
      };
    },
    async structured<T>(
      request: StructuredRequest<T>
    ): Promise<StructuredResponse<T>> {
      const body = responsesBody(request as StructuredRequest<unknown>);
      const raw = await post(
        doFetch,
        `${base}/v1/responses`,
        apiKey(),
        body,
        RESPONSES_TIMEOUT_MS
      );
      const parsed = ResponsesEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new AiProviderError(
          "invalid_output",
          "Responses body does not match the expected envelope"
        );
      }
      const envelope = parsed.data;
      if (envelope.status === "failed" || envelope.error) {
        throw new AiProviderError("upstream", "Responses call failed");
      }
      const parts = outputParts(envelope);
      const text = parts.find((part) => part.type === "output_text")?.text;
      const usage = usageOf(
        body.model,
        envelope.usage?.input_tokens ??
          estimateTokens(`${request.instructions}\n${request.input}`),
        envelope.usage?.output_tokens ?? estimateTokens(text ?? "")
      );
      const refusal = parts.find((part) => part.type === "refusal");
      if (refusal) {
        return {
          model: body.model,
          output: null,
          refusal: refusal.refusal ?? "refused",
          usage,
        };
      }
      if (envelope.status === "incomplete") {
        throw new AiProviderError(
          "invalid_output",
          `Responses output incomplete (${envelope.incomplete_details?.reason ?? "unknown"})`
        );
      }
      if (typeof text !== "string") {
        throw new AiProviderError(
          "invalid_output",
          "Responses output has no text"
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiProviderError(
          "invalid_output",
          "Responses output is not JSON"
        );
      }
      const output = request.validator.safeParse(json);
      if (!output.success) {
        throw new AiProviderError(
          "invalid_output",
          `Responses output does not match "${request.name}"`
        );
      }
      return { model: body.model, output: output.data, refusal: null, usage };
    },
  };
}
