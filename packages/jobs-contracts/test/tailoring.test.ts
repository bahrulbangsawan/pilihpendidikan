import { describe, expect, test } from "bun:test";
import { FIELD_PLAN_JSON_SCHEMA } from "../src/agent";
import {
  CV_BULLET_SECTIONS,
  CV_TAILORING_PATCH_JSON_SCHEMA,
  CvBulletSchema,
  CvTailoringPatchSchema,
  CvVariantDiffSchema,
  isSelectionOnly,
} from "../src/cv-tailoring";
import { EMAIL_PARAGRAPH_JSON_SCHEMA } from "../src/email";
import { RECORD_EXAMPLES } from "./examples";

interface Node {
  [key: string]: unknown;
  additionalProperties?: unknown;
  items?: unknown;
  properties?: Record<string, unknown>;
  required?: string[];
  type?: unknown;
}

/** Every object node: additionalProperties false and all properties required. */
function strictViolations(node: unknown, path = "$"): string[] {
  if (!node || typeof node !== "object") {
    return [];
  }
  const n = node as Node;
  const out: string[] = [];
  if (n.type === "object") {
    if (n.additionalProperties !== false) {
      out.push(`${path}: additionalProperties is not false`);
    }
    const props = Object.keys(n.properties ?? {}).sort();
    const required = [...(n.required ?? [])].sort();
    if (JSON.stringify(props) !== JSON.stringify(required)) {
      out.push(`${path}: required ${required} != properties ${props}`);
    }
  }
  for (const [key, value] of Object.entries(n.properties ?? {})) {
    out.push(...strictViolations(value, `${path}.${key}`));
  }
  if (n.items) {
    out.push(...strictViolations(n.items, `${path}[]`));
  }
  return out;
}

const PATCH = {
  section_order: ["summary", "skills", "experience", "education"],
  include_entries: [
    { section: "experience", entry_id: "exp-1" },
    { section: "education", entry_id: "edu-1" },
  ],
  bullets: [
    {
      entry_id: "exp-1",
      text: "Built payment APIs in Go serving 2M requests a day.",
      source_bullet_ids: ["experience:exp-1:2"],
      operation: "rephrase",
    },
  ],
  summary: {
    text: "Backend engineer focused on payments.",
    source_bullet_ids: ["experience:exp-1:2"],
    source_fact_keys: [],
  },
  skills_order: ["Go", "PostgreSQL"],
  notes_for_user: ["Posting asks for Kubernetes; not in your CV"],
};

describe("CvTailoringPatch strict schema (08 §4.3)", () => {
  test("TC-TAILOR-SCHEMA every object is closed and lists all properties as required", () => {
    expect(CV_TAILORING_PATCH_JSON_SCHEMA.name).toBe("cv_tailoring_patch");
    expect(CV_TAILORING_PATCH_JSON_SCHEMA.strict).toBe(true);
    expect(strictViolations(CV_TAILORING_PATCH_JSON_SCHEMA.schema)).toEqual([]);
  });

  test("TC-TAILOR-SCHEMA the field-plan and email-paragraph strict schemas follow the same rules", () => {
    expect(strictViolations(FIELD_PLAN_JSON_SCHEMA.schema)).toEqual([]);
    expect(strictViolations(EMAIL_PARAGRAPH_JSON_SCHEMA.schema)).toEqual([]);
  });

  test("TC-TAILOR-SCHEMA the Zod schema and the strict JSON schema agree on fields", () => {
    const schema = CV_TAILORING_PATCH_JSON_SCHEMA.schema;
    expect(Object.keys(CvTailoringPatchSchema.shape).sort()).toEqual(
      Object.keys(schema.properties).sort()
    );
    expect(
      Object.keys(CvTailoringPatchSchema.shape.summary.shape).sort()
    ).toEqual([...schema.properties.summary.required].sort());
    expect(
      Object.keys(CvTailoringPatchSchema.shape.bullets.element.shape).sort()
    ).toEqual([...schema.properties.bullets.items.required].sort());
  });

  test("TC-TAILOR-SCHEMA a valid patch parses and round-trips", () => {
    const parsed = CvTailoringPatchSchema.parse(PATCH);
    expect(
      CvTailoringPatchSchema.parse(JSON.parse(JSON.stringify(parsed)))
    ).toEqual(parsed);
  });

  test("TC-TAILOR-SCHEMA unknown keys, missing keys and limit breaks are rejected", () => {
    const bad = (patch: Record<string, unknown>) =>
      CvTailoringPatchSchema.safeParse({ ...PATCH, ...patch }).success;
    expect(bad({ extra: true })).toBe(false);
    expect(
      CvTailoringPatchSchema.safeParse({ ...PATCH, notes_for_user: undefined })
        .success
    ).toBe(false);
    expect(bad({ section_order: ["summary", "hobbies"] })).toBe(false);
    const bullet = PATCH.bullets[0];
    expect(bad({ bullets: [{ ...bullet, text: "x".repeat(301) }] })).toBe(
      false
    );
    expect(bad({ bullets: [{ ...bullet, source_bullet_ids: [] }] })).toBe(
      false
    );
    expect(bad({ bullets: [{ ...bullet, operation: "invent" }] })).toBe(false);
    expect(bad({ bullets: [{ ...bullet, company: "Google" }] })).toBe(false);
    expect(bad({ summary: { ...PATCH.summary, text: "x".repeat(701) } })).toBe(
      false
    );
    expect(bad({ notes_for_user: ["x".repeat(201)] })).toBe(false);
  });

  test("TC-TAILOR-SCHEMA CvBullet matches the cv-engine shape", () => {
    expect([...CV_BULLET_SECTIONS]).toEqual([
      "summary",
      "experience",
      "projects",
      "volunteer",
      "awards",
      "certificates",
    ]);
    expect(
      CvBulletSchema.safeParse({
        id: "summary:0:1",
        section: "summary",
        entry_id: "0",
        text: "Backend engineer.",
      }).success
    ).toBe(true);
    expect(Object.keys(CvBulletSchema.shape).sort()).toEqual([
      "entry_id",
      "id",
      "section",
      "text",
    ]);
  });

  test("TC-TAILOR-SCHEMA the stored diff (08 §4.5) parses; selection-only detection", () => {
    const diff = CvVariantDiffSchema.parse(RECORD_EXAMPLES.cv_variants.diff);
    expect(isSelectionOnly(diff)).toBe(false);
    expect(
      isSelectionOnly({
        bullets: diff.bullets.map((b) => ({
          ...b,
          operation: "keep" as const,
        })),
      })
    ).toBe(true);
  });
});
