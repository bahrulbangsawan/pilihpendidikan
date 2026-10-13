// One conditional write (D-21) with the conflict rules of 12 §11 applied:
// send with `base_revision`; on `409 revision_conflict` merge what does not
// overlap and re-send once with the new revision, or hand the overlap to the
// UI ("Apply mine anyway" / "Keep theirs") without retrying.

import { isApiError } from "./api-client";
import type { FieldMerger } from "./conflict";
import { resolveRevisionConflict } from "./conflict";

export interface RevisionedRecord {
  revision: number;
}

export type WriteOutcome<T extends RevisionedRecord> =
  /** Saved; `mergedFrom` lists the other side's fields merged in. */
  | { kind: "saved"; record: T; mergedFrom: string[] }
  /** My change was already there. */
  | { kind: "noop"; record: T }
  /** Both changed the same fields: the UI decides. Nothing was retried. */
  | {
      kind: "overlap";
      current: T;
      fields: string[];
      /** Re-sends my change over theirs (the user's explicit choice). */
      applyMine: () => Promise<T>;
    };

export interface RevisionedWrite<T extends RevisionedRecord> {
  /** The record as it was when the edit started. */
  base: T;
  /** The fields this edit changes. */
  changes: Readonly<Record<string, unknown>>;
  /** The resource's writable fields (compare only these on a conflict). */
  fields?: readonly string[];
  merge?: FieldMerger;
  /** Sends the write; resolves to the saved record. */
  send: (baseRevision: number, changes: Record<string, unknown>) => Promise<T>;
}

function currentRecord<T extends RevisionedRecord>(value: unknown): T | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "revision" in value &&
    typeof value.revision === "number"
  ) {
    return value as T;
  }
  return null;
}

export async function writeWithConflicts<T extends RevisionedRecord>(
  write: RevisionedWrite<T>
): Promise<WriteOutcome<T>> {
  try {
    const record = await write.send(write.base.revision, { ...write.changes });
    return { kind: "saved", record, mergedFrom: [] };
  } catch (error) {
    if (!(isApiError(error) && error.isRevisionConflict)) {
      throw error;
    }
    const current = currentRecord<T>(error.current);
    if (!current) {
      throw error;
    }
    const resolution = resolveRevisionConflict({
      base: write.base as unknown as Record<string, unknown>,
      changes: write.changes,
      current: current as unknown as Record<string, unknown> & {
        revision: number;
      },
      merge: write.merge,
      fields: write.fields,
    });
    if (resolution.kind === "noop") {
      return { kind: "noop", record: current };
    }
    const applyMine = () => write.send(current.revision, { ...write.changes });
    if (resolution.kind === "overlap") {
      return { kind: "overlap", current, fields: resolution.fields, applyMine };
    }
    try {
      const record = await write.send(
        resolution.baseRevision,
        resolution.changes
      );
      return { kind: "saved", record, mergedFrom: resolution.theirFields };
    } catch (retryError) {
      // Changed again in between: stop and let the user decide.
      if (isApiError(retryError) && retryError.isRevisionConflict) {
        const latest = currentRecord<T>(retryError.current) ?? current;
        return {
          kind: "overlap",
          current: latest,
          fields: Object.keys(write.changes),
          applyMine: () => write.send(latest.revision, { ...write.changes }),
        };
      }
      throw retryError;
    }
  }
}
