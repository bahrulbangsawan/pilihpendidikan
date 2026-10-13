// `GET /api/v1/changes` (05 §11, 20 §4.1, §4.3).
//
//   1. head  = newest committed seq, floor = oldest retained seq;
//   2. a cursor below `floor - 1` (rows after it may have been trimmed by the
//      30-day retention) or beyond the head (a cursor this log never issued,
//      e.g. after a restore) → 410 cursor_expired: the client re-snapshots;
//   3. the user's rows in (cursor, head], at most `limit` (≤ 500), optionally
//      filtered by entity;
//   4. several changes of one entity collapse into its latest one, placed at
//      that change's seq; `data` is the entity's CURRENT record read with the
//      user's scope (11 §6.1 rule 6). A record that no longer exists — or is
//      no longer visible to the user — is reported as a `delete` tombstone;
//   5. `next_cursor` = the last seq read when more rows follow, else the head
//      (an idle client keeps advancing, so it does not expire while nothing
//      of its own changes). A page also stops early at ~4 MB of `data`.

import type { ChangesResponse } from "@pilihpendidikan/jobs-contracts/api";
import { CHANGES_LIMIT_DEFAULT } from "@pilihpendidikan/jobs-contracts/api";
import type { ChangeEntity } from "@pilihpendidikan/jobs-contracts/enums";
import { CHANGE_ENTITIES } from "@pilihpendidikan/jobs-contracts/enums";
import { apiError, invalidRequest } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import type { ChangeRow } from "../../repo/sync/changes";
import {
  changeLogFloor,
  changeLogHead,
  listChangeRows,
  loadEntityRecords,
} from "../../repo/sync/changes";

/** Approximate `data` bytes per page before it stops early. */
export const CHANGES_BYTE_BUDGET = 4 * 1024 * 1024;

const KNOWN_ENTITIES: ReadonlySet<string> = new Set(CHANGE_ENTITIES);

type Change = ChangesResponse["changes"][number];

/** Parses `entities=a,b`; unknown names → 400. Empty → null (all). */
export function parseEntityFilter(
  raw: string | undefined
): ChangeEntity[] | null {
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  const names = [
    ...new Set(
      raw
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    ),
  ];
  const unknown = names.filter((name) => !KNOWN_ENTITIES.has(name));
  if (unknown.length > 0) {
    throw invalidRequest(`Unknown entities: ${unknown.join(", ")}.`, [
      {
        code: "invalid_value",
        path: ["entities"],
        message: `expected any of ${CHANGE_ENTITIES.join(", ")}`,
      },
    ]);
  }
  return names as ChangeEntity[];
}

/** The latest row of each entity in a page, ordered by that row's seq. */
export function collapseChanges(rows: readonly ChangeRow[]): ChangeRow[] {
  const latest = new Map<string, ChangeRow>();
  for (const row of rows) {
    if (!KNOWN_ENTITIES.has(row.entity)) {
      continue;
    }
    const key = `${row.entity}\u0000${row.entity_id}`;
    const seen = latest.get(key);
    if (!seen || row.seq > seen.seq) {
      latest.set(key, row);
    }
  }
  return [...latest.values()].sort((a, b) => a.seq - b.seq);
}

async function recordsFor(
  identity: D1Database,
  db: JobsDb,
  scope: UserScope,
  rows: readonly ChangeRow[]
): Promise<Map<string, Map<string, Record<string, unknown>>>> {
  const idsByEntity = new Map<ChangeEntity, string[]>();
  for (const row of rows) {
    if (row.op === "delete") {
      continue;
    }
    const entity = row.entity as ChangeEntity;
    const ids = idsByEntity.get(entity) ?? [];
    ids.push(row.entity_id);
    idsByEntity.set(entity, ids);
  }
  const out = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [entity, ids] of idsByEntity) {
    out.set(entity, await loadEntityRecords(identity, db, scope, entity, ids));
  }
  return out;
}

function toChange(
  row: ChangeRow,
  data: Record<string, unknown> | undefined
): Change {
  const base = {
    seq: row.seq,
    entity: row.entity as ChangeEntity,
    entity_id: row.entity_id,
  };
  if (row.op === "delete" || data === undefined) {
    return { ...base, revision: row.revision, op: "delete" };
  }
  const stored =
    typeof data.revision === "number" ? data.revision : row.revision;
  return {
    ...base,
    revision: Math.max(row.revision, stored),
    op: "upsert",
    data: data as Change["data"],
  };
}

export interface ChangesQuery {
  cursor?: number;
  entities?: string;
  limit?: number;
}

/** One page of the user's change feed. */
export async function readChanges(
  identity: D1Database,
  db: JobsDb,
  scope: UserScope,
  query: ChangesQuery,
  options: { byteBudget?: number } = {}
): Promise<ChangesResponse> {
  const cursor = query.cursor ?? 0;
  const limit = Math.min(
    query.limit ?? CHANGES_LIMIT_DEFAULT,
    CHANGES_LIMIT_DEFAULT
  );
  const entities = parseEntityFilter(query.entities);
  const head = await changeLogHead(db);
  const floor = await changeLogFloor(db);
  if ((floor !== null && cursor < floor - 1) || cursor > head) {
    throw apiError(
      "cursor_expired",
      "This cursor is older than the retained change log. Take a new snapshot.",
      { details: { cursor, oldest_seq: floor, latest_seq: head } }
    );
  }
  const rows = await listChangeRows(db, scope, {
    after: cursor,
    upTo: head,
    limit: limit + 1,
    entities,
  });
  const page = rows.slice(0, limit);
  const moreRows = rows.length > limit;
  const collapsed = collapseChanges(page);
  const records = await recordsFor(identity, db, scope, collapsed);
  const budget = options.byteBudget ?? CHANGES_BYTE_BUDGET;
  const changes: Change[] = [];
  let bytes = 0;
  for (const row of collapsed) {
    const change = toChange(row, records.get(row.entity)?.get(row.entity_id));
    const size = change.data ? JSON.stringify(change.data).length : 0;
    if (changes.length > 0 && bytes + size > budget) {
      return {
        changes,
        next_cursor: changes.at(-1)?.seq ?? cursor,
        has_more: true,
      };
    }
    bytes += size;
    changes.push(change);
  }
  if (moreRows) {
    return {
      changes,
      next_cursor: page.at(-1)?.seq ?? cursor,
      has_more: true,
    };
  }
  return { changes, next_cursor: Math.max(head, cursor), has_more: false };
}
