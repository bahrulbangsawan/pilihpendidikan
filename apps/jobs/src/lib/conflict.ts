// Revision conflicts (job-tracker-spec 12 §11, D-21). Every write sends
// `base_revision`; a `409 revision_conflict` carries `details.current`.
//
// - Fields only the other side changed: auto-merge — re-send my fields with
//   the new revision ("Updated with changes from …").
// - A field both sides changed to different values: never auto-retry; revert
//   the optimistic update and ask: "Apply mine anyway" / "Keep theirs".
//   Text fields (checklist notes) first try a three-way merge.
// - My change already matches the current value: nothing left to send.

import type { LegacyJobSection } from "@pilihpendidikan/jobs-contracts/records";
import { mergeText } from "./text-merge";

/** Bookkeeping columns that change on every write; never a user conflict. */
export const META_FIELDS: ReadonlySet<string> = new Set([
  "revision",
  "updated_at",
  "created_at",
  "last_change_source",
  "stage_changed_at",
]);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (typeof a === "object" && typeof b === "object" && !Array.isArray(b)) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (!deepEqual(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Fields whose value differs between `base` and `current` (meta excluded),
 * over `fields` when given (e.g. when `base` is a board card, a view with
 * extra keys), else over every key of both.
 */
export function changedFields(
  base: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
  fields?: readonly string[]
): string[] {
  const keys = fields
    ? new Set(fields)
    : new Set([...Object.keys(base), ...Object.keys(current)]);
  return [...keys].filter(
    (key) => !(META_FIELDS.has(key) || deepEqual(base[key], current[key]))
  );
}

/** A field-level merge for overlapping edits (e.g. text, checklists). */
export type FieldMerger = (
  field: string,
  base: unknown,
  mine: unknown,
  theirs: unknown
) => { ok: true; value: unknown } | { ok: false };

export type ConflictResolution =
  | {
      kind: "retry";
      /** What to re-send with `base_revision = baseRevision`. */
      changes: Record<string, unknown>;
      baseRevision: number;
      /** What the other side changed (auto-merged in). */
      theirFields: string[];
      /** Overlapping fields resolved by a merger. */
      mergedFields: string[];
    }
  | { kind: "noop"; theirFields: string[] }
  | {
      kind: "overlap";
      /** Fields both sides changed differently. */
      fields: string[];
      theirFields: string[];
    };

export interface ConflictInput {
  /** The record my edit started from. */
  base: Readonly<Record<string, unknown>>;
  /** My changed fields. */
  changes: Readonly<Record<string, unknown>>;
  /** `details.current` of the 409. */
  current: Readonly<Record<string, unknown>> & { revision: number };
  /** Compare only these fields (the resource's writable fields). */
  fields?: readonly string[];
  merge?: FieldMerger;
}

/** Applies the 12 §11 rules to one 409 revision_conflict. */
export function resolveRevisionConflict(
  input: ConflictInput
): ConflictResolution {
  const { base, changes, current, merge } = input;
  const theirFields = changedFields(base, current, input.fields);
  const pending = Object.keys(changes).filter(
    (field) => !deepEqual(current[field], changes[field])
  );
  if (pending.length === 0) {
    return { kind: "noop", theirFields };
  }
  const resend: Record<string, unknown> = {};
  const overlapping: string[] = [];
  const mergedFields: string[] = [];
  for (const field of pending) {
    if (!theirFields.includes(field)) {
      resend[field] = changes[field];
      continue;
    }
    const merged = merge?.(field, base[field], changes[field], current[field]);
    if (merged?.ok) {
      resend[field] = merged.value;
      mergedFields.push(field);
    } else {
      overlapping.push(field);
    }
  }
  if (overlapping.length > 0) {
    return { kind: "overlap", fields: overlapping, theirFields };
  }
  return {
    kind: "retry",
    changes: resend,
    baseRevision: current.revision,
    theirFields,
    mergedFields,
  };
}

// ── Checklists (applications.sections, 06 §5) ───────────────────────────────

type Item = LegacyJobSection["items"][number];

function mergeScalar<T>(
  base: T,
  mine: T,
  theirs: T
): { ok: true; value: T } | { ok: false } {
  if (deepEqual(mine, theirs) || deepEqual(theirs, base)) {
    return { ok: true, value: mine };
  }
  if (deepEqual(mine, base)) {
    return { ok: true, value: theirs };
  }
  return { ok: false };
}

function mergeItem(base: Item, mine: Item, theirs: Item): Item | null {
  const title = mergeScalar(base.title, mine.title, theirs.title);
  const url = mergeScalar(base.url, mine.url, theirs.url);
  const done = mergeScalar(base.done, mine.done, theirs.done);
  const notes = mergeText(base.notes, mine.notes, theirs.notes);
  if (!(title.ok && url.ok && done.ok && notes.ok)) {
    return null;
  }
  return {
    id: mine.id,
    title: title.value,
    url: url.value,
    done: done.value,
    notes: notes.text,
  };
}

const CONFLICT = Symbol("conflict");
const DROPPED = Symbol("dropped");

/** One entry the other side still has: merged, dropped (I deleted it) or a conflict. */
function mergeTheirEntry<T extends { id: string }>(
  their: T,
  original: T | undefined,
  own: T | undefined,
  mergeOne: (base: T, mine: T, theirs: T) => T | null
): T | typeof CONFLICT | typeof DROPPED {
  if (!original) {
    return own ? (mergeOne(their, own, their) ?? their) : their;
  }
  if (!own) {
    // I deleted it: fine unless they changed it meanwhile.
    return deepEqual(original, their) ? DROPPED : CONFLICT;
  }
  return mergeOne(original, own, their) ?? CONFLICT;
}

function mergeById<T extends { id: string }>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  mergeOne: (base: T, mine: T, theirs: T) => T | null
): T[] | null {
  const baseById = new Map(base.map((entry) => [entry.id, entry]));
  const mineById = new Map(mine.map((entry) => [entry.id, entry]));
  const theirIds = new Set(theirs.map((entry) => entry.id));
  const result: T[] = [];
  // Their order first: what the other side sees stays where it is.
  for (const their of theirs) {
    const merged = mergeTheirEntry(
      their,
      baseById.get(their.id),
      mineById.get(their.id),
      mergeOne
    );
    if (merged === CONFLICT) {
      return null;
    }
    if (merged !== DROPPED) {
      result.push(merged);
    }
  }
  for (const own of mine) {
    if (theirIds.has(own.id)) {
      continue;
    }
    const original = baseById.get(own.id);
    if (!original) {
      result.push(own);
    } else if (!deepEqual(original, own)) {
      // They deleted what I edited.
      return null;
    }
  }
  return result;
}

/**
 * Three-way merge of the checklist array by section and item id: additions
 * on both sides are kept, one-sided edits win, item notes merge as text.
 * Null when both sides changed the same thing differently.
 */
export function mergeSections(
  base: readonly LegacyJobSection[],
  mine: readonly LegacyJobSection[],
  theirs: readonly LegacyJobSection[]
): LegacyJobSection[] | null {
  return mergeById(base, mine, theirs, (original, own, their) => {
    const name = mergeScalar(original.name, own.name, their.name);
    const items = mergeById(original.items, own.items, their.items, mergeItem);
    if (!(name.ok && items)) {
      return null;
    }
    return { id: own.id, name: name.value, items };
  });
}

/** Writable application fields compared on a conflict (05 §5 PATCH). */
export const APPLICATION_FIELDS = [
  "stage",
  "board_rank",
  "mode",
  "priority",
  "archived",
  "follow_up_at",
  "base_cv_id",
  "sections",
  "submission_status",
  "cv_variant_id",
] as const;

/** The FieldMerger for application writes: checklists merge structurally. */
export const applicationFieldMerger: FieldMerger = (
  field,
  base,
  mine,
  theirs
) => {
  if (
    field === "sections" &&
    Array.isArray(base) &&
    Array.isArray(mine) &&
    Array.isArray(theirs)
  ) {
    const merged = mergeSections(
      base as LegacyJobSection[],
      mine as LegacyJobSection[],
      theirs as LegacyJobSection[]
    );
    return merged ? { ok: true, value: merged } : { ok: false };
  }
  return { ok: false };
};
