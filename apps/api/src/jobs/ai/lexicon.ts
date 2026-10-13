// Deterministic lexicons of the field planner (19 §6.1–§6.4, 03 §9), in
// English and Indonesian:
//
//   protectedCategory(text)   the protected-class lexicon of 19 §6.2: a hit
//                             forces `sensitivity = protected` whatever the
//                             model says (never auto-filled, 11 T-14)
//   isPersonalQuestion(text)  salary, relocation, start date (03 §9 personal)
//   factKeysForField(field)   which applicant facts a visible field may use,
//                             so only relevant facts reach the model (11 §11)
//   isQuestionField(field)    fields matched against the answer bank (19 §6.2)
//   isFreeTextMotivation(f)   where generated text may ever be proposed
//
// Labels are untrusted page text; these functions only read them.

import type { ObservedField } from "@pilihpendidikan/jobs-contracts/agent";
import { normalizeText } from "@pilihpendidikan/jobs-contracts/fingerprint";

export const PROTECTED_CATEGORIES = [
  "gender",
  "race_ethnicity",
  "disability",
  "veteran",
  "sexual_orientation",
  "criminal_history",
  "age",
  "religion",
  "health",
  "union",
  "citizenship_visa",
] as const;
export type ProtectedCategory = (typeof PROTECTED_CATEGORIES)[number];

const PROTECTED_LEXICON: readonly [ProtectedCategory, RegExp][] = [
  [
    "gender",
    /\b(gender|sex|pronouns?|male|female|non-binary|jenis kelamin|kelamin)\b/,
  ],
  [
    "race_ethnicity",
    /\b(race|racial|ethnicity|ethnic|hispanic|latino|latinx|suku|ras|etnis)\b/,
  ],
  [
    "disability",
    /\b(disability|disabilities|disabled|impairment|accommodation|difabel|disabilitas|penyandang)\b/,
  ],
  [
    "veteran",
    /\b(veteran|veterans|military service|armed forces|protected veteran)\b/,
  ],
  [
    "sexual_orientation",
    /\b(sexual orientation|lgbtq?|lgbtqia|heterosexual|homosexual|bisexual|gay|lesbian|orientasi seksual)\b/,
  ],
  [
    "criminal_history",
    /\b(criminal|conviction|convicted|felony|felonies|misdemeanou?r|arrest|arrested|offen[cs]e record|catatan kriminal|skck|pidana)\b/,
  ],
  [
    "age",
    /\b(date of birth|birth ?date|birthday|dob|how old|age|tanggal lahir|tgl lahir|usia|umur)\b/,
  ],
  ["religion", /\b(religion|religious|faith|church|mosque|agama|keyakinan)\b/],
  [
    "health",
    /\b(health|medical|medication|pregnan\w*|illness|diagnos\w*|kesehatan|riwayat penyakit|vaccinat\w*)\b/,
  ],
  ["union", /\b(union membership|labou?r union|trade union|serikat pekerja)\b/],
  [
    "citizenship_visa",
    /\b(citizen|citizenship|nationality|visa|sponsor|sponsorship|work authori[sz]ation|authori[sz]ed to work|right to work|work permit|immigration|green card|kewarganegaraan|warga negara|izin kerja)\b/,
  ],
];

// "Are you 18 or older?" is an eligibility check entailed by
// `eligibility.age_18_plus` (19 §6.4), not an age question.
const AGE_ELIGIBILITY_RE =
  /\b(18|eighteen|delapan belas)\b.*\b(older|over|at least|of age|years|tahun|lebih)\b|\b(at least|over)\b.*\b18\b/;

/** The protected class a label / description asks about, or null. */
export function protectedCategory(text: string): ProtectedCategory | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }
  for (const [category, pattern] of PROTECTED_LEXICON) {
    if (pattern.test(normalized)) {
      if (category === "age" && AGE_ELIGIBILITY_RE.test(normalized)) {
        continue;
      }
      return category;
    }
  }
  return null;
}

const PERSONAL_RE =
  /\b(salary|compensation|pay expectations?|expected pay|current pay|wage|remuneration|gaji|upah|relocat\w*|relokasi|pindah|start date|earliest start|available to start|availability date|mulai bekerja|tanggal mulai)\b/;

/** 03 §9 `personal`: salary, relocation, start date. */
export function isPersonalQuestion(text: string): boolean {
  return PERSONAL_RE.test(normalizeText(text));
}

/** Label + description + section of a field, for the lexicons. */
export function fieldText(
  field: Pick<ObservedField, "label" | "description" | "section">
): string {
  return `${field.label} ${field.description} ${field.section ?? ""}`;
}

// ---------------------------------------------------------------------------
// Field → fact keys (minimization, 11 §11)
// ---------------------------------------------------------------------------

export type FactKeyMatcher = string | RegExp;

interface FactRule {
  keys: readonly FactKeyMatcher[];
  pattern: RegExp;
}

const EXPERIENCE_KEY = /^experience\[[^\]]+\]/;
const EDUCATION_KEY = /^education\[[^\]]+\]/;

const FACT_RULES: readonly FactRule[] = [
  {
    pattern: /\b(first name|given name|forename|nama depan)\b/,
    keys: ["contact.first_name", "contact.full_name"],
  },
  {
    pattern: /\b(last name|surname|family name|nama belakang)\b/,
    keys: ["contact.last_name", "contact.full_name"],
  },
  {
    pattern: /\b(full name|legal name|your name|nama lengkap|^name$|^nama$)\b/,
    keys: ["contact.full_name", "contact.first_name", "contact.last_name"],
  },
  { pattern: /\b(e-?mail|surel|surat elektronik)\b/, keys: ["contact.email"] },
  {
    pattern:
      /\b(phone|mobile|telephone|cell|telepon|telp|no hp|nomor hp|whatsapp|wa)\b/,
    keys: ["contact.phone"],
  },
  { pattern: /\blinkedin\b/, keys: ["links.linkedin"] },
  { pattern: /\bgithub\b/, keys: ["links.github"] },
  {
    pattern: /\b(portfolio|portofolio|behance|dribbble)\b/,
    keys: ["links.portfolio", "links.website"],
  },
  {
    pattern: /\b(website|personal site|blog|homepage|url|link)\b/,
    keys: [
      "links.website",
      "links.portfolio",
      "links.github",
      "links.linkedin",
    ],
  },
  { pattern: /\b(country|negara)\b/, keys: ["contact.country"] },
  {
    pattern:
      /\b(city|location|(?<!e-?mail |web |ip )address|domicile|based in|where do you live|domisili|kota|alamat|lokasi)\b/,
    keys: ["contact.location", "contact.country"],
  },
  {
    pattern:
      /\b(18|eighteen)\b.*\b(older|over|at least|of age|years)\b|\blegal age\b/,
    keys: ["eligibility.age_18_plus"],
  },
  {
    pattern: /\b(salary|compensation|expected pay|pay expectations?|gaji)\b/,
    keys: ["prefs.min_salary"],
  },
  {
    pattern: /\b(time ?zone|zona waktu)\b/,
    keys: ["prefs.timezone"],
  },
  {
    pattern: /\b(languages?|bahasa)\b/,
    keys: ["profile.languages"],
  },
  {
    pattern: /\b(company|employer|organi[sz]ation|perusahaan|tempat kerja)\b/,
    keys: [EXPERIENCE_KEY],
  },
  {
    pattern:
      /\b(job title|current title|current role|position|jabatan|posisi)\b/,
    keys: [EXPERIENCE_KEY],
  },
  {
    pattern:
      /\b(school|university|college|institution|institute|kampus|sekolah|universitas|perguruan tinggi)\b/,
    keys: [EDUCATION_KEY],
  },
  {
    pattern:
      /\b(degree|major|field of study|discipline|qualification|jurusan|gelar|program studi|pendidikan)\b/,
    keys: [EDUCATION_KEY],
  },
  {
    pattern:
      /\b(citizen|citizenship|nationality|visa|sponsor\w*|work authori[sz]ation|authori[sz]ed to work|right to work|work permit|kewarganegaraan|izin kerja)\b/,
    keys: [/^work_auth\.[A-Z]{2}$/],
  },
];

/** Whether a fact key belongs to the contact block (11 §11). */
export function isContactFact(key: string): boolean {
  return key.startsWith("contact.") || key.startsWith("links.");
}

/** Fact key matchers a visible field may use (empty: none is relevant). */
export function factKeysForField(
  field: Pick<ObservedField, "label" | "description" | "section" | "kind">
): FactKeyMatcher[] {
  if (field.kind === "file") {
    return [];
  }
  const text = normalizeText(`${field.label} ${field.description}`);
  const keys: FactKeyMatcher[] = [];
  for (const rule of FACT_RULES) {
    if (rule.pattern.test(text)) {
      keys.push(...rule.keys);
    }
  }
  if (field.kind === "email") {
    keys.push("contact.email");
  }
  if (field.kind === "tel") {
    keys.push("contact.phone");
  }
  if (field.kind === "url") {
    keys.push(
      "links.linkedin",
      "links.github",
      "links.portfolio",
      "links.website"
    );
  }
  return keys;
}

/** True when `key` satisfies one of the matchers. */
export function keyMatches(
  key: string,
  matchers: readonly FactKeyMatcher[]
): boolean {
  return matchers.some((matcher) =>
    typeof matcher === "string" ? matcher === key : matcher.test(key)
  );
}

// ---------------------------------------------------------------------------
// Question-like fields (19 §6.2) and generated-text slots (19 §6.4)
// ---------------------------------------------------------------------------

const YES_NO_RE =
  /^(yes|no|ya|tidak|true|false|y|n|iya|bukan|prefer not to say|decline to self-identify|i don't wish to answer)$/;
const RANGE_RE =
  /^(\d+\s*(-|–|to|sampai)\s*\d+|\d+\+?|less than \d+|more than \d+|< ?\d+|> ?\d+)(\s*\w+)?$/;
const CONTACT_SECTION_RE =
  /\b(contact|personal (info|information|details)|education|kontak|data diri|pendidikan)\b/;

/** 19 §6.2: label ends with "?", yes/no or range options, or a free-text box outside contact/education. */
export function isQuestionField(
  field: Pick<ObservedField, "label" | "kind" | "options" | "section">
): boolean {
  if (field.label.trim().endsWith("?")) {
    return true;
  }
  const options = field.options
    .map((option) => normalizeText(option.label || option.value))
    .filter(Boolean);
  if (
    options.length >= 2 &&
    (options.every((option) => YES_NO_RE.test(option)) ||
      options.filter((option) => RANGE_RE.test(option)).length >=
        Math.ceil(options.length / 2))
  ) {
    return true;
  }
  return (
    field.kind === "textarea" &&
    !CONTACT_SECTION_RE.test(normalizeText(field.section ?? ""))
  );
}

const MOTIVATION_RE =
  /\b(cover letter|motivation|why (do )?you want|why are you interested|why (this|our) (company|role)|tell us about yourself|additional information|anything else|surat lamaran|motivasi|informasi tambahan)\b/;

/** Free-text fields where generated text may be proposed (19 §6.4). */
export function isFreeTextMotivation(
  field: Pick<ObservedField, "label" | "description" | "kind" | "section">
): boolean {
  return (
    (field.kind === "textarea" ||
      field.kind === "contenteditable" ||
      field.kind === "text") &&
    MOTIVATION_RE.test(normalizeText(fieldText(field)))
  );
}

const RESUME_RE =
  /\b(resume|résumé|cv|curriculum vitae|daftar riwayat hidup)\b/;
const COVER_RE =
  /\b(cover letter|motivation letter|surat lamaran|surat motivasi)\b/;

/** Which file slot a file field asks for. */
export function fileSlotOf(
  field: Pick<ObservedField, "label" | "description" | "accept">
): "cv_file" | "cover_letter_file" | null {
  const text = normalizeText(`${field.label} ${field.description}`);
  if (COVER_RE.test(text)) {
    return "cover_letter_file";
  }
  return RESUME_RE.test(text) ? "cv_file" : null;
}

const PDF_ACCEPT_RE = /(^|[,\s])(\.pdf|application\/pdf|\*\/\*|\*)($|[,\s])/i;

/** A file input takes a PDF (no `accept`, or one that lists PDF / any). */
export function acceptsPdf(accept: string | null): boolean {
  if (!accept?.trim()) {
    return true;
  }
  return PDF_ACCEPT_RE.test(accept.trim());
}

const YES_WORDS = new Set(["yes", "ya", "y", "true", "iya", "benar"]);
const NO_WORDS = new Set(["no", "tidak", "n", "false", "bukan", "salah"]);

/** "yes" / "no" / null for a yes-no style option text. */
export function yesNo(text: string): "yes" | "no" | null {
  const normalized = normalizeText(text);
  if (YES_WORDS.has(normalized)) {
    return "yes";
  }
  return NO_WORDS.has(normalized) ? "no" : null;
}

/** A stored value as yes / no (booleans, "true" / "false", yes-no words). */
export function booleanFlag(raw: unknown, text: string): "yes" | "no" | null {
  if (typeof raw === "boolean") {
    return raw ? "yes" : "no";
  }
  return yesNo(text);
}
