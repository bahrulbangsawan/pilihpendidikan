// The CV tab's diff view model (08 §4.5, §7): `cv_variants.diff` arranged
// side by side — each tailored bullet next to the source bullets it was
// derived from (shown on hover / focus), grouped by CV entry; excluded
// entries struck through; the summary and section order before → after;
// `notes_for_user` as warnings. Entry headers come from the tailored CVData
// when the api includes it, else the entry id is shown. Pure.

import type { CvVariantDiff } from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import { CvVariantDiffSchema } from "@pilihpendidikan/jobs-contracts/cv-tailoring";

export type BulletOperation = CvVariantDiff["bullets"][number]["operation"];

export interface DiffSource {
  id: string;
  text: string;
}

export interface DiffBullet {
  /** Stable key: entry id + position. */
  key: string;
  operation: BulletOperation;
  /** Model-written words the user must read (rephrase / merge). */
  rewritten: boolean;
  sources: DiffSource[];
  text: string;
}

export interface DiffEntry {
  bullets: DiffBullet[];
  entryId: string;
  label: string;
  section: string | null;
}

export interface DiffModel {
  entries: DiffEntry[];
  excluded: { section: string; entryId: string; label: string }[];
  fallbacksToKeep: number;
  notes: string[];
  rewrittenCount: number;
  sectionOrder: { from: string[]; to: string[]; changed: boolean };
  summary: {
    from: string;
    to: string;
    changed: boolean;
    sources: string[];
  } | null;
}

/** Entry labels from a CVData-like object: `exp-1` → "Engineer · Acme". */
export function entryLabels(
  cv: unknown
): Map<string, { label: string; section: string }> {
  const labels = new Map<string, { label: string; section: string }>();
  if (typeof cv !== "object" || cv === null) {
    return labels;
  }
  const data = cv as Record<string, unknown>;
  const add = (
    section: string,
    pick: (entry: Record<string, unknown>) => (string | undefined)[]
  ) => {
    const list = data[section];
    if (!Array.isArray(list)) {
      return;
    }
    for (const raw of list) {
      if (typeof raw !== "object" || raw === null) {
        continue;
      }
      const entry = raw as Record<string, unknown>;
      if (typeof entry.id !== "string") {
        continue;
      }
      const parts = pick(entry).filter(
        (part): part is string => typeof part === "string" && part.trim() !== ""
      );
      labels.set(entry.id, {
        label: parts.join(" · ") || entry.id,
        section,
      });
    }
  };
  const text = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  add("experience", (e) => [text(e.title), text(e.company)]);
  add("projects", (e) => [text(e.name)]);
  add("volunteer", (e) => [text(e.role), text(e.organization)]);
  add("awards", (e) => [text(e.title)]);
  add("certificates", (e) => [text(e.name)]);
  add("education", (e) => [text(e.degree), text(e.institution)]);
  return labels;
}

const SUMMARY_ENTRY = "summary";

/** The diff of a variant, or null when the variant has none yet (`{}`). */
export function parseDiff(raw: unknown): CvVariantDiff | null {
  const parsed = CvVariantDiffSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function buildDiffModel(
  diff: CvVariantDiff,
  tailoredCv?: unknown
): DiffModel {
  const labels = entryLabels(tailoredCv);
  const entries: DiffEntry[] = [];
  const byEntry = new Map<string, DiffEntry>();
  let rewrittenCount = 0;
  diff.bullets.forEach((bullet, index) => {
    let entry = byEntry.get(bullet.entry_id);
    if (!entry) {
      const known = labels.get(bullet.entry_id);
      entry = {
        entryId: bullet.entry_id,
        label: known?.label ?? bullet.entry_id,
        section:
          known?.section ??
          (bullet.entry_id === SUMMARY_ENTRY ? SUMMARY_ENTRY : null),
        bullets: [],
      };
      byEntry.set(bullet.entry_id, entry);
      entries.push(entry);
    }
    const rewritten =
      bullet.operation === "rephrase" || bullet.operation === "merge";
    if (rewritten) {
      rewrittenCount += 1;
    }
    entry.bullets.push({
      key: `${bullet.entry_id}:${index}`,
      operation: bullet.operation,
      rewritten,
      text: bullet.text,
      sources: bullet.sources.map((source) => ({ ...source })),
    });
  });
  return {
    entries,
    excluded: diff.excluded_entries.map((entry) => ({
      section: entry.section,
      entryId: entry.entry_id,
      label: entry.label,
    })),
    fallbacksToKeep: diff.validator.fallbacks_to_keep,
    notes: [...diff.notes_for_user],
    rewrittenCount,
    sectionOrder: {
      from: [...diff.section_order.from],
      to: [...diff.section_order.to],
      changed: !sameList(diff.section_order.from, diff.section_order.to),
    },
    summary: diff.summary
      ? {
          from: diff.summary.from,
          to: diff.summary.to,
          changed: diff.summary.from.trim() !== diff.summary.to.trim(),
          sources: [...diff.summary.sources],
        }
      : null,
  };
}
