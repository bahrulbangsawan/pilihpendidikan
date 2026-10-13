// Account export reads (11 §10, 14 §6 `export_user`): every JOBS_DB row of
// the user, page by page (keyset on rowid), in its API representation
// (JSON columns parsed, flags as booleans). Postings are the ones the user
// can see — their private postings and the public postings they link
// through their own `user_jobs` — so the export explains every tracked job.

import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeRow, queryAll } from "../core/db";
import { PURGE_TABLES } from "./purge";

/** Tables exported row by row (every user-scoped table but postings). */
export const EXPORT_TABLES = PURGE_TABLES.filter(
  (table): table is Exclude<(typeof PURGE_TABLES)[number], "job_postings"> =>
    table !== "job_postings"
);
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Rows per export page. */
export const EXPORT_PAGE = 1000;

export interface ExportPage {
  /** The rowid to continue after (null when this was the last page). */
  next: number | null;
  rows: Record<string, unknown>[];
}

function pageOfRows(
  table: string,
  rows: Record<string, unknown>[],
  limit: number
): ExportPage {
  const records = rows.map((row) => {
    const { __rowid: _rowid, ...rest } = row;
    return decodeRow(table, rest);
  });
  return {
    rows: records,
    next: rows.length < limit ? null : Number(rows.at(-1)?.__rowid ?? 0),
  };
}

/** One page of the user's rows of `table` after `afterRowid`. */
export async function exportTablePage(
  db: JobsDb,
  scope: UserScope,
  table: ExportTable,
  afterRowid: number,
  limit: number = EXPORT_PAGE
): Promise<ExportPage> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT rowid AS __rowid, * FROM ${table} WHERE user_id = ? AND rowid > ? ORDER BY rowid LIMIT ?`,
    scope.userId,
    afterRowid,
    limit
  );
  return pageOfRows(table, rows, limit);
}

/** One page of the postings the user can see, after `afterRowid`. */
export async function exportPostingsPage(
  db: JobsDb,
  scope: UserScope,
  afterRowid: number,
  limit: number = EXPORT_PAGE
): Promise<ExportPage> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT p.rowid AS __rowid, p.* FROM job_postings p WHERE p.rowid > ? AND (p.owner_user_id = ? OR p.id IN (SELECT u.posting_id FROM user_jobs u WHERE u.user_id = ?)) ORDER BY p.rowid LIMIT ?",
    afterRowid,
    scope.userId,
    scope.userId,
    limit
  );
  return pageOfRows("job_postings", rows, limit);
}

export interface ExportFileRow {
  id: string;
  kind: string;
  original_name: string | null;
  r2_key: string;
  sha256: string;
  size_bytes: number;
}

/** The user's stored files (status `ready`), oldest first. */
export async function exportFiles(
  db: JobsDb,
  scope: UserScope
): Promise<ExportFileRow[]> {
  return await queryAll<ExportFileRow>(
    db,
    "SELECT id, kind, r2_key, sha256, size_bytes, original_name FROM files WHERE user_id = ? AND status = 'ready' ORDER BY created_at, id",
    scope.userId
  );
}
