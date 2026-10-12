// Text made safe for the print cuts (./pdf-fonts.ts) before it reaches a
// @react-pdf document, and set the way the on-screen paper sets it. react-pdf
// takes a character its font lacks from a built-in Helvetica that the file
// does not embed, which prints a wrong glyph over its neighbours; tabs,
// carriage returns and line separators are such characters. Each builder
// runs its document's strings through these helpers.
import { PRINT_COVERAGE } from "./print-coverage";

const LINE_ENDINGS = /\r\n?|[\v\f\u0085\u2028\u2029]/g;
// The hyphen and non-breaking hyphen look like "-" and are not in the cuts.
const HYPHENS = /[\u2010\u2011]/g;
// Intl writes a narrow no-break space in some locales.
const NARROW_NO_BREAK_SPACE = /\u202f/g;
const TABS = /\t/g;
// What CSS collapses: spaces and line breaks (tabs are spaces by now).
const COLLAPSIBLE = /[ \n]+/g;
const SPACES = / +/g;
const NO_BREAK_SPACE = "\u00a0";
// Arrows the cuts lack, written the way a plain keyboard would.
const SUBSTITUTES: Readonly<Record<string, string>> = {
  "\u2190": "<-",
  "\u2192": "->",
  "\u2194": "<->",
  "\u21d0": "<=",
  "\u21d2": "=>",
};
// Emoji have no glyph in any font a PDF here can embed; the joiners,
// variation selectors and skin-tone modifiers that build them go too.
const EMOJI =
  /\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u200d\ufe0e\ufe0f]/u;

function covered(codePoint: number): boolean {
  let low = 0;
  let high = PRINT_COVERAGE.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = PRINT_COVERAGE[middle];
    if (!range) {
      return false;
    }
    const [first, last] = range;
    if (codePoint < first) {
      high = middle - 1;
    } else if (codePoint > last) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * The text with every character the print cuts can set, line breaks kept as
 * `\n`: composed accents (NFC), plain hyphens, tabs as spaces, arrows
 * spelled out, emoji dropped. Anything else the cuts lack (CJK,
 * Cyrillic, Greek) is left as it is.
 */
export function toPrintText(value: string): string {
  const text = value
    .normalize("NFC")
    .replace(LINE_ENDINGS, "\n")
    .replace(HYPHENS, "-")
    .replace(NARROW_NO_BREAK_SPACE, NO_BREAK_SPACE)
    .replace(TABS, " ");
  let printable = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\n" || covered(codePoint)) {
      printable += character;
    } else if (character in SUBSTITUTES) {
      printable += SUBSTITUTES[character];
    } else if (!EMOJI.test(character)) {
      printable += character;
    }
  }
  return printable;
}

/**
 * A one-line field as the paper shows it (`white-space: normal`): runs of
 * spaces and line breaks become one space, and the ends are trimmed.
 */
export function toPrintLine(value: string): string {
  return toPrintText(value).replace(COLLAPSIBLE, " ").trim();
}

/**
 * A multi-line field as the paper shows it (`whitespace-pre-line`), one entry
 * per line for the PDF to set as its own Text (a newline inside one would
 * reach the fallback font): spaces collapse within a line, a trailing line
 * break adds no line, and an empty line keeps its height with a no-break
 * space. Keys stay unique when lines repeat.
 */
export function toPrintLines(value: string): { key: string; text: string }[] {
  const lines = toPrintText(value)
    .split("\n")
    .map((line) => line.replace(SPACES, " ").trim());
  if (lines.length > 1 && lines.at(-1) === "") {
    lines.pop();
  }
  const occurrences = new Map<string, number>();
  return lines.map((line) => {
    const occurrence = (occurrences.get(line) ?? 0) + 1;
    occurrences.set(line, occurrence);
    return {
      key: JSON.stringify([line, occurrence]),
      text: line || NO_BREAK_SPACE,
    };
  });
}
