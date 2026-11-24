// Typed, validated access to the package's JSON data files: the skills
// dictionary (07 §3 F1) and title families (07 §3 F2). The files themselves
// are exported too
// (`@pilihpendidikan/jobs-contracts/skills-dictionary.json`, …).
import { z } from "zod";
import skillsFile from "../skills-dictionary.json" with { type: "json" };
import titleFamiliesFile from "../title-families.json" with { type: "json" };
import { normalizeText } from "./fingerprint";
import { defineSchema } from "./registry";

export const SKILL_CATEGORIES = [
  "language",
  "framework",
  "database",
  "cloud",
  "devops",
  "data",
  "mobile",
  "testing",
  "security",
  "design",
  "practice",
  "platform",
] as const;

export const SkillsDictionarySchema = defineSchema(
  "data",
  "SkillsDictionary",
  z.object({
    version: z.literal(1),
    description: z.string(),
    skills: z
      .array(
        z.object({
          /** Canonical term, in normalizeText form. */
          id: z.string().min(1),
          label: z.string().min(1),
          category: z.enum(SKILL_CATEGORIES),
          /** Alternative spellings, in normalizeText form. */
          synonyms: z.array(z.string().min(1)),
        })
      )
      .min(150),
  })
);
export type SkillsDictionary = z.infer<typeof SkillsDictionarySchema>;

export const TitleFamiliesSchema = defineSchema(
  "data",
  "TitleFamilies",
  z.object({
    version: z.literal(1),
    description: z.string(),
    /** Stripped from titles before comparing (07 §3 F2). */
    seniority_words: z.array(z.string().min(1)),
    families: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        titles: z.array(z.string().min(1)).min(1),
      })
    ),
  })
);
export type TitleFamilies = z.infer<typeof TitleFamiliesSchema>;

export const SKILLS_DICTIONARY: SkillsDictionary =
  SkillsDictionarySchema.parse(skillsFile);
export const TITLE_FAMILIES: TitleFamilies =
  TitleFamiliesSchema.parse(titleFamiliesFile);

let skillIndex: Map<string, string> | null = null;

/** Normalized term or synonym → canonical skill id (07 §3 F1). */
export function skillTermIndex(): ReadonlyMap<string, string> {
  if (!skillIndex) {
    skillIndex = new Map();
    for (const skill of SKILLS_DICTIONARY.skills) {
      skillIndex.set(skill.id, skill.id);
      for (const synonym of skill.synonyms) {
        skillIndex.set(synonym, skill.id);
      }
    }
  }
  return skillIndex;
}

/** Canonical skill id of a term (`JS` → `javascript`), or null. */
export function canonicalSkill(term: string): string | null {
  return skillTermIndex().get(normalizeText(term)) ?? null;
}

/** Title family id of a title, or null (exact normalized match). */
export function titleFamilyOf(title: string): string | null {
  const normalized = normalizeText(title);
  return (
    TITLE_FAMILIES.families.find((family) => family.titles.includes(normalized))
      ?.id ?? null
  );
}
