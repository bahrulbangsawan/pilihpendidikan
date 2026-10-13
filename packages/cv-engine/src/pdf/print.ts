// The PDF's type comes from the shared print module, @rulisme/ui/print/*
// (DESIGN.md § Implementation › Print artifacts): the merged Inter cuts with
// their line-break policy (pdf-fonts) and the text normaliser (pdf-text).
// cv-engine sits below @rulisme/ui (the UI library re-exports ./format.ts),
// so it takes both from the app that renders, as each builder already
// registers the fonts itself:
//
//   registerPrintFonts(Font);                  // @rulisme/ui/print/pdf-fonts
//   registerCvPrintText({ toPrintText, toPrintLine, toPrintLines });
//
// renderCvPdfBlob runs that setup through its `registerFonts` option, with
// the `Font` it renders with. A render without the text helpers throws
// rather than print characters the cuts lack.
import type { CVData } from "../types";

/**
 * The family every page sets: PRINT_FONT_FAMILY of
 * @rulisme/ui/print/pdf-fonts, registered by the caller at 400 / 600 / 700.
 */
export const PDF_FONT_FAMILY = "Inter";

/** The text normaliser of @rulisme/ui/print/pdf-text. */
export interface CvPrintText {
  /** One-line fields: spaces and line breaks collapse, ends trimmed. */
  toPrintLine: (value: string) => string;
  /** Multi-line fields, one entry per line, keys unique. */
  toPrintLines: (value: string) => { key: string; text: string }[];
  /** Characters the cuts can set, line breaks kept as `\n`. */
  toPrintText: (value: string) => string;
}

let printText: CvPrintText | null = null;

/** Hands cv-engine the print text helpers; call it before the first render. */
export function registerCvPrintText(text: CvPrintText): void {
  printText = text;
}

/** The registered helpers; throws when the caller has not registered them. */
export function requirePrintText(): CvPrintText {
  if (!printText) {
    throw new Error(
      "cv-engine: register the print text helpers (registerCvPrintText with @rulisme/ui/print/pdf-text) before rendering a CV PDF"
    );
  }
  return printText;
}

// Fields whose newlines are the user's own line breaks, which the preview
// shows with `whitespace-pre-line`. Every other field is one line, as the
// preview shows it.
const MULTILINE_FIELDS = new Set(["summary", "description"]);

function toPdfValue(value: unknown, field: string, text: CvPrintText): unknown {
  if (typeof value === "string") {
    return MULTILINE_FIELDS.has(field)
      ? text.toPrintText(value)
      : text.toPrintLine(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => toPdfValue(item, field, text));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        toPdfValue(item, key, text),
      ])
    );
  }
  return value;
}

/**
 * The CV with every string made safe for the PDF's print cuts and set as the
 * preview sets it (`@rulisme/ui/print/pdf-text`): characters the cuts lack
 * never reach react-pdf's unembedded fallback font, and one-line fields
 * collapse their spaces and line breaks. The summary and descriptions keep
 * the user's line breaks; the templates set each line on its own
 * (`getTextLines`, `getDescriptionLines`).
 */
export function toPdfText(data: CVData): CVData {
  return toPdfValue(data, "", requirePrintText()) as CVData;
}

/**
 * The lines of a free-text field (the summary, an award or a project
 * description) as the preview's `whitespace-pre-line` shows them, for the PDF
 * to set each as its own Text instead of keeping a newline inside one.
 */
export function getTextLines(text: string): { key: string; text: string }[] {
  return requirePrintText().toPrintLines(text);
}
