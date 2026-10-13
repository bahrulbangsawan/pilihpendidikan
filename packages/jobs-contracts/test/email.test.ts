import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_TEMPLATES } from "../src/email-templates-data";
import { EmailParagraphDraftSchema, renderEmailTemplate } from "../src/email";
import { LOCALES } from "../src/enums";

const posting = { title: "Finance Staff", company_name: "Acme Indonesia" };
const FORBIDDEN = /undefined|null|NaN|\{|\}|\[object/;
const TRIPLE_NEWLINE = /\n{3}/;
const TRAILING_SPACE = /[ \t]$/m;

describe("email templates (09 §5.1)", () => {
  test.each(LOCALES.map((locale) => [locale] as const))(
    "T9-10 %s renders with missing optional facts and no undefined text",
    (locale) => {
      const out = renderEmailTemplate({
        locale,
        posting,
        facts: { "contact.full_name": "Rahma Putri" },
      });
      const text = `${out.subject}\n${out.body_text}`;
      expect(text).not.toMatch(FORBIDDEN);
      expect(out.body_text).not.toMatch(TRIPLE_NEWLINE);
      expect(out.body_text).not.toMatch(TRAILING_SPACE);
      expect(out.body_text.endsWith("Rahma Putri")).toBe(true);
      expect(out.body_text).toContain(
        locale === "en"
          ? "Dear Hiring Team,"
          : "Yth. Tim Rekrutmen Acme Indonesia,"
      );
      expect(out.subject).toBe(
        locale === "en"
          ? "Application for Finance Staff — Rahma Putri"
          : "Lamaran Finance Staff — Rahma Putri"
      );
    }
  );

  test("T9-10 every optional fact present renders every line", () => {
    const out = renderEmailTemplate({
      locale: "en",
      posting: { ...posting, source_job_ref: "FIN-042" },
      facts: {
        "contact.full_name": "Rahma Putri",
        "contact.phone": "+62 812-3456-7890",
        "links.linkedin": "https://www.linkedin.com/in/rahma",
      },
      recipientName: "Ms. Sari",
      optionalParagraph:
        "I led month-end closing for three entities.\r\nI use SAP daily.",
    });
    expect(out.body_text).toBe(
      [
        "Dear Ms. Sari,",
        "",
        "I am writing to apply for the Finance Staff position at Acme Indonesia (ref. FIN-042).",
        "Please find my CV attached.",
        "",
        "I led month-end closing for three entities.",
        "I use SAP daily.",
        "",
        "Kind regards,",
        "Rahma Putri",
        "+62 812-3456-7890",
        "https://www.linkedin.com/in/rahma",
      ].join("\n")
    );
  });

  test("T9-10 a missing name never leaves a dangling separator; values cannot inject headers", () => {
    const out = renderEmailTemplate({
      locale: "en",
      posting: {
        title: "Analyst\r\nBcc: attacker@example.com",
        company_name: "Acme",
      },
      facts: {},
    });
    expect(out.subject).toBe(
      "Application for Analyst Bcc: attacker@example.com"
    );
    expect(out.subject).not.toContain("\n");
    expect(`${out.subject}${out.body_text}`).not.toMatch(FORBIDDEN);
  });

  test("T9-10 non-string facts and empty values render nothing", () => {
    const out = renderEmailTemplate({
      locale: "id",
      posting,
      facts: {
        "contact.full_name": "Rahma",
        "contact.phone": { country: "ID" },
        "links.linkedin": "  ",
      },
      recipientName: "   ",
      optionalParagraph: "  ",
    });
    expect(out.body_text).not.toMatch(FORBIDDEN);
    expect(out.body_text).toContain("Yth. Tim Rekrutmen Acme Indonesia,");
    expect(out.body_text.endsWith("Hormat saya,\nRahma")).toBe(true);
  });

  test("T9-10 the generated template module mirrors email-templates/*.txt", () => {
    for (const locale of LOCALES) {
      const txt = readFileSync(
        join(import.meta.dir, "..", "email-templates", `${locale}.txt`),
        "utf8"
      );
      expect<string>(EMAIL_TEMPLATES[locale]).toBe(txt);
    }
  });

  test("T9-10 the AI paragraph draft is ≤ 600 characters with provenance", () => {
    expect(
      EmailParagraphDraftSchema.safeParse({
        paragraph: "x",
        source_bullet_ids: ["experience:e:0"],
        source_fact_keys: [],
      }).success
    ).toBe(true);
    expect(
      EmailParagraphDraftSchema.safeParse({
        paragraph: "x".repeat(601),
        source_bullet_ids: [],
        source_fact_keys: [],
      }).success
    ).toBe(false);
  });
});
