// Match scoring contract (07): the AI-safe profile summary, the stored
// `match_scores.components` JSON, rule score criteria and the r1 weights.
import { z } from "zod";
import { CountryCodeSchema } from "./common";
import { defineSchema } from "./registry";

/** Rubric of the deterministic features and weights below (07 §3). */
export const RUBRIC_VERSION = "r1";

/** Model label stored when no AI component contributed (07 §11). */
export const DETERMINISTIC_ONLY_MODEL = "deterministic-only";

export const SENIORITY_LEVELS = [
  "intern",
  "junior",
  "mid",
  "senior",
  "lead",
  "principal",
  "unknown",
] as const;
export const SeniorityLevelSchema = defineSchema(
  "scoring",
  "SeniorityLevel",
  z.enum(SENIORITY_LEVELS)
);
export type SeniorityLevel = z.infer<typeof SeniorityLevelSchema>;

export const EDUCATION_LEVELS = [
  "none",
  "secondary",
  "diploma",
  "bachelor",
  "master",
  "doctorate",
] as const;
export const EducationLevelSchema = defineSchema(
  "scoring",
  "EducationLevel",
  z.enum(EDUCATION_LEVELS)
);
export type EducationLevel = z.infer<typeof EducationLevelSchema>;

export const LANGUAGE_LEVELS = [
  "native",
  "fluent",
  "professional",
  "conversational",
  "basic",
] as const;
export const LanguageLevelSchema = defineSchema(
  "scoring",
  "LanguageLevel",
  z.enum(LANGUAGE_LEVELS)
);
export type LanguageLevel = z.infer<typeof LanguageLevelSchema>;

/** `work_auth.<country_code>` statuses (03 §9). */
export const WORK_AUTH_STATUSES = [
  "citizen",
  "permanent_resident",
  "work_visa",
  "needs_sponsorship",
  "none",
] as const;
export const WorkAuthStatusSchema = defineSchema(
  "scoring",
  "WorkAuthStatus",
  z.enum(WORK_AUTH_STATUSES)
);
export type WorkAuthStatus = z.infer<typeof WorkAuthStatusSchema>;

export const PREFERRED_WORKPLACES = ["onsite", "hybrid", "remote"] as const;
export const PreferredWorkplaceSchema = defineSchema(
  "scoring",
  "PreferredWorkplace",
  z.enum(PREFERRED_WORKPLACES)
);

export const FLOOR_PERIODS = ["year", "month", "hour"] as const;

/** Where the user can work (07 §2.1, fact `prefs.locations`). */
export const ProfileLocationSchema = defineSchema(
  "scoring",
  "ProfileLocation",
  z.object({
    country_code: CountryCodeSchema,
    city: z.string().max(120).optional(),
  })
);

export const SalaryFloorSchema = defineSchema(
  "scoring",
  "SalaryFloor",
  z.object({
    amount: z.number().min(0),
    currency: z.string().length(3),
    period: z.enum(FLOOR_PERIODS),
  })
);

/**
 * The per-user profile summary sent to the AI rubric (07 §2.1). It never
 * contains contact PII, employer or school names.
 */
export const ScoringProfileSchema = defineSchema(
  "scoring",
  "ScoringProfile",
  z.object({
    profile_version: z.number().int().min(0),
    target_titles: z.array(z.string().max(200)),
    seniority: SeniorityLevelSchema,
    years_experience_total: z.number().min(0).nullable(),
    skills: z.array(z.string().max(100)).max(150),
    experience_digest: z
      .array(
        z.object({
          title: z.string().max(200),
          years: z.number().min(0),
          keywords: z.array(z.string().max(100)),
        })
      )
      .max(8),
    education: z.array(
      z.object({ level: EducationLevelSchema, field: z.string().max(200) })
    ),
    languages: z.array(
      z.object({ code: z.string().min(2).max(8), level: LanguageLevelSchema })
    ),
    locations: z.array(ProfileLocationSchema),
    workplace_prefs: z.array(PreferredWorkplaceSchema),
    work_authorization: z.array(
      z.object({
        country_code: CountryCodeSchema,
        status: WorkAuthStatusSchema,
      })
    ),
    salary_floor: SalaryFloorSchema.optional(),
  })
);
export type ScoringProfile = z.infer<typeof ScoringProfileSchema>;

// ---------------------------------------------------------------------------
// Stored components (07 §4.3)
// ---------------------------------------------------------------------------

const unit = z.number().min(0).max(1);
const weight = z.number().min(0).max(1);

export const SkillsOverlapComponentSchema = defineSchema(
  "scoring",
  "SkillsOverlapComponent",
  z.object({
    value: unit,
    matched: z.array(z.string()),
    missing: z.array(z.string()),
    weight,
  })
);
export const TitleSimilarityComponentSchema = defineSchema(
  "scoring",
  "TitleSimilarityComponent",
  z.object({ value: unit, best_target: z.string().nullable(), weight })
);
export const LocationFitComponentSchema = defineSchema(
  "scoring",
  "LocationFitComponent",
  z.object({ value: unit, reason: z.string().max(60), weight })
);
export const SeniorityFitComponentSchema = defineSchema(
  "scoring",
  "SeniorityFitComponent",
  z.object({
    value: unit,
    posting: SeniorityLevelSchema,
    user: SeniorityLevelSchema,
    weight,
  })
);
export const SalaryFitComponentSchema = defineSchema(
  "scoring",
  "SalaryFitComponent",
  z.object({
    value: unit,
    posting_max_yearly: z.number().min(0).nullable(),
    floor_yearly: z.number().min(0).nullable(),
    currency: z.string().length(3).nullable(),
    weight,
  })
);
export const LanguageFitComponentSchema = defineSchema(
  "scoring",
  "LanguageFitComponent",
  z.object({
    value: unit,
    required: z.array(z.string()),
    missing: z.array(z.string()),
    weight,
  })
);
export const FreshnessComponentSchema = defineSchema(
  "scoring",
  "FreshnessComponent",
  z.object({ value: unit, age_days: z.number().min(0), weight })
);

/** Why an AI component is absent or present (07 §7.2, §9, §11). */
export const AI_COMPONENT_STATUSES = [
  "ok",
  "budget",
  "error",
  "dlq",
  "disabled",
  "skipped",
] as const;
export const AiComponentStatusSchema = defineSchema(
  "scoring",
  "AiComponentStatus",
  z.enum(AI_COMPONENT_STATUSES)
);
export type AiComponentStatus = z.infer<typeof AiComponentStatusSchema>;

/** The three gating predicates of the Decisions request (07 §4.1). */
export const GATE_PREDICATES = [
  "requires_unavailable_work_authorization",
  "requires_degree_user_lacks",
  "requires_onsite_outside_user_locations",
] as const;
export const GatePredicateSchema = defineSchema(
  "scoring",
  "GatePredicate",
  z.enum(GATE_PREDICATES)
);
export type GatePredicate = z.infer<typeof GatePredicateSchema>;

export const GATE_LEVELS = ["blocking", "possible"] as const;
export const GateLevelSchema = defineSchema(
  "scoring",
  "GateLevel",
  z.enum(GATE_LEVELS)
);
export type GateLevel = z.infer<typeof GateLevelSchema>;

export const AiComponentSchema = defineSchema(
  "scoring",
  "AiComponent",
  z.object({
    status: AiComponentStatusSchema,
    overall_fit: z
      .object({
        score: z.number().min(0).max(4),
        confidence: unit.nullable(),
      })
      .nullable(),
    weight,
    predicates: z.object({
      requires_unavailable_work_authorization: unit.nullable().optional(),
      requires_degree_user_lacks: unit.nullable().optional(),
      requires_onsite_outside_user_locations: unit.nullable().optional(),
    }),
    refused: z.array(z.string()),
  })
);

export const ScoreGateSchema = defineSchema(
  "scoring",
  "ScoreGate",
  z.object({
    predicate: GatePredicateSchema,
    level: GateLevelSchema,
    probability: unit,
    multiplier: unit,
  })
);
export type ScoreGate = z.infer<typeof ScoreGateSchema>;

/** `match_scores.components` once `status = 'ready'` (07 §4.3). */
export const ScoreComponentsSchema = defineSchema(
  "scoring",
  "ScoreComponents",
  z.object({
    rubric_version: z.string().min(1),
    features: z.object({
      skills_overlap: SkillsOverlapComponentSchema.nullable(),
      title_similarity: TitleSimilarityComponentSchema.nullable(),
      location_fit: LocationFitComponentSchema.nullable(),
      seniority_fit: SeniorityFitComponentSchema.nullable(),
      salary_fit: SalaryFitComponentSchema.nullable(),
      language_fit: LanguageFitComponentSchema.nullable(),
      freshness: FreshnessComponentSchema.nullable(),
    }),
    ai: AiComponentSchema,
    gates: z.array(ScoreGateSchema),
    base: unit,
    score: z.number().int().min(0).max(100),
    posting_revision: z.number().int().min(1).optional(),
  })
);
export type ScoreComponents = z.infer<typeof ScoreComponentsSchema>;

/** Score filters of `automation_rules.criteria` (07 §10). */
export const RuleScoreCriteriaSchema = defineSchema(
  "scoring",
  "RuleScoreCriteria",
  z.object({
    min_score: z.number().int().min(0).max(100),
    require_ai_component: z.boolean(),
    max_score_age_days: z.number().int().min(1).max(365),
    exclude_blocking_gates: z.literal(true),
    exclude_possible_gates: z.boolean(),
  })
);
export type RuleScoreCriteria = z.infer<typeof RuleScoreCriteriaSchema>;

// ---------------------------------------------------------------------------
// r1 weights, gates and the combination formula (07 §3, §4.2)
// ---------------------------------------------------------------------------

export const FEATURE_NAMES = [
  "skills_overlap",
  "title_similarity",
  "location_fit",
  "seniority_fit",
  "salary_fit",
  "language_fit",
  "freshness",
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export type ComponentName = FeatureName | "ai";

/** r1 weights; they sum to 1.0 (07 §3). */
export const R1_WEIGHTS: Readonly<Record<ComponentName, number>> = {
  skills_overlap: 0.25,
  title_similarity: 0.15,
  location_fit: 0.15,
  seniority_fit: 0.1,
  salary_fit: 0.05,
  language_fit: 0.05,
  freshness: 0.05,
  ai: 0.2,
};

/** Probability thresholds of the gate bands (07 §4.2). */
export const GATE_BLOCKING_MIN_P = 0.8;
export const GATE_POSSIBLE_MIN_P = 0.5;

/** Multipliers per predicate and band (07 §4.2). */
export const GATE_MULTIPLIERS: Readonly<
  Record<GatePredicate, Readonly<Record<GateLevel, number>>>
> = {
  requires_unavailable_work_authorization: { blocking: 0.2, possible: 0.7 },
  requires_degree_user_lacks: { blocking: 0.5, possible: 0.85 },
  requires_onsite_outside_user_locations: { blocking: 0.5, possible: 0.85 },
};

/** The gate a predicate probability triggers, or null (`p < 0.50`). */
export function gateFor(
  predicate: GatePredicate,
  probability: number | null
): ScoreGate | null {
  if (probability === null || probability < GATE_POSSIBLE_MIN_P) {
    return null;
  }
  const level: GateLevel =
    probability >= GATE_BLOCKING_MIN_P ? "blocking" : "possible";
  return {
    predicate,
    level,
    probability,
    multiplier: GATE_MULTIPLIERS[predicate][level],
  };
}

/**
 * 07 §3: `base = Σ w·v / Σ w` over non-null components, then
 * `score = round(100 · base · Π multipliers)` clamped to [0, 100]. Returns
 * `{base: 0, score: 0}` when every component is null.
 */
export function combineScore(
  values: Partial<Record<ComponentName, number | null>>,
  gates: readonly Pick<ScoreGate, "multiplier">[] = [],
  weights: Readonly<Record<ComponentName, number>> = R1_WEIGHTS
): { base: number; score: number } {
  let weighted = 0;
  let total = 0;
  for (const name of [...FEATURE_NAMES, "ai"] as const) {
    const value = values[name];
    if (value === null || value === undefined) {
      continue;
    }
    weighted += weights[name] * value;
    total += weights[name];
  }
  const base = total > 0 ? weighted / total : 0;
  let multiplier = 1;
  for (const gate of gates) {
    multiplier *= gate.multiplier;
  }
  const score = Math.min(100, Math.max(0, Math.round(100 * base * multiplier)));
  return { base, score };
}

/** Score bands of the UI, analytics breakdown and inbox filter (06, 07, 10). */
export const SCORE_BANDS = ["high", "medium", "low", "unscored"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

/** ≥ 80 high, 60–79 medium, < 60 low, null unscored. */
export function scoreBand(score: number | null | undefined): ScoreBand {
  if (score === null || score === undefined) {
    return "unscored";
  }
  if (score >= 80) {
    return "high";
  }
  return score >= 60 ? "medium" : "low";
}
