import { describe, expect, it } from "bun:test";
import type {
  FieldPlan,
  FieldPlanItem,
} from "@pilihpendidikan/jobs-contracts/agent";
import { FieldPlanSchema } from "@pilihpendidikan/jobs-contracts/agent";
import {
  field,
  observation,
  option,
} from "../../routes/ai-proxy/fixtures.test";
import type { StoredAnswer } from "../../repo/ai-proxy";
import type { AgentFact } from "./facts";
import { protectedFields } from "./questions";
import type { ValidationInput } from "./validator";
import { canonicalDate, validateFieldPlan, valuesEqual } from "./validator";

const fact = (
  key: string,
  value: string,
  raw: unknown = value,
  sensitivity: AgentFact["sensitivity"] = "none"
): AgentFact => ({
  key,
  value,
  raw,
  source: "user_entered",
  sensitivity,
});

const answer = (
  overrides: Partial<StoredAnswer> &
    Pick<StoredAnswer, "question_key" | "answer">
): StoredAnswer => ({
  id: `ans_${overrides.question_key}`,
  answer_kind: "text",
  sensitivity: "none",
  auto_use: "always",
  match_patterns: [],
  ...overrides,
});

function item(
  ref: string,
  signature: string,
  overrides: Partial<FieldPlanItem> = {}
): FieldPlanItem {
  return {
    plan_item: "p1",
    ref,
    signature,
    action: "fill",
    value_source: "fact",
    fact_key: null,
    answer_id: null,
    option_value: null,
    value: null,
    confidence: 0.95,
    sensitivity: "none",
    needs_human: false,
    question_key: null,
    reason: "model",
    ...overrides,
  };
}

function setup(
  fields: ReturnType<typeof field>[],
  extra: Partial<ValidationInput> = {}
): ValidationInput {
  const obs = observation({ fields });
  return {
    observation: obs,
    facts: [
      fact("contact.email", "sari@example.com"),
      fact("contact.phone", "0812-5555-0101"),
      fact("contact.country", "Indonesia"),
      fact("links.linkedin", "https://www.linkedin.com/in/sari-example/"),
      fact("eligibility.age_18_plus", "true", true),
      fact(
        "prefs.min_salary",
        "IDR 15000000 per month",
        { amount: 15_000_000 },
        "personal"
      ),
      fact("work_auth.ID", "citizen", { status: "citizen" }, "protected"),
    ],
    answers: [],
    hints: [],
    protectedRefs: protectedFields(obs.fields),
    fileSlots: { cv_file: true, cover_letter_file: false },
    generatedTextAllowed: false,
    mode: "approval",
    ...extra,
  };
}

function plan(
  items: FieldPlanItem[],
  missing: FieldPlan["missing"] = []
): FieldPlan {
  return { items, missing };
}

describe("TAI-FIELDPLAN the 19 §6.4 validator (server side)", () => {
  it("TAI-FIELDPLAN keeps fact values that equal the fact after kind normalization and recomputes them", () => {
    const email = field({ label: "Email", kind: "email" });
    const phone = field({ label: "Phone", kind: "tel" });
    const link = field({ label: "LinkedIn", kind: "url" });
    const input = setup([email, phone, link]);
    const report = validateFieldPlan(
      plan([
        item(email.ref, email.signature, {
          fact_key: "contact.email",
          value: "SARI@example.com",
        }),
        item(phone.ref, phone.signature, {
          fact_key: "contact.phone",
          value: "+62 812 5555 0101",
        }),
        item(link.ref, link.signature, {
          fact_key: "links.linkedin",
          value: "linkedin.com/in/sari-example",
        }),
      ]),
      input
    );
    expect(
      report.plan.items.map((i) => [i.value, i.needs_human, i.action])
    ).toEqual([
      ["sari@example.com", false, "fill"],
      ["0812-5555-0101", false, "fill"],
      ["https://www.linkedin.com/in/sari-example/", false, "fill"],
    ]);
    expect(report.plan.missing).toEqual([]);
    expect(FieldPlanSchema.parse(report.plan)).toEqual(report.plan);
  });

  it("TAI-FIELDPLAN a fabricated or altered value becomes needs_human (11 T-13)", () => {
    const email = field({ label: "Email", kind: "email", required: true });
    const years = field({
      label: "Years of Kubernetes experience?",
      kind: "number",
    });
    const report = validateFieldPlan(
      plan([
        item(email.ref, email.signature, {
          fact_key: "contact.email",
          value: "other@example.com",
        }),
        item(years.ref, years.signature, {
          fact_key: "skills.kubernetes_years",
          value: "7",
        }),
      ]),
      setup([email, years])
    );
    for (const result of report.plan.items) {
      expect(result).toMatchObject({
        needs_human: true,
        value: null,
        value_source: "none",
        fact_key: null,
      });
      expect(result.reason).toStartWith("validator:");
    }
    expect(report.plan.missing.map((m) => m.ref)).toEqual([
      email.ref,
      years.ref,
    ]);
    expect(report.downgraded).toBe(2);
  });

  it("TAI-FIELDPLAN options must be enabled and entailed by a fact or answer", () => {
    const country = field({
      label: "Country",
      kind: "select",
      options: [
        option("Singapore", "SG"),
        option("Indonesia", "ID"),
        { ...option("Malaysia", "MY"), disabled: true },
      ],
    });
    const adult = field({
      label: "Are you 18 or older?",
      kind: "radio_group",
      options: [option("Yes"), option("No")],
    });
    const report = validateFieldPlan(
      plan([
        item(country.ref, country.signature, {
          value_source: "option",
          option_value: "ID",
          fact_key: "contact.country",
          action: "select",
        }),
        item(adult.ref, adult.signature, {
          value_source: "option",
          option_value: "Yes",
          fact_key: "eligibility.age_18_plus",
          action: "select",
        }),
      ]),
      setup([country, adult])
    );
    expect(
      report.plan.items.map((i) => [
        i.option_value,
        i.value,
        i.needs_human,
        i.sensitivity,
      ])
    ).toEqual([
      ["ID", "Indonesia", false, "none"],
      ["Yes", "Yes", false, "none"],
    ]);
    const bad = validateFieldPlan(
      plan([
        item(country.ref, country.signature, {
          value_source: "option",
          option_value: "SG",
          fact_key: "contact.country",
        }),
        item(adult.ref, adult.signature, {
          value_source: "option",
          option_value: "Yes",
        }),
      ]),
      setup([country, adult])
    );
    expect(bad.plan.items.every((i) => i.needs_human && i.value === null)).toBe(
      true
    );
    const disabled = validateFieldPlan(
      plan([
        item(country.ref, country.signature, {
          value_source: "option",
          option_value: "MY",
          fact_key: "contact.country",
        }),
      ]),
      setup([country])
    );
    expect(disabled.plan.items[0].needs_human).toBe(true);
  });

  it("TAI-FIELDPLAN answers: never is refused, approval is proposed, always fills, choice answers pick their option", () => {
    const notice = field({ label: "Notice period?", kind: "text" });
    const sponsor = field({
      label: "Do you have a portfolio?",
      kind: "radio_group",
      options: [option("Yes"), option("No")],
    });
    const relocate = field({
      label: "Are you willing to relocate?",
      kind: "radio_group",
      options: [option("Yes"), option("No")],
    });
    const answers = [
      answer({ question_key: "notice_period", answer: "1 month" }),
      answer({
        question_key: "has_portfolio",
        answer: "yes",
        answer_kind: "boolean",
        auto_use: "never",
      }),
      answer({
        question_key: "relocation",
        answer: "No",
        answer_kind: "choice",
        sensitivity: "personal",
        auto_use: "approval",
      }),
    ];
    const report = validateFieldPlan(
      plan([
        item(notice.ref, notice.signature, {
          value_source: "answer",
          answer_id: "ans_notice_period",
          value: "1 month",
        }),
        item(sponsor.ref, sponsor.signature, {
          value_source: "answer",
          answer_id: "ans_has_portfolio",
          option_value: "Yes",
        }),
        item(relocate.ref, relocate.signature, {
          value_source: "answer",
          answer_id: "ans_relocation",
          option_value: "No",
        }),
      ]),
      setup([notice, sponsor, relocate], { answers })
    );
    const [a, b, c] = report.plan.items;
    expect(a).toMatchObject({
      value: "1 month",
      needs_human: false,
      question_key: "notice_period",
    });
    expect(b).toMatchObject({
      needs_human: true,
      value: null,
      value_source: "none",
    });
    expect(c).toMatchObject({
      needs_human: true,
      value: "No",
      option_value: "No",
      value_source: "answer",
      sensitivity: "personal",
    });
    expect(report.plan.missing.map((m) => m.ref)).toEqual([sponsor.ref]);
  });

  it("TAI-FIELDPLAN protected questions (model OR lexicon) are never auto-filled; a stored approval answer is proposed", () => {
    const gender = field({
      label: "What is your gender?",
      kind: "select",
      options: [
        option("Female"),
        option("Male"),
        option("Decline to self-identify"),
      ],
    });
    const visa = field({
      label: "Will you require visa sponsorship?",
      kind: "radio_group",
      options: [option("Yes"), option("No")],
    });
    const answers = [
      answer({
        question_key: "eeo.gender",
        answer: "Female",
        answer_kind: "choice",
        sensitivity: "protected",
        auto_use: "approval",
      }),
      answer({
        question_key: "requires_sponsorship",
        answer: "No",
        answer_kind: "boolean",
        sensitivity: "none",
        auto_use: "always",
      }),
    ];
    const report = validateFieldPlan(
      plan([
        // The model claims "none" and an always answer: the lexicon wins.
        item(gender.ref, gender.signature, {
          value_source: "option",
          option_value: "Male",
          sensitivity: "none",
        }),
        item(visa.ref, visa.signature, {
          value_source: "answer",
          answer_id: "ans_requires_sponsorship",
          option_value: "No",
        }),
      ]),
      setup([gender, visa], { answers })
    );
    const [g, v] = report.plan.items;
    expect(g).toMatchObject({
      sensitivity: "protected",
      needs_human: true,
      value_source: "answer",
      answer_id: "ans_eeo.gender",
      value: "Female",
      question_key: "eeo.gender",
    });
    expect(v).toMatchObject({
      sensitivity: "protected",
      needs_human: true,
      value: null,
    });
    // Without a stored approval answer nothing is suggested.
    const bare = validateFieldPlan(
      plan([item(gender.ref, gender.signature, { value_source: "none" })]),
      setup([gender])
    );
    expect(bare.plan.items[0]).toMatchObject({
      needs_human: true,
      value: null,
      sensitivity: "protected",
    });
    // A protected fact (work_auth) is never a source.
    const auth = field({ label: "Citizenship", kind: "text" });
    const fromFact = validateFieldPlan(
      plan([
        item(auth.ref, auth.signature, {
          fact_key: "work_auth.ID",
          value: "citizen",
        }),
      ]),
      setup([auth])
    );
    expect(fromFact.plan.items[0]).toMatchObject({
      needs_human: true,
      value: null,
    });
  });

  it("TAI-FIELDPLAN personal facts (salary) are proposed via approval, not auto-filled", () => {
    const salary = field({ label: "Expected salary", kind: "text" });
    const report = validateFieldPlan(
      plan([
        item(salary.ref, salary.signature, {
          fact_key: "prefs.min_salary",
          value: "IDR 15000000 per month",
        }),
      ]),
      setup([salary])
    );
    expect(report.plan.items[0]).toMatchObject({
      needs_human: true,
      value: "IDR 15000000 per month",
      sensitivity: "personal",
      value_source: "fact",
    });
  });

  it("TAI-FIELDPLAN files: CV slot on a PDF-accepting file input; doc-only or missing slots need the human", () => {
    const cv = field({
      label: "Resume",
      kind: "file",
      accept: ".pdf,.doc,.docx",
      required: true,
    });
    const docOnly = field({
      label: "CV (Word only)",
      kind: "file",
      accept: ".doc,.docx",
      required: true,
    });
    const cover = field({
      label: "Cover letter",
      kind: "file",
      accept: ".pdf",
    });
    const coverRequired = field({
      label: "Cover letter",
      kind: "file",
      accept: ".pdf",
      required: true,
    });
    const report = validateFieldPlan(
      plan([
        item(cv.ref, cv.signature, {
          value_source: "cv_file",
          action: "upload",
        }),
        item(docOnly.ref, docOnly.signature, {
          value_source: "cv_file",
          action: "upload",
        }),
        item(cover.ref, cover.signature, {
          value_source: "cover_letter_file",
          action: "upload",
        }),
        item(coverRequired.ref, coverRequired.signature, {
          value_source: "cover_letter_file",
          action: "upload",
        }),
      ]),
      setup([cv, docOnly, cover, coverRequired])
    );
    expect(
      report.plan.items.map((i) => [i.action, i.value_source, i.needs_human])
    ).toEqual([
      ["upload", "cv_file", false],
      ["upload", "none", true],
      ["skip", "none", false],
      ["upload", "none", true],
    ]);
    expect(report.plan.items[1].reason).toContain("unsupported_file_type");
  });

  it("TAI-FIELDPLAN generated text only when allowed, never in auto mode, only for motivation fields, ≤ 2,000 chars", () => {
    const why = field({
      label: "Why do you want to work here?",
      kind: "textarea",
    });
    const address = field({ label: "Address", kind: "textarea" });
    const proposal = (
      f: ReturnType<typeof field>,
      value = "I like distributed systems."
    ) => item(f.ref, f.signature, { value_source: "generated_text", value });
    const allowed = validateFieldPlan(
      plan([proposal(why)]),
      setup([why], { generatedTextAllowed: true })
    );
    expect(allowed.plan.items[0]).toMatchObject({
      value_source: "generated_text",
      needs_human: false,
      value: "I like distributed systems.",
    });
    const off = validateFieldPlan(plan([proposal(why)]), setup([why]));
    expect(off.plan.items[0].needs_human).toBe(true);
    const auto = validateFieldPlan(
      plan([proposal(why)]),
      setup([why], { generatedTextAllowed: true, mode: "auto" })
    );
    expect(auto.plan.items[0].needs_human).toBe(true);
    const wrongField = validateFieldPlan(
      plan([proposal(address)]),
      setup([address], { generatedTextAllowed: true })
    );
    expect(wrongField.plan.items[0].needs_human).toBe(true);
    const long = validateFieldPlan(
      plan([proposal(why, "x".repeat(2001))]),
      setup([why], { generatedTextAllowed: true })
    );
    expect(long.plan.items[0].needs_human).toBe(true);
  });

  it("TAI-FIELDPLAN skips touched and prefilled fields, drops unknown refs, adds omitted fields and handles refusals", () => {
    const touched = field({
      label: "Email",
      kind: "email",
      user_touched: true,
    });
    const prefilled = field({ label: "Phone", kind: "tel", has_value: true });
    const invalid = field({
      label: "Country",
      kind: "text",
      has_value: true,
      invalid: true,
    });
    const omitted = field({ label: "Favourite colour", required: true });
    const input = setup([touched, prefilled, invalid, omitted]);
    const report = validateFieldPlan(
      plan([
        item(touched.ref, touched.signature, { fact_key: "contact.email" }),
        item(prefilled.ref, prefilled.signature, { fact_key: "contact.phone" }),
        item(invalid.ref, invalid.signature, {
          fact_key: "contact.country",
          value: "Indonesia",
        }),
        item("f999", "0000000000000000", { fact_key: "contact.email" }),
        item(invalid.ref, "ffffffffffffffff", { fact_key: "contact.email" }),
      ]),
      input
    );
    expect(report.dropped).toEqual(["f999", invalid.ref]);
    expect(
      report.plan.items.map((i) => [i.ref, i.action, i.needs_human])
    ).toEqual([
      [touched.ref, "skip", false],
      [prefilled.ref, "skip", false],
      [invalid.ref, "fill", false],
      [omitted.ref, "fill", true],
    ]);
    expect(report.plan.items.map((i) => i.plan_item)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
    const refused = validateFieldPlan(null, input);
    expect(
      refused.plan.items.filter((i) => i.needs_human).map((i) => i.ref)
    ).toEqual([invalid.ref, omitted.ref]);
  });

  it("TAI-FIELDPLAN low confidence (< 0.75) needs the human but keeps the validated suggestion", () => {
    const email = field({ label: "Email", kind: "email" });
    const report = validateFieldPlan(
      plan([
        item(email.ref, email.signature, {
          fact_key: "contact.email",
          value: "sari@example.com",
          confidence: 0.6,
        }),
      ]),
      setup([email])
    );
    expect(report.plan.items[0]).toMatchObject({
      needs_human: true,
      value: "sari@example.com",
    });
  });

  it("TAI-FIELDPLAN kind normalization never changes content", () => {
    expect(valuesEqual("tel", "+62 812-5555-0101", "0812 5555 0101")).toBe(
      true
    );
    expect(valuesEqual("tel", "+62 812-5555-0102", "0812 5555 0101")).toBe(
      false
    );
    expect(valuesEqual("url", "https://github.com/x/", "github.com/x")).toBe(
      true
    );
    expect(valuesEqual("url", "https://github.com/y", "github.com/x")).toBe(
      false
    );
    expect(valuesEqual("month", "03/2024", "2024-03")).toBe(true);
    expect(valuesEqual("date", "2024-03-01", "2024-3-1")).toBe(true);
    expect(canonicalDate("Mar 2024")).toBe("2024-03");
    expect(valuesEqual("text", "Sari  Wulandari", "sari wulandari")).toBe(true);
    expect(valuesEqual("text", "Sari W.", "Sari Wulandari")).toBe(false);
  });
});
