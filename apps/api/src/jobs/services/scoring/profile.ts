// The per-user ScoringProfile (07 §2.1): built server-side from the primary
// base CV (CV_KV `cv:{id}`), `applicant_facts` and the `years_experience.*`
// screening answers.
//
// [DECISION 07 §2.1] It never contains identity: no name, email, phone,
// address, links, photo, employer or school names, user id. Free text from
// the CV is reduced to dictionary skill terms and role titles stripped of
// "at <company>" suffixes; education keeps the level and field only.
//
// `aiProfileView` is what reaches OpenAI (07 §8): with
// `ai_scoring_sensitive = false` the work authorization and the salary floor
// are removed (F5 still runs locally on the full profile).

import type { CVData } from "@pilihpendidikan/cv-engine/types";
import { WORK_AUTH_STATUSES } from "@pilihpendidikan/jobs-contracts/scoring";
import type {
  EducationLevel,
  ScoringProfile,
} from "@pilihpendidikan/jobs-contracts/scoring";
import { ScoringProfileSchema } from "@pilihpendidikan/jobs-contracts/scoring";
import { normalizeText } from "@pilihpendidikan/jobs-contracts/fingerprint";
import {
  canonicalUserSkills,
  extractSkillTerms,
  languageCode,
  languageLevelOf,
  seniorityFromText,
} from "./text";

type Seniority = ScoringProfile["seniority"];

export const PROFILE_LIMITS = {
  skills: 150,
  roles: 8,
  keywordsPerRole: 12,
  targetTitles: 20,
} as const;

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const AT_COMPANY_RE = /\s+(?:at|@|di|pada)\s+.+$/i;
const PIPE_SUFFIX_RE = /\s*[|·•].*$/;
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
const WORK_AUTH_KEY_RE = /^work_auth\.([A-Z]{2})$/;

export interface ProfileFact {
  key: string;
  /** Parsed JSON value. */
  value: unknown;
}

export interface YearsAnswer {
  answer: string;
  question_key: string;
}

export interface ProfileSources {
  cv: CVData | null;
  facts: readonly ProfileFact[];
  now: number;
  profileVersion: number;
  yearsAnswers: readonly YearsAnswer[];
}

function monthStart(value: string | undefined): number | null {
  const match = MONTH_RE.exec(value ?? "");
  if (!match) {
    return null;
  }
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }
  return Date.UTC(Number(match[1]), month - 1, 1);
}

interface Interval {
  end: number;
  start: number;
}

function roleInterval(
  entry: { current: boolean; endDate: string; startDate: string },
  now: number
): Interval | null {
  const start = monthStart(entry.startDate);
  if (start === null) {
    return null;
  }
  const end = entry.current || !entry.endDate ? now : monthStart(entry.endDate);
  if (end === null || end < start) {
    return null;
  }
  return { start, end: Math.min(end, now) };
}

/** Years covered by the union of intervals (overlaps counted once). */
export function unionYears(intervals: readonly Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let current: Interval | null = null;
  for (const interval of sorted) {
    if (!current || interval.start > current.end) {
      if (current) {
        total += current.end - current.start;
      }
      current = { ...interval };
    } else {
      current.end = Math.max(current.end, interval.end);
    }
  }
  if (current) {
    total += current.end - current.start;
  }
  return Math.round((total / MS_PER_YEAR) * 10) / 10;
}

/** A role title without company or extra segments ("Engineer at Acme" → "Engineer"). */
export function cleanRoleTitle(title: string): string {
  return title
    .replace(AT_COMPANY_RE, "")
    .replace(PIPE_SUFFIX_RE, "")
    .trim()
    .slice(0, 200);
}

const EDUCATION_RULES: readonly [RegExp, EducationLevel][] = [
  [/\b(ph\.?d|doctor|doctorate|doktor|s3|dphil)\b/, "doctorate"],
  [
    /\b(master|masters|msc|m\.sc|mba|m\.eng|meng|ma|mfa|magister|s2|m\.kom|m\.t)\b/,
    "master",
  ],
  [
    /\b(bachelor|bachelors|bsc|b\.sc|ba|bs|b\.eng|beng|sarjana|s1|s\.kom|s\.t|undergraduate)\b/,
    "bachelor",
  ],
  [
    /\b(diploma|associate|d1|d2|d3|d4|ahli madya|a\.md|vocational)\b/,
    "diploma",
  ],
  [/\b(high school|senior high|sma|smk|secondary|a-levels?)\b/, "secondary"],
];

// "Computer Science, Universitas X" / "BSc - X University" / "… at X": keep the head.
const DEGREE_TAIL_RE = /[,|–—]|\s-\s|\s+(?:at|di|from)\s+/i;
const LEVEL_WORDS_RE =
  /\b(ph\.?d|doctor of|doctorate|master of|masters? in|bachelor of|bachelors? in|bachelor's|master's|degree in|degree|sarjana|magister|diploma in|diploma|msc|bsc|mba|ba|bs|ma|s1|s2|s3|d3|d4|in)\b/g;

/** Education level of a degree text (and the CV category). */
export function educationLevelOf(
  degree: string,
  category: string
): EducationLevel {
  const normalized = normalizeText(degree);
  for (const [pattern, level] of EDUCATION_RULES) {
    if (pattern.test(normalized)) {
      return level;
    }
  }
  if (category === "school") {
    return "secondary";
  }
  if (category === "polytechnic" || category === "academy") {
    return "diploma";
  }
  return category === "university" ? "bachelor" : "none";
}

/** The field of study without the level words ("BSc Computer Science" → "computer science"). */
export function educationFieldOf(degree: string): string {
  const head = degree.split(DEGREE_TAIL_RE)[0] ?? "";
  return normalizeText(head)
    .replace(LEVEL_WORDS_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function factMap(facts: readonly ProfileFact[]): Map<string, unknown> {
  return new Map(facts.map((fact) => [fact.key, fact.value]));
}

function seniorityFor(
  years: number | null,
  latestTitle: string | null,
  latestIsInternship: boolean
): Seniority {
  const named = seniorityFromText(latestTitle);
  if (named) {
    return named;
  }
  if (latestIsInternship) {
    return "intern";
  }
  if (years === null) {
    return "unknown";
  }
  if (years < 2) {
    return "junior";
  }
  if (years < 5) {
    return "mid";
  }
  if (years < 9) {
    return "senior";
  }
  return "lead";
}

function yearsFromAnswers(answers: readonly YearsAnswer[]): {
  skills: string[];
  total: number | null;
} {
  let total: number | null = null;
  const skills: string[] = [];
  for (const answer of answers) {
    const subject = answer.question_key.slice("years_experience.".length);
    const years = Number.parseFloat(answer.answer);
    if (!Number.isFinite(years) || years < 0) {
      continue;
    }
    if (subject === "total" || subject === "overall" || subject === "") {
      total = Math.round(years * 10) / 10;
    } else if (years > 0) {
      skills.push(subject.replace(/_/g, " "));
    }
  }
  return { total, skills };
}

function languagesOf(
  facts: Map<string, unknown>,
  cv: CVData | null
): ScoringProfile["languages"] {
  const fromFacts = facts.get("profile.languages");
  const out = new Map<string, ScoringProfile["languages"][number]>();
  if (Array.isArray(fromFacts)) {
    for (const entry of fromFacts) {
      const code = typeof entry?.code === "string" ? entry.code : null;
      if (code && typeof entry.level === "string") {
        out.set(code, { code, level: languageLevelOf(entry.level) });
      }
    }
  }
  if (out.size === 0 && cv) {
    for (const entry of cv.languages ?? []) {
      const code = languageCode(entry.language);
      if (code && !out.has(code)) {
        out.set(code, { code, level: languageLevelOf(entry.proficiency) });
      }
    }
  }
  return [...out.values()];
}

function locationsOf(
  facts: Map<string, unknown>,
  workAuth: ScoringProfile["work_authorization"]
): ScoringProfile["locations"] {
  const prefs = facts.get("prefs.locations");
  const out: ScoringProfile["locations"] = [];
  if (Array.isArray(prefs)) {
    for (const entry of prefs) {
      if (typeof entry?.country_code === "string") {
        out.push({
          country_code: entry.country_code,
          ...(typeof entry.city === "string" && entry.city
            ? { city: entry.city.slice(0, 120) }
            : {}),
        });
      }
    }
  }
  if (out.length > 0) {
    return out;
  }
  // No stated preference: the countries where the user may work.
  return workAuth
    .filter((entry) =>
      ["citizen", "permanent_resident", "work_visa"].includes(entry.status)
    )
    .map((entry) => ({ country_code: entry.country_code }));
}

function workAuthOf(
  facts: readonly ProfileFact[]
): ScoringProfile["work_authorization"] {
  const out: ScoringProfile["work_authorization"] = [];
  for (const fact of facts) {
    const match = WORK_AUTH_KEY_RE.exec(fact.key);
    const status = (fact.value as { status?: unknown } | null)?.status;
    if (
      match &&
      typeof status === "string" &&
      (WORK_AUTH_STATUSES as readonly string[]).includes(status)
    ) {
      out.push({
        country_code: match[1],
        status:
          status as ScoringProfile["work_authorization"][number]["status"],
      });
    }
  }
  return out;
}

function salaryFloorOf(value: unknown): ScoringProfile["salary_floor"] {
  const floor = value as {
    amount?: unknown;
    currency?: unknown;
    period?: unknown;
  } | null;
  if (
    floor &&
    typeof floor.amount === "number" &&
    floor.amount > 0 &&
    typeof floor.currency === "string" &&
    floor.currency.length === 3 &&
    (floor.period === "year" ||
      floor.period === "month" ||
      floor.period === "hour")
  ) {
    return {
      amount: floor.amount,
      currency: floor.currency.toUpperCase(),
      period: floor.period,
    };
  }
  return;
}

interface RoleDigest {
  current: boolean;
  interval: Interval | null;
  internship: boolean;
  keywords: string[];
  title: string;
}

function rolesOf(cv: CVData | null, now: number): RoleDigest[] {
  if (!cv) {
    return [];
  }
  return (cv.experience ?? [])
    .map((entry) => ({
      title: cleanRoleTitle(entry.title ?? ""),
      interval: roleInterval(entry, now),
      current: Boolean(entry.current),
      internship: entry.workType === "internship",
      keywords: [
        ...extractSkillTerms(`${entry.title} ${entry.description}`),
      ].slice(0, PROFILE_LIMITS.keywordsPerRole),
    }))
    .filter((role) => role.title.length > 0)
    .sort(
      (a, b) =>
        (b.interval?.end ?? 0) - (a.interval?.end ?? 0) ||
        (b.interval?.start ?? 0) - (a.interval?.start ?? 0)
    );
}

/** The full scoring profile (features run on this one). */
export function buildScoringProfile(sources: ProfileSources): ScoringProfile {
  const facts = factMap(sources.facts);
  const cv = sources.cv;
  const roles = rolesOf(cv, sources.now);
  const answers = yearsFromAnswers(sources.yearsAnswers);
  const intervals = roles
    .map((role) => role.interval)
    .filter((interval): interval is Interval => interval !== null);
  const yearsTotal =
    answers.total ?? (intervals.length > 0 ? unionYears(intervals) : null);
  const targetFacts = stringArray(facts.get("prefs.target_titles"));
  const jobTitle = cv?.personalInfo?.jobTitle?.trim() ?? "";
  const fromCv = jobTitle ? [cleanRoleTitle(jobTitle)] : [];
  const targetTitles = (targetFacts.length > 0 ? targetFacts : fromCv)
    .map((title) => title.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, PROFILE_LIMITS.targetTitles);
  const skillSources = [
    ...(cv?.skills ?? []).flatMap((category) => category.items ?? []),
    ...stringArray(facts.get("skills.extra")),
    ...answers.skills,
  ];
  const skills = canonicalUserSkills(skillSources).slice(
    0,
    PROFILE_LIMITS.skills
  );
  const latest = roles[0] ?? null;
  const workAuth = workAuthOf(sources.facts);
  const workplace = stringArray(facts.get("prefs.workplace_types")).filter(
    (value): value is ScoringProfile["workplace_prefs"][number] =>
      value === "onsite" || value === "hybrid" || value === "remote"
  );
  const education = (cv?.education ?? [])
    .map((entry) => ({
      level: educationLevelOf(entry.degree ?? "", entry.category ?? ""),
      field: educationFieldOf(entry.degree ?? ""),
    }))
    .filter((entry) => entry.level !== "none" || entry.field.length > 0);
  const floor = salaryFloorOf(facts.get("prefs.min_salary"));
  const profile: ScoringProfile = {
    profile_version: sources.profileVersion,
    target_titles: targetTitles,
    seniority: seniorityFor(
      yearsTotal,
      latest?.title ?? targetTitles[0] ?? null,
      latest?.internship ?? false
    ),
    years_experience_total: yearsTotal,
    skills,
    experience_digest: roles.slice(0, PROFILE_LIMITS.roles).map((role) => ({
      title: role.title,
      years: role.interval
        ? Math.round(
            ((role.interval.end - role.interval.start) / MS_PER_YEAR) * 10
          ) / 10
        : 0,
      keywords: role.keywords,
    })),
    education,
    languages: languagesOf(facts, cv),
    locations: locationsOf(facts, workAuth),
    workplace_prefs: [...new Set(workplace)],
    work_authorization: workAuth,
    ...(floor ? { salary_floor: floor } : {}),
  };
  return ScoringProfileSchema.parse(profile);
}

/** The profile as sent to the AI rubric (07 §8). */
export function aiProfileView(
  profile: ScoringProfile,
  sensitiveAllowed: boolean
): ScoringProfile {
  if (sensitiveAllowed) {
    return profile;
  }
  const { salary_floor: _floor, ...rest } = profile;
  return { ...rest, work_authorization: [] };
}

/** 07 §11: no skills and no target titles ⇒ the AI rubric is skipped. */
export function isThinProfile(profile: ScoringProfile): boolean {
  const keywords = profile.experience_digest.some(
    (role) => role.keywords.length > 0
  );
  return (
    profile.skills.length === 0 &&
    !keywords &&
    profile.target_titles.length === 0
  );
}
