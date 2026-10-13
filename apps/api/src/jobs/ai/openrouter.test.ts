import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { fieldPlanRequest } from "./compose";
import {
  createOpenRouterPrimitives,
  DECIDE_SYSTEM_PROMPT,
  OPENROUTER_DEFAULT_MODELS,
  openRouterModel,
} from "./openrouter";
import type { DecisionRequest } from "./primitives";
import {
  AI_MODELS,
  AiProviderError,
  DECISIONS_TIMEOUT_MS,
  RESPONSES_TIMEOUT_MS,
} from "./primitives";
import { getAiProvider } from "./provider";

interface Sent {
  body: Record<string, unknown>;
  headers: Headers;
  signal: AbortSignal | null | undefined;
  url: string;
}

function stubFetch(
  respond: (body: Record<string, unknown>) => Response | Promise<Response>
): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({
      url,
      body,
      headers: new Headers(init.headers),
      signal: init.signal,
    });
    return await respond(body);
  }) as unknown as typeof fetch;
  return { fetch: fn, sent };
}

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) => new Response(JSON.stringify(body), { status, headers });

function contentOf(content: unknown): string | null {
  if (content === null || typeof content === "string") {
    return content;
  }
  return JSON.stringify(content);
}

function completion(
  content: unknown,
  extra: {
    finish_reason?: string;
    refusal?: string;
    usage?: Record<string, unknown>;
  } = {}
) {
  return {
    id: "gen-1",
    model: "openai/gpt-6-luna",
    choices: [
      {
        finish_reason: extra.finish_reason ?? "stop",
        message: {
          role: "assistant",
          content: contentOf(content),
          refusal: extra.refusal ?? null,
        },
      },
    ],
    usage: extra.usage ?? {
      prompt_tokens: 400,
      completion_tokens: 20,
      cost: 0.000_123,
    },
  };
}

const ENV = { OPENROUTER_API_KEY: "sk-or-test" };
const PNG = "data:image/png;base64,iVBORw0KGgo=";

const mixedRequest: DecisionRequest = {
  input: "Thank you for applying!",
  questions: [
    { type: "predicate", name: "received", instructions: "Received?" },
    {
      type: "choice",
      name: "page_kind",
      instructions: "Which page?",
      choices: [
        { value: "form", description: "A form" },
        { value: "confirmation", description: "A confirmation" },
      ],
    },
    {
      type: "score",
      name: "fit",
      instructions: "How good?",
      levels: [
        { label: "poor", description: "Poor" },
        { label: "ok", description: "OK" },
        { label: "great", description: "Great" },
      ],
    },
  ],
};

async function errorOf(promise: Promise<unknown>): Promise<AiProviderError> {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AiProviderError);
  return err as AiProviderError;
}

describe("OpenRouter provider selection and models", () => {
  it("selects OpenRouter with JOBS_AI_PROVIDER=openrouter; fake still wins", () => {
    expect(
      getAiProvider({ JOBS_AI_MODE: "live", JOBS_AI_PROVIDER: "openrouter" }).id
    ).toBe("openrouter");
    expect(
      getAiProvider({ JOBS_AI_MODE: "live", JOBS_AI_PROVIDER: " OpenRouter " })
        .id
    ).toBe("openrouter");
    expect(
      getAiProvider({ JOBS_AI_MODE: "fake", JOBS_AI_PROVIDER: "openrouter" }).id
    ).toBe("fake");
    expect(
      getAiProvider({ JOBS_AI_MODE: "live", JOBS_AI_PROVIDER: "openai" }).id
    ).toBe("openai");
    expect(getAiProvider({ JOBS_AI_MODE: "live" }).id).toBe("openai");
  });

  it("maps AI_MODELS onto the OpenRouter models, escalation included", () => {
    expect(openRouterModel({}, undefined, "decisions")).toBe(
      OPENROUTER_DEFAULT_MODELS.decisions
    );
    expect(openRouterModel({}, undefined, "structured")).toBe(
      OPENROUTER_DEFAULT_MODELS.structured
    );
    expect(
      openRouterModel({}, AI_MODELS.structuredEscalation, "structured")
    ).toBe(OPENROUTER_DEFAULT_MODELS.structuredEscalation);
    const env = {
      OPENROUTER_MODEL_DECISIONS: "x/dec",
      OPENROUTER_MODEL_STRUCTURED: "x/str",
      OPENROUTER_MODEL_ESCALATION: "x/esc",
    };
    expect(openRouterModel(env, AI_MODELS.decisions, "decisions")).toBe(
      "x/dec"
    );
    expect(openRouterModel(env, AI_MODELS.structured, "structured")).toBe(
      "x/str"
    );
    expect(
      openRouterModel(env, AI_MODELS.structuredEscalation, "structured")
    ).toBe("x/esc");
    expect(openRouterModel(env, "anthropic/claude-x", "structured")).toBe(
      "anthropic/claude-x"
    );
    expect(openRouterModel(env, "gpt-9", "structured")).toBe("openai/gpt-9");
  });

  it("the field-plan escalation attempt calls the escalation model", async () => {
    const stub = stubFetch(() => json(200, completion({ fields: [] })));
    const ai = createOpenRouterPrimitives(ENV, stub.fetch);
    const request = fieldPlanRequest({
      attempt: 2,
      observation: {
        url: "https://example.com",
        title: "Apply",
        fields: [],
      } as never,
      context: {
        answers: [],
        facts: [],
        fileSlots: { cover_letter_file: false, cv_file: false },
        generatedTextAllowed: false,
        hints: [],
        withheldAnswers: [],
        withheldFacts: [],
      },
    });
    await ai
      .structured({ ...request, validator: z.unknown() })
      .catch(() => null);
    expect(stub.sent[0]?.body.model).toBe(
      OPENROUTER_DEFAULT_MODELS.structuredEscalation
    );
  });
});

describe("OpenRouter structured()", () => {
  const request = {
    name: "thing",
    schema: {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
    },
    validator: z.object({ a: z.string() }),
    instructions: "Be precise.",
    input: "untrusted text",
    maxOutputTokens: 300,
  };

  it("sends the chat body with the privacy block, headers and no store", async () => {
    const stub = stubFetch(() => json(200, completion({ a: "ok" })));
    const ai = createOpenRouterPrimitives(ENV, stub.fetch);
    const result = await ai.structured(request);
    expect(result.output).toEqual({ a: "ok" });
    expect(result.refusal).toBeNull();
    const sent = stub.sent[0];
    expect(sent?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent?.headers.get("Authorization")).toBe("Bearer sk-or-test");
    expect(sent?.headers.get("HTTP-Referer")).toBe(
      "https://jobs.pilihpendidikan.com"
    );
    expect(sent?.headers.get("X-Title")).toBe("Pilih Jobs");
    expect(sent?.body).toEqual({
      model: OPENROUTER_DEFAULT_MODELS.structured,
      messages: [
        { role: "system", content: "Be precise." },
        { role: "user", content: "untrusted text" },
      ],
      max_tokens: 300,
      response_format: {
        type: "json_schema",
        json_schema: { name: "thing", strict: true, schema: request.schema },
      },
      provider: {
        data_collection: "deny",
        zdr: true,
        require_parameters: true,
      },
    });
    expect("store" in (sent?.body ?? {})).toBe(false);
    expect(sent?.signal).toBeDefined();
    expect(RESPONSES_TIMEOUT_MS).toBe(60_000);
  });

  it("reads usage tokens and the reported cost (USD → micro-USD)", async () => {
    const stub = stubFetch(() => json(200, completion({ a: "ok" })));
    const result = await createOpenRouterPrimitives(ENV, stub.fetch).structured(
      request
    );
    expect(result.usage).toEqual({
      model: OPENROUTER_DEFAULT_MODELS.structured,
      input_tokens: 400,
      output_tokens: 20,
      cost_micro_usd: 123,
    });
  });

  it("estimates the cost when OpenRouter reports none", async () => {
    const stub = stubFetch(() =>
      json(
        200,
        completion(
          { a: "ok" },
          { usage: { prompt_tokens: 1000, completion_tokens: 1000 } }
        )
      )
    );
    const result = await createOpenRouterPrimitives(ENV, stub.fetch).structured(
      request
    );
    // gpt-6.1-sol: $2 / $10 per 1M.
    expect(result.usage.cost_micro_usd).toBe(12_000);
  });

  it("maps message.refusal to a refusal result", async () => {
    const stub = stubFetch(() =>
      json(200, completion(null, { refusal: "I can't help with that." }))
    );
    const result = await createOpenRouterPrimitives(ENV, stub.fetch).structured(
      request
    );
    expect(result.output).toBeNull();
    expect(result.refusal).toBe("I can't help with that.");
  });

  it("finish_reason length, non-JSON and schema mismatch are invalid_output", async () => {
    const cases = [
      completion('{"a": "trunc', { finish_reason: "length" }),
      completion("not json"),
      completion({ b: 1 }),
    ];
    for (const body of cases) {
      const stub = stubFetch(() => json(200, body));
      const err = await errorOf(
        createOpenRouterPrimitives(ENV, stub.fetch).structured(request)
      );
      expect(err.kind).toBe("invalid_output");
      expect(err.retryable).toBe(false);
    }
  });

  it("an error object in a 200 body is upstream", async () => {
    const stub = stubFetch(() =>
      json(200, { error: { code: 502, message: "provider down" } })
    );
    const err = await errorOf(
      createOpenRouterPrimitives(ENV, stub.fetch).structured(request)
    );
    expect(err.kind).toBe("upstream");
  });
});

describe("OpenRouter decide() (Decisions emulation)", () => {
  it("builds one strict schema per question and round-trips through answersFor", async () => {
    const stub = stubFetch(() =>
      json(
        200,
        completion({
          received: { probability: 0.91 },
          page_kind: { choice: "confirmation" },
          fit: { score: 2 },
        })
      )
    );
    const ai = createOpenRouterPrimitives(ENV, stub.fetch);
    const result = await ai.decide(mixedRequest);
    expect(result.answers).toEqual([
      { type: "predicate", name: "received", probability: 0.91 },
      {
        type: "choice",
        name: "page_kind",
        choice: "confirmation",
        confidence: null,
        probabilities: [],
      },
      {
        type: "score",
        name: "fit",
        score: 2,
        confidence: null,
        probabilities: [],
      },
    ]);
    expect(result.id).toBe("gen-1");
    expect(result.model).toBe(OPENROUTER_DEFAULT_MODELS.decisions);
    expect(result.usage.cost_micro_usd).toBe(123);
    const body = stub.sent[0]?.body as {
      messages: Array<{ content: unknown; role: string }>;
      model: string;
      provider: unknown;
      response_format: {
        json_schema: { name: string; schema: unknown; strict: boolean };
      };
    };
    expect(body.model).toBe(OPENROUTER_DEFAULT_MODELS.decisions);
    expect(body.provider).toEqual({
      data_collection: "deny",
      zdr: true,
      require_parameters: true,
    });
    expect("store" in body).toBe(false);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toEqual({
      type: "object",
      properties: {
        received: {
          type: "object",
          properties: {
            probability: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["probability"],
          additionalProperties: false,
        },
        page_kind: {
          type: "object",
          properties: {
            choice: { type: "string", enum: ["form", "confirmation"] },
          },
          required: ["choice"],
          additionalProperties: false,
        },
        fit: {
          type: "object",
          properties: { score: { type: "integer", enum: [0, 1, 2] } },
          required: ["score"],
          additionalProperties: false,
        },
      },
      required: ["received", "page_kind", "fit"],
      additionalProperties: false,
    });
    const system = String(body.messages[0]?.content);
    expect(body.messages[0]?.role).toBe("system");
    expect(system.startsWith(DECIDE_SYSTEM_PROMPT)).toBe(true);
    expect(system).toContain("untrusted");
    expect(system).toContain("- confirmation: A confirmation");
    expect(system).toContain("- 2 (great): Great");
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "Thank you for applying!",
    });
    expect(DECISIONS_TIMEOUT_MS).toBe(10_000);
  });

  it("missing or invalid answers become refusals, as with Decisions", async () => {
    const stub = stubFetch(() =>
      json(
        200,
        completion({
          received: { probability: 1.7 },
          page_kind: { choice: "elsewhere" },
        })
      )
    );
    const result = await createOpenRouterPrimitives(ENV, stub.fetch).decide(
      mixedRequest
    );
    expect(result.answers.map((answer) => answer.type)).toEqual([
      "refusal",
      "refusal",
      "refusal",
    ]);
    expect(result.answers[1]).toEqual({
      type: "refusal",
      name: "page_kind",
      refusal: "choice outside the supplied values",
    });
    expect(result.answers[2]).toEqual({
      type: "refusal",
      name: "fit",
      refusal: "no answer returned",
    });
  });

  it("a model refusal refuses every question", async () => {
    const stub = stubFetch(() =>
      json(200, completion(null, { refusal: "No." }))
    );
    const result = await createOpenRouterPrimitives(ENV, stub.fetch).decide(
      mixedRequest
    );
    expect(result.answers).toEqual([
      { type: "refusal", name: "received", refusal: "No." },
      { type: "refusal", name: "page_kind", refusal: "No." },
      { type: "refusal", name: "fit", refusal: "No." },
    ]);
  });

  it("finish_reason length is invalid_output", async () => {
    const stub = stubFetch(() =>
      json(200, completion('{"received":', { finish_reason: "length" }))
    );
    const err = await errorOf(
      createOpenRouterPrimitives(ENV, stub.fetch).decide(mixedRequest)
    );
    expect(err.kind).toBe("invalid_output");
  });

  it("passes images as image_url parts and enforces the Decisions limits", async () => {
    const stub = stubFetch(() =>
      json(200, completion({ received: { probability: 0.2 } }))
    );
    const ai = createOpenRouterPrimitives(ENV, stub.fetch);
    await ai.decide({
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Page text" },
            { type: "input_image", image_url: PNG },
          ],
        },
      ],
      questions: [mixedRequest.questions[0] as DecisionRequest["questions"][0]],
    });
    const messages = stub.sent[0]?.body.messages as Array<{ content: unknown }>;
    expect(messages[1]?.content).toEqual([
      { type: "text", text: "Page text" },
      { type: "image_url", image_url: { url: PNG } },
    ]);

    const hosted = await errorOf(
      ai.decide({
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: "https://example.com/a.png" },
            ],
          },
        ],
        questions: mixedRequest.questions,
      })
    );
    expect(hosted.kind).toBe("bad_request");
    const twoImages = await errorOf(
      ai.decide({
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: PNG },
              { type: "input_image", image_url: PNG },
            ],
          },
        ],
        questions: mixedRequest.questions,
      })
    );
    expect(twoImages.kind).toBe("bad_request");
    expect(stub.sent).toHaveLength(1);
  });
});

describe("OpenRouter errors", () => {
  it("maps statuses like openai.ts, 402 → unavailable", async () => {
    const cases: [number, string, boolean][] = [
      [429, "rate_limited", true],
      [500, "upstream", true],
      [503, "upstream", true],
      [408, "timeout", true],
      [401, "unavailable", false],
      [402, "unavailable", false],
      [403, "unavailable", false],
      [404, "unavailable", false],
      [400, "bad_request", false],
      [422, "bad_request", false],
    ];
    for (const [status, kind, retryable] of cases) {
      const stub = stubFetch(() =>
        json(
          status,
          { error: { code: status, message: "secret prompt text" } },
          status === 429 ? { "Retry-After": "7" } : {}
        )
      );
      const err = await errorOf(
        createOpenRouterPrimitives(ENV, stub.fetch).decide(mixedRequest)
      );
      expect(err.kind).toBe(kind as AiProviderError["kind"]);
      expect(err.retryable).toBe(retryable);
      expect(err.status).toBe(status);
      expect(err.message).not.toContain("secret prompt text");
      if (status === 429) {
        expect(err.retryAfterSeconds).toBe(7);
      }
    }
  });

  it("network failure / abort is a retryable timeout", async () => {
    const fn = (() => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    const err = await errorOf(
      createOpenRouterPrimitives(ENV, fn).decide(mixedRequest)
    );
    expect(err.kind).toBe("timeout");
    expect(err.retryable).toBe(true);
  });

  it("a missing key is unavailable and sends nothing", async () => {
    const stub = stubFetch(() => json(200, completion({})));
    const ai = createOpenRouterPrimitives(
      { OPENROUTER_API_KEY: " " },
      stub.fetch
    );
    expect((await errorOf(ai.decide(mixedRequest))).kind).toBe("unavailable");
    expect(
      (
        await errorOf(
          ai.structured({
            name: "x",
            schema: {},
            validator: z.unknown(),
            instructions: "",
            input: "",
          })
        )
      ).kind
    ).toBe("unavailable");
    expect(stub.sent).toHaveLength(0);
  });

  it("honours OPENROUTER_BASE_URL", async () => {
    const stub = stubFetch(() =>
      json(200, completion({ received: { probability: 0.5 } }))
    );
    await createOpenRouterPrimitives(
      { ...ENV, OPENROUTER_BASE_URL: "https://proxy.example/api/" },
      stub.fetch
    ).decide({
      input: "x",
      questions: [mixedRequest.questions[0] as DecisionRequest["questions"][0]],
    });
    expect(stub.sent[0]?.url).toBe(
      "https://proxy.example/api/v1/chat/completions"
    );
  });
});
