import { describe, expect, it } from "bun:test";
import { isQuestionField, protectedCategory } from "../../ai/lexicon";
import type { DecisionRequest } from "../../ai/primitives";
import { getAiProvider } from "../../ai/provider";
import type { StoredAnswer, StoredFact } from "../../repo/ai-proxy";
import { field, option } from "../../routes/ai-proxy/fixtures.test";
import { agentFacts, planContext } from "./facts";
import {
  bankKeys,
  matchInputFor,
  matchQuestionsToBank,
  protectedFields,
  questionFields,
} from "./questions";

const answer = (
  question_key: string,
  extra: Partial<StoredAnswer> = {}
): StoredAnswer => ({
  id: `ans_${question_key}`,
  question_key,
  match_patterns: [],
  answer: "yes",
  answer_kind: "text",
  sensitivity: "none",
  auto_use: "always",
  ...extra,
});

describe("TAI-QUESTIONS screening questions → answer bank (19 §6.2)", () => {
  it("TAI-QUESTIONS detects question-like fields", () => {
    expect(
      isQuestionField(
        field({ label: "Will you now or in the future require sponsorship?" })
      )
    ).toBe(true);
    expect(
      isQuestionField(
        field({
          label: "Sponsorship",
          kind: "radio_group",
          options: [option("Yes"), option("No")],
        })
      )
    ).toBe(true);
    expect(
      isQuestionField(
        field({
          label: "Years with Python",
          kind: "select",
          options: [option("0-1"), option("2-4"), option("5+")],
        })
      )
    ).toBe(true);
    expect(
      isQuestionField(
        field({
          label: "Anything else",
          kind: "textarea",
          section: "Additional questions",
        })
      )
    ).toBe(true);
    expect(
      isQuestionField(
        field({
          label: "Address",
          kind: "textarea",
          section: "Contact information",
        })
      )
    ).toBe(false);
    expect(isQuestionField(field({ label: "First name" }))).toBe(false);
  });

  it("TAI-QUESTIONS the protected-class lexicon (EN + ID) forces protected and keeps those fields out of matching", () => {
    const labels: [string, string | null][] = [
      ["What is your gender?", "gender"],
      ["Jenis kelamin", "gender"],
      ["Race / Ethnicity", "race_ethnicity"],
      ["Do you have a disability?", "disability"],
      ["Protected veteran status", "veteran"],
      ["Sexual orientation", "sexual_orientation"],
      ["Have you ever been convicted of a felony?", "criminal_history"],
      ["Date of birth", "age"],
      ["Tanggal lahir", "age"],
      ["Agama", "religion"],
      ["Any health conditions we should know about?", "health"],
      ["Union membership", "union"],
      ["Will you require visa sponsorship?", "citizenship_visa"],
      ["Kewarganegaraan", "citizenship_visa"],
      ["Are you 18 years of age or older?", null],
      ["Notice period?", null],
    ];
    for (const [label, category] of labels) {
      const found: string | null = protectedCategory(label);
      expect({ label, category: found }).toEqual({ label, category });
    }
    const fields = [
      field({ label: "What is your gender?" }),
      field({ label: "Notice period?" }),
    ];
    const refs = protectedFields(fields);
    expect([...refs.keys()]).toEqual([fields[0].ref]);
    expect(questionFields(fields, refs).map((f) => f.ref)).toEqual([
      fields[1].ref,
    ]);
  });

  it("TAI-QUESTIONS offers ≤ 38 keys (most relevant first) without protected or never answers", () => {
    const answers = [
      ...Array.from({ length: 45 }, (_, i) => answer(`custom.question_${i}`)),
      answer("notice_period", {
        match_patterns: ["notice period", "earliest start"],
      }),
      answer("eeo.gender", { sensitivity: "protected", auto_use: "approval" }),
      answer("salary_expectation", {
        auto_use: "never",
        sensitivity: "personal",
      }),
    ];
    const keys = bankKeys(answers, [
      field({ label: "What is your notice period?" }),
    ]);
    expect(keys).toHaveLength(38);
    expect(keys[0]).toEqual({
      value: "notice_period",
      description: "notice period / notice period / earliest start",
    });
    expect(keys.map((k) => k.value)).not.toContain("eeo.gender");
    expect(keys.map((k) => k.value)).not.toContain("salary_expectation");
  });

  it("TAI-QUESTIONS batches ≤ 6 questions per Decisions request and keeps only confident matches as binding hints", async () => {
    const fields = Array.from({ length: 8 }, (_, i) =>
      field({
        label:
          i === 0
            ? "What is your notice period?"
            : `Unusual question number ${i}?`,
      })
    );
    const answers = [
      answer("notice_period", { match_patterns: ["notice period"] }),
      answer("hobbies"),
    ];
    const input = matchInputFor(fields, answers, protectedFields(fields));
    const requests: DecisionRequest[] = [];
    const ai = getAiProvider(
      { JOBS_AI_MODE: "fake" },
      {
        fake: {
          onDecide: (r) => {
            requests.push(r);
          },
        },
      }
    );
    const result = await matchQuestionsToBank(ai, input, answers);
    expect(requests.map((r) => r.questions.length)).toEqual([6, 2]);
    for (const request of requests) {
      for (const question of request.questions) {
        expect(question.type).toBe("choice");
        if (question.type === "choice") {
          expect(question.choices.at(-1)).toEqual({
            value: "none",
            description: "None of these",
          });
          expect(question.instructions).toContain("Form question (untrusted)");
        }
      }
    }
    expect(result.hints).toEqual([
      {
        ref: fields[0].ref,
        answer_id: "ans_notice_period",
        question_key: "notice_period",
      },
    ]);
    expect(result.calls).toBe(2);
    // A match below 0.80 is not binding.
    const unsure = getAiProvider(
      { JOBS_AI_MODE: "fake" },
      {
        fake: {
          answer: (q) =>
            q.type === "choice"
              ? {
                  type: "choice",
                  name: q.name,
                  choice: "notice_period",
                  confidence: 0.79,
                  probabilities: [],
                }
              : undefined,
        },
      }
    );
    expect((await matchQuestionsToBank(unsure, input, answers)).hints).toEqual(
      []
    );
  });
});

describe("TAI-PII minimization of the field-plan context (11 §11, 19 §6.1)", () => {
  const stored: StoredFact[] = [
    {
      id: "f1",
      key: "contact.email",
      value: "sari@example.com",
      source: "cv_import",
      cv_id: null,
      cv_entry_id: null,
    },
    {
      id: "f2",
      key: "contact.phone",
      value: "0812-5555-0101",
      source: "cv_import",
      cv_id: null,
      cv_entry_id: null,
    },
    {
      id: "f3",
      key: "contact.location",
      value: "Jl. Kenanga 12, Bandung",
      source: "user_entered",
      cv_id: null,
      cv_entry_id: null,
    },
    {
      id: "f4",
      key: "links.github",
      value: "https://github.com/sari-example",
      source: "user_entered",
      cv_id: null,
      cv_entry_id: null,
    },
    {
      id: "f5",
      key: "work_auth.ID",
      value: { status: "citizen" },
      source: "user_entered",
      cv_id: null,
      cv_entry_id: null,
    },
    {
      id: "f6",
      key: "prefs.min_salary",
      value: { amount: 15_000_000, currency: "IDR", period: "month" },
      source: "user_entered",
      cv_id: null,
      cv_entry_id: null,
    },
  ];
  const answers = [
    answer("notice_period", {
      answer: "1 month",
      match_patterns: ["notice period"],
    }),
    answer("eeo.gender", {
      answer: "Female",
      sensitivity: "protected",
      auto_use: "approval",
    }),
    answer("expected_salary", {
      answer: "20 million",
      auto_use: "never",
      sensitivity: "personal",
      match_patterns: ["expected salary"],
    }),
    answer("favourite_food", { answer: "Rendang" }),
  ];

  it("TAI-PII sends only facts relevant to visible fields; contact facts only with a contact field", async () => {
    const env = {
      CV_KV: { get: () => Promise.resolve(null) } as unknown as KVNamespace,
    };
    const emailOnly = [
      field({ label: "Email address", kind: "email" }),
      field({ label: "Notice period?" }),
    ];
    const facts = await agentFacts(env, "sari@example.com", stored, emailOnly);
    const context = planContext({
      answers,
      facts,
      fields: emailOnly,
      fileSlots: { cv_file: true, cover_letter_file: false },
      generatedTextAllowed: false,
      hints: [],
    });
    expect(context.facts.map((f) => f.key)).toEqual(["contact.email"]);
    expect(context.answers.map((a) => a.question_key)).toEqual([
      "notice_period",
    ]);
    expect(context.withheldAnswers).toEqual([]);
    const text = JSON.stringify(context);
    for (const secret of [
      "0812",
      "Kenanga",
      "github.com",
      "citizen",
      "Female",
      "20 million",
      "Rendang",
      "15000000",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("TAI-PII protected values and never-answers are reported by key only; the CLI's fact_keys narrow further", async () => {
    const env = {
      CV_KV: { get: () => Promise.resolve(null) } as unknown as KVNamespace,
    };
    const fields = [
      field({
        label: "Gender",
        kind: "select",
        options: [option("Female"), option("Male")],
      }),
      field({ label: "Will you require visa sponsorship?" }),
      field({ label: "Expected salary" }),
      field({ label: "Phone", kind: "tel" }),
      field({ label: "Email", kind: "email" }),
    ];
    const facts = await agentFacts(env, "sari@example.com", stored, fields);
    const context = planContext({
      answers,
      facts,
      fields,
      fileSlots: { cv_file: false, cover_letter_file: false },
      generatedTextAllowed: false,
      hints: [],
      requestedKeys: ["contact.phone", "work_auth.ID", "prefs.min_salary"],
    });
    expect(context.facts.map((f) => f.key).sort()).toEqual([
      "contact.phone",
      "prefs.min_salary",
    ]);
    expect(context.withheldFacts).toEqual(["work_auth.ID"]);
    expect(context.withheldAnswers).toEqual([
      { question_key: "eeo.gender", reason: "protected" },
      { question_key: "expected_salary", reason: "never" },
    ]);
    const text = JSON.stringify(context);
    expect(text).not.toContain("Female");
    expect(text).not.toContain("citizen");
    expect(text).not.toContain("20 million");
    expect(text).not.toContain("sari@example.com");
  });

  it("TAI-PII resolves CV entry facts only when a field asks about employment or education, from an owned CV", async () => {
    const kv = new Map<string, string>([["owner:cv:cv-1", "sari@example.com"]]);
    const env = {
      CV_KV: {
        get: (key: string) => Promise.resolve(kv.get(key) ?? null),
      } as unknown as KVNamespace,
    };
    const entry: StoredFact = {
      id: "f9",
      key: "experience[exp-1]",
      value: { cv_id: "cv-1", cv_entry_id: "exp-1" },
      source: "cv_import",
      cv_id: "cv-1",
      cv_entry_id: "exp-1",
    };
    // No stored CV: nothing is resolved.
    expect(
      await agentFacts(
        env,
        "sari@example.com",
        [entry],
        [field({ label: "Current company" })]
      )
    ).toEqual([]);
    const { sampleCv } = await import("../scoring/fixtures.test");
    kv.set(
      "cv:cv-1",
      JSON.stringify(
        sampleCv({ experience: [{ ...sampleCv().experience[0], id: "exp-1" }] })
      )
    );
    const resolved = await agentFacts(
      env,
      "sari@example.com",
      [entry],
      [field({ label: "Current company" })]
    );
    expect(resolved.map((f) => [f.key, f.value])).toEqual([
      ["experience[exp-1].title", "Backend Engineer at Kopi Kenangan Contoh"],
      ["experience[exp-1].company", "Kopi Kenangan Contoh"],
      ["experience[exp-1].start_date", "2023-01"],
      ["experience[exp-1].current", "true"],
    ]);
    expect(
      await agentFacts(
        env,
        "sari@example.com",
        [entry],
        [field({ label: "Email", kind: "email" })]
      )
    ).toEqual([]);
    expect(
      await agentFacts(
        env,
        "mallory@example.com",
        [entry],
        [field({ label: "Employer" })]
      )
    ).toEqual([]);
  });
});
