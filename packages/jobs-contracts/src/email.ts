// Email application templates (09 §5.1) and the optional AI paragraph
// contract (09 §5.2).
//
// Templates live in `email-templates/{en,id}.txt` (the source of truth);
// `email-templates-data.ts` is generated from them because Workers cannot
// read files at runtime. Syntax: `{path}` or `{path|"fallback"}`.
import { z } from "zod";
import { EMAIL_TEMPLATES } from "./email-templates-data";
import type { Locale } from "./enums";
import { defineSchema } from "./registry";

export interface EmailTemplatePosting {
  company_name: string;
  /** Adds "(ref. …)" after the company name when present. */
  source_job_ref?: string | null;
  title: string;
}

export interface RenderEmailTemplateInput {
  /** Canonical fact key → value (`contact.full_name`, `links.linkedin`, …). */
  facts: Readonly<Record<string, unknown>>;
  locale: Locale;
  /** User-reviewed paragraph (09 §5.2); omitted when empty. */
  optionalParagraph?: string | null;
  posting: EmailTemplatePosting;
  /** Falls back to "Hiring Team" / "Tim Rekrutmen". */
  recipientName?: string | null;
}

export interface RenderedEmail {
  body_text: string;
  locale: Locale;
  subject: string;
}

const PLACEHOLDER = /\{([a-z_]+(?:\.[a-z0-9_]+)*)(?:\|"([^"]*)")?\}/g;
const HAS_PLACEHOLDER = /\{[a-z_]+(?:\.[a-z0-9_]+)*(?:\|"[^"]*")?\}/;
const SUBJECT_LINE = /^(?:Subject|Subjek): (.*)$/;
const CRLF = /\r\n?/g;
const CONTROL_EXCEPT_NEWLINE = /(?!\n)\p{Cc}/gu;
const CONTROL_ALL = /\p{Cc}/gu;
const INLINE_WHITESPACE = /\s+/g;
const TRAILING_LINE_SPACE = /[ \t]+$/gm;
const EXTRA_BLANK_LINES = /\n{3,}/g;
const TRAILING_SEPARATOR = /\s+[—–-]\s*$/;

/** One-line values: controls removed, whitespace collapsed, trimmed. */
function inlineValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(CONTROL_ALL, " ").replace(INLINE_WHITESPACE, " ").trim();
}

/** The paragraph keeps its line breaks; other controls are removed. */
function paragraphValue(value: string | null | undefined): string {
  return (value ?? "")
    .replace(CRLF, "\n")
    .replace(CONTROL_EXCEPT_NEWLINE, "")
    .trim();
}

function resolvePlaceholder(
  path: string,
  input: RenderEmailTemplateInput
): string {
  switch (path) {
    case "posting.title":
      return inlineValue(input.posting.title);
    case "posting.company_name":
      return inlineValue(input.posting.company_name);
    case "posting.source_ref_clause": {
      const ref = inlineValue(input.posting.source_job_ref);
      return ref === "" ? "" : ` (ref. ${ref})`;
    }
    case "recipient_name":
      return inlineValue(input.recipientName);
    case "optional_paragraph":
      return paragraphValue(input.optionalParagraph);
    default:
      return path.startsWith("facts.")
        ? inlineValue(input.facts[path.slice("facts.".length)])
        : "";
  }
}

function renderLine(line: string, input: RenderEmailTemplateInput): string {
  return line.replace(
    PLACEHOLDER,
    (_match, path: string, fallback?: string) => {
      const value = resolvePlaceholder(path, input);
      return value === "" ? (fallback ?? "") : value;
    }
  );
}

/**
 * Renders a template:
 * - the first line `Subject: …` / `Subjek: …` becomes `subject` (one line;
 *   a dangling " —" left by an empty value is removed);
 * - a body line that contained placeholders and renders blank is dropped, so
 *   a missing optional fact never leaves "undefined", "null" or a hole;
 * - at most one blank line in a row, no trailing spaces, no leading or
 *   trailing blank lines.
 */
export function renderEmailTemplate(
  input: RenderEmailTemplateInput
): RenderedEmail {
  const template = EMAIL_TEMPLATES[input.locale].replace(CRLF, "\n");
  const [header = "", ...bodyLines] = template.split("\n");
  const subjectMatch = SUBJECT_LINE.exec(header);
  if (!subjectMatch) {
    throw new Error(`Email template ${input.locale} lacks a subject line`);
  }
  const subject = inlineValue(renderLine(subjectMatch[1] ?? "", input)).replace(
    TRAILING_SEPARATOR,
    ""
  );
  const rendered: string[] = [];
  for (const line of bodyLines) {
    const out = renderLine(line, input);
    if (HAS_PLACEHOLDER.test(line) && out.trim() === "") {
      continue;
    }
    rendered.push(out);
  }
  const bodyText = rendered
    .join("\n")
    .replace(TRAILING_LINE_SPACE, "")
    .replace(EXTRA_BLANK_LINES, "\n\n")
    .trim();
  return { subject, body_text: bodyText, locale: input.locale };
}

/** Limits of email applications (09 §5.3, §8). */
export const EMAIL_LIMITS = {
  bodyBytes: 20_480,
  attachments: 5,
  attachmentBytesTotal: 10_485_760,
  recipientLength: 254,
  paragraphLength: 600,
} as const;

/** Structured Outputs result of "Draft a paragraph" (09 §5.2). */
export const EmailParagraphDraftSchema = defineSchema(
  "email",
  "EmailParagraphDraft",
  z.strictObject({
    paragraph: z.string().max(EMAIL_LIMITS.paragraphLength),
    source_bullet_ids: z.array(z.string()),
    source_fact_keys: z.array(z.string()),
  })
);
export type EmailParagraphDraft = z.infer<typeof EmailParagraphDraftSchema>;

/** The strict `text.format` object for the paragraph draft (09 §5.2). */
export const EMAIL_PARAGRAPH_JSON_SCHEMA = {
  name: "email_paragraph",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["paragraph", "source_bullet_ids", "source_fact_keys"],
    properties: {
      paragraph: { type: "string", maxLength: EMAIL_LIMITS.paragraphLength },
      source_bullet_ids: { type: "array", items: { type: "string" } },
      source_fact_keys: { type: "array", items: { type: "string" } },
    },
  },
} as const;
