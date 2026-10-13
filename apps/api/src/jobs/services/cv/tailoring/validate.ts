// The no-fabrication validator of CV tailoring (08 §4.4). Every rule is hard
// in the sense that model text breaking it never reaches the CV:
//
//   V1  every include_entries / bullets entry exists in the base CV (in the
//       named section; bullets in a section that has description lines)
//   V2  every source_bullet_id exists and belongs to the bullet's own entry
//       (the summary may cite any bullet)
//   V3  keep / reorder text equals its single source bullet (whitespace-
//       normalized)
//   V4  rephrase / merge text introduces no new token of the classes in
//       tokens.ts compared with the union of its sources
//   V5  rephrase / merge text ≤ 1.3 × the combined source length
//   V6  the summary passes V4 against its cited bullets, cited facts and the
//       existing summary
//   V7  skills_order is a permutation of a subset of existing skill items
//   V8  entry fields (company, title, dates, institution, degree, GPA,
//       certificate names, languages) come from the base CV — the patch
//       cannot express them; applyPatch copies them and re-checks
//   V9  ≥ 1 experience or education entry remains (when the base has one):
//       a section the patch does not name keeps all its entries and
//       include_entries can only name existing ones; personalInfo is copied
//       (photo dropped, 08 §9)
//   V10 notes_for_user is shown in the review UI only, never CV content
//
// Outcome (08 §4.4 DECISION): V1–V3 and V7–V9 failures reject the whole patch
// (one repair round-trip, then the variant fails); a bullet failing V4/V5
// falls back to `keep` of its sources; a summary failing V6 keeps the
// existing summary.

import type { CVData } from "@pilihpendidikan/cv-engine";
import type {
  CvBullet,
  CvTailoringPatch,
} from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import { newTokens } from "./tokens";

export type RuleId =
  | "V1"
  | "V2"
  | "V3"
  | "V4"
  | "V5"
  | "V6"
  | "V7"
  | "V8"
  | "V9"
  | "V10";

export interface Violation {
  /** Index into patch.bullets, when the violation is about one bullet. */
  bullet?: number;
  /** True for V1–V3 and V7–V9: the patch as a whole is rejected. */
  hard: boolean;
  message: string;
  rule: RuleId;
}

/** Sections whose entries `include_entries` may name. */
export const ENTRY_SECTIONS = [
  "experience",
  "education",
  "skills",
  "awards",
  "certificates",
  "languages",
  "projects",
  "volunteer",
] as const;
export type EntrySection = (typeof ENTRY_SECTIONS)[number];

/** Sections whose description lines are bullets (summary aside). */
export const BULLET_ENTRY_SECTIONS = [
  "experience",
  "projects",
  "volunteer",
  "awards",
] as const;

/** Length cap of V5. */
export const REPHRASE_LENGTH_RATIO = 1.3;

export interface TailoringContext {
  base: CVData;
  /** flattenCvBullets(base). */
  bullets: readonly CvBullet[];
  /** Facts the summary may cite (key → display text), already filtered. */
  facts: ReadonlyMap<string, string>;
  /** Capitalized terms of the posting (prompt-injection bait, V4/V6). */
  postingTerms: ReadonlySet<string>;
}

export interface ValidationResult {
  /** Bullets (by patch index) that fall back to `keep` (V4/V5). */
  fallbacks: Set<number>;
  hard: Violation[];
  soft: Violation[];
  /** Whether patch.summary.text may replace the summary (V6). */
  summaryAccepted: boolean;
}

const WHITESPACE_RE = /\s+/g;

/** Whitespace-normalized text (V3, V5). */
export function squash(text: string): string {
  return text.replace(WHITESPACE_RE, " ").trim();
}

function entriesOf(
  base: CVData,
  section: EntrySection
): ReadonlyArray<{ id: string }> {
  return (base[section] as Array<{ id: string }> | undefined) ?? [];
}

function describeTokens(tokens: ReturnType<typeof newTokens>): string {
  return tokens.map((t) => `${t.class} "${t.token}"`).join(", ");
}

function checkIncludeEntries(
  patch: CvTailoringPatch,
  ctx: TailoringContext,
  hard: Violation[]
): void {
  for (const entry of patch.include_entries) {
    const section = entry.section as EntrySection;
    if (!(ENTRY_SECTIONS as readonly string[]).includes(section)) {
      hard.push({
        rule: "V1",
        hard: true,
        message: `include_entries names an unknown section "${entry.section}".`,
      });
      continue;
    }
    if (!entriesOf(ctx.base, section).some((e) => e.id === entry.entry_id)) {
      hard.push({
        rule: "V1",
        hard: true,
        message: `include_entries names "${entry.entry_id}", which is not an entry of ${section}.`,
      });
    }
  }
}

// V1 + V2 + V3 for one patch bullet; returns the cited sources when sound.
function checkBulletStructure(
  bullet: CvTailoringPatch["bullets"][number],
  index: number,
  ctx: TailoringContext,
  byId: ReadonlyMap<string, CvBullet>,
  hard: Violation[]
): CvBullet[] | null {
  const owners = BULLET_ENTRY_SECTIONS.filter((section) =>
    entriesOf(ctx.base, section).some((e) => e.id === bullet.entry_id)
  );
  if (owners.length === 0) {
    hard.push({
      rule: "V1",
      hard: true,
      bullet: index,
      message: `bullets[${index}] names entry "${bullet.entry_id}", which has no description lines in the base CV.`,
    });
    return null;
  }
  const sources: CvBullet[] = [];
  for (const id of bullet.source_bullet_ids) {
    const source = byId.get(id);
    if (!source) {
      hard.push({
        rule: "V2",
        hard: true,
        bullet: index,
        message: `bullets[${index}] cites "${id}", which is not a source bullet.`,
      });
      return null;
    }
    if (source.entry_id !== bullet.entry_id || source.section === "summary") {
      hard.push({
        rule: "V2",
        hard: true,
        bullet: index,
        message: `bullets[${index}] cites "${id}" from another entry than "${bullet.entry_id}".`,
      });
      return null;
    }
    sources.push(source);
  }
  if (new Set(sources.map((s) => s.section)).size > 1) {
    hard.push({
      rule: "V2",
      hard: true,
      bullet: index,
      message: `bullets[${index}] mixes sources of different sections.`,
    });
    return null;
  }
  if (
    (bullet.operation === "keep" || bullet.operation === "reorder") &&
    (sources.length !== 1 || squash(bullet.text) !== squash(sources[0].text))
  ) {
    hard.push({
      rule: "V3",
      hard: true,
      bullet: index,
      message: `bullets[${index}] is "${bullet.operation}" but its text is not exactly its one source bullet.`,
    });
    return null;
  }
  return sources;
}

// V4 + V5 for a rephrase / merge; a failure is a keep-fallback.
function checkRephrase(
  bullet: CvTailoringPatch["bullets"][number],
  index: number,
  sources: readonly CvBullet[],
  ctx: TailoringContext,
  soft: Violation[]
): boolean {
  if (bullet.operation !== "rephrase" && bullet.operation !== "merge") {
    return true;
  }
  let ok = true;
  const texts = sources.map((s) => s.text);
  const added = newTokens(bullet.text, texts, ctx.postingTerms);
  if (added.length > 0) {
    ok = false;
    soft.push({
      rule: "V4",
      hard: false,
      bullet: index,
      message: `bullets[${index}] adds ${describeTokens(added)} not found in its sources.`,
    });
  }
  const sourceLength = squash(texts.join(" ")).length;
  if (squash(bullet.text).length > REPHRASE_LENGTH_RATIO * sourceLength) {
    ok = false;
    soft.push({
      rule: "V5",
      hard: false,
      bullet: index,
      message: `bullets[${index}] is longer than ${REPHRASE_LENGTH_RATIO} × its sources.`,
    });
  }
  if (squash(bullet.text) === "") {
    ok = false;
    soft.push({
      rule: "V5",
      hard: false,
      bullet: index,
      message: `bullets[${index}] is empty.`,
    });
  }
  return ok;
}

function checkSummary(
  patch: CvTailoringPatch,
  ctx: TailoringContext,
  byId: ReadonlyMap<string, CvBullet>,
  hard: Violation[],
  soft: Violation[]
): boolean {
  const summary = patch.summary;
  for (const id of summary.source_bullet_ids) {
    if (!byId.has(id)) {
      hard.push({
        rule: "V2",
        hard: true,
        message: `summary cites "${id}", which is not a source bullet.`,
      });
    }
  }
  const text = squash(summary.text);
  if (text === "" || text === squash(ctx.base.summary ?? "")) {
    return false;
  }
  const sources = [ctx.base.summary ?? ""];
  for (const id of summary.source_bullet_ids) {
    const bullet = byId.get(id);
    if (bullet) {
      sources.push(bullet.text);
    }
  }
  let ok = true;
  for (const key of summary.source_fact_keys) {
    const fact = ctx.facts.get(key);
    if (fact === undefined) {
      ok = false;
      soft.push({
        rule: "V6",
        hard: false,
        message: `summary cites fact "${key}", which is not an available fact.`,
      });
    } else {
      sources.push(fact);
    }
  }
  const added = newTokens(text, sources, ctx.postingTerms);
  if (added.length > 0) {
    ok = false;
    soft.push({
      rule: "V6",
      hard: false,
      message: `summary adds ${describeTokens(added)} not found in its sources.`,
    });
  }
  return ok;
}

function skillItems(base: CVData): Set<string> {
  return new Set(
    base.skills.flatMap((category) =>
      category.items.map((item) => squash(item))
    )
  );
}

function checkSkillsOrder(
  patch: CvTailoringPatch,
  ctx: TailoringContext,
  hard: Violation[]
): void {
  const existing = skillItems(ctx.base);
  const seen = new Set<string>();
  for (const raw of patch.skills_order) {
    const item = squash(raw);
    if (!existing.has(item)) {
      hard.push({
        rule: "V7",
        hard: true,
        message: `skills_order lists "${raw}", which is not a skill of the base CV.`,
      });
    } else if (seen.has(item)) {
      hard.push({
        rule: "V7",
        hard: true,
        message: `skills_order lists "${raw}" twice.`,
      });
    }
    seen.add(item);
  }
}

/** The entries `include_entries` keeps per section (absent section = all). */
export function keptEntryIds(
  patch: Pick<CvTailoringPatch, "include_entries">,
  base: CVData
): Map<EntrySection, string[]> {
  const kept = new Map<EntrySection, string[]>();
  for (const section of ENTRY_SECTIONS) {
    const named = patch.include_entries
      .filter((e) => e.section === section)
      .map((e) => e.entry_id)
      .filter((id) => entriesOf(base, section).some((e) => e.id === id));
    kept.set(
      section,
      named.length > 0
        ? [...new Set(named)]
        : entriesOf(base, section).map((e) => e.id)
    );
  }
  return kept;
}

/**
 * Runs V1–V7 over a patch. V8–V10 hold by construction (apply.ts copies every
 * entry field and personalInfo from the base, keeps all entries of a section
 * the patch does not name, never writes notes_for_user into the CV) and are
 * re-asserted on the applied CV.
 */
export function validatePatch(
  patch: CvTailoringPatch,
  ctx: TailoringContext
): ValidationResult {
  const hard: Violation[] = [];
  const soft: Violation[] = [];
  const fallbacks = new Set<number>();
  const byId = new Map(ctx.bullets.map((b) => [b.id, b]));
  checkIncludeEntries(patch, ctx, hard);
  for (const [index, bullet] of patch.bullets.entries()) {
    const sources = checkBulletStructure(bullet, index, ctx, byId, hard);
    if (sources && !checkRephrase(bullet, index, sources, ctx, soft)) {
      fallbacks.add(index);
    }
  }
  const summaryAccepted = checkSummary(patch, ctx, byId, hard, soft);
  checkSkillsOrder(patch, ctx, hard);
  return {
    hard,
    soft,
    fallbacks,
    summaryAccepted: summaryAccepted && hard.length === 0,
  };
}

/** Violation list for the repair prompt and the stored diff. */
export function formatViolations(violations: readonly Violation[]): string[] {
  return violations.map((v) => `${v.rule}: ${v.message}`);
}
