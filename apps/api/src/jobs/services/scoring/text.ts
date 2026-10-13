// Deterministic text analysis for scoring r1 (07 §3): skill terms from the
// curated dictionary (F1), title tokens and families (F2), seniority words
// (F4), language requirements (F6) and location parsing (F3). Pure functions
// over strings: no I/O, no AI, the same output for the same input.

import type { ScoringProfile } from "@pilihpendidikan/jobs-contracts/scoring";
import {
  skillTermIndex,
  TITLE_FAMILIES,
} from "@pilihpendidikan/jobs-contracts/data";
import { normalizeText } from "@pilihpendidikan/jobs-contracts/fingerprint";

type Seniority = ScoringProfile["seniority"];
type LanguageLevel = ScoringProfile["languages"][number]["level"];

const SPACE_RE = /\s+/;
const TRAILING_PUNCT_RE = /[.\-/]+$/;
const LEADING_PUNCT_RE = /^[.\-/]+/;
const SENTENCE_SPLIT_RE = /(?:\.\s+|[\n\r;•·▪●◦]+|\s-\s|•)/u;

// ---------------------------------------------------------------------------
// Skills (F1)
// ---------------------------------------------------------------------------

/**
 * Dictionary terms that are also everyday words. They count only when written
 * like a technology in the ORIGINAL text (`Go`, `C`, `R`, `Excel`, `Swift`):
 * "go to market", "excel at", "swift delivery" are not skills.
 */
const CASE_SENSITIVE_TERMS: Readonly<Record<string, RegExp>> = {
  go: /(?<![\p{L}\p{N}_.#+-])Go(?![\p{L}\p{N}_#+-])/u,
  c: /(?<![\p{L}\p{N}_.#+-])C(?![\p{L}\p{N}_#+&'-])(?!\.[\p{L}\p{N}])/u,
  r: /(?<![\p{L}\p{N}_.#+-])R(?![\p{L}\p{N}_#+&'-])(?!\.[\p{L}\p{N}])/u,
  excel: /(?<![\p{L}\p{N}_])(?:Excel|EXCEL)(?![\p{L}\p{N}_])/u,
  swift: /(?<![\p{L}\p{N}_])(?:Swift|SWIFT)(?![\p{L}\p{N}_])/u,
  spring:
    /(?<![\p{L}\p{N}_])Spring(?! (?:Boot|(?:19|20)\d\d))(?![\p{L}\p{N}_])/u,
  express: /(?<![\p{L}\p{N}_])(?:Express(?:\.js|JS)?)(?![\p{L}\p{N}_])/u,
  rust: /(?<![\p{L}\p{N}_])Rust(?![\p{L}\p{N}_])/u,
  dart: /(?<![\p{L}\p{N}_])Dart(?![\p{L}\p{N}_])/u,
  unity: /(?<![\p{L}\p{N}_])Unity(?![\p{L}\p{N}_])/u,
  flask: /(?<![\p{L}\p{N}_])Flask(?![\p{L}\p{N}_])/u,
  bash: /(?<![\p{L}\p{N}_])(?:Bash|BASH)(?![\p{L}\p{N}_])/u,
  ruby: /(?<![\p{L}\p{N}_])Ruby(?! on Rails)(?![\p{L}\p{N}_])/u,
};

let maxTermWords = 0;

function termWords(): number {
  if (maxTermWords === 0) {
    for (const term of skillTermIndex().keys()) {
      maxTermWords = Math.max(maxTermWords, term.split(" ").length);
    }
  }
  return maxTermWords;
}

function lookup(phrase: string): string | null {
  if (Object.hasOwn(CASE_SENSITIVE_TERMS, phrase)) {
    return null;
  }
  return skillTermIndex().get(phrase) ?? null;
}

function cleanToken(token: string): string {
  return token.replace(TRAILING_PUNCT_RE, "").replace(LEADING_PUNCT_RE, "");
}

/** The longest dictionary term starting at `tokens[i]`: `[id, words]`. */
function longestTermAt(
  tokens: readonly string[],
  i: number
): [string, number] | null {
  for (let n = Math.min(termWords(), tokens.length - i); n >= 1; n--) {
    const words = tokens.slice(i, i + n);
    const id =
      lookup(words.join(" ")) ??
      lookup([...words.slice(0, -1), cleanToken(words.at(-1) ?? "")].join(" "));
    if (id) {
      return [id, n];
    }
  }
  return null;
}

/** Canonical skill ids mentioned in `text` (longest dictionary match wins). */
export function extractSkillTerms(text: string): Set<string> {
  const found = new Set<string>();
  const tokens = normalizeText(text).split(" ").filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const term = longestTermAt(tokens, i);
    if (term) {
      found.add(term[0]);
      i += term[1];
      continue;
    }
    // "react/redux", "(aws)" → parts.
    for (const part of tokens[i].split("/")) {
      const id = lookup(cleanToken(part));
      if (id) {
        found.add(id);
      }
    }
    i += 1;
  }
  for (const [id, pattern] of Object.entries(CASE_SENSITIVE_TERMS)) {
    if (pattern.test(text)) {
      found.add(skillTermIndex().get(id) ?? id);
    }
  }
  return found;
}

/** A user-entered skill as a canonical id (or its normalized text). */
export function canonicalUserSkills(items: readonly string[]): string[] {
  const out = new Set<string>();
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) {
      continue;
    }
    const direct = skillTermIndex().get(normalized);
    if (direct) {
      out.add(direct);
      continue;
    }
    const inside = extractSkillTerms(item);
    if (inside.size > 0) {
      for (const id of inside) {
        out.add(id);
      }
    } else if (normalized.length <= 100) {
      out.add(normalized);
    }
  }
  return [...out];
}

const REQUIRED_MARKER_RE =
  /\b(must|required|requirements?|mandatory|essential|minimum|at least|wajib|harus|diwajibkan|syarat)\b/i;
const OPTIONAL_MARKER_RE =
  /\b(nice to have|nice-to-have|bonus|plus|preferred|preferably|advantage|desirable|optional|good to have|nilai tambah|diutamakan)\b/i;

/** Splits text into sentences / bullet lines. */
export function sentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The posting's skill terms with their weight (07 §3 F1): terms in a line that
 * says "must" / "required" (and is not a nice-to-have) count double.
 */
export function postingSkillWeights(
  requirements: readonly string[],
  description: string
): Map<string, 1 | 2> {
  const weights = new Map<string, 1 | 2>();
  const lines = [
    ...requirements,
    ...sentences(
      description.length > 60_000 ? description.slice(0, 60_000) : description
    ),
  ];
  for (const line of lines) {
    const terms = extractSkillTerms(line);
    if (terms.size === 0) {
      continue;
    }
    const weight: 1 | 2 =
      REQUIRED_MARKER_RE.test(line) && !OPTIONAL_MARKER_RE.test(line) ? 2 : 1;
    for (const term of terms) {
      if ((weights.get(term) ?? 0) < weight) {
        weights.set(term, weight);
      }
    }
  }
  return weights;
}

// ---------------------------------------------------------------------------
// Titles (F2)
// ---------------------------------------------------------------------------

const TITLE_STOPWORDS = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on-site",
  "contract",
  "full-time",
  "part-time",
  "fulltime",
  "parttime",
  "freelance",
  "and",
  "of",
  "the",
  "for",
  "with",
  "in",
  "at",
  "-",
  "/",
  "&",
  "dan",
  "untuk",
]);

let seniorityPhrases: string[][] | null = null;

function seniorityWordList(): string[][] {
  seniorityPhrases ??= TITLE_FAMILIES.seniority_words
    .map((phrase) => normalizeText(phrase).split(" "))
    .sort((a, b) => b.length - a.length);
  return seniorityPhrases;
}

/** Title tokens without seniority words and filler (07 §3 F2). */
export function titleTokens(title: string): string[] {
  const tokens = normalizeText(title)
    .split(" ")
    .map((token) => cleanToken(token))
    .filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const phrase = seniorityWordList().find((words) =>
      words.every((word, k) => tokens[i + k] === word)
    );
    if (phrase) {
      i += phrase.length;
      continue;
    }
    if (!TITLE_STOPWORDS.has(tokens[i])) {
      out.push(tokens[i]);
    }
    i += 1;
  }
  return out;
}

let familyTitles: Array<{ id: string; words: string[] }> | null = null;

function familyIndex(): Array<{ id: string; words: string[] }> {
  familyTitles ??= TITLE_FAMILIES.families.flatMap((family) =>
    family.titles.map((title) => ({
      id: family.id,
      words: titleTokens(title),
    }))
  );
  return familyTitles;
}

function containsRun(tokens: readonly string[], words: readonly string[]) {
  if (words.length === 0 || words.length > tokens.length) {
    return false;
  }
  for (let i = 0; i + words.length <= tokens.length; i++) {
    if (words.every((word, k) => tokens[i + k] === word)) {
      return true;
    }
  }
  return false;
}

/** Title families whose titles appear in `title` as a word run. */
export function titleFamilyIds(title: string): Set<string> {
  const tokens = titleTokens(title);
  const ids = new Set<string>();
  for (const entry of familyIndex()) {
    if (containsRun(tokens, entry.words)) {
      ids.add(entry.id);
    }
  }
  return ids;
}

/** Token-set Jaccard of two titles (seniority stripped). */
export function titleJaccard(a: string, b: string): number {
  const left = new Set(titleTokens(a));
  const right = new Set(titleTokens(b));
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }
  return shared / (left.size + right.size - shared);
}

// ---------------------------------------------------------------------------
// Seniority (F4)
// ---------------------------------------------------------------------------

export const SENIORITY_ORDER: Readonly<
  Record<Exclude<Seniority, "unknown">, number>
> = {
  intern: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  lead: 4,
  principal: 5,
};

const ROMAN_LEVELS: Readonly<Record<string, Exclude<Seniority, "unknown">>> = {
  i: "junior",
  ii: "mid",
  iii: "senior",
  iv: "lead",
};
const ROMAN_SUFFIX_RE = /\b(iv|iii|ii|i)$/;
const PRINCIPAL_RE =
  /\b(principal|distinguished|director|vp|chief|cto|cio)\b|vice president/;
const LEAD_RE =
  /\b(lead|staff|head|supervisor)\b|engineering manager|team manager/;
const SENIOR_RE = /\b(senior|sr)\b/;
const INTERN_RE = /\b(intern|internship|magang|trainee|apprentice)\b/;
const JUNIOR_RE = /\b(junior|jr|graduate|associate)\b|entry[- ]level/;
const MID_RE = /\b(mid|mid-level|middle|intermediate)\b/;

/** Seniority named in a title or seniority field, or null. */
export function seniorityFromText(
  text: string | null | undefined
): Exclude<Seniority, "unknown"> | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }
  if (PRINCIPAL_RE.test(normalized)) {
    return "principal";
  }
  if (LEAD_RE.test(normalized)) {
    return "lead";
  }
  if (SENIOR_RE.test(normalized)) {
    return "senior";
  }
  if (INTERN_RE.test(normalized)) {
    return "intern";
  }
  if (JUNIOR_RE.test(normalized)) {
    return "junior";
  }
  if (MID_RE.test(normalized)) {
    return "mid";
  }
  const roman = ROMAN_SUFFIX_RE.exec(normalized)?.[1];
  return roman ? (ROMAN_LEVELS[roman] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Languages (F6)
// ---------------------------------------------------------------------------

/** Language names (EN and ID spellings, normalizeText form) → ISO 639-1. */
export const LANGUAGE_CODES: Readonly<Record<string, string>> = {
  english: "en",
  inggris: "en",
  "bahasa inggris": "en",
  indonesian: "id",
  "bahasa indonesia": "id",
  bahasa: "id",
  japanese: "ja",
  jepang: "ja",
  "bahasa jepang": "ja",
  mandarin: "zh",
  chinese: "zh",
  "bahasa mandarin": "zh",
  cantonese: "yue",
  korean: "ko",
  korea: "ko",
  "bahasa korea": "ko",
  german: "de",
  jerman: "de",
  french: "fr",
  perancis: "fr",
  prancis: "fr",
  spanish: "es",
  spanyol: "es",
  arabic: "ar",
  arab: "ar",
  "bahasa arab": "ar",
  dutch: "nl",
  belanda: "nl",
  malay: "ms",
  "bahasa melayu": "ms",
  hindi: "hi",
  portuguese: "pt",
  russian: "ru",
  italian: "it",
  thai: "th",
  vietnamese: "vi",
  tagalog: "tl",
  filipino: "tl",
  javanese: "jv",
  jawa: "jv",
  sundanese: "su",
  sunda: "su",
};

export const LANGUAGE_RANK: Readonly<Record<LanguageLevel, number>> = {
  basic: 1,
  conversational: 2,
  professional: 3,
  fluent: 4,
  native: 5,
};

const LEVEL_WORDS: readonly [RegExp, LanguageLevel][] = [
  [/^(native|mother tongue|bahasa ibu)$/, "native"],
  [
    /^(fluent|fluency|fluently|fasih|lancar|advanced|excellent|full professional)$/,
    "fluent",
  ],
  [
    /^(business|business-level|professional|proficient|proficiency|strong|good|working|mahir|menguasai|communication|written|verbal|spoken|speak|speaking|read|write|skills?)$/,
    "professional",
  ],
  [/^(conversational|intermediate|percakapan)$/, "conversational"],
  [/^(basic|elementary|dasar)$/, "basic"],
];

function levelWord(token: string): LanguageLevel | null {
  for (const [pattern, level] of LEVEL_WORDS) {
    if (pattern.test(token)) {
      return level;
    }
  }
  return null;
}

const LANGUAGE_CODE_RE = /^[a-z]{2,3}$/;

/** A language name (or an ISO code) → ISO code, or null. */
export function languageCode(name: string): string | null {
  const normalized = normalizeText(name);
  if (LANGUAGE_CODES[normalized]) {
    return LANGUAGE_CODES[normalized];
  }
  return LANGUAGE_CODE_RE.test(normalized) ? normalized : null;
}

const LEVEL_WINDOW = 5;

/** The language named at `tokens[i]` ("bahasa inggris" spans two words). */
function languageAt(
  tokens: readonly string[],
  i: number
): { code: string; width: number } | null {
  if (tokens[i] === "bahasa") {
    const code = LANGUAGE_CODES[`bahasa ${tokens[i + 1] ?? ""}`];
    return code ? { code, width: 2 } : null;
  }
  const code = LANGUAGE_CODES[tokens[i]];
  return code ? { code, width: 1 } : null;
}

/** The highest level word within five words of a language name. */
function levelNear(
  tokens: readonly string[],
  i: number,
  width: number
): LanguageLevel | null {
  let best: LanguageLevel | null = null;
  const from = Math.max(0, i - LEVEL_WINDOW);
  const to = Math.min(tokens.length, i + width + LEVEL_WINDOW);
  for (let k = from; k < to; k++) {
    const level = k >= i && k < i + width ? null : levelWord(tokens[k]);
    if (level && (!best || LANGUAGE_RANK[level] > LANGUAGE_RANK[best])) {
      best = level;
    }
  }
  return best;
}

/**
 * Languages a posting requires, with the level asked (07 §3 F6): a language
 * name within five words of a level word ("fluent in Japanese", "Bahasa
 * Indonesia (native)", "excellent written English"). Lines that say "nice to
 * have" / "plus" are optional and ignored.
 */
export function languageRequirements(
  requirements: readonly string[],
  description: string
): Map<string, LanguageLevel> {
  const required = new Map<string, LanguageLevel>();
  for (const line of [...requirements, ...sentences(description)]) {
    if (OPTIONAL_MARKER_RE.test(line)) {
      continue;
    }
    const tokens = normalizeText(line)
      .split(" ")
      .map(cleanToken)
      .filter(Boolean);
    let i = 0;
    while (i < tokens.length) {
      const language = languageAt(tokens, i);
      if (!language) {
        i += 1;
        continue;
      }
      const level = levelNear(tokens, i, language.width);
      const current = required.get(language.code);
      if (
        level &&
        (!current || LANGUAGE_RANK[level] > LANGUAGE_RANK[current])
      ) {
        required.set(language.code, level);
      }
      i += language.width;
    }
  }
  return required;
}

/** CV proficiency text → a profile level. */
const PROFICIENCY_RULES: readonly [RegExp, LanguageLevel][] = [
  [/native|mother|ibu/, "native"],
  [/fluent|fasih|lancar|advanced|c1|c2|full professional/, "fluent"],
  [/professional|business|proficient|b2|upper/, "professional"],
  [/conversational|intermediate|b1|menengah/, "conversational"],
];

export function languageLevelOf(text: string): LanguageLevel {
  const normalized = normalizeText(text);
  return (
    PROFICIENCY_RULES.find(([pattern]) => pattern.test(normalized))?.[1] ??
    "basic"
  );
}

// ---------------------------------------------------------------------------
// Locations (F3)
// ---------------------------------------------------------------------------

/** Country names and big cities (normalizeText form) → ISO 3166-1 alpha-2. */
export const PLACE_COUNTRIES: Readonly<Record<string, string>> = {
  indonesia: "ID",
  jakarta: "ID",
  "dki jakarta": "ID",
  "jakarta selatan": "ID",
  "south jakarta": "ID",
  bandung: "ID",
  surabaya: "ID",
  yogyakarta: "ID",
  jogja: "ID",
  semarang: "ID",
  medan: "ID",
  bali: "ID",
  denpasar: "ID",
  tangerang: "ID",
  bekasi: "ID",
  depok: "ID",
  bogor: "ID",
  makassar: "ID",
  malang: "ID",
  singapore: "SG",
  singapura: "SG",
  malaysia: "MY",
  "kuala lumpur": "MY",
  penang: "MY",
  thailand: "TH",
  bangkok: "TH",
  vietnam: "VN",
  "viet nam": "VN",
  "ho chi minh city": "VN",
  hanoi: "VN",
  philippines: "PH",
  manila: "PH",
  australia: "AU",
  sydney: "AU",
  melbourne: "AU",
  "new zealand": "NZ",
  japan: "JP",
  tokyo: "JP",
  "south korea": "KR",
  korea: "KR",
  seoul: "KR",
  china: "CN",
  shanghai: "CN",
  beijing: "CN",
  "hong kong": "HK",
  taiwan: "TW",
  taipei: "TW",
  india: "IN",
  bangalore: "IN",
  bengaluru: "IN",
  "united states": "US",
  usa: "US",
  us: "US",
  "new york": "US",
  "san francisco": "US",
  seattle: "US",
  canada: "CA",
  toronto: "CA",
  vancouver: "CA",
  "united kingdom": "GB",
  uk: "GB",
  london: "GB",
  ireland: "IE",
  dublin: "IE",
  germany: "DE",
  berlin: "DE",
  munich: "DE",
  netherlands: "NL",
  amsterdam: "NL",
  france: "FR",
  paris: "FR",
  spain: "ES",
  portugal: "PT",
  sweden: "SE",
  switzerland: "CH",
  "united arab emirates": "AE",
  uae: "AE",
  dubai: "AE",
};

const CITY_COUNTRY_SPLIT_RE = /[,;|()/–—]+|\s-\s/;
const PLACE_NOISE = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on-site",
  "wfh",
  "anywhere",
  "worldwide",
  "global",
]);
const TWO_LETTER_RE = /^[a-z]{2}$/;

/** Best-effort `{city, country_code}` of a free-text location. */
export function parsePlace(raw: string): {
  city?: string;
  country_code?: string;
} {
  let country: string | undefined;
  let city: string | undefined;
  for (const part of raw.split(CITY_COUNTRY_SPLIT_RE)) {
    const normalized = normalizeText(part);
    if (!normalized || PLACE_NOISE.has(normalized)) {
      continue;
    }
    const code =
      PLACE_COUNTRIES[normalized] ??
      (TWO_LETTER_RE.test(normalized) ? normalized.toUpperCase() : undefined);
    if (code) {
      country ??= code;
      if (normalized.length > 3 && !COUNTRY_NAME_SET.has(normalized)) {
        city ??= normalized;
      }
      continue;
    }
    city ??= normalized;
  }
  return {
    ...(city ? { city } : {}),
    ...(country ? { country_code: country } : {}),
  };
}

const COUNTRY_NAME_SET = new Set([
  "indonesia",
  "singapore",
  "singapura",
  "malaysia",
  "thailand",
  "vietnam",
  "viet nam",
  "philippines",
  "australia",
  "new zealand",
  "japan",
  "south korea",
  "korea",
  "china",
  "hong kong",
  "taiwan",
  "india",
  "united states",
  "usa",
  "canada",
  "united kingdom",
  "uk",
  "ireland",
  "germany",
  "netherlands",
  "france",
  "spain",
  "portugal",
  "sweden",
  "switzerland",
  "united arab emirates",
  "uae",
]);

/** City names compare in normalizeText form. */
export function sameCity(
  a: string | undefined,
  b: string | undefined
): boolean {
  if (!(a && b)) {
    return false;
  }
  const left = normalizeText(a);
  const right = normalizeText(b);
  return (
    left === right ||
    left.startsWith(`${right} `) ||
    right.startsWith(`${left} `)
  );
}

export function words(text: string): string[] {
  return normalizeText(text).split(SPACE_RE).filter(Boolean);
}
