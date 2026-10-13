// Canonical applicant fact keys (03 §9). New keys are added here only.
//
// Static keys (`contact.email`) and pattern keys (`work_auth.<CC>`,
// `education[<cv_entry_id>]`, `experience[<cv_entry_id>]`) each carry a value
// schema and the sensitivity the agent applies when the key is asked.
import { z } from "zod";
import { CountryCodeSchema, UrlSchema } from "./common";
import type { Sensitivity } from "./enums";
import { WorkplaceTypeSchema } from "./enums";
import { defineSchema } from "./registry";
import {
  LanguageLevelSchema,
  ProfileLocationSchema,
  SalaryFloorSchema,
  WorkAuthStatusSchema,
} from "./scoring";

export const WorkAuthFactValueSchema = defineSchema(
  "facts",
  "WorkAuthFactValue",
  z.object({ status: WorkAuthStatusSchema })
);

/** `education[…]` / `experience[…]` facts reference a CV entry, never copy it. */
export const CvEntryRefFactValueSchema = defineSchema(
  "facts",
  "CvEntryRefFactValue",
  z.object({ cv_id: z.string().min(1), cv_entry_id: z.string().min(1) })
);

export const LanguageFactValueSchema = defineSchema(
  "facts",
  "LanguageFactValue",
  z.array(
    z.object({ code: z.string().min(2).max(8), level: LanguageLevelSchema })
  )
);

export interface FactKeySpec {
  /** Why the key exists (spec reference). */
  note: string;
  /** Sensitivity class when a form asks for this value (03 §9, 19 §6). */
  sensitivity: Sensitivity;
  value: z.ZodType;
}

const nonEmpty = z.string().min(1).max(300);

/** Static canonical keys (03 §9, plus keys referenced in 07 §2.1 and 19 §6.4). */
export const FACT_KEYS = {
  "contact.full_name": {
    value: nonEmpty,
    sensitivity: "none",
    note: "03 §9; seeded from the base CV personalInfo",
  },
  "contact.first_name": {
    value: nonEmpty,
    sensitivity: "none",
    note: "split name fields on ATS forms (12 §6.3)",
  },
  "contact.last_name": {
    value: nonEmpty,
    sensitivity: "none",
    note: "split name fields on ATS forms",
  },
  "contact.email": {
    value: z.string().email().max(254),
    sensitivity: "none",
    note: "03 §9",
  },
  "contact.phone": {
    value: z.string().min(4).max(40),
    sensitivity: "none",
    note: "03 §9",
  },
  "contact.location": { value: nonEmpty, sensitivity: "none", note: "03 §9" },
  "contact.country": {
    value: nonEmpty,
    sensitivity: "none",
    note: "country selects (19 §6.4 example)",
  },
  "links.linkedin": { value: UrlSchema, sensitivity: "none", note: "03 §9" },
  "links.github": { value: UrlSchema, sensitivity: "none", note: "03 §9" },
  "links.portfolio": { value: UrlSchema, sensitivity: "none", note: "03 §9" },
  "links.website": { value: UrlSchema, sensitivity: "none", note: "03 §9" },
  "profile.primary_cv_id": {
    value: nonEmpty,
    sensitivity: "none",
    note: "apps/cv slug of the base CV (03 §9, 07 §2.1)",
  },
  "profile.languages": {
    value: LanguageFactValueSchema,
    sensitivity: "none",
    note: "languages for scoring (07 §2.1)",
  },
  "skills.extra": {
    value: z.array(z.string().min(1).max(100)).max(150),
    sensitivity: "none",
    note: "skills beyond the CV (07 §2.1)",
  },
  "prefs.target_titles": {
    value: z.array(z.string().min(1).max(200)).max(20),
    sensitivity: "none",
    note: "03 §9, 07 §2.1",
  },
  "prefs.locations": {
    value: z.array(ProfileLocationSchema).max(20),
    sensitivity: "none",
    note: "03 §9, 07 §2.1",
  },
  "prefs.workplace_types": {
    value: z.array(WorkplaceTypeSchema.exclude(["unknown"])),
    sensitivity: "none",
    note: "03 §9",
  },
  "prefs.min_salary": {
    value: SalaryFloorSchema,
    sensitivity: "personal",
    note: "03 §9; salary floor of 07 §2.1",
  },
  "prefs.timezone": {
    value: z.string().min(1).max(64),
    sensitivity: "none",
    note: "IANA zone, mirrors user_settings.timezone",
  },
  "prefs.ai_scoring_sensitive": {
    value: z.boolean(),
    sensitivity: "none",
    note: "mirrors user_settings.ai_scoring_sensitive",
  },
  "eligibility.age_18_plus": {
    value: z.boolean(),
    sensitivity: "none",
    note: "entails 'Are you 18 or older?' (19 §6.4)",
  },
} as const satisfies Record<string, FactKeySpec>;
export type StaticFactKey = keyof typeof FACT_KEYS;

const WORK_AUTH_KEY = /^work_auth\.([A-Z]{2})$/;
const CV_ENTRY_KEY = /^(education|experience)\[([A-Za-z0-9_.:-]{1,80})\]$/;

/** Pattern keys (03 §9). */
export const FACT_KEY_PATTERNS = [
  {
    pattern: WORK_AUTH_KEY,
    example: "work_auth.ID",
    value: WorkAuthFactValueSchema,
    sensitivity: "protected",
    note: "protected when asked as citizenship/visa status (03 §9)",
  },
  {
    pattern: CV_ENTRY_KEY,
    example: "experience[exp-1]",
    value: CvEntryRefFactValueSchema,
    sensitivity: "none",
    note: "references a CV entry; always resolved, never copied",
  },
] as const satisfies readonly (FactKeySpec & {
  example: string;
  pattern: RegExp;
})[];

/** The spec of a canonical key, or null when the key is not canonical. */
export function factKeySpec(key: string): FactKeySpec | null {
  if (Object.hasOwn(FACT_KEYS, key)) {
    return FACT_KEYS[key as StaticFactKey];
  }
  return FACT_KEY_PATTERNS.find((entry) => entry.pattern.test(key)) ?? null;
}

export function isCanonicalFactKey(key: string): boolean {
  return factKeySpec(key) !== null;
}

/** Validates a fact value against its key's schema. */
export function validateFactValue(
  key: string,
  value: unknown
): { ok: true } | { ok: false; error: string } {
  const spec = factKeySpec(key);
  if (!spec) {
    return { ok: false, error: `unknown fact key ${key}` };
  }
  const parsed = spec.value.safeParse(value);
  return parsed.success
    ? { ok: true }
    : { ok: false, error: parsed.error.issues[0]?.message ?? "invalid value" };
}

/** `work_auth.<CC>` key for a country. */
export function workAuthKey(countryCode: string): string {
  return `work_auth.${CountryCodeSchema.parse(countryCode)}`;
}
