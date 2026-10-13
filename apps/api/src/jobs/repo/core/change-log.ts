// The per-user change feed (03 §10, 20 §4): every insert/update/delete of a
// user-scoped row appends `{entity, entity_id, revision, op}` to `change_log`
// in the SAME `batch()` as the mutation. Clients read it with
// `GET /api/v1/changes?cursor=<seq>` (leaf-2.8).
//
// `entity` names come from the contracts (`CHANGE_ENTITIES`: "application",
// "user_job", "posting", "event", "task", "attempt", "approval", "score", …).

import type {
  ChangeEntity,
  ChangeOp,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { UserScope } from "../../core/scope";
import type { JobsDb, RevisionedTable } from "./db";
import { queryFirst, REVISIONED_TABLES, stmt } from "./db";

export interface ChangeInput {
  entity: ChangeEntity;
  entityId: string;
  now: number;
  /** Defaults to "upsert". */
  op?: ChangeOp;
  /** The row's revision after the change (append-only records use 1). */
  revision: number;
}

/** INSERT of one change_log row. */
export function appendChange(
  db: JobsDb,
  scope: UserScope,
  change: ChangeInput
): D1PreparedStatement {
  return stmt(
    db,
    "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
    scope.userId,
    change.entity,
    change.entityId,
    change.revision,
    change.op ?? "upsert",
    change.now
  );
}

/**
 * change_log row whose revision is read from the row itself, for statements
 * placed AFTER an `UPDATE … SET revision = revision + 1` in the same batch.
 * Writes nothing when the row does not exist (or is not the user's).
 */
export function appendChangeFromRow(
  db: JobsDb,
  scope: UserScope,
  change: {
    entity: ChangeEntity;
    now: number;
    table: RevisionedTable;
    id: string;
  }
): D1PreparedStatement {
  if (!(REVISIONED_TABLES as readonly string[]).includes(change.table)) {
    throw new Error(`"${change.table}" is not a revisioned JOBS_DB table`);
  }
  const idColumn = change.table === "user_settings" ? "user_id" : "id";
  return stmt(
    db,
    `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, ?, ?, revision, 'upsert', ? FROM ${change.table} WHERE ${idColumn} = ? AND user_id = ?`,
    change.entity,
    change.id,
    change.now,
    change.id,
    scope.userId
  );
}

/** The user's latest change_log seq (0 when empty): the board/snapshot cursor. */
export async function latestChangeSeq(
  db: JobsDb,
  scope: UserScope
): Promise<number> {
  const row = await queryFirst<{ seq: number | null }>(
    db,
    "SELECT MAX(seq) AS seq FROM change_log WHERE user_id = ?",
    scope.userId
  );
  return row?.seq ?? 0;
}
