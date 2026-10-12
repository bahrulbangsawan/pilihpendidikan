import {
  toPrintLine,
  toPrintLines,
  toPrintText,
} from "@rulisme/ui/print/pdf-text";
import type { CVData } from "@/components/cv-form";

// Fields whose newlines are the user's own line breaks, which the preview
// shows with `whitespace-pre-line`. Every other field is one line, as the
// preview shows it.
const MULTILINE_FIELDS = new Set(["summary", "description"]);

function toPdfValue(value: unknown, field: string): unknown {
  if (typeof value === "string") {
    return MULTILINE_FIELDS.has(field)
      ? toPrintText(value)
      : toPrintLine(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => toPdfValue(item, field));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toPdfValue(item, key)])
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
  return toPdfValue(data, "") as CVData;
}

/**
 * The lines of a free-text field (the summary, an award or a project
 * description) as the preview's `whitespace-pre-line` shows them, for the PDF
 * to set each as its own Text instead of keeping a newline inside one.
 */
export function getTextLines(text: string): { key: string; text: string }[] {
  return toPrintLines(text);
}

export function getDescriptionLines(
  description: string | undefined
): { key: string; text: string }[] {
  const occurrences = new Map<string, number>();
  const lines: { key: string; text: string }[] = [];

  for (const line of description?.split("\n") ?? []) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    const occurrence = (occurrences.get(text) ?? 0) + 1;
    occurrences.set(text, occurrence);
    lines.push({ key: JSON.stringify([text, occurrence]), text });
  }

  return lines;
}

export function formatOngoingEndDate(
  endDate: string,
  current: boolean,
  formatDate: (value: string) => string,
  presentLabel = "Present"
): string {
  if (current || !endDate) {
    return presentLabel;
  }
  return formatDate(endDate);
}

export function hasPreviewSectionContent(
  data: CVData,
  sectionId: CVData["sectionOrder"][number]
): boolean {
  switch (sectionId) {
    case "summary":
      return Boolean(data.summary);
    case "experience":
      return data.experience.some((entry) => entry.company || entry.title);
    case "education":
      return data.education.some((entry) => entry.institution || entry.degree);
    case "skills":
      return data.skills.some((category) => category.items.length > 0);
    case "awards":
      return data.awards.some((entry) => entry.title);
    case "certificates":
      return data.certificates.some((entry) => entry.name);
    case "languages":
      return data.languages.some((entry) => entry.language);
    case "projects":
      return data.projects.length > 0;
    case "volunteer":
      return data.volunteer.some((entry) => entry.organization || entry.role);
    default:
      return false;
  }
}
