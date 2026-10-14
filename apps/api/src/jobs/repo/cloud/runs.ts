// `cloud_runs` access (24 §2.2): the execution history of scrapes, probes
// and directory refreshes. System data (no `user_id`); `requested_by` only
// records which operator started a manual run.

import type { CloudRunRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { JobsDb } from "../core/db";
import {
  decodeRow,
  encodeJson,
  queryAll,
  queryFirst,
  runBatch,
  stmt,
} from "../core/db";
import { marks } from "../discovery/sql";

export const CLOUD_RUN_COLUMNS = [
  "id",
  "source_id",
  "kind",
  "trigger",
  "status",
  "attempt",
  "requested_by",
  "queued_at",
  "started_at",
  "finished_at",
  "duration_ms",
  "strategy",
  "stats",
  "error_class",
  "error_message",
  "http_status",
  "warnings",
  "log",
  "engine_version",
  "updated_at",
] as const satisfies readonly (keyof CloudRunRecord)[];
type CloudRunColumn = (typeof CLOUD_RUN_COLUMNS)[number];

const JSON_COLUMNS: ReadonlySet<string> = new Set(["stats", "warnings", "log"]);

function encode(column: string, value: unknown): unknown {
  return JSON_COLUMNS.has(column) ? encodeJson(value) : (value ?? null);
}

function decode(row: Record<string, unknown>): CloudRunRecord {
  return decodeRow<CloudRunRecord>("cloud_runs", row);
}

export function insertCloudRunStatement(
  db: JobsDb,
  run: CloudRunRecord
): D1PreparedStatement {
  const row = run as unknown as Record<string, unknown>;
  return stmt(
    db,
    `INSERT INTO cloud_runs (${CLOUD_RUN_COLUMNS.join(", ")}) VALUES (${marks(CLOUD_RUN_COLUMNS.length)})`,
    ...CLOUD_RUN_COLUMNS.map((column) => encode(column, row[column]))
  );
}

/** UPDATE of a run; `onlyIf` fences on the current status (e.g. not final). */
export function updateCloudRunStatement(
  db: JobsDb,
  id: string,
  patch: Partial<CloudRunRecord>,
  now: number,
  onlyIf?: readonly CloudRunRecord["status"][]
): D1PreparedStatement {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    if (
      !(CLOUD_RUN_COLUMNS as readonly string[]).includes(column) ||
      column === "id"
    ) {
      throw new Error(`not a writable cloud_runs column: ${column}`);
    }
    sets.push(`${column as CloudRunColumn} = ?`);
    binds.push(encode(column, value));
  }
  sets.push("updated_at = ?");
  binds.push(now);
  const fence = onlyIf?.length
    ? ` AND status IN (${onlyIf.map(() => "?").join(", ")})`
    : "";
  return stmt(
    db,
    `UPDATE cloud_runs SET ${sets.join(", ")} WHERE id = ?${fence}`,
    ...binds,
    id,
    ...(onlyIf ?? [])
  );
}

/** Applies a run update now; returns whether a row matched. */
export async function applyCloudRunUpdate(
  db: JobsDb,
  id: string,
  patch: Partial<CloudRunRecord>,
  now: number,
  onlyIf?: readonly CloudRunRecord["status"][]
): Promise<boolean> {
  const [result] = await runBatch(db, [
    updateCloudRunStatement(db, id, patch, now, onlyIf),
  ]);
  return (result?.meta?.changes ?? 0) > 0;
}

export async function getCloudRun(
  db: JobsDb,
  id: string
): Promise<CloudRunRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM cloud_runs WHERE id = ?",
    id
  );
  return row ? decode(row) : null;
}

/** The newest runs of a source (detail view). */
export async function latestRunsOf(
  db: JobsDb,
  sourceId: string,
  limit: number
): Promise<CloudRunRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM cloud_runs WHERE source_id = ? ORDER BY queued_at DESC, id DESC LIMIT ?",
    sourceId,
    limit
  );
  return rows.map(decode);
}

/** A keyset page of runs, newest first (`after` = the last row's key). */
export async function pageRuns(
  db: JobsDb,
  filter: { kinds?: readonly string[]; sourceId?: string },
  page: { after: [number, string] | null; limit: number }
): Promise<CloudRunRecord[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.sourceId) {
    where.push("source_id = ?");
    binds.push(filter.sourceId);
  }
  if (filter.kinds?.length) {
    where.push(`kind IN (${marks(filter.kinds.length)})`);
    binds.push(...filter.kinds);
  }
  if (page.after) {
    where.push("(queued_at < ? OR (queued_at = ? AND id < ?))");
    binds.push(page.after[0], page.after[0], page.after[1]);
  }
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM cloud_runs${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY queued_at DESC, id DESC LIMIT ?`,
    ...binds,
    page.limit
  );
  return rows.map(decode);
}

/** A live (queued / running) run of a source, if any. */
export async function liveRunOf(
  db: JobsDb,
  sourceId: string,
  kind: CloudRunRecord["kind"]
): Promise<CloudRunRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM cloud_runs WHERE source_id = ? AND kind = ? AND status IN ('queued', 'running') ORDER BY queued_at DESC LIMIT 1",
    sourceId,
    kind
  );
  return row ? decode(row) : null;
}

/** The live directory refresh, if any. */
export async function liveDirectoryRun(
  db: JobsDb
): Promise<CloudRunRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM cloud_runs WHERE kind = 'directory' AND status IN ('queued', 'running') ORDER BY queued_at DESC LIMIT 1"
  );
  return row ? decode(row) : null;
}

/**
 * Runs stuck in `queued` / `running` since before `before` (a lost message
 * or a dead invocation): the reaper fails them.
 */
export async function failStaleRuns(
  db: JobsDb,
  before: number,
  now: number,
  limit: number
): Promise<string[]> {
  const [result] = await runBatch(db, [
    stmt(
      db,
      `UPDATE cloud_runs SET status = 'failed', error_class = 'timeout',
         error_message = 'The run did not finish in time; the next run resumes from the last checkpoint.',
         finished_at = ?, updated_at = ?
       WHERE id IN (SELECT id FROM cloud_runs WHERE status IN ('queued', 'running') AND updated_at < ? LIMIT ?)
       RETURNING id`,
      now,
      now,
      before,
      limit
    ),
  ]);
  return ((result?.results ?? []) as { id: string }[]).map((r) => r.id);
}

/** Retention (90 d, 24 §2.2). Returns the number of deleted runs. */
export async function deleteRunsBefore(
  db: JobsDb,
  before: number,
  limit: number
): Promise<number> {
  const [result] = await runBatch(db, [
    stmt(
      db,
      "DELETE FROM cloud_runs WHERE id IN (SELECT id FROM cloud_runs WHERE queued_at < ? AND status NOT IN ('queued', 'running') LIMIT ?)",
      before,
      limit
    ),
  ]);
  return result?.meta?.changes ?? 0;
}
