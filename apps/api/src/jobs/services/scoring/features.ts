// Deterministic features of rubric r1 (07 §3). Pure functions with golden
// tests (T7-01): each returns its stored component (07 §4.3) or null when the
// input is unknown, so the weights renormalize over what is known.
//
//   F1 skills_overlap    |S_req ∩ S_user| / max(3, |S_req|), required ×2   0.25
//   F2 title_similarity  max token-set Jaccard vs targets, family match → 1  0.15
//   F3 location_fit      remote in a user country / location match → 1,
//                        hybrid same country other city → 0.5, else 0      0.15
//   F4 seniority_fit     1 − 0.35·|Δlevel|, floored at 0                    0.10
//   F5 salary_fit        1 if max ≥ floor, linear to 0 at 0.7·floor         0.05
//   F6 language_fit      1 if every required language is met, else 0       0.05
//   F7 freshness         1 ≤ 7 d, linear to 0.3 at 45 d, 0.3 beyond          0.05

import type {
  PostingLocation,
  Salary,
} from "@pilihpendidikan/jobs-contracts/records";
import type {
  FeatureName,
  ScoreComponents,
  ScoringProfile,
} from "@pilihpendidikan/jobs-contracts/scoring";
import { R1_WEIGHTS } from "@pilihpendidikan/jobs-contracts/scoring";
import {
  LANGUAGE_RANK,
  languageRequirements,
  parsePlace,
  postingSkillWeights,
  SENIORITY_ORDER,
  sameCity,
  seniorityFromText,
  titleFamilyIds,
  titleJaccard,
} from "./text";

/** A posting as the scorer sees it (04 §2.1, JSON columns parsed). */
export interface PostingForScoring {
  department: string | null;
  description_text: string;
  employment_type: string | null;
  first_seen_at: number;
  id: string;
  locations: PostingLocation[];
  posted_at: number | null;
  requirements: string[];
  revision: number;
  salary: Salary | null;
  seniority: string | null;
  title: string;
  workplace_type: string | null;
}

type Features = ScoreComponents["features"];

const DAY_MS = 86_400_000;
const round = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Minimum denominator of F1 (07 §3). */
export const SKILLS_MIN_DENOMINATOR = 3;

/** F1 — skills overlap with required-term doubling. */
export function skillsOverlap(
  profile: Pick<ScoringProfile, "skills" | "experience_digest">,
  posting: Pick<PostingForScoring, "requirements" | "description_text">
): Features["skills_overlap"] {
  const userSkills = new Set([
    ...profile.skills,
    ...profile.experience_digest.flatMap((role) => role.keywords),
  ]);
  if (userSkills.size === 0) {
    return null;
  }
  const weights = postingSkillWeights(
    posting.requirements,
    posting.description_text
  );
  if (weights.size === 0) {
    return null;
  }
  let total = 0;
  let matchedWeight = 0;
  const matched: [string, number][] = [];
  const missing: [string, number][] = [];
  for (const [term, weight] of weights) {
    total += weight;
    if (userSkills.has(term)) {
      matchedWeight += weight;
      matched.push([term, weight]);
    } else {
      missing.push([term, weight]);
    }
  }
  const order = (a: [string, number], b: [string, number]) =>
    b[1] - a[1] || a[0].localeCompare(b[0]);
  return {
    value: round(
      clamp01(matchedWeight / Math.max(SKILLS_MIN_DENOMINATOR, total))
    ),
    matched: matched.sort(order).map(([term]) => term),
    missing: missing.sort(order).map(([term]) => term),
    weight: R1_WEIGHTS.skills_overlap,
  };
}

/** F2 — best title similarity over the user's target titles. */
export function titleSimilarity(
  profile: Pick<ScoringProfile, "target_titles">,
  posting: Pick<PostingForScoring, "title">
): Features["title_similarity"] {
  if (profile.target_titles.length === 0 || !posting.title.trim()) {
    return null;
  }
  const postingFamilies = titleFamilyIds(posting.title);
  let best = { value: -1, target: profile.target_titles[0] };
  for (const target of profile.target_titles) {
    const families = titleFamilyIds(target);
    const sameFamily = [...families].some((id) => postingFamilies.has(id));
    const value = sameFamily ? 1 : titleJaccard(target, posting.title);
    if (value > best.value) {
      best = { value, target };
    }
  }
  return {
    value: round(clamp01(best.value)),
    best_target: best.target,
    weight: R1_WEIGHTS.title_similarity,
  };
}

interface Place {
  city?: string;
  country_code?: string;
}

function postingPlaces(locations: readonly PostingLocation[]): Place[] {
  return locations.map((location) => {
    const parsed = parsePlace(location.raw);
    return {
      city: location.city ?? parsed.city,
      country_code: location.country_code ?? parsed.country_code,
    };
  });
}

const REMOTE_RE = /\bremote\b|\bwfh\b|work from home|anywhere/i;

function isRemote(
  posting: Pick<PostingForScoring, "workplace_type" | "locations">
) {
  return (
    posting.workplace_type === "remote" ||
    (posting.workplace_type !== "onsite" &&
      posting.workplace_type !== "hybrid" &&
      posting.locations.some((location) => REMOTE_RE.test(location.raw)))
  );
}

/** F3 — location fit (07 §3). */
export function locationFit(
  profile: Pick<ScoringProfile, "locations">,
  posting: Pick<PostingForScoring, "workplace_type" | "locations">
): Features["location_fit"] {
  if (profile.locations.length === 0) {
    return null;
  }
  const userCountries = new Set(
    profile.locations.map((location) => location.country_code)
  );
  const places = postingPlaces(posting.locations);
  const weight = R1_WEIGHTS.location_fit;
  if (isRemote(posting)) {
    const countries = places
      .map((place) => place.country_code)
      .filter((code): code is string => Boolean(code));
    if (countries.length === 0) {
      return { value: 1, reason: "remote_anywhere", weight };
    }
    return countries.some((code) => userCountries.has(code))
      ? { value: 1, reason: "remote_in_country", weight }
      : { value: 0, reason: "remote_outside_region", weight };
  }
  if (places.length === 0) {
    return null;
  }
  const exact = places.some((place) =>
    profile.locations.some(
      (mine) =>
        place.country_code === mine.country_code &&
        (!mine.city || sameCity(place.city, mine.city))
    )
  );
  if (exact) {
    return { value: 1, reason: "location_match", weight };
  }
  if (
    posting.workplace_type === "hybrid" &&
    places.some(
      (place) => place.country_code && userCountries.has(place.country_code)
    )
  ) {
    return { value: 0.5, reason: "hybrid_same_country", weight };
  }
  const known = places.some((place) => place.country_code || place.city);
  return known ? { value: 0, reason: "outside_locations", weight } : null;
}

/** The posting's seniority: its own field, else its title. */
export function postingSeniority(
  posting: Pick<PostingForScoring, "seniority" | "title">
): ScoringProfile["seniority"] {
  return (
    seniorityFromText(posting.seniority) ??
    seniorityFromText(posting.title) ??
    "unknown"
  );
}

/** F4 — seniority fit (07 §3). */
export function seniorityFit(
  profile: Pick<ScoringProfile, "seniority">,
  posting: Pick<PostingForScoring, "seniority" | "title">
): Features["seniority_fit"] {
  const level = postingSeniority(posting);
  if (level === "unknown" || profile.seniority === "unknown") {
    return null;
  }
  const delta = Math.abs(
    SENIORITY_ORDER[level] - SENIORITY_ORDER[profile.seniority]
  );
  return {
    value: round(Math.max(0, 1 - 0.35 * delta)),
    posting: level,
    user: profile.seniority,
    weight: R1_WEIGHTS.seniority_fit,
  };
}

/** Static monthly FX table: USD per unit of currency (07 §3 F5). */
export const USD_PER_UNIT: Readonly<Record<string, number>> = {
  USD: 1,
  IDR: 0.000_063,
  SGD: 0.74,
  MYR: 0.21,
  THB: 0.028,
  PHP: 0.0175,
  VND: 0.000_04,
  EUR: 1.08,
  GBP: 1.27,
  AUD: 0.66,
  NZD: 0.6,
  CAD: 0.73,
  JPY: 0.0067,
  KRW: 0.000_74,
  CNY: 0.14,
  HKD: 0.128,
  TWD: 0.031,
  INR: 0.012,
  AED: 0.272,
  CHF: 1.12,
  SEK: 0.095,
};

const PERIODS_PER_YEAR: Readonly<Record<string, number>> = {
  year: 1,
  month: 12,
  week: 52,
  day: 260,
  hour: 2080,
};

/** An amount per period → per year in `toCurrency`, or null (unknown FX). */
export function yearlyIn(
  amount: number,
  period: string,
  fromCurrency: string,
  toCurrency: string
): number | null {
  const perYear = PERIODS_PER_YEAR[period];
  const from = USD_PER_UNIT[fromCurrency.toUpperCase()];
  const to = USD_PER_UNIT[toCurrency.toUpperCase()];
  if (!(perYear && from && to)) {
    return null;
  }
  return (amount * perYear * from) / to;
}

/** F5 — salary fit (07 §3), in the posting's currency. */
export function salaryFit(
  profile: Pick<ScoringProfile, "salary_floor">,
  posting: Pick<PostingForScoring, "salary">
): Features["salary_fit"] {
  const floor = profile.salary_floor;
  const salary = posting.salary;
  const top = salary?.max ?? salary?.min;
  if (!(floor && salary && top !== undefined && salary.currency)) {
    return null;
  }
  const currency = salary.currency.toUpperCase();
  const postingMax = yearlyIn(top, salary.period ?? "year", currency, currency);
  const floorYearly = yearlyIn(
    floor.amount,
    floor.period,
    floor.currency,
    currency
  );
  if (postingMax === null || floorYearly === null || floorYearly <= 0) {
    return null;
  }
  const value = clamp01((postingMax - 0.7 * floorYearly) / (0.3 * floorYearly));
  return {
    value: round(value),
    posting_max_yearly: Math.round(postingMax),
    floor_yearly: Math.round(floorYearly),
    currency,
    weight: R1_WEIGHTS.salary_fit,
  };
}

/** F6 — language fit (07 §3). */
export function languageFit(
  profile: Pick<ScoringProfile, "languages">,
  posting: Pick<PostingForScoring, "requirements" | "description_text">
): Features["language_fit"] {
  const required = languageRequirements(
    posting.requirements,
    posting.description_text
  );
  if (required.size === 0) {
    return null;
  }
  const mine = new Map(profile.languages.map((l) => [l.code, l.level]));
  const missing: string[] = [];
  for (const [code, level] of required) {
    const have = mine.get(code);
    if (!have || LANGUAGE_RANK[have] < LANGUAGE_RANK[level]) {
      missing.push(code);
    }
  }
  return {
    value: missing.length === 0 ? 1 : 0,
    required: [...required.keys()].sort(),
    missing: missing.sort(),
    weight: R1_WEIGHTS.language_fit,
  };
}

/** F7 — freshness from `posted_at`, else `first_seen_at` (07 §3). */
export function freshness(
  posting: Pick<PostingForScoring, "posted_at" | "first_seen_at">,
  now: number
): Features["freshness"] {
  const seen = posting.posted_at ?? posting.first_seen_at;
  const ageDays = Math.max(0, Math.floor((now - seen) / DAY_MS));
  let value: number;
  if (ageDays <= 7) {
    value = 1;
  } else if (ageDays >= 45) {
    value = 0.3;
  } else {
    value = 1 - (0.7 * (ageDays - 7)) / 38;
  }
  return {
    value: round(value),
    age_days: ageDays,
    weight: R1_WEIGHTS.freshness,
  };
}

/** F1–F7 for one (profile, posting) pair. */
export function computeFeatures(
  profile: ScoringProfile,
  posting: PostingForScoring,
  now: number
): Features {
  return {
    skills_overlap: skillsOverlap(profile, posting),
    title_similarity: titleSimilarity(profile, posting),
    location_fit: locationFit(profile, posting),
    seniority_fit: seniorityFit(profile, posting),
    salary_fit: salaryFit(profile, posting),
    language_fit: languageFit(profile, posting),
    freshness: freshness(posting, now),
  };
}

/** `value` of each feature (null when unknown). */
export function featureValues(
  features: Features
): Record<FeatureName, number | null> {
  return {
    skills_overlap: features.skills_overlap?.value ?? null,
    title_similarity: features.title_similarity?.value ?? null,
    location_fit: features.location_fit?.value ?? null,
    seniority_fit: features.seniority_fit?.value ?? null,
    salary_fit: features.salary_fit?.value ?? null,
    language_fit: features.language_fit?.value ?? null,
    freshness: features.freshness?.value ?? null,
  };
}
