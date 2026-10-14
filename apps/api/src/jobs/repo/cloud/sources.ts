// `cloud_sources` access (24 §2.1). Catalog rows are system data with no
// `user_id` (D-39): the T11-SQL lint lists the table as a system table, so
// these statements need no user predicate. Every write fences on `revision`
// (operator edits) or on `lease_id` (the pipeline), never both.

import type { CloudSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { JobsDb } from "../core/db";
import {
  decodeRow,
  encodeJson,
  guard,
  queryAll,
  queryFirst,
  returnedRows,
  runBatch,
  stmt,
} from "../core/db";
import { marks } from "../discovery/sql";

/** Every `cloud_sources` column, in table order (24 §2.1). */
export const CLOUD_SOURCE_COLUMNS = [
  "id",
  "slug",
  "name",
  "homepage_url",
  "listing_url",
  "canonical_domain",
  "category",
  "origin",
  "directory_ref",
  "description",
  "strategy",
  "strategy_config",
  "health",
  "status_reason",
  "enabled",
  "priority",
  "interval_minutes",
  "rate_limit",
  "auth_required",
  "auth_note",
  "terms_url",
  "terms_note",
  "ai_enabled",
  "allow_browser",
  "next_run_at",
  "lease_id",
  "lease_expires_at",
  "last_run_id",
  "last_run_status",
  "last_run_at",
  "last_success_at",
  "last_error_class",
  "last_error_message",
  "consecutive_failures",
  "circuit_open_until",
  "cursor_state",
  "stats",
  "user_modified",
  "revision",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof CloudSourceRecord)[];
export type CloudSourceColumn = (typeof CLOUD_SOURCE_COLUMNS)[number];

const JSON_COLUMNS: ReadonlySet<string> = new Set([
  "strategy_config",
  "rate_limit",
  "cursor_state",
  "stats",
  "user_modified",
]);
const BOOL_COLUMNS: ReadonlySet<string> = new Set([
  "enabled",
  "auth_required",
  "ai_enabled",
  "allow_browser",
]);

function encode(column: string, value: unknown): unknown {
  if (JSON_COLUMNS.has(column)) {
    return encodeJson(value);
  }
  if (BOOL_COLUMNS.has(column)) {
    return value ? 1 : 0;
  }
  return value ?? null;
}

function assertColumn(column: string): asserts column is CloudSourceColumn {
  if (!(CLOUD_SOURCE_COLUMNS as readonly string[]).includes(column)) {
    throw new Error(`not a cloud_sources column: ${column}`);
  }
}

function decode(row: Record<string, unknown>): CloudSourceRecord {
  return decodeRow<CloudSourceRecord>("cloud_sources", row);
}

/** The whole catalog (≤ a few hundred rows), priority first. */
export async function listCloudSources(
  db: JobsDb
): Promise<CloudSourceRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM cloud_sources ORDER BY priority DESC, name"
  );
  return rows.map(decode);
}

export async function getCloudSource(
  db: JobsDb,
  id: string
): Promise<CloudSourceRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM cloud_sources WHERE id = ?",
    id
  );
  return row ? decode(row) : null;
}

export async function getCloudSourceBySlug(
  db: JobsDb,
  slug: string
): Promise<CloudSourceRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM cloud_sources WHERE slug = ?",
    slug
  );
  return row ? decode(row) : null;
}

/** Sources registered for a registrable domain (duplicate check). */
export async function findCloudSourcesByDomain(
  db: JobsDb,
  domain: string
): Promise<CloudSourceRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM cloud_sources WHERE canonical_domain = ?",
    domain
  );
  return rows.map(decode);
}

/** INSERT of a full catalog row. */
export function insertCloudSourceStatement(
  db: JobsDb,
  record: CloudSourceRecord
): D1PreparedStatement {
  const row = record as unknown as Record<string, unknown>;
  return stmt(
    db,
    `INSERT INTO cloud_sources (${CLOUD_SOURCE_COLUMNS.join(", ")}) VALUES (${marks(CLOUD_SOURCE_COLUMNS.length)})`,
    ...CLOUD_SOURCE_COLUMNS.map((column) => encode(column, row[column]))
  );
}

function setClause(patch: Partial<CloudSourceRecord>): {
  binds: unknown[];
  sets: string[];
} {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    assertColumn(column);
    if (column === "id" || column === "revision" || column === "created_at") {
      throw new Error(`${column} is not writable`);
    }
    sets.push(`${column} = ?`);
    binds.push(encode(column, value));
  }
  return { sets, binds };
}

/**
 * Operator edit fenced on `revision` (D-21): a guard first, then the UPDATE
 * that bumps the revision. A stale revision aborts with GuardFailedError.
 */
export function revisionedUpdateStatements(
  db: JobsDb,
  id: string,
  baseRevision: number,
  patch: Partial<CloudSourceRecord>,
  now: number
): D1PreparedStatement[] {
  const { sets, binds } = setClause(patch);
  return [
    guard(
      db,
      `revision:cloud_sources:${id}`,
      "SELECT 1 FROM cloud_sources WHERE id = ? AND revision = ?",
      id,
      baseRevision
    ),
    stmt(
      db,
      `UPDATE cloud_sources SET ${[...sets, "revision = revision + 1", "updated_at = ?"].join(", ")} WHERE id = ? AND revision = ?`,
      ...binds,
      now,
      id,
      baseRevision
    ),
  ];
}

/**
 * Pipeline write that does not change what an operator edits (health,
 * schedule, stats, cursor): no revision bump, so it never conflicts with an
 * operator's form. `leaseId` fences writes of a run that lost its lease.
 */
export function systemUpdateStatement(
  db: JobsDb,
  id: string,
  patch: Partial<CloudSourceRecord>,
  now: number,
  options: { leaseId?: string } = {}
): D1PreparedStatement {
  const { sets, binds } = setClause(patch);
  const fence = options.leaseId ? " AND lease_id = ?" : "";
  return stmt(
    db,
    `UPDATE cloud_sources SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?${fence}`,
    ...binds,
    now,
    id,
    ...(options.leaseId ? [options.leaseId] : [])
  );
}

/** Applies a system update now; returns whether a row matched. */
export async function applySystemUpdate(
  db: JobsDb,
  id: string,
  patch: Partial<CloudSourceRecord>,
  now: number,
  options: { leaseId?: string } = {}
): Promise<boolean> {
  const [result] = await runBatch(db, [
    systemUpdateStatement(db, id, patch, now, options),
  ]);
  return (result?.meta?.changes ?? 0) > 0;
}

/**
 * Sources due for a scrape (24 §6.1): enabled, schedulable health, a real
 * strategy, `next_run_at` reached, breaker closed, no live lease.
 */
export async function listDueSources(
  db: JobsDb,
  now: number,
  limit: number
): Promise<CloudSourceRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM cloud_sources
     WHERE enabled = 1
       AND health IN ('ACTIVE', 'FAILED', 'RATE_LIMITED')
       AND strategy <> 'none'
       AND (next_run_at IS NULL OR next_run_at <= ?)
       AND (circuit_open_until IS NULL OR circuit_open_until <= ?)
       AND (lease_expires_at IS NULL OR lease_expires_at < ?)
     ORDER BY priority DESC, coalesce(next_run_at, 0), id
     LIMIT ?`,
    now,
    now,
    now,
    limit
  );
  return rows.map(decode);
}

/**
 * Takes the source's lease (24 §6.2) when no live lease exists, or renews it
 * when `leaseId` already holds it (a redelivery of the same run); returns the
 * row as stored after the update, or null when another run holds it.
 */
export async function acquireLease(
  db: JobsDb,
  id: string,
  leaseId: string,
  now: number,
  ttlMs: number
): Promise<CloudSourceRecord | null> {
  const [result] = await runBatch(db, [
    stmt(
      db,
      `UPDATE cloud_sources SET lease_id = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND (lease_expires_at IS NULL OR lease_expires_at < ? OR lease_id = ?)
       RETURNING *`,
      leaseId,
      now + ttlMs,
      now,
      id,
      now,
      leaseId
    ),
  ]);
  const [row] = returnedRows<Record<string, unknown>>(result);
  return row ? decode(row) : null;
}

/** Expired leases (the reaper clears them and fails their runs). */
export async function reapExpiredLeases(
  db: JobsDb,
  now: number,
  limit: number
): Promise<{ id: string; last_run_id: string | null }[]> {
  const [result] = await runBatch(db, [
    stmt(
      db,
      `UPDATE cloud_sources SET lease_id = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id IN (SELECT id FROM cloud_sources WHERE lease_expires_at IS NOT NULL AND lease_expires_at < ? LIMIT ?)
       RETURNING id, last_run_id`,
      now,
      now,
      limit
    ),
  ]);
  return returnedRows<{ id: string; last_run_id: string | null }>(result);
}

/** Postings each source delivered (total and open), keyed by source id. */
export async function postingCountsBySource(
  db: JobsDb
): Promise<Map<string, { open: number; total: number }>> {
  const rows = await queryAll<{ id: string; open: number; total: number }>(
    db,
    // sql-allow: public-posting — counts of shared public rows per catalog
    // source; no posting content is read
    "SELECT cloud_source_id AS id, count(*) AS total, sum(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open FROM job_postings WHERE cloud_source_id IS NOT NULL AND visibility = 'public' GROUP BY cloud_source_id"
  );
  return new Map(
    rows.map((row) => [row.id, { total: row.total, open: row.open ?? 0 }])
  );
}

/** Postings of one source (total and open). */
export async function postingCountsOf(
  db: JobsDb,
  sourceId: string
): Promise<{ open: number; total: number }> {
  const row = await queryFirst<{ open: number | null; total: number }>(
    db,
    // sql-allow: public-posting — counts of shared public rows of one source
    "SELECT count(*) AS total, sum(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open FROM job_postings WHERE cloud_source_id = ? AND visibility = 'public'",
    sourceId
  );
  return { total: row?.total ?? 0, open: row?.open ?? 0 };
}
