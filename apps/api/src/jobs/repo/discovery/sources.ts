// `job_sources` (04 §2.4, 05 §4): the caller's configured discovery sources.

import type { JobSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { CursorKey } from "../../core/pagination";
import { keysetAfter } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import { appendChange } from "../core/change-log";
import type { JobsDb } from "../core/db";
import {
  decodeRow,
  encodeJson,
  guardRevision,
  queryAll,
  queryFirst,
  stmt,
} from "../core/db";
import { chunk, IN_CHUNK, marks } from "./sql";

export async function getSource(
  db: JobsDb,
  scope: UserScope,
  id: string
): Promise<JobSourceRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM job_sources WHERE id = ? AND user_id = ?",
    id,
    scope.userId
  );
  return row ? decodeRow<JobSourceRecord>("job_sources", row) : null;
}

/** The caller's sources, oldest first (keyset on created_at, id). */
export async function listSources(
  db: JobsDb,
  scope: UserScope,
  options: {
    cursor: CursorKey | null;
    enabled: boolean | null;
    limit: number;
  }
): Promise<JobSourceRecord[]> {
  const after = keysetAfter(["created_at", "id"], options.cursor, "asc");
  const filters: string[] = [];
  const binds: unknown[] = [];
  if (options.enabled !== null) {
    filters.push("enabled = ?");
    binds.push(options.enabled ? 1 : 0);
  }
  if (after.sql) {
    filters.push(after.sql);
    binds.push(...after.binds);
  }
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM job_sources WHERE user_id = ?${filters.map((f) => ` AND ${f}`).join("")} ORDER BY created_at ASC, id ASC LIMIT ?`,
    scope.userId,
    ...binds,
    options.limit + 1
  );
  return rows.map((row) => decodeRow<JobSourceRecord>("job_sources", row));
}

export function insertSourceStatements(
  db: JobsDb,
  scope: UserScope,
  source: JobSourceRecord,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO job_sources (id, user_id, adapter, label, config, enabled, schedule, last_run_id, last_success_at, cursor_state, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?)",
      source.id,
      scope.userId,
      source.adapter,
      source.label,
      encodeJson(source.config),
      source.enabled ? 1 : 0,
      source.schedule,
      encodeJson(source.cursor_state),
      now,
      now
    ),
    appendChange(db, scope, {
      entity: "source",
      entityId: source.id,
      revision: 1,
      now,
    }),
  ];
}

/** Guarded UPDATE of a source to `next` (revision base + 1). */
export function updateSourceStatements(
  db: JobsDb,
  scope: UserScope,
  next: JobSourceRecord,
  base: number,
  now: number
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "job_sources", next.id, base),
    stmt(
      db,
      "UPDATE job_sources SET label = ?, config = ?, enabled = ?, schedule = ?, cursor_state = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?",
      next.label,
      encodeJson(next.config),
      next.enabled ? 1 : 0,
      next.schedule,
      encodeJson(next.cursor_state),
      now,
      next.id,
      scope.userId,
      base
    ),
    appendChange(db, scope, {
      entity: "source",
      entityId: next.id,
      revision: base + 1,
      now,
    }),
  ];
}

/** Guarded DELETE of a source (+ a `delete` change). */
export function deleteSourceStatements(
  db: JobsDb,
  scope: UserScope,
  id: string,
  revision: number,
  now: number
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "job_sources", id, revision),
    stmt(
      db,
      "DELETE FROM job_sources WHERE id = ? AND user_id = ? AND revision = ?",
      id,
      scope.userId,
      revision
    ),
    appendChange(db, scope, {
      entity: "source",
      entityId: id,
      revision: revision + 1,
      op: "delete",
      now,
    }),
  ];
}

/** Labels of the caller's sources, keyed by id. */
export async function sourceLabels(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const group of chunk([...new Set(ids)], IN_CHUNK)) {
    const rows = await queryAll<{ id: string; label: string }>(
      db,
      `SELECT id, label FROM job_sources WHERE user_id = ? AND id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      out.set(row.id, row.label);
    }
    // Followed cloud sources (24 §5.3): catalog rows are system data, their
    // names are public.
    const cloudIds = group.filter((id) => id.startsWith("csr_"));
    if (cloudIds.length > 0) {
      const cloud = await queryAll<{ id: string; name: string }>(
        db,
        `SELECT id, name FROM cloud_sources WHERE id IN (${marks(cloudIds.length)})`,
        ...cloudIds
      );
      for (const row of cloud) {
        out.set(row.id, row.name);
      }
    }
  }
  return out;
}
