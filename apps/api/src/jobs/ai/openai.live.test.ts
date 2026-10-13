// T7-11 — contract test against the LIVE OpenAI Decisions API (A-01): the
// response envelope must keep matching the Zod schema the provider parses.
// It runs only when both `OPENAI_API_KEY` and `JOBS_AI_LIVE=1` are set (a
// small nightly / manual job, about $0.0001 per run); in CI and in every
// local `bun test` it is skipped and never touches the network.
//
//   OPENAI_API_KEY=sk-… JOBS_AI_LIVE=1 bun test src/jobs/ai/openai.live.test.ts

import { describe, expect, it } from "bun:test";
import { postingView } from "../services/scoring/engine";
import { postingOf, profileOf } from "../services/scoring/fixtures.test";
import { scoreRequest, verifyRequest } from "./compose";
import { createOpenAiPrimitives, decisionsBody } from "./openai";
import { answersFor, DecisionsResponseEnvelopeSchema } from "./primitives";

const LIVE =
  Boolean(process.env.OPENAI_API_KEY?.trim()) &&
  process.env.JOBS_AI_LIVE === "1";
const BASE = (
  process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com"
).replace(/\/+$/, "");
const TIMEOUT_MS = 30_000;

describe.skipIf(!LIVE)("T7-11 live Decisions contract (07 §14, A-01)", () => {
  it(
    "T7-11 POST /v1/decisions answers the scoring rubric in the shape the Zod schema expects",
    async () => {
      const request = scoreRequest({
        askSensitive: true,
        profile: profileOf(),
        posting: postingView(postingOf()),
      });
      const response = await fetch(`${BASE}/v1/decisions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(decisionsBody(request)),
      });
      expect(response.status).toBe(200);
      const parsed = DecisionsResponseEnvelopeSchema.safeParse(
        await response.json()
      );
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      const answers = answersFor(request.questions, parsed.data);
      expect(answers.map((a) => a.name)).toEqual(
        request.questions.map((q) => q.name)
      );
      for (const [i, answer] of answers.entries()) {
        const asked = request.questions[i];
        expect(answer.type === "refusal" || answer.type === asked.type).toBe(
          true
        );
        if (answer.type === "score") {
          expect(answer.score).toBeGreaterThanOrEqual(0);
          expect(answer.score).toBeLessThanOrEqual(4);
        }
        if (answer.type === "predicate") {
          expect(answer.probability).toBeGreaterThanOrEqual(0);
          expect(answer.probability).toBeLessThanOrEqual(1);
        }
      }
    },
    TIMEOUT_MS
  );

  it(
    "T7-11 the live provider parses a predicate request and reports its usage",
    async () => {
      const ai = createOpenAiPrimitives({
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      });
      const result = await ai.decide(
        verifyRequest({
          final_url: "https://boards.greenhouse.io/acme/jobs/1/confirmation",
          page_title: "Application submitted",
          text_excerpt:
            "Thank you for applying! We have received your application.",
        })
      );
      expect(result.model).toBe("gpt-6-luna");
      expect(result.answers).toHaveLength(2);
      expect(result.usage.input_tokens).toBeGreaterThan(0);
      expect(result.usage.cost_micro_usd).toBeGreaterThan(0);
    },
    TIMEOUT_MS
  );
});
