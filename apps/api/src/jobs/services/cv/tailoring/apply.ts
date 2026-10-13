// Applying a validated patch to the base CV (08 §4.1 step 6) and the diff of
// 08 §4.5.
//
// What the patch can change, and nothing else (V8 by construction):
//   - section order (listed sections first, the rest after, in base order;
//     every section stays in `sectionOrder` so the CV builder shows it);
//   - which entries of a section remain, and their order (`include_entries`;
//     a section the patch does not mention keeps all its entries);
//   - the description lines of included entries that have patch bullets
//     (keep / reorder verbatim, accepted rephrase / merge text, and the
//     sources of rejected ones as `keep` fallbacks);
//   - the summary (only when V6 accepted it);
//   - the order (and subset) of skill items inside their categories.
// Every other field — personalInfo (minus the photo, 08 §9), titles, entry
// fields — is copied from the base. The result is re-parsed with CVDataSchema
// and re-checked against the base (V8, V9).

import type { CVData, CVSectionId } from "@pilihpendidikan/cv-engine";
import { CV_SECTION_IDS, CVDataSchema } from "@pilihpendidikan/cv-engine";
import type {
  BulletOperation,
  CvBullet,
  CvTailoringPatch,
  CvVariantDiff,
} from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import type { CvTemplate } from "@pilihpendidikan/jobs-contracts/enums";
import type { EntrySection, ValidationResult } from "./validate";
import {
  BULLET_ENTRY_SECTIONS,
  ENTRY_SECTIONS,
  keptEntryIds,
  squash,
} from "./validate";

export interface AppliedTailoring {
  cv: CVData;
  /** The 08 §4.5 diff, without `tailored_cv_sha256` (added on save). */
  diff: CvVariantDiff;
}

export class TailoringInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailoringInvariantError";
  }
}

type Entry = { id: string } & Record<string, unknown>;

/** The section order of a CV: its own order, then any missing section. */
export function fullSectionOrder(order: readonly CVSectionId[]): CVSectionId[] {
  return [...new Set<CVSectionId>([...order, ...CV_SECTION_IDS])];
}

/** A short human label of an entry (diff `excluded_entries`). */
export function entryLabel(section: EntrySection, entry: Entry): string {
  const text = (key: string) =>
    typeof entry[key] === "string" ? (entry[key] as string) : "";
  const parts: Record<EntrySection, string[]> = {
    experience: [text("title"), text("company")],
    education: [text("degree"), text("institution")],
    skills: [text("name")],
    awards: [text("title")],
    certificates: [text("name")],
    languages: [text("language")],
    projects: [text("name")],
    volunteer: [text("role"), text("organization")],
  };
  return parts[section].filter(Boolean).join(", ") || entry.id;
}

/** personalInfo as tailored variants carry it: copied, photo dropped (08 §9). */
export function tailoredPersonalInfo(base: CVData): CVData["personalInfo"] {
  return { ...base.personalInfo, photoUrl: "", usePhoto: false };
}

interface FinalBullet {
  entry_id: string;
  operation: BulletOperation;
  sources: Array<{ id: string; text: string }>;
  text: string;
}

function patchedSectionOrder(
  patch: CvTailoringPatch,
  base: CVData
): CVSectionId[] {
  const listed = [...new Set(patch.section_order)] as CVSectionId[];
  return fullSectionOrder([...listed, ...fullSectionOrder(base.sectionOrder)]);
}

// The lines of each entry that has patch bullets, after fallbacks.
function finalBullets(
  patch: CvTailoringPatch,
  validation: ValidationResult,
  byId: ReadonlyMap<string, CvBullet>
): { bullets: FinalBullet[]; fallbacks: number } {
  const out: FinalBullet[] = [];
  let fallbacks = 0;
  for (const [index, bullet] of patch.bullets.entries()) {
    const sources = bullet.source_bullet_ids
      .map((id) => byId.get(id))
      .filter((s): s is CvBullet => s !== undefined)
      .map((s) => ({ id: s.id, text: s.text }));
    if (validation.fallbacks.has(index)) {
      fallbacks += 1;
      for (const source of sources) {
        out.push({
          entry_id: bullet.entry_id,
          operation: "keep",
          text: source.text,
          sources: [source],
        });
      }
      continue;
    }
    out.push({
      entry_id: bullet.entry_id,
      operation: bullet.operation,
      text: squash(bullet.text),
      sources,
    });
  }
  return { bullets: out, fallbacks };
}

function bulletSection(
  bullet: FinalBullet,
  byId: ReadonlyMap<string, CvBullet>
): string | null {
  const first = bullet.sources[0];
  return first ? (byId.get(first.id)?.section ?? null) : null;
}

// Lines per "section:entry_id", deduplicated in order.
function linesByEntry(
  bullets: readonly FinalBullet[],
  byId: ReadonlyMap<string, CvBullet>
): Map<string, string[]> {
  const lines = new Map<string, string[]>();
  for (const bullet of bullets) {
    const section = bulletSection(bullet, byId);
    if (!section) {
      continue;
    }
    const key = `${section}:${bullet.entry_id}`;
    const list = lines.get(key) ?? [];
    if (!list.includes(bullet.text)) {
      list.push(bullet.text);
    }
    lines.set(key, list);
  }
  return lines;
}

function orderSkills(
  base: CVData,
  skillsOrder: readonly string[]
): CVData["skills"] {
  if (skillsOrder.length === 0) {
    return base.skills.map((c) => ({ ...c, items: [...c.items] }));
  }
  const rank = new Map(skillsOrder.map((item, i) => [squash(item), i]));
  return base.skills
    .map((category) => ({
      ...category,
      items: category.items
        .filter((item) => rank.has(squash(item)))
        .sort(
          (a, b) => (rank.get(squash(a)) ?? 0) - (rank.get(squash(b)) ?? 0)
        ),
    }))
    .filter((category) => category.items.length > 0);
}

function excludedEntries(
  base: CVData,
  kept: ReadonlyMap<EntrySection, string[]>
): CvVariantDiff["excluded_entries"] {
  const out: CvVariantDiff["excluded_entries"] = [];
  for (const section of ENTRY_SECTIONS) {
    const keep = new Set(kept.get(section) ?? []);
    for (const entry of base[section] as unknown as Entry[]) {
      if (!keep.has(entry.id)) {
        out.push({
          section,
          entry_id: entry.id,
          label: entryLabel(section, entry),
        });
      }
    }
  }
  return out;
}

const DESCRIBED: ReadonlySet<string> = new Set(BULLET_ENTRY_SECTIONS);

// V8 + V9: everything but descriptions, order and skill items equals the
// base, entry by entry; an experience or education entry remains.
function assertCopiedFromBase(base: CVData, result: CVData): void {
  const hadCore = base.experience.length + base.education.length > 0;
  if (hadCore && result.experience.length + result.education.length === 0) {
    throw new TailoringInvariantError("V9: no experience or education left");
  }
  const { photoUrl: _a, usePhoto: _b, ...basePerson } = base.personalInfo;
  const { photoUrl: _c, usePhoto: _d, ...resultPerson } = result.personalInfo;
  if (JSON.stringify(basePerson) !== JSON.stringify(resultPerson)) {
    throw new TailoringInvariantError("V9: personalInfo changed");
  }
  for (const section of ENTRY_SECTIONS) {
    const baseEntries = new Map(
      (base[section] as unknown as Entry[]).map((e) => [e.id, e])
    );
    for (const entry of result[section] as unknown as Entry[]) {
      const original = baseEntries.get(entry.id);
      if (!original) {
        throw new TailoringInvariantError(
          `V8: ${section} entry ${entry.id} is new`
        );
      }
      for (const [key, value] of Object.entries(entry)) {
        const editable =
          (key === "description" && DESCRIBED.has(section)) ||
          (key === "items" && section === "skills");
        if (
          !editable &&
          JSON.stringify(value) !== JSON.stringify(original[key])
        ) {
          throw new TailoringInvariantError(
            `V8: ${section} entry ${entry.id} field ${key} changed`
          );
        }
      }
    }
  }
}

export interface ApplyMeta {
  model: string;
  promptVersion: string;
  template: CvTemplate;
}

/** Patch + validation → the tailored CVData and its diff (08 §4.1 step 6). */
export function applyPatch(
  base: CVData,
  patch: CvTailoringPatch,
  validation: ValidationResult,
  bullets: readonly CvBullet[],
  meta: ApplyMeta
): AppliedTailoring {
  const byId = new Map(bullets.map((b) => [b.id, b]));
  const kept = keptEntryIds(patch, base);
  const { bullets: final, fallbacks } = finalBullets(patch, validation, byId);
  const lines = linesByEntry(final, byId);
  const draft = structuredClone(base) as CVData;
  for (const section of ENTRY_SECTIONS) {
    const entries = new Map(
      (base[section] as unknown as Entry[]).map((e) => [e.id, e])
    );
    (draft as unknown as Record<string, Entry[]>)[section] = (
      kept.get(section) ?? []
    )
      .map((id) => entries.get(id))
      .filter((e): e is Entry => e !== undefined)
      .map((entry) => {
        const copy = structuredClone(entry);
        const own = lines.get(`${section}:${entry.id}`);
        if (own && DESCRIBED.has(section)) {
          copy.description = own.join("\n");
        }
        return copy;
      });
  }
  draft.skills = orderSkills(
    { ...base, skills: (draft.skills as CVData["skills"]) ?? [] },
    patch.skills_order
  );
  const summaryChanged = validation.summaryAccepted;
  if (summaryChanged) {
    draft.summary = squash(patch.summary.text);
  }
  draft.sectionOrder = patchedSectionOrder(patch, base);
  draft.personalInfo = tailoredPersonalInfo(base);
  draft.style = meta.template;
  draft.visibility = "private";
  const cv = CVDataSchema.parse(draft) as CVData;
  assertCopiedFromBase(base, cv);
  const byIdText = new Map(bullets.map((b) => [b.id, b.text]));
  const diff: CvVariantDiff = {
    prompt_version: meta.promptVersion,
    model: meta.model,
    section_order: {
      from: fullSectionOrder(base.sectionOrder),
      to: cv.sectionOrder,
    },
    excluded_entries: excludedEntries(base, kept),
    bullets: final.map((b) => ({
      entry_id: b.entry_id,
      operation: b.operation,
      text: b.text,
      sources: b.sources,
    })),
    summary: summaryChanged
      ? {
          from: base.summary ?? "",
          to: cv.summary,
          sources: [
            ...patch.summary.source_bullet_ids
              .map((id) => byIdText.get(id))
              .filter((t): t is string => t !== undefined),
            ...patch.summary.source_fact_keys.map((key) => `fact:${key}`),
          ],
        }
      : null,
    notes_for_user: patch.notes_for_user
      .map((note) => squash(note))
      .filter(Boolean),
    validator: {
      fallbacks_to_keep: fallbacks,
      violations: [...validation.soft].map((v) => `${v.rule}: ${v.message}`),
    },
  };
  return { cv, diff };
}

/**
 * A copy-only variant (no AI, M3): the base CV as a private, photo-free
 * document in the variant's template, with a diff that changes nothing.
 */
export function copyAsTailored(
  base: CVData,
  template: CvTemplate,
  meta: { model: string; promptVersion: string }
): AppliedTailoring {
  const draft = structuredClone(base) as CVData;
  draft.sectionOrder = fullSectionOrder(base.sectionOrder);
  draft.personalInfo = tailoredPersonalInfo(base);
  draft.style = template;
  draft.visibility = "private";
  const cv = CVDataSchema.parse(draft) as CVData;
  assertCopiedFromBase(base, cv);
  return {
    cv,
    diff: {
      prompt_version: meta.promptVersion,
      model: meta.model,
      section_order: { from: cv.sectionOrder, to: cv.sectionOrder },
      excluded_entries: [],
      bullets: [],
      summary: null,
      notes_for_user: [],
      validator: { fallbacks_to_keep: 0, violations: [] },
    },
  };
}

/** True when no model-written sentence reaches the CV (auto-approve, 08 §7). */
export function isPureSelection(
  diff: Pick<CvVariantDiff, "bullets" | "summary">
): boolean {
  return (
    diff.summary === null &&
    diff.bullets.every(
      (b) => b.operation === "keep" || b.operation === "reorder"
    )
  );
}
