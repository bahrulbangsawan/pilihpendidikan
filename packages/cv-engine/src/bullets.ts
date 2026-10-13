// The units a tailoring model may select or rephrase (08 §4.2): each line of
// an entry's description and each sentence of the summary, with an id that
// says where it came from. Entries themselves (companies, titles, dates,
// institutions, degrees, skills, languages, certificates) are not bullets.
import { DEFAULT_SECTION_ORDER } from "./document";
import { getDescriptionLines } from "./template-utils";
import type { CVData, CVSectionId } from "./types";

export type CvBulletSection =
  | "summary"
  | "experience"
  | "projects"
  | "volunteer"
  | "awards"
  | "certificates";

export interface CvBullet {
  /**
   * `${section}:${entry_id}:${lineIndex}`, e.g. "experience:exp-1:2" (the
   * third line). Summary sentences are "summary:0:<sentenceIndex>".
   */
  id: string;
  section: CvBulletSection;
  /** The entry's own id; "0" for the summary, which has no entry. */
  entry_id: string;
  /** The line or sentence as stored, trimmed: the unit the templates set. */
  text: string;
}

/** The entry id the summary's sentences carry. */
export const SUMMARY_ENTRY_ID = "0";

// A sentence ends at ., ! or ? (and any closing quotes or brackets) when
// whitespace and the start of another sentence follow: an uppercase letter,
// a digit, or an opening quote or bracket.
const SENTENCE_BREAK = /(?<=[.!?]["'”’)\]]*)\s+(?=[\p{Lu}\p{N}"'“‘([])/gu;
// Words that end in a full stop without ending the sentence, initials
// included.
const ABBREVIATION =
  /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Inc|Ltd|Co|Corp|No|vs|etc|e\.g|i\.e|Jl|\p{Lu})\.$/u;

/**
 * The sentences of one line of text, each exactly as written (trimmed).
 * Conservative: a full stop after a common abbreviation or an initial does
 * not end a sentence, and nothing splits inside a number ("3.5") or before
 * a lowercase word.
 */
export function splitSentences(line: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of line.matchAll(SENTENCE_BREAK)) {
    const sentence = line.slice(start, match.index);
    if (ABBREVIATION.test(sentence)) {
      continue;
    }
    sentences.push(sentence.trim());
    start = match.index + match[0].length;
  }
  sentences.push(line.slice(start).trim());
  return sentences.filter(Boolean);
}

function summaryBullets(summary: string): CvBullet[] {
  const sentences = getDescriptionLines(summary).flatMap(({ text }) =>
    splitSentences(text)
  );
  return sentences.map((text, index) => ({
    id: `summary:${SUMMARY_ENTRY_ID}:${index}`,
    section: "summary",
    entry_id: SUMMARY_ENTRY_ID,
    text,
  }));
}

function entryBullets(
  section: Exclude<CvBulletSection, "summary">,
  entries: readonly { id: string; description?: string }[]
): CvBullet[] {
  return entries.flatMap((entry) =>
    getDescriptionLines(entry.description).map(({ text }, lineIndex) => ({
      id: `${section}:${entry.id}:${lineIndex}`,
      section,
      entry_id: entry.id,
      text,
    }))
  );
}

function sectionBullets(cv: CVData, section: CVSectionId): CvBullet[] {
  switch (section) {
    case "summary":
      return summaryBullets(cv.summary ?? "");
    case "experience":
      return entryBullets("experience", cv.experience ?? []);
    case "projects":
      return entryBullets("projects", cv.projects ?? []);
    case "volunteer":
      return entryBullets("volunteer", cv.volunteer ?? []);
    case "awards":
      return entryBullets("awards", cv.awards ?? []);
    // Certificates, education, skills and languages carry no free text.
    default:
      return [];
  }
}

/**
 * Every bullet of the CV, in reading order: sections as `sectionOrder` lists
 * them (any section it leaves out follows, in the default order), entries in
 * document order, lines top to bottom. Description lines split exactly as
 * the templates split them (getDescriptionLines): one per line, trimmed,
 * blank lines skipped; the line index counts only the lines kept.
 */
export function flattenCvBullets(cv: CVData): CvBullet[] {
  const order = [
    ...new Set<CVSectionId>([
      ...(cv.sectionOrder ?? []),
      ...DEFAULT_SECTION_ORDER,
    ]),
  ];
  return order.flatMap((section) => sectionBullets(cv, section));
}
