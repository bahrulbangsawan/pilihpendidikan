// Shared SQL plumbing of the discovery repo (05 §4): D1 limits and the
// multi-row INSERT builder that keeps a 100-item postings batch inside them.
//
// D1 limits (14 §4, 04 header): ≤ 100 bound parameters per statement and
// ≤ 1,000 queries per invocation; a postings batch is budgeted at
// 100 × 4 + 3 = 403 statements in ONE `batch()`.

import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { runBatch, stmt } from "../core/db";

/** Bound parameters per D1 statement (D1 limit). */
export const MAX_PARAMS_PER_STATEMENT = 100;
/** Ids per `IN (…)` list, leaving room for the other binds of a statement. */
export const IN_CHUNK = 90;
/** Statement budget of one 100-item postings batch (14 §4). */
export const BATCH_STATEMENT_BUDGET = 403;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** `?, ?, ?` for an `IN (…)` list. */
export function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Multi-row `INSERT` statements for `rows`, each statement carrying at most
 * 100 bound parameters. `head` is the statement up to `VALUES` (it names the
 * columns, `user_id` included for user-scoped tables), `rowSql` one row's
 * `(…)` group and `tail` an optional `ON CONFLICT …` clause.
 */
export function insertRows(
  db: JobsDb,
  spec: { head: string; rowSql: string; tail?: string },
  rows: readonly (readonly unknown[])[]
): D1PreparedStatement[] {
  if (rows.length === 0) {
    return [];
  }
  const width = rows[0].length;
  const perStatement = Math.max(
    1,
    Math.floor(MAX_PARAMS_PER_STATEMENT / Math.max(1, width))
  );
  return chunk(rows, perStatement).map((group) =>
    stmt(
      db,
      `${spec.head} VALUES ${group.map(() => spec.rowSql).join(", ")}${
        spec.tail ? ` ${spec.tail}` : ""
      }`,
      ...group.flat()
    )
  );
}

/** change_log rows of the caller, as multi-row INSERTs. */
export function changeLogRows(
  db: JobsDb,
  scope: UserScope,
  rows: readonly {
    entity: string;
    entityId: string;
    op?: "upsert" | "delete";
    revision: number;
  }[],
  now: number
): D1PreparedStatement[] {
  return insertRows(
    db,
    {
      head: "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at)",
      rowSql: "(?, ?, ?, ?, ?, ?)",
    },
    rows.map((row) => [
      scope.userId,
      row.entity,
      row.entityId,
      row.revision,
      row.op ?? "upsert",
      now,
    ])
  );
}

/** Runs one transactional batch planned by a discovery service. */
export async function runDiscoveryBatch(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<D1Result[]> {
  return await runBatch(db, statements);
}

/** LIKE pattern for a free-text filter (`%`, `_` and `\` escaped). */
export function likePattern(text: string): string {
  return `%${text.replace(LIKE_SPECIAL_RE, "\\$&")}%`;
}
const LIKE_SPECIAL_RE = /[\\%_]/g;
