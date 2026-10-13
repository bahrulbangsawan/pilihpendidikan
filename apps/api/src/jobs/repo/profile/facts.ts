// `applicant_facts` (04 §2.3, 03 §9): the user's typed fact sheet. One row
// per canonical key (`UNIQUE (user_id, key)`); every write bumps `revision`
// and appends a `fact` change in the same batch (03 §10).
//
//   listFacts / factsByKeys        reads (API records: `value` parsed)
//   insertFactStatements           create (revision 1)
//   updateFactStatements           guarded update (D-21: `revision = base`)
//   deleteFactStatements           guarded delete + `delete` tombstone
//   mirrorFactStatements           settings → fact mirror (`prefs.timezone`,
//                                  `prefs.ai_scoring_sensitive`), a no-op when
//                                  the stored value is already the same
//   runProfileBatch                one transactional batch (services cannot
//                                  import the SQL helpers)

import type { FactSource } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicantFactRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import { appendChange } from "../core/change-log";
import type { JobsDb } from "../core/db";
import {
  decodeRow,
  encodeJson,
  guardRevision,
  queryAll,
  runBatch,
  stmt,
} from "../core/db";

/** D1 binds at most 100 parameters per statement (04 header). */
const IN_CHUNK = 90;

const FACT_COLUMNS =
  "id, user_id, key, value, source, cv_id, cv_entry_id, revision, created_at, updated_at";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** The API record of a stored row (`value` parsed). */
export function factRecord(row: Record<string, unknown>): ApplicantFactRecord {
  return decodeRow<ApplicantFactRecord>("applicant_facts", row);
}

/** Every fact of the user, ordered by key. */
export async function listFacts(
  db: JobsDb,
  scope: UserScope
): Promise<ApplicantFactRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT ${FACT_COLUMNS} FROM applicant_facts WHERE user_id = ? ORDER BY key`,
    scope.userId
  );
  return rows.map(factRecord);
}

/** The user's facts for `keys`, by key. */
export async function factsByKeys(
  db: JobsDb,
  scope: UserScope,
  keys: readonly string[]
): Promise<Map<string, ApplicantFactRecord>> {
  const out = new Map<string, ApplicantFactRecord>();
  for (const group of chunk([...new Set(keys)], IN_CHUNK)) {
    const marks = group.map(() => "?").join(", ");
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT ${FACT_COLUMNS} FROM applicant_facts WHERE user_id = ? AND key IN (${marks})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      const record = factRecord(row);
      out.set(record.key, record);
    }
  }
  return out;
}

export interface FactWrite {
  cvEntryId: string | null;
  cvId: string | null;
  source: FactSource;
  value: unknown;
}

/** INSERT of a new fact (revision 1) + its change. */
export function insertFactStatements(
  db: JobsDb,
  scope: UserScope,
  input: FactWrite & { id: string; key: string; now: number }
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO applicant_facts (id, user_id, key, value, source, cv_id, cv_entry_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      input.id,
      scope.userId,
      input.key,
      encodeJson(input.value),
      input.source,
      input.cvId,
      input.cvEntryId,
      input.now,
      input.now
    ),
    appendChange(db, scope, {
      entity: "fact",
      entityId: input.id,
      revision: 1,
      now: input.now,
    }),
  ];
}

/** Guarded UPDATE of a fact at `baseRevision` + its change (D-21). */
export function updateFactStatements(
  db: JobsDb,
  scope: UserScope,
  input: FactWrite & { baseRevision: number; id: string; now: number }
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "applicant_facts", input.id, input.baseRevision),
    stmt(
      db,
      "UPDATE applicant_facts SET value = ?, source = ?, cv_id = ?, cv_entry_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?",
      encodeJson(input.value),
      input.source,
      input.cvId,
      input.cvEntryId,
      input.now,
      input.id,
      scope.userId,
      input.baseRevision
    ),
    appendChange(db, scope, {
      entity: "fact",
      entityId: input.id,
      revision: input.baseRevision + 1,
      now: input.now,
    }),
  ];
}

/** Guarded DELETE of a fact + its `delete` tombstone (revision + 1). */
export function deleteFactStatements(
  db: JobsDb,
  scope: UserScope,
  input: { id: string; now: number; revision: number }
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "applicant_facts", input.id, input.revision),
    stmt(
      db,
      "DELETE FROM applicant_facts WHERE id = ? AND user_id = ? AND revision = ?",
      input.id,
      scope.userId,
      input.revision
    ),
    appendChange(db, scope, {
      entity: "fact",
      entityId: input.id,
      revision: input.revision + 1,
      op: "delete",
      now: input.now,
    }),
  ];
}

/**
 * Settings → fact mirror (03 §9: `prefs.timezone` mirrors
 * `user_settings.timezone`, `prefs.ai_scoring_sensitive` mirrors
 * `ai_scoring_sensitive`). Upserts the fact as `user_entered`; nothing is
 * written (and no change logged) when it already holds `value`.
 */
export function mirrorFactStatements(
  db: JobsDb,
  scope: UserScope,
  input: { id: string; key: string; now: number; value: unknown }
): D1PreparedStatement[] {
  const value = encodeJson(input.value);
  return [
    stmt(
      db,
      "INSERT INTO applicant_facts (id, user_id, key, value, source, cv_id, cv_entry_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 'user_entered', NULL, NULL, 1, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, source = 'user_entered', cv_id = NULL, cv_entry_id = NULL, revision = applicant_facts.revision + 1, updated_at = excluded.updated_at WHERE applicant_facts.value <> excluded.value OR applicant_facts.source <> 'user_entered'",
      input.id,
      scope.userId,
      input.key,
      value,
      input.now,
      input.now
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'fact', id, revision, 'upsert', ? FROM applicant_facts WHERE user_id = ? AND key = ? AND updated_at = ? AND value = ?",
      input.now,
      scope.userId,
      input.key,
      input.now,
      value
    ),
  ];
}

/** Runs one transactional profile batch (facts, answers, settings). */
export async function runProfileBatch(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  await runBatch(db, statements);
}
