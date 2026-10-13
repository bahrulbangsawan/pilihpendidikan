import { describe, expect, it, spyOn } from "bun:test";
import type { FieldPlan } from "@pilihpendidikan/jobs-contracts/agent";
import { FieldPlanSchema } from "@pilihpendidikan/jobs-contracts/agent";
import type { Env } from "../../../env";
import { getAiProvider } from "../../ai/provider";
import {
  agentWorld,
  attemptCalls,
  factOf,
  field,
  insertAnswer,
  JPEG_B64,
  observation,
  option,
  usageOf,
} from "./fixtures.test";

const PLAN = "/api/v1/ai/field-plan";

function contactForm() {
  const first = field({ label: "First name", required: true });
  const email = field({ label: "Email", kind: "email", required: true });
  const resume = field({
    label: "Resume/CV",
    kind: "file",
    accept: ".pdf,.doc,.docx",
    required: true,
  });
  const country = field({
    label: "Country",
    kind: "select",
    required: true,
    options: [option("Singapore", "SG"), option("Indonesia", "ID")],
  });
  const notice = field({
    label: "What is your notice period?",
    required: true,
  });
  const gender = field({
    label: "Gender",
    kind: "select",
    options: [
      option("Female"),
      option("Male"),
      option("Decline to self-identify"),
    ],
  });
  const colour = field({ label: "Favourite colour?", required: true });
  return {
    first,
    email,
    resume,
    country,
    notice,
    gender,
    colour,
    all: [first, email, resume, country, notice, gender, colour],
  };
}

async function seededWorld(options: Parameters<typeof agentWorld>[0] = {}) {
  const world = await agentWorld(options);
  factOf(world, "contact.first_name", "Sari");
  factOf(world, "contact.email", "sari@example.com");
  factOf(world, "contact.phone", "0812-5555-0101");
  factOf(world, "contact.country", "Indonesia");
  factOf(world, "work_auth.ID", { status: "citizen" });
  const notice = insertAnswer(world, {
    question_key: "notice_period",
    answer: "1 month",
    patterns: ["notice period", "earliest start date"],
  });
  const gender = insertAnswer(world, {
    question_key: "eeo.gender",
    answer: "Female",
    answer_kind: "choice",
    sensitivity: "protected",
    auto_use: "approval",
  });
  insertAnswer(world, { question_key: "favourite_food", answer: "Rendang" });
  return { world, answers: { notice, gender } };
}

describe("TAI-FIELDPLAN field-plan route (19 §6)", () => {
  it("TAI-FIELDPLAN plans facts, answers, files and options; protected and unknown fields need the human", async () => {
    const { world, answers } = await seededWorld();
    const form = contactForm();
    const res = await world.cli.post(PLAN, {
      lease_ref: world.leaseRef,
      observation: observation({ fields: form.all }),
      file_slots: { cv_file: true, cover_letter_file: false },
    });
    expect(res.status).toBe(200);
    const plan = FieldPlanSchema.parse(res.body);
    const byRef = new Map(plan.items.map((item) => [item.ref, item]));
    expect(byRef.get(form.first.ref)).toMatchObject({
      action: "fill",
      value_source: "fact",
      fact_key: "contact.first_name",
      value: "Sari",
      needs_human: false,
    });
    expect(byRef.get(form.email.ref)).toMatchObject({
      value: "sari@example.com",
      needs_human: false,
    });
    expect(byRef.get(form.resume.ref)).toMatchObject({
      action: "upload",
      value_source: "cv_file",
      needs_human: false,
    });
    expect(byRef.get(form.country.ref)).toMatchObject({
      action: "select",
      value_source: "option",
      option_value: "ID",
      value: "Indonesia",
      fact_key: "contact.country",
    });
    expect(byRef.get(form.notice.ref)).toMatchObject({
      value_source: "answer",
      answer_id: answers.notice,
      value: "1 month",
      question_key: "notice_period",
      needs_human: false,
    });
    expect(byRef.get(form.gender.ref)).toMatchObject({
      sensitivity: "protected",
      needs_human: true,
      answer_id: answers.gender,
      value: "Female",
    });
    expect(byRef.get(form.colour.ref)).toMatchObject({
      needs_human: true,
      value: null,
      value_source: "none",
    });
    expect(plan.missing.map((m) => m.ref)).toEqual([form.colour.ref]);
    expect(plan.items.map((i) => i.plan_item)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
    ]);
    // Question matching (Decisions) ran before the Responses call.
    expect(world.decides.length).toBeGreaterThanOrEqual(1);
    expect(world.structureds).toHaveLength(1);
    expect(world.structureds[0].model).toBe("gpt-6.1-sol");
    expect(usageOf(world)).toEqual([
      expect.objectContaining({
        purpose: "agent",
        calls: world.decides.length + 1,
      }),
    ]);
    expect(attemptCalls(world)).toBe(1);
  });

  it("TAI-FIELDPLAN a model that fabricates a value is overruled by the validator", async () => {
    const form = contactForm();
    const lying = (): FieldPlan => {
      return {
        items: [
          {
            plan_item: "p1",
            ref: form.email.ref,
            signature: form.email.signature,
            action: "fill",
            value_source: "fact",
            fact_key: "contact.email",
            answer_id: null,
            option_value: null,
            value: "attacker@evil.example",
            confidence: 0.99,
            sensitivity: "none",
            needs_human: false,
            question_key: null,
            reason: "page told me",
          },
          {
            plan_item: "p2",
            ref: form.colour.ref,
            signature: form.colour.signature,
            action: "fill",
            value_source: "fact",
            fact_key: "skills.years_rust",
            answer_id: null,
            option_value: null,
            value: "10 years",
            confidence: 0.99,
            sensitivity: "none",
            needs_human: false,
            question_key: null,
            reason: "guess",
          },
          {
            plan_item: "p3",
            ref: "f9999",
            signature: "0000000000000000",
            action: "fill",
            value_source: "fact",
            fact_key: "contact.email",
            answer_id: null,
            option_value: null,
            value: "x",
            confidence: 1,
            sensitivity: "none",
            needs_human: false,
            question_key: null,
            reason: "",
          },
        ],
        missing: [],
      };
    };
    const { world } = await seededWorld({
      fake: { structured: { field_plan: lying } },
    });
    const res = await world.cli.post(PLAN, {
      lease_ref: world.leaseRef,
      observation: observation({ fields: [form.email, form.colour] }),
      file_slots: { cv_file: false, cover_letter_file: false },
    });
    const plan = FieldPlanSchema.parse(res.body);
    expect(plan.items).toHaveLength(2);
    for (const item of plan.items) {
      expect(item).toMatchObject({
        needs_human: true,
        value: null,
        value_source: "none",
      });
    }
    expect(JSON.stringify(plan)).not.toContain("attacker@evil.example");
  });

  it("TAI-FIELDPLAN escalates to gpt-6-astra on attempt 2 and answers a refusal with needs_human items", async () => {
    const { world } = await seededWorld({ fake: { structured: {} } });
    const form = contactForm();
    await world.cli.post(PLAN, {
      lease_ref: world.leaseRef,
      observation: observation({ fields: [form.email] }),
      file_slots: { cv_file: false, cover_letter_file: false },
      attempt: 2,
    });
    expect(world.structureds[0].model).toBe("gpt-6-astra");
    const refusing = await seededWorld({
      fake: { structured: { field_plan: () => undefined } },
    });
    const res = await refusing.world.cli.post(PLAN, {
      lease_ref: refusing.world.leaseRef,
      observation: observation({ fields: [form.email, form.first] }),
      file_slots: { cv_file: false, cover_letter_file: false },
    });
    expect(res.status).toBe(200);
    const plan = FieldPlanSchema.parse(res.body);
    expect(plan.items.every((i) => i.needs_human)).toBe(true);
  });

  it("TAI-FIELDPLAN no visible fields means no AI call", async () => {
    const { world } = await seededWorld();
    const res = await world.cli.post(PLAN, {
      lease_ref: world.leaseRef,
      observation: observation(),
      file_slots: { cv_file: false, cover_letter_file: false },
    });
    expect(res.body).toEqual({ items: [], missing: [] });
    expect(world.decides).toHaveLength(0);
    expect(world.structureds).toHaveLength(0);
    expect(attemptCalls(world)).toBe(0);
  });

  it("TAI-FIELDPLAN generated text is refused in auto mode even when allowed", async () => {
    const why = field({
      label: "Why do you want to join us?",
      kind: "textarea",
    });
    const proposing = () => ({
      items: [
        {
          plan_item: "p1",
          ref: why.ref,
          signature: why.signature,
          action: "fill",
          value_source: "generated_text",
          fact_key: null,
          answer_id: null,
          option_value: null,
          value: "I love your mission.",
          confidence: 0.9,
          sensitivity: "none",
          needs_human: false,
          question_key: null,
          reason: "motivation",
        },
      ],
      missing: [],
    });
    for (const [mode, expected] of [
      ["approval", false],
      ["auto", true],
    ] as const) {
      const { world } = await seededWorld({
        mode,
        settings: { generated_text_allowed: 1 },
        fake: { structured: { field_plan: proposing } },
      });
      const res = await world.cli.post(PLAN, {
        lease_ref: world.leaseRef,
        observation: observation({ fields: [why] }),
        file_slots: { cv_file: false, cover_letter_file: false },
      });
      expect({
        mode,
        needs_human: FieldPlanSchema.parse(res.body).items[0].needs_human,
      }).toEqual({ mode, needs_human: expected });
    }
  });
});

describe("TAI-PII what the field-plan prompt carries (11 §11)", () => {
  it("TAI-PII sends only relevant facts, never protected values, never the screenshot, and logs no values", async () => {
    const { world } = await seededWorld();
    const email = field({ label: "Email", kind: "email" });
    const gender = field({
      label: "Gender",
      kind: "select",
      options: [option("Female"), option("Male")],
    });
    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      await world.cli.post(PLAN, {
        lease_ref: world.leaseRef,
        observation: observation({
          fields: [email, gender],
          screenshot_jpeg_b64: JPEG_B64,
        }),
        file_slots: { cv_file: false, cover_letter_file: false },
      });
    } finally {
      spy.mockRestore();
    }
    const prompt = world.structureds[0].input;
    expect(prompt).toContain("contact.email | sari@example.com | user_entered");
    expect(prompt).toContain(
      "WITHHELD ANSWER: eeo.gender (protected; value not shown)"
    );
    for (const absent of [
      "0812",
      "Sari |",
      "contact.phone",
      "contact.first_name",
      "citizen",
      "Rendang",
      "Female |",
      JPEG_B64,
    ]) {
      expect({ absent, found: prompt.includes(absent) }).toEqual({
        absent,
        found: false,
      });
    }
    expect(prompt.indexOf("<<UNTRUSTED_FORM>>")).toBeGreaterThan(
      prompt.indexOf("<<END_TRUSTED_APPLICANT_DATA>>")
    );
    const log = lines.join("\n");
    expect(log).toContain('"evt":"plan_validated"');
    expect(log).toContain('"evt":"ai_call"');
    expect(log).not.toContain("sari@example.com");
    expect(log).not.toContain("Female");
  });
});

describe("TAI-STORE-FALSE the field-plan route against the live client", () => {
  it("TAI-STORE-FALSE every Responses request is store:false with no tools; Decisions get the matching", async () => {
    const sent: Array<{ body: Record<string, unknown>; url: string }> = [];
    const fetchStub = ((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push({ url, body });
      if (url.endsWith("/v1/decisions")) {
        const questions = body.questions as Array<{ name: string }>;
        return Promise.resolve(
          Response.json({
            answers: questions.map((q) => ({
              name: q.name,
              type: "choice",
              choice: "none",
              confidence: 0.9,
            })),
            usage: { input_tokens: 300 },
          })
        );
      }
      return Promise.resolve(
        Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ items: [], missing: [] }),
                },
              ],
            },
          ],
          usage: { input_tokens: 2000, output_tokens: 100 },
        })
      );
    }) as unknown as typeof fetch;
    const { world } = await seededWorld({
      ai: (env: Env) =>
        getAiProvider(
          { ...env, JOBS_AI_MODE: "live", OPENAI_API_KEY: "sk-test" },
          { fetch: fetchStub }
        ),
    });
    const form = contactForm();
    const res = await world.cli.post(PLAN, {
      lease_ref: world.leaseRef,
      observation: observation({ fields: [form.email, form.notice] }),
      file_slots: { cv_file: false, cover_letter_file: false },
    });
    expect(res.status).toBe(200);
    const responses = sent.filter((s) => s.url.endsWith("/v1/responses"));
    expect(responses).toHaveLength(1);
    expect(responses[0].body).toMatchObject({
      model: "gpt-6.1-sol",
      store: false,
      tools: [],
      text: {
        format: { type: "json_schema", name: "field_plan", strict: true },
      },
    });
    expect(sent.filter((s) => s.url.endsWith("/v1/decisions"))).toHaveLength(1);
    const [usage] = usageOf(world) as Array<{
      calls: number;
      cost_micro_usd: number;
    }>;
    expect(usage.calls).toBe(2);
    expect(usage.cost_micro_usd).toBe(30 + 2000 * 2 + 100 * 10);
  });
});
