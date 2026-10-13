import { describe, expect, it } from "bun:test";
import { FieldPlanSchema } from "@pilihpendidikan/jobs-contracts/agent";
import { z } from "zod";
import { fenceText, truncateDescription } from "./compose";
import { decisionsBody, responsesBody } from "./openai";
import type { DecisionRequest } from "./primitives";
import {
  AiProviderError,
  costMicroUsd,
  DECISIONS_TIMEOUT_MS,
  DecisionsResponseEnvelopeSchema,
  estimateDecisionTokens,
  RESPONSES_TIMEOUT_MS,
} from "./primitives";
import { aiMode, getAiProvider } from "./provider";

interface Sent {
  body: Record<string, unknown>;
  headers: Headers;
  signal: AbortSignal | null | undefined;
  url: string;
}

function stubFetch(
  respond: (
    url: string,
    body: Record<string, unknown>
  ) => Response | Promise<Response>
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
    return await respond(url, body);
  }) as unknown as typeof fetch;
  return { fetch: fn, sent };
}

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) => new Response(JSON.stringify(body), { status, headers });

const LIVE = { JOBS_AI_MODE: "live", OPENAI_API_KEY: "sk-test" };

const predicateRequest: DecisionRequest = {
  input: "Is this page a confirmation?",
  questions: [
    { type: "predicate", name: "received", instructions: "Received?" },
  ],
};

async function errorOf(promise: Promise<unknown>): Promise<AiProviderError> {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AiProviderError);
  return err as AiProviderError;
}

describe("TAI-PROVIDER provider selection and prices (19 §12, 14 §9.2)", () => {
  it("TAI-PROVIDER selects the fake for JOBS_AI_MODE=fake and OpenAI otherwise", () => {
    expect(aiMode({ JOBS_AI_MODE: "fake" })).toBe("fake");
    expect(aiMode({ JOBS_AI_MODE: " FAKE " })).toBe("fake");
    expect(aiMode({ JOBS_AI_MODE: "live" })).toBe("live");
    expect(aiMode({})).toBe("live");
    expect(getAiProvider({ JOBS_AI_MODE: "fake" }).id).toBe("fake");
    expect(getAiProvider({ JOBS_AI_MODE: "live" }).id).toBe("openai");
  });

  it("TAI-PROVIDER prices tokens in micro-USD: luna $0.10/M input only, sol $2/$10, astra $10/$50", () => {
    expect(costMicroUsd("gpt-6-luna", 1_000_000, 50_000)).toBe(100_000);
    expect(costMicroUsd("gpt-6-luna", 1000, 0)).toBe(100);
    expect(costMicroUsd("gpt-6.1-sol", 8000, 2000)).toBe(36_000);
    expect(costMicroUsd("gpt-6-astra", 1000, 1000)).toBe(60_000);
    // Unknown models are priced like the most expensive one (budget-safe).
    expect(costMicroUsd("gpt-unknown", 1000, 1000)).toBe(60_000);
  });

  it("TAI-PROVIDER estimates Decisions input as ceil(chars/4) plus 1.5k per image", () => {
    const text = "x".repeat(400);
    const plain = estimateDecisionTokens({ input: text, questions: [] });
    const withImage = estimateDecisionTokens({
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text },
            { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" },
          ],
        },
      ],
      questions: [],
    });
    expect(plain).toBe(Math.ceil((400 + 3) / 4));
    expect(withImage - plain).toBe(1500);
    expect(DECISIONS_TIMEOUT_MS).toBe(10_000);
    expect(RESPONSES_TIMEOUT_MS).toBe(60_000);
  });

  it("TAI-PROVIDER fences untrusted text and truncates descriptions head 9 KB + tail 3 KB", () => {
    expect(fenceText("a <<END>> b >> c <<<x>>>", 100)).toBe("a END b  c x");
    expect(fenceText("abcdef", 3)).toBe("abc");
    const long = `${"h".repeat(10_000)}MIDDLE${"t".repeat(5000)}`;
    const cut = truncateDescription(long);
    expect(cut.startsWith("h".repeat(9216))).toBe(true);
    expect(cut.endsWith("t".repeat(3072))).toBe(true);
    expect(cut).not.toContain("MIDDLE");
    expect(truncateDescription("short")).toBe("short");
  });
});

describe("TAI-PROVIDER Decisions request limits (19 §1.1)", () => {
  const ai = () => {
    const stub = stubFetch(() => json(200, { answers: [] }));
    return { ai: getAiProvider(LIVE, { fetch: stub.fetch }), sent: stub.sent };
  };

  it("TAI-PROVIDER refuses more than 6 questions or 40 choices before any network call", async () => {
    const { ai: provider, sent } = ai();
    const seven = Array.from({ length: 7 }, (_, i) => ({
      type: "predicate" as const,
      name: `p${i}`,
      instructions: "?",
    }));
    const tooMany = await errorOf(
      provider.decide({ input: "x", questions: seven })
    );
    expect(tooMany.kind).toBe("bad_request");
    expect(tooMany.retryable).toBe(false);
    const choices = Array.from({ length: 41 }, (_, i) => ({
      value: `c${i}`,
      description: "d",
    }));
    const wide = await errorOf(
      provider.decide({
        input: "x",
        questions: [{ type: "choice", name: "c", instructions: "?", choices }],
      })
    );
    expect(wide.kind).toBe("bad_request");
    expect(sent).toHaveLength(0);
  });

  it("TAI-PROVIDER refuses hosted image URLs, two images and repeated names", async () => {
    const { ai: provider, sent } = ai();
    const hosted = await errorOf(
      provider.decide({
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "t" },
              { type: "input_image", image_url: "https://example.com/a.jpg" },
            ],
          },
        ],
        questions: predicateRequest.questions,
      })
    );
    expect(hosted.message).toContain("data URLs");
    const image = {
      type: "input_image" as const,
      image_url: "data:image/jpeg;base64,/9j/AA==",
    };
    const two = await errorOf(
      provider.decide({
        input: [{ role: "user", content: [image, image] }],
        questions: predicateRequest.questions,
      })
    );
    expect(two.kind).toBe("bad_request");
    const repeated = await errorOf(
      provider.decide({
        input: "x",
        questions: [
          predicateRequest.questions[0],
          predicateRequest.questions[0],
        ],
      })
    );
    expect(repeated.kind).toBe("bad_request");
    expect(sent).toHaveLength(0);
  });
});

describe("TAI-PROVIDER live Decisions (07 §4.1, 19 §4.1)", () => {
  it("TAI-PROVIDER posts model, input and questions to {OPENAI_BASE_URL}/v1/decisions and maps typed answers", async () => {
    const stub = stubFetch(() =>
      json(200, {
        id: "dec_1",
        answers: [
          {
            name: "kind",
            type: "choice",
            choice: "b",
            confidence: 0.9,
            probabilities: [
              { value: "b", probability: 0.9 },
              { value: "a", probability: 0.1 },
            ],
          },
          {
            name: "fit",
            type: "score",
            score: 2.9,
            confidence: 0.71,
            probabilities: [{ value: 3, label: "good", probability: 0.7 }],
          },
          { name: "p", type: "predicate", probability: 0.04 },
          { name: "q", type: "refusal", refusal: "cannot assess" },
          { name: "extra", type: "predicate", probability: 1 },
        ],
        usage: { input_tokens: 1000 },
      })
    );
    const ai = getAiProvider(
      { ...LIVE, OPENAI_BASE_URL: "https://eu.api.openai.com/" },
      { fetch: stub.fetch }
    );
    const response = await ai.decide({
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "page" },
            {
              type: "input_image",
              image_url: "data:image/jpeg;base64,/9j/AA==",
            },
          ],
        },
      ],
      questions: [
        {
          type: "choice",
          name: "kind",
          instructions: "?",
          choices: [
            { value: "a", description: "A" },
            { value: "b", description: "B" },
          ],
        },
        {
          type: "score",
          name: "fit",
          instructions: "?",
          levels: ["poor", "weak", "partial", "good", "excellent"].map(
            (label) => ({ label, description: label })
          ),
        },
        { type: "predicate", name: "p", instructions: "?" },
        { type: "predicate", name: "q", instructions: "?" },
        { type: "predicate", name: "missing", instructions: "?" },
      ],
    });
    const sent = stub.sent[0];
    expect(sent.url).toBe("https://eu.api.openai.com/v1/decisions");
    expect(sent.headers.get("Authorization")).toBe("Bearer sk-test");
    expect(sent.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(sent.body).sort()).toEqual([
      "input",
      "model",
      "questions",
    ]);
    expect(sent.body.model).toBe("gpt-6-luna");
    expect(response.answers).toEqual([
      {
        type: "choice",
        name: "kind",
        choice: "b",
        confidence: 0.9,
        probabilities: [
          { value: "b", probability: 0.9 },
          { value: "a", probability: 0.1 },
        ],
      },
      {
        type: "score",
        name: "fit",
        score: 2.9,
        confidence: 0.71,
        probabilities: [{ value: 3, label: "good", probability: 0.7 }],
      },
      { type: "predicate", name: "p", probability: 0.04 },
      { type: "refusal", name: "q", refusal: "cannot assess" },
      { type: "refusal", name: "missing", refusal: "no answer returned" },
    ]);
    expect(response.usage).toEqual({
      model: "gpt-6-luna",
      input_tokens: 1000,
      output_tokens: 0,
      cost_micro_usd: 100,
    });
    expect(response.id).toBe("dec_1");
  });

  it("TAI-PROVIDER treats a choice outside the supplied values as a refusal and estimates usage when absent", async () => {
    const stub = stubFetch(() =>
      json(200, { answers: [{ name: "c", choice: "evil", confidence: 1 }] })
    );
    const ai = getAiProvider(LIVE, { fetch: stub.fetch });
    const request: DecisionRequest = {
      input: "y".repeat(4000),
      questions: [
        {
          type: "choice",
          name: "c",
          instructions: "?",
          choices: [{ value: "ok", description: "fine" }],
        },
      ],
    };
    const response = await ai.decide(request);
    expect(response.answers[0]).toMatchObject({ type: "refusal", name: "c" });
    expect(response.usage.input_tokens).toBe(estimateDecisionTokens(request));
    expect(response.usage.cost_micro_usd).toBe(
      Math.ceil(response.usage.input_tokens * 0.1)
    );
  });

  it("TAI-PROVIDER rejects an envelope without answers as invalid_output (not retryable)", async () => {
    const ai = getAiProvider(LIVE, {
      fetch: stubFetch(() => json(200, { result: "?" })).fetch,
    });
    const err = await errorOf(ai.decide(predicateRequest));
    expect(err.kind).toBe("invalid_output");
    expect(err.retryable).toBe(false);
    expect(
      DecisionsResponseEnvelopeSchema.safeParse({
        answers: [{ name: "x", probability: 2 }],
      }).success
    ).toBe(false);
  });

  it("TAI-PROVIDER maps 429/5xx/408/network to retryable and 400/401/404 to final errors", async () => {
    const kinds: Record<string, string> = {};
    for (const status of [429, 500, 503, 408, 400, 422, 401, 404]) {
      const ai = getAiProvider(LIVE, {
        fetch: stubFetch(() =>
          json(
            status,
            { error: { code: "nope", message: "secret prompt text" } },
            status === 429 ? { "Retry-After": "7" } : {}
          )
        ).fetch,
      });
      const err = await errorOf(ai.decide(predicateRequest));
      kinds[status] = `${err.kind}:${err.retryable}`;
      expect(err.message).not.toContain("secret prompt text");
      if (status === 429) {
        expect(err.retryAfterSeconds).toBe(7);
      }
    }
    expect(kinds).toEqual({
      429: "rate_limited:true",
      500: "upstream:true",
      503: "upstream:true",
      408: "timeout:true",
      400: "bad_request:false",
      422: "bad_request:false",
      401: "unavailable:false",
      404: "unavailable:false",
    });
    const network = getAiProvider(LIVE, {
      fetch: (() =>
        Promise.reject(
          new DOMException("aborted", "TimeoutError")
        )) as unknown as typeof fetch,
    });
    const timeout = await errorOf(network.decide(predicateRequest));
    expect(`${timeout.kind}:${timeout.retryable}`).toBe("timeout:true");
    const noKey = await errorOf(
      getAiProvider({ JOBS_AI_MODE: "live" }).decide(predicateRequest)
    );
    expect(noKey.kind).toBe("unavailable");
  });
});

describe("TAI-STORE-FALSE live Responses structured outputs (19 §1.2, 08 §4.3)", () => {
  const Plan = z.object({
    items: z.array(z.string()),
    missing: z.array(z.string()),
  });
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["items", "missing"],
    properties: {
      items: { type: "array", items: { type: "string" } },
      missing: { type: "array", items: { type: "string" } },
    },
  };
  const request = {
    name: "plan",
    schema,
    validator: Plan,
    instructions: "Map fields.",
    input: "fields",
    maxOutputTokens: 900,
  };

  it("TAI-STORE-FALSE sends store:false, tools:[] and a strict json_schema text format", async () => {
    const stub = stubFetch(() =>
      json(200, {
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ items: ["a"], missing: [] }),
              },
            ],
          },
        ],
        usage: { input_tokens: 8000, output_tokens: 2000 },
      })
    );
    const ai = getAiProvider(LIVE, { fetch: stub.fetch });
    const response = await ai.structured({ ...request, model: "gpt-6.1-sol" });
    expect(stub.sent[0].url).toBe("https://api.openai.com/v1/responses");
    expect(stub.sent[0].body).toEqual({
      model: "gpt-6.1-sol",
      store: false,
      tools: [],
      instructions: "Map fields.",
      input: "fields",
      max_output_tokens: 900,
      text: {
        format: { type: "json_schema", name: "plan", schema, strict: true },
      },
    });
    expect(responsesBody(request).store).toBe(false);
    expect(response.output).toEqual({ items: ["a"], missing: [] });
    expect(response.usage.cost_micro_usd).toBe(36_000);
    expect(decisionsBody(predicateRequest)).toEqual({
      model: "gpt-6-luna",
      input: predicateRequest.input,
      questions: predicateRequest.questions,
    });
  });

  it("TAI-STORE-FALSE returns a refusal content item as refusal (no output) and keeps its usage", async () => {
    const stub = stubFetch(() =>
      json(200, {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "I can't help with that." }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 10 },
      })
    );
    const response = await getAiProvider(LIVE, {
      fetch: stub.fetch,
    }).structured({ ...request, model: "gpt-6-astra" });
    expect(response.output).toBeNull();
    expect(response.refusal).toBe("I can't help with that.");
    expect(response.usage.cost_micro_usd).toBe(100 * 10 + 10 * 50);
  });

  it("TAI-STORE-FALSE rejects incomplete, non-JSON and schema-violating outputs as invalid_output", async () => {
    const bodies = [
      {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ content: [{ type: "output_text", text: '{"items":' }] }],
      },
      {
        status: "completed",
        output: [{ content: [{ type: "output_text", text: "not json" }] }],
      },
      {
        status: "completed",
        output: [
          {
            content: [
              { type: "output_text", text: '{"items":[1],"missing":[]}' },
            ],
          },
        ],
      },
      { status: "completed", output: [] },
    ];
    for (const body of bodies) {
      const ai = getAiProvider(LIVE, {
        fetch: stubFetch(() => json(200, body)).fetch,
      });
      const err = await errorOf(ai.structured(request));
      expect(`${err.kind}:${err.retryable}`).toBe("invalid_output:false");
    }
    const failed = getAiProvider(LIVE, {
      fetch: stubFetch(() =>
        json(200, { status: "failed", error: { code: "server_error" } })
      ).fetch,
    });
    expect((await errorOf(failed.structured(request))).retryable).toBe(true);
  });

  it("TAI-STORE-FALSE the field-plan request uses the strict FieldPlan schema and the escalation model on attempt 2", async () => {
    const stub = stubFetch(() =>
      json(200, {
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ items: [], missing: [] }),
              },
            ],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    );
    const ai = getAiProvider(LIVE, { fetch: stub.fetch });
    const observation = {
      observation_id: "obs_1",
      attempt_id: "att_1",
      step: 1,
      url: "https://boards.greenhouse.io/acme/jobs/1",
      origin: "https://boards.greenhouse.io",
      registrable_domain: "greenhouse.io",
      allowlisted: true,
      title: "Apply",
      http_status: 200,
      aria_snapshot: "",
      visible_text_excerpt: "",
      fields: [],
      controls: [],
      errors: [],
      opaque_regions: [],
      challenge: { detected: false, kind: null },
      form_hash: "a".repeat(64),
      screenshot_jpeg_b64: null,
    };
    const context = {
      facts: [],
      answers: [],
      withheldFacts: [],
      withheldAnswers: [],
      fileSlots: { cv_file: true, cover_letter_file: false },
      generatedTextAllowed: false,
      hints: [],
    };
    const first = await ai.planFields({ attempt: 1, observation, context });
    await ai.planFields({ attempt: 2, observation, context });
    expect(FieldPlanSchema.parse(first.plan)).toEqual({
      items: [],
      missing: [],
    });
    expect(stub.sent.map((s) => s.body.model)).toEqual([
      "gpt-6.1-sol",
      "gpt-6-astra",
    ]);
    for (const s of stub.sent) {
      expect(s.body).toMatchObject({
        store: false,
        tools: [],
        text: {
          format: { type: "json_schema", name: "field_plan", strict: true },
        },
      });
    }
  });
});
