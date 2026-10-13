// Token classes of the no-fabrication rule V4 (08 §4.4). A rephrased or
// merged bullet (and the summary, V6) may contain no token of these classes
// that its sources do not already contain:
//
//   numbers     every number (10, 3.5, 2019, 10,000 → 10000), "%" / percent,
//               magnitudes (5k, 2M, million, juta), currency markers ($, Rp,
//               USD …) and number words (ten, dozens, doubled, puluhan …)
//   dates       month names and abbreviations (English and Indonesian);
//               years are numbers already
//   proper      capitalized words not at the start of a sentence, plus — at
//               any position — acronyms (MIT, AWS) and mixed-case words
//               (PhD, GitHub, iOS), capitalized terms of the posting
//               (prompt-injection bait such as "Acme" or "Harvard"), and
//               sentence openers that are neither in the sources nor an
//               ordinary bullet opener (action verb, -ed / -ing form,
//               function word): "Stripe integration cut latency" is caught
//   skills      skills-dictionary terms (07 §3 F1), compared as canonical ids
//               (JS ≡ JavaScript)
//   credentials degree / certification words (master, phd, sarjana, certified …)
//   seniority   title inflation words (senior, principal, director, CTO …)
//
// The last two classes extend the spec's list in its stated direction
// ("false rejections cost a retry; false acceptance would be a fabricated
// claim"): degrees and titles are entry-level facts the model may never
// write (V8), so they may not reappear inside free text either.
//
// Source sides are generous: a proper-noun / credential / seniority / date
// token is "present" when the same word occurs anywhere in the sources, in
// any case or position.

import { skillTermIndex } from "@pilihpendidikan/jobs-contracts/data";
import { normalizeText } from "@pilihpendidikan/jobs-contracts/fingerprint";

export type TokenClass =
  | "number"
  | "date"
  | "proper_noun"
  | "skill"
  | "credential"
  | "seniority";

export interface ExtractedTokens {
  credentials: Set<string>;
  dates: Set<string>;
  numbers: Set<string>;
  /** Proper-noun candidates of this text (lowercased). */
  properNouns: Set<string>;
  seniority: Set<string>;
  /** Capitalized words that open a sentence (lowercased). */
  sentenceInitials: Set<string>;
  skills: Set<string>;
  /** Every word of the text, lowercased (the generous source side). */
  words: Set<string>;
}

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const GROUPED_RE = /^\d{1,3}(?:[.,]\d{3})+$/;
const MAGNITUDE_RE =
  /\d(?:[.,]?\d)*\s?(k|mm|mn|m|bn|b|t|thousand|million|billion|trillion|ribu|juta|miliar|milyar|triliun)\b/gi;
const PERCENT_RE = /%|\bpercent\b|\bpersen\b|\bpct\b|\bper cent\b/i;
const CURRENCY_SYMBOL_RE = /[$€£¥₹₩₫฿]/gu;
const CURRENCY_CODE_RE =
  /\b(rp|idr|usd|eur|gbp|sgd|myr|jpy|aud|cad|inr|cny|us\$)\b/gi;
// Hyphens split words ("React-based" → React + based) on both sides alike.
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’.+#&]*/gu;
const SENTENCE_END_RE = /[.!?]["'”’)\]]*$/;
const SENTENCE_GAP_RE = /^["'”’)\]]*[!?.]/;
const TRAILING_PUNCT_RE = /[.'’]+$/;
const POSSESSIVE_RE = /['’]s$/i;
const UPPER_START_RE = /^\p{Lu}/u;
const UPPER_RE = /\p{Lu}/gu;
const LOWER_THEN_UPPER_RE = /\p{Ll}\p{Lu}/u;
const LETTER_RE = /\p{L}/u;
const SKILL_WORD_CHAR_RE = /[\p{L}\p{N}+#]/u;

const NUMBER_WORDS = new Set([
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "hundreds",
  "thousand",
  "thousands",
  "million",
  "millions",
  "billion",
  "billions",
  "trillion",
  "dozen",
  "dozens",
  "score",
  "scores",
  "double",
  "doubled",
  "doubling",
  "triple",
  "tripled",
  "tripling",
  "quadrupled",
  "twofold",
  "threefold",
  "tenfold",
  "twice",
  "thrice",
  "half",
  "halved",
  "decade",
  "decades",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
  "puluh",
  "puluhan",
  "ratus",
  "ratusan",
  "ribu",
  "ribuan",
  "juta",
  "jutaan",
  "miliar",
  "milyar",
  "triliun",
  "lusin",
]);

const MONTHS = new Map<string, string>([
  ["january", "01"],
  ["jan", "01"],
  ["januari", "01"],
  ["february", "02"],
  ["feb", "02"],
  ["februari", "02"],
  ["march", "03"],
  ["mar", "03"],
  ["maret", "03"],
  ["april", "04"],
  ["apr", "04"],
  ["june", "06"],
  ["jun", "06"],
  ["juni", "06"],
  ["july", "07"],
  ["jul", "07"],
  ["juli", "07"],
  ["august", "08"],
  ["aug", "08"],
  ["agustus", "08"],
  ["agu", "08"],
  ["september", "09"],
  ["sep", "09"],
  ["sept", "09"],
  ["october", "10"],
  ["oct", "10"],
  ["oktober", "10"],
  ["okt", "10"],
  ["november", "11"],
  ["nov", "11"],
  ["december", "12"],
  ["dec", "12"],
  ["desember", "12"],
  ["des", "12"],
  ["mei", "05"],
  ["q1", "q1"],
  ["q2", "q2"],
  ["q3", "q3"],
  ["q4", "q4"],
  ["h1", "h1"],
  ["h2", "h2"],
]);

const CREDENTIALS = new Set([
  "bachelor",
  "bachelors",
  "master",
  "masters",
  "phd",
  "ph.d",
  "doctorate",
  "doctoral",
  "doctor",
  "mba",
  "bsc",
  "b.sc",
  "msc",
  "m.sc",
  "b.a",
  "m.a",
  "b.eng",
  "m.eng",
  "beng",
  "meng",
  "diploma",
  "degree",
  "degrees",
  "graduate",
  "graduated",
  "postgraduate",
  "undergraduate",
  "alumnus",
  "alumni",
  "certified",
  "certification",
  "certifications",
  "certificate",
  "certificates",
  "licensed",
  "license",
  "licence",
  "accredited",
  "chartered",
  "fellowship",
  "scholarship",
  "sarjana",
  "magister",
  "doktor",
  "ijazah",
  "cum",
  "laude",
  "summa",
  "magna",
  "honors",
  "honours",
  "valedictorian",
  "s.kom",
  "s.t",
  "s.e",
  "s1",
  "s2",
  "s3",
  "d3",
  "d4",
]);

const SENIORITY = new Set([
  "senior",
  "sr",
  "principal",
  "staff",
  "head",
  "director",
  "directors",
  "chief",
  "executive",
  "vp",
  "vice",
  "president",
  "cto",
  "ceo",
  "cfo",
  "coo",
  "cio",
  "cpo",
  "founder",
  "cofounder",
  "owner",
  "partner",
  "manager",
  "supervisor",
  "architect",
  "expert",
  "specialist",
  "veteran",
]);

// Words that start every second bullet in capitals without being names.
const PRONOUNS = new Set(["i", "i'm", "i’ve", "i've", "i’m"]);

function normalizeNumber(raw: string): string {
  if (GROUPED_RE.test(raw)) {
    return String(Number(raw.replace(/[.,]/g, "")));
  }
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? String(value) : raw;
}

function numbersOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(NUMBER_RE)) {
    out.add(normalizeNumber(match[0]));
  }
  for (const match of text.matchAll(MAGNITUDE_RE)) {
    out.add(`mag:${match[1].toLowerCase()}`);
  }
  if (PERCENT_RE.test(text)) {
    out.add("percent");
  }
  for (const match of text.matchAll(CURRENCY_SYMBOL_RE)) {
    out.add(`cur:${match[0]}`);
  }
  for (const match of text.matchAll(CURRENCY_CODE_RE)) {
    out.add(`cur:${match[1].toLowerCase()}`);
  }
  return out;
}

function cleanWord(raw: string): string {
  return raw.replace(POSSESSIVE_RE, "").replace(TRAILING_PUNCT_RE, "");
}

function isAcronymOrMixedCase(word: string): boolean {
  const uppers = word.match(UPPER_RE)?.length ?? 0;
  return uppers >= 2 || LOWER_THEN_UPPER_RE.test(word);
}

interface WordToken {
  /** As written, trailing punctuation removed. */
  clean: string;
  lower: string;
  sentenceStart: boolean;
}

function wordsOf(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  let sentenceStart = true;
  for (const match of text.matchAll(WORD_RE)) {
    const raw = match[0];
    const clean = cleanWord(raw);
    if (clean) {
      tokens.push({ clean, lower: clean.toLowerCase(), sentenceStart });
    }
    // The next word starts a sentence when this one ends with . ! or ?
    // (closing quotes / brackets allowed), looking past the word itself.
    const after = text.slice(
      (match.index ?? 0) + raw.length,
      (match.index ?? 0) + raw.length + 3
    );
    sentenceStart = SENTENCE_END_RE.test(raw) || SENTENCE_GAP_RE.test(after);
  }
  return tokens;
}

// Ordinary sentence openers of CV bullets: action verbs and function words.
// A capitalized word that opens a sentence, is not in the sources and is not
// one of these (nor an -ed / -ing form) is treated as a possible new name:
// "Stripe integration cut latency" must not slip through as "sentence start".
const COMMON_OPENERS = new Set([
  "a",
  "an",
  "the",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "on",
  "to",
  "with",
  "within",
  "without",
  "across",
  "after",
  "before",
  "during",
  "over",
  "under",
  "through",
  "while",
  "this",
  "that",
  "these",
  "those",
  "our",
  "my",
  "we",
  "each",
  "every",
  "all",
  "both",
  "key",
  "also",
  "built",
  "drove",
  "grew",
  "led",
  "ran",
  "made",
  "won",
  "wrote",
  "taught",
  "brought",
  "set",
  "cut",
  "kept",
  "held",
  "own",
  "owns",
  "lead",
  "leads",
  "build",
  "builds",
  "design",
  "designs",
  "develop",
  "develops",
  "manage",
  "manages",
  "maintain",
  "maintains",
  "support",
  "supports",
  "improve",
  "improves",
  "create",
  "creates",
  "deliver",
  "delivers",
  "drive",
  "drives",
  "help",
  "helps",
  "work",
  "works",
  "write",
  "writes",
  "run",
  "runs",
  "mentor",
  "mentors",
  "partner",
  "responsible",
  "end",
  "cross",
  "full",
  "high",
  "new",
  "core",
  "backend",
  "frontend",
  "internal",
  "customer",
  "client",
  "team",
]);
const VERB_FORM_RE = /(?:ed|ing)$/;

function isOrdinaryOpener(word: string): boolean {
  return COMMON_OPENERS.has(word) || VERB_FORM_RE.test(word);
}

function sentenceInitialsOf(tokens: readonly WordToken[]): Set<string> {
  const out = new Set<string>();
  for (const token of tokens) {
    if (
      token.sentenceStart &&
      UPPER_START_RE.test(token.clean) &&
      LETTER_RE.test(token.clean) &&
      !PRONOUNS.has(token.lower)
    ) {
      out.add(token.lower);
    }
  }
  return out;
}

function properNounsOf(tokens: readonly WordToken[]): Set<string> {
  const out = new Set<string>();
  for (const token of tokens) {
    if (!LETTER_RE.test(token.clean) || PRONOUNS.has(token.lower)) {
      continue;
    }
    const capitalized = UPPER_START_RE.test(token.clean);
    if (
      (capitalized && !token.sentenceStart) ||
      isAcronymOrMixedCase(token.clean)
    ) {
      out.add(token.lower);
    }
  }
  return out;
}

let skillTerms: string[] | null = null;

function sortedSkillTerms(): string[] {
  skillTerms ??= [...skillTermIndex().keys()].sort(
    (a, b) => b.length - a.length
  );
  return skillTerms;
}

function isSkillBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) {
    return true;
  }
  return !SKILL_WORD_CHAR_RE.test(text[index]);
}

/** Canonical ids of the skills-dictionary terms in `text` (07 §3 F1). */
export function skillsOf(text: string): Set<string> {
  const normalized = normalizeText(text);
  const index = skillTermIndex();
  const out = new Set<string>();
  for (const term of sortedSkillTerms()) {
    let from = normalized.indexOf(term);
    while (from !== -1) {
      if (
        isSkillBoundary(normalized, from - 1) &&
        isSkillBoundary(normalized, from + term.length)
      ) {
        out.add(index.get(term) as string);
        break;
      }
      from = normalized.indexOf(term, from + 1);
    }
  }
  return out;
}

/** Every V4 class of one text. */
export function extractTokens(text: string): ExtractedTokens {
  const tokens = wordsOf(text);
  const words = new Set(tokens.map((t) => t.lower));
  const dates = new Set<string>();
  const credentials = new Set<string>();
  const seniority = new Set<string>();
  const numbers = numbersOf(text);
  for (const word of words) {
    const month = MONTHS.get(word);
    if (month) {
      dates.add(month);
    }
    if (NUMBER_WORDS.has(word)) {
      numbers.add(`word:${word}`);
    }
    if (CREDENTIALS.has(word)) {
      credentials.add(word);
    }
    if (SENIORITY.has(word)) {
      seniority.add(word);
    }
  }
  return {
    numbers,
    dates,
    properNouns: properNounsOf(tokens),
    sentenceInitials: sentenceInitialsOf(tokens),
    skills: skillsOf(text),
    credentials,
    seniority,
    words,
  };
}

/**
 * Capitalized terms a posting introduces (its non-initial capitalized words,
 * acronyms and mixed-case words): if one of them shows up in model text at
 * any position without being in the sources, it is treated as a new proper
 * noun (prompt-injection bait, 08 T8-06).
 */
export function postingTermsOf(text: string): Set<string> {
  return properNounsOf(wordsOf(text));
}

export interface NewToken {
  class: TokenClass;
  token: string;
}

/**
 * Tokens of `candidate` absent from `sources` (V4). `postingTerms` adds the
 * posting's capitalized terms to the proper-noun check at every position.
 */
function missing(
  cls: TokenClass,
  tokens: Iterable<string>,
  present: (token: string) => boolean
): NewToken[] {
  const out: NewToken[] = [];
  for (const token of tokens) {
    if (!present(token)) {
      out.push({ class: cls, token });
    }
  }
  return out;
}

function properNounCandidates(
  out: ExtractedTokens,
  postingTerms: ReadonlySet<string>
): Set<string> {
  const proper = new Set(out.properNouns);
  for (const word of out.words) {
    if (postingTerms.has(word)) {
      proper.add(word);
    }
  }
  for (const word of out.sentenceInitials) {
    if (!isOrdinaryOpener(word)) {
      proper.add(word);
    }
  }
  return proper;
}

export function newTokens(
  candidate: string,
  sources: readonly string[],
  postingTerms: ReadonlySet<string> = new Set()
): NewToken[] {
  const out = extractTokens(candidate);
  const source = extractTokens(sources.join("\n"));
  const terms = skillTermIndex();
  // A skill spelled differently in the sources (JS / JavaScript) is the same
  // claim: the skill class decides it, not the proper-noun class.
  const knownProper = (p: string): boolean => {
    const skill = terms.get(normalizeText(p));
    return (
      source.words.has(p) || (skill !== undefined && source.skills.has(skill))
    );
  };
  return [
    ...missing("number", out.numbers, (n) => source.numbers.has(n)),
    ...missing("date", out.dates, (d) => source.dates.has(d)),
    ...missing(
      "proper_noun",
      properNounCandidates(out, postingTerms),
      knownProper
    ),
    ...missing("skill", out.skills, (k) => source.skills.has(k)),
    ...missing("credential", out.credentials, (c) => source.words.has(c)),
    ...missing("seniority", out.seniority, (w) => source.words.has(w)),
  ];
}
