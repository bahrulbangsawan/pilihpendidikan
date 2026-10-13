// CV tailoring contract (08 §4): bullet provenance, the Structured Outputs
// patch (Zod + the strict JSON schema sent to the Responses API) and the
// stored diff.
import { z } from "zod";
import { Sha256HexSchema } from "./common";
import { defineSchema } from "./registry";

/** CV sections a patch may order (08 §4.3 `section_order` enum). */
export const CV_SECTION_IDS = [
  "summary",
  "experience",
  "education",
  "skills",
  "awards",
  "certificates",
  "languages",
  "projects",
  "volunteer",
] as const;
export const CvSectionIdSchema = defineSchema(
  "cv-tailoring",
  "CvSectionId",
  z.enum(CV_SECTION_IDS)
);
export type CvSectionId = z.infer<typeof CvSectionIdSchema>;

/** Sections whose description lines become bullets (08 §4.2). */
export const CV_BULLET_SECTIONS = [
  "summary",
  "experience",
  "projects",
  "volunteer",
  "awards",
  "certificates",
] as const;
export const CvBulletSectionSchema = defineSchema(
  "cv-tailoring",
  "CvBulletSection",
  z.enum(CV_BULLET_SECTIONS)
);

/** The `entry_id` summary sentences carry (cv-engine `SUMMARY_ENTRY_ID`). */
export const SUMMARY_ENTRY_ID = "0";

/**
 * One source bullet (08 §4.2), field for field the `CvBullet` of
 * `@pilihpendidikan/cv-engine` (`flattenCvBullets`). `id` is
 * `${section}:${entry_id}:${lineIndex}`, e.g. `experience:exp-1:2`; summary
 * sentences are `summary:0:<sentenceIndex>` with `entry_id` "0".
 */
export const CvBulletSchema = defineSchema(
  "cv-tailoring",
  "CvBullet",
  z.object({
    id: z.string().min(1),
    section: CvBulletSectionSchema,
    entry_id: z.string(),
    text: z.string(),
  })
);
export type CvBullet = z.infer<typeof CvBulletSchema>;

export const BULLET_OPERATIONS = [
  "keep",
  "reorder",
  "rephrase",
  "merge",
] as const;
export const BulletOperationSchema = defineSchema(
  "cv-tailoring",
  "BulletOperation",
  z.enum(BULLET_OPERATIONS)
);
export type BulletOperation = z.infer<typeof BulletOperationSchema>;

/** Limits of the patch (08 §4.3). */
export const TAILOR_LIMITS = {
  bulletText: 300,
  summaryText: 700,
  noteText: 200,
} as const;

/**
 * The Structured Outputs patch (08 §4.3). Strict objects: unknown keys are
 * rejected, exactly like `strict: true` on the model side.
 */
export const CvTailoringPatchSchema = defineSchema(
  "cv-tailoring",
  "CvTailoringPatch",
  z.strictObject({
    section_order: z.array(CvSectionIdSchema),
    include_entries: z.array(
      z.strictObject({ section: z.string(), entry_id: z.string() })
    ),
    bullets: z.array(
      z.strictObject({
        entry_id: z.string(),
        text: z.string().max(TAILOR_LIMITS.bulletText),
        source_bullet_ids: z.array(z.string()).min(1),
        operation: BulletOperationSchema,
      })
    ),
    summary: z.strictObject({
      text: z.string().max(TAILOR_LIMITS.summaryText),
      source_bullet_ids: z.array(z.string()),
      source_fact_keys: z.array(z.string()),
    }),
    skills_order: z.array(z.string()),
    notes_for_user: z.array(z.string().max(TAILOR_LIMITS.noteText)),
  })
);
export type CvTailoringPatch = z.infer<typeof CvTailoringPatchSchema>;

/** Prompt version recorded in `cv_variants.diff.prompt_version` (08 §4.3). */
export const TAILOR_PROMPT_VERSION = "tailor-prompt-v1";

/**
 * The exact `text.format` object for the Responses API (08 §4.3): every
 * object has `additionalProperties: false` and lists all its properties in
 * `required`.
 */
export const CV_TAILORING_PATCH_JSON_SCHEMA = {
  name: "cv_tailoring_patch",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "section_order",
      "include_entries",
      "bullets",
      "summary",
      "skills_order",
      "notes_for_user",
    ],
    properties: {
      section_order: {
        type: "array",
        items: { enum: [...CV_SECTION_IDS] },
      },
      include_entries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["section", "entry_id"],
          properties: {
            section: { type: "string" },
            entry_id: { type: "string" },
          },
        },
      },
      bullets: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entry_id", "text", "source_bullet_ids", "operation"],
          properties: {
            entry_id: { type: "string" },
            text: { type: "string", maxLength: TAILOR_LIMITS.bulletText },
            source_bullet_ids: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
            },
            operation: { enum: [...BULLET_OPERATIONS] },
          },
        },
      },
      summary: {
        type: "object",
        additionalProperties: false,
        required: ["text", "source_bullet_ids", "source_fact_keys"],
        properties: {
          text: { type: "string", maxLength: TAILOR_LIMITS.summaryText },
          source_bullet_ids: { type: "array", items: { type: "string" } },
          source_fact_keys: { type: "array", items: { type: "string" } },
        },
      },
      skills_order: { type: "array", items: { type: "string" } },
      notes_for_user: {
        type: "array",
        items: { type: "string", maxLength: TAILOR_LIMITS.noteText },
      },
    },
  },
} as const;

/** `cv_variants.diff` (08 §4.5). */
export const CvVariantDiffSchema = defineSchema(
  "cv-tailoring",
  "CvVariantDiff",
  z.object({
    prompt_version: z.string().min(1),
    model: z.string().min(1),
    section_order: z.object({
      from: z.array(CvSectionIdSchema),
      to: z.array(CvSectionIdSchema),
    }),
    excluded_entries: z.array(
      z.object({
        section: z.string(),
        entry_id: z.string(),
        label: z.string(),
      })
    ),
    bullets: z.array(
      z.object({
        entry_id: z.string(),
        operation: BulletOperationSchema,
        text: z.string(),
        sources: z.array(z.object({ id: z.string(), text: z.string() })),
      })
    ),
    summary: z
      .object({
        from: z.string(),
        to: z.string(),
        sources: z.array(z.string()),
      })
      .nullable(),
    notes_for_user: z.array(z.string()),
    validator: z.object({
      fallbacks_to_keep: z.number().int().min(0),
      violations: z.array(z.string()).optional(),
    }),
    /** sha256 of the canonical tailored CVData JSON ("edited after approval", 08 §5). */
    tailored_cv_sha256: Sha256HexSchema.optional(),
  })
);
export type CvVariantDiff = z.infer<typeof CvVariantDiffSchema>;

/** True when no bullet was rephrased or merged (auto-approve rule, 08 §7). */
export function isSelectionOnly(diff: Pick<CvVariantDiff, "bullets">): boolean {
  return diff.bullets.every(
    (bullet) => bullet.operation === "keep" || bullet.operation === "reorder"
  );
}
