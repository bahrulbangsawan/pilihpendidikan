// Inter on paper: the type of the builders' @react-pdf documents (the CV
// templates, the invoice, the portfolio deck). DESIGN.md § Implementation ›
// Print artifacts has the rules; each builder calls registerPrintFonts with
// react-pdf's `Font` once, before its first render, and sets
// PRINT_FONT_FAMILY on its pages.
//
// react-pdf cannot read the theme's variable font, so the PDF embeds static
// cuts at the three print weights: 400 text, 600 headings, 700 the title.
// Each cut is one font holding the @fontsource latin, latin-ext and
// vietnamese subsets (scripts/build-print-fonts.sh merges them; the table in
// ./print-coverage.ts lists what they hold). One font per weight matters:
// react-pdf breaks a word wherever its font changes, and sets the hyphen or
// ellipsis it inserts in a cut that may not have it. No document sets
// italics, so there is no italic cut. Only the glyphs a PDF uses are
// embedded in it.
import inter400 from "./fonts/inter-print-400.woff?url";
import inter600 from "./fonts/inter-print-600.woff?url";
import inter700 from "./fonts/inter-print-700.woff?url";

/** The family every @react-pdf page sets. */
export const PRINT_FONT_FAMILY = "Inter";

const CUTS = [
  { src: inter400, fontWeight: 400 },
  { src: inter600, fontWeight: 600 },
  { src: inter700, fontWeight: 700 },
];

/** The part of @react-pdf/renderer's `Font` this module uses. */
export interface PrintFontStore {
  register(options: {
    family: string;
    fonts: { src: string; fontWeight: number }[];
  }): void;
  getFont(descriptor: { fontFamily: string; fontWeight: number }): unknown;
  registerHyphenationCallback(callback: (word: string) => string[]): void;
}

interface FontSource {
  load: () => Promise<void>;
  data?: unknown;
}

interface Glyph {
  codePoints?: unknown;
}

function isFontSource(value: unknown): value is FontSource {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<FontSource>).load === "function"
  );
}

// Every letter keeps its character. fontkit caches each glyph the first time
// it is asked for, and the PDF subsetter asks for the parts of composite
// glyphs without one (Inter builds É from E and an accent, í from ı). react-pdf
// maps text to glyphs through those characters, so in the next PDF of the
// session such a letter would drop out of the page and of copied text
// ("Ezra Yıldız" printed as "zra Yıldız", copied as "zra Yldz"). A glyph
// cached without characters takes those of the first text that uses it, as
// every other glyph does. The repair checks what it touches and otherwise
// leaves the font alone: a newer react-pdf can at worst bring the problem
// back, never fail a download.
function keepCharacters(font: object): void {
  const loaded = font as {
    getGlyph?: (id: number, characters?: number[]) => Glyph | undefined;
  };
  if (typeof loaded.getGlyph !== "function") {
    return;
  }
  const getGlyph = loaded.getGlyph.bind(font);
  loaded.getGlyph = (id: number, characters?: number[]) => {
    const glyph = getGlyph(id, characters);
    if (
      Array.isArray(characters) &&
      characters.length > 0 &&
      Array.isArray(glyph?.codePoints) &&
      glyph.codePoints.length === 0
    ) {
      glyph.codePoints = characters;
    }
    return glyph;
  };
}

const repaired = new WeakSet<object>();

function repairOnLoad(store: PrintFontStore, fontWeight: number): void {
  let source: unknown;
  try {
    source = store.getFont({ fontFamily: PRINT_FONT_FAMILY, fontWeight });
  } catch {
    return;
  }
  if (!isFontSource(source)) {
    return;
  }
  const font = source;
  const load = font.load.bind(font);
  font.load = async () => {
    await load();
    const data = font.data;
    if (typeof data === "object" && data !== null && !repaired.has(data)) {
      repaired.add(data);
      keepCharacters(data);
    }
  };
}

// Where react-pdf may break a line inside a run of text. The browser sets
// the on-screen paper with `overflow-wrap: anywhere` and never hyphenates;
// react-pdf breaks only where this callback splits a word, and marks the
// break with a hyphen unless the next piece is empty, which its line breaker
// turns into zero-width space. So words stay whole, except:
// - after a hyphen, a dash or a slash, without a hyphen, as browsers break;
// - in a run longer than the column holds (a URL, an email, an IBAN), also
//   after its separators (. @ _ ? & = # ~ + :), without a hyphen;
// - and as a last resort, a piece still that long breaks anywhere, marked
//   with a hyphen, so nothing runs off its column.
// MAX_UNBROKEN_RUN is longer than real words, Indonesian compounds such as
// "dipertanggungjawabkan" included, and fits every text column of the three
// documents but the invoice's custom-field labels, which pass a smaller one
// to their Text (`hyphenationCallback={hyphenateWithin(…)}`).
const MAX_UNBROKEN_RUN = 26;
const BREAK_AFTER = new Set(["-", "\u2013", "\u2014", "/"]);
const BREAK_AFTER_IN_LONG_RUNS = new Set([
  ".",
  "@",
  "_",
  "?",
  "&",
  "=",
  "#",
  "~",
  "+",
  ":",
]);
const NO_HYPHEN = "";
// A character with the combining accents typed after it, or stray accents:
// the pieces always join back into the run.
const GRAPHEMES = /\P{M}\p{M}*|\p{M}+/gu;

// Never right before a separator, where the inserted hyphen would sit next
// to the run's own.
function breakAnywhere(run: string): string[] {
  const pieces: string[] = [];
  for (const grapheme of run.match(GRAPHEMES) ?? [run]) {
    const separator =
      BREAK_AFTER.has(grapheme) || BREAK_AFTER_IN_LONG_RUNS.has(grapheme);
    if (separator && pieces.length > 0) {
      pieces[pieces.length - 1] += grapheme;
    } else {
      pieces.push(grapheme);
    }
  }
  return pieces;
}

/** A hyphenation callback for a column that holds `maxRun` characters. */
export function hyphenateWithin(maxRun: number): (word: string) => string[] {
  return (word: string) => {
    if (!word.trim()) {
      return [word];
    }
    const long = word.length > maxRun;
    const pieces: string[] = [];
    let run = "";
    for (const grapheme of word.match(GRAPHEMES) ?? [word]) {
      run += grapheme;
      if (
        BREAK_AFTER.has(grapheme) ||
        (long && BREAK_AFTER_IN_LONG_RUNS.has(grapheme))
      ) {
        pieces.push(run, NO_HYPHEN);
        run = "";
      }
    }
    if (run) {
      pieces.push(run);
    } else {
      pieces.pop();
    }
    return pieces.flatMap((piece) =>
      piece.length > maxRun ? breakAnywhere(piece) : [piece]
    );
  };
}

/** The callback every Text uses unless it passes its own. */
export const hyphenateForPrint = hyphenateWithin(MAX_UNBROKEN_RUN);

const registered = new WeakSet<object>();

/** Registers the print family, its repair and the line-break policy once. */
export function registerPrintFonts(store: PrintFontStore): void {
  if (registered.has(store)) {
    return;
  }
  registered.add(store);
  store.register({
    family: PRINT_FONT_FAMILY,
    fonts: CUTS.map((cut) => ({ ...cut })),
  });
  for (const { fontWeight } of CUTS) {
    repairOnLoad(store, fontWeight);
  }
  store.registerHyphenationCallback(hyphenateForPrint);
}
