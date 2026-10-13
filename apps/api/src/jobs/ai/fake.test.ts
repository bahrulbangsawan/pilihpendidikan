import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { field, observation, option } from "../routes/ai-proxy/fixtures.test";
import { postingView } from "../services/scoring/engine";
import { postingOf, profileOf } from "../services/scoring/fixtures.test";
import type { FakeAiOptions } from "./fake";
import { AiProviderError } from "./primitives";
import { getAiProvider } from "./provider";

const fake = (options: FakeAiOptions = {}) =>
  getAiProvider({ JOBS_AI_MODE: "fake" }, { fake: options });

describe("TAI-PROVIDER the deterministic fake provider (JOBS_AI_MODE=fake)", () => {
  it("TAI-PROVIDER scores from skill and title overlap, deterministically, with realistic usage", async () => {
    const ai = fake();
    const relevant = {
      askSensitive: true,
      profile: profileOf(),
      posting: postingView(postingOf()),
    };
    const unrelated = {
      askSensitive: true,
      profile: profileOf(),
      posting: postingView(
        postingOf({
          title: "Pastry Chef",
          requirements: ["Croissants", "Sourdough"],
          description_text: "Bakery shifts.",
        })
      ),
    };
    const a = await ai.scorePosting(relevant);
    const b = await ai.scorePosting(unrelated);
    expect(a).toEqual(await ai.scorePosting(relevant));
    expect(a.overall_fit?.score ?? 0).toBeGreaterThan(
      b.overall_fit?.score ?? 4
    );
    expect(a.usage).toMatchObject({ model: "gpt-6-luna", output_tokens: 0 });
    expect(a.usage.input_tokens).toBeGreaterThan(100);
    expect(a.usage.cost_micro_usd).toBe(Math.ceil(a.usage.input_tokens * 0.1));
    expect(a.calls).toBe(1);
  });

  it("TAI-PROVIDER raises gates only for explicit degree, on-site and sponsorship wording", async () => {
    const ai = fake();
    const profile = profileOf({
      education: [{ level: "diploma", field: "it" }],
      work_authorization: [{ country_code: "ID", status: "citizen" }],
    });
    const gated = await ai.scorePosting({
      askSensitive: true,
      profile,
      posting: postingView(
        postingOf({
          workplace_type: "onsite",
          locations: [{ raw: "Singapore", country_code: "SG" }],
          requirements: [
            "Bachelor's degree in Computer Science is required",
            "No visa sponsorship available",
          ],
        })
      ),
    });
    expect(gated.predicates.requires_degree_user_lacks).toBeGreaterThanOrEqual(
      0.8
    );
    expect(
      gated.predicates.requires_onsite_outside_user_locations
    ).toBeGreaterThanOrEqual(0.8);
    expect(
      gated.predicates.requires_unavailable_work_authorization
    ).toBeGreaterThanOrEqual(0.8);
    const open = await ai.scorePosting({
      askSensitive: false,
      profile,
      posting: postingView(
        postingOf({ requirements: ["Degree or equivalent experience"] })
      ),
    });
    expect(open.predicates.requires_degree_user_lacks).toBeLessThan(0.5);
    expect(open.predicates.requires_onsite_outside_user_locations).toBeLessThan(
      0.5
    );
    expect(
      open.predicates.requires_unavailable_work_authorization
    ).toBeUndefined();
  });

  it("TAI-PROVIDER plans fields only from the supplied facts and never invents a value", async () => {
    const ai = fake();
    const email = field({ label: "Email", kind: "email" });
    const phone = field({ label: "Phone", kind: "tel" });
    const country = field({
      label: "Country",
      kind: "select",
      options: [option("Indonesia", "ID")],
    });
    const result = await ai.planFields({
      attempt: 1,
      observation: observation({ fields: [email, phone, country] }),
      context: {
        facts: [
          {
            key: "contact.email",
            value: "sari@example.com",
            source: "user_entered",
            sensitivity: "none",
          },
          {
            key: "contact.country",
            value: "Indonesia",
            source: "user_entered",
            sensitivity: "none",
          },
        ],
        answers: [],
        withheldFacts: [],
        withheldAnswers: [],
        fileSlots: { cv_file: false, cover_letter_file: false },
        generatedTextAllowed: false,
        hints: [],
      },
    });
    expect(
      result.plan?.items.map((i) => [i.value_source, i.value, i.needs_human])
    ).toEqual([
      ["fact", "sari@example.com", false],
      ["none", null, true],
      ["option", "Indonesia", false],
    ]);
    expect(result.plan?.missing.map((m) => m.ref)).toEqual([phone.ref]);
    expect(result.usage.output_tokens).toBeGreaterThan(0);
  });

  it("TAI-PROVIDER lets tests script answers, structured outputs and failures", async () => {
    const scripted = fake({
      answer: (q) =>
        q.name === "page_kind"
          ? {
              type: "choice",
              name: q.name,
              choice: "confirmation",
              confidence: 0.9,
              probabilities: [],
            }
          : undefined,
      structured: { thing: { ok: true } },
    });
    expect(
      (await scripted.classifyPage({ observation: observation() })).page_kind
    ).toBe("confirmation");
    const thing = await scripted.structured({
      name: "thing",
      schema: {},
      validator: z.object({ ok: z.boolean() }),
      instructions: "",
      input: "",
    });
    expect(thing.output).toEqual({ ok: true });
    const none = await fake().structured({
      name: "other",
      schema: {},
      validator: z.object({}),
      instructions: "",
      input: "",
    });
    expect(none.output).toBeNull();
    expect(none.refusal).toContain("no fixture");
    const broken = fake({ structured: { thing: { ok: "yes" } } });
    const err = await broken
      .structured({
        name: "thing",
        schema: {},
        validator: z.object({ ok: z.boolean() }),
        instructions: "",
        input: "",
      })
      .catch((e: unknown) => e);
    expect((err as AiProviderError).kind).toBe("invalid_output");
    const failing = fake({ fail: "rate_limited" });
    const fail = await failing
      .verifySubmission({
        final_url: "https://x.example",
        page_title: "",
        text_excerpt: "",
      })
      .catch((e: unknown) => e);
    expect(fail).toBeInstanceOf(AiProviderError);
    expect((fail as AiProviderError).retryable).toBe(true);
  });

  it("TAI-PROVIDER enforces the same Decisions limits as the live client", async () => {
    const err = await fake()
      .decide({
        input: "x",
        questions: Array.from({ length: 7 }, (_, i) => ({
          type: "predicate" as const,
          name: `p${i}`,
          instructions: "?",
        })),
      })
      .catch((e: unknown) => e);
    expect((err as AiProviderError).kind).toBe("bad_request");
  });
});
