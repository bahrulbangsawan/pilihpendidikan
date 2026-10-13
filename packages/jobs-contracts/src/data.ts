// Typed, validated access to the package's JSON data files: the skills
// dictionary (07 §3 F1), title families (07 §3 F2) and the Connect CLI
// commands (22 §12). The files themselves are exported too
// (`@pilihpendidikan/jobs-contracts/skills-dictionary.json`, …).
import { z } from "zod";
import cliCommandsFile from "../cli-commands.json" with { type: "json" };
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

const perOs = z.object({
  macos: z.string().min(1),
  linux: z.string().min(1),
  windows: z.string().min(1),
});
const labelledCommand = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  command: z.string().min(1),
});

export const CliCommandsSchema = defineSchema(
  "data",
  "CliCommands",
  z.object({
    version: z.literal(1),
    description: z.string(),
    package: z.string(),
    executable: z.string(),
    alias: z.string(),
    requirements: z.string(),
    install_uv: perOs.extend({ docs_url: z.string().url() }),
    steps: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        commands: perOs,
        note: z.string(),
      })
    ),
    alternatives: z.array(labelledCommand.extend({ available: z.boolean() })),
    step_up: z.array(labelledCommand),
    troubleshooting: z.array(labelledCommand),
    upgrade: z.object({ uv: z.string(), pipx: z.string() }),
    uninstall: z.string(),
  })
);
export type CliCommands = z.infer<typeof CliCommandsSchema>;

export const SKILLS_DICTIONARY: SkillsDictionary =
  SkillsDictionarySchema.parse(skillsFile);
export const TITLE_FAMILIES: TitleFamilies =
  TitleFamiliesSchema.parse(titleFamiliesFile);
export const CLI_COMMANDS: CliCommands =
  CliCommandsSchema.parse(cliCommandsFile);

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
