// Change feed reads (05 §11, 20 §4, 11 §6.1 rule 6).
//
// `change_log.seq` is one global AUTOINCREMENT sequence; every user reads
// only their rows (`user_id = ?`, index `ix_change_user_seq`). The two
// system reads below return bare sequence numbers (no user data):
//
//   changeLogFloor   MIN(seq): rows below it were trimmed by the daily
//                    retention (which deletes a contiguous prefix, see
//                    repo/sync/retention.ts) → a cursor below `floor - 1`
//                    may have missed changes → 410 cursor_expired (20 §4.3)
//   changeLogHead    MAX(seq): the snapshot cursor and the cursor of an
//                    exhausted feed. D1 serializes writes, so every row at
//                    or below the head is committed when it is read.
//
// `data` of a change is the CURRENT row, read with the same user predicate
// (`loadEntityRecords`); postings are visible through the user's own
// `user_jobs` link or private ownership, devices live in `DB`.

import type { ChangeEntity } from "@pilihpendidikan/jobs-contracts/enums";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeRow, queryAll, queryFirst } from "../core/db";

/** D1 binds at most 100 parameters per statement. */
const IN_CHUNK = 90;

export interface ChangeRow {
  changed_at: number;
  entity: string;
  entity_id: string;
  op: "upsert" | "delete";
  revision: number;
  seq: number;
}

/** The oldest retained seq (null when the log is empty). */
export async function changeLogFloor(db: JobsDb): Promise<number | null> {
  const row = await queryFirst<{ v: number | null }>(
    db,
    // sql-allow: system — a bare sequence number (the 410 floor, 20 §4.3); no user data
    "SELECT MIN(seq) AS v FROM change_log"
  );
  return row?.v ?? null;
}

/** The newest committed seq (0 when the log is empty). */
export async function changeLogHead(db: JobsDb): Promise<number> {
  const row = await queryFirst<{ v: number | null }>(
    db,
    // sql-allow: system — a bare sequence number (snapshot / feed cursor); no user data
    "SELECT MAX(seq) AS v FROM change_log"
  );
  return row?.v ?? 0;
}

/** The user's changes in `(after, upTo]`, oldest first, at most `limit`. */
export async function listChangeRows(
  db: JobsDb,
  scope: UserScope,
  input: {
    after: number;
    entities: readonly string[] | null;
    limit: number;
    upTo: number;
  }
): Promise<ChangeRow[]> {
  const filter =
    input.entities && input.entities.length > 0
      ? `AND entity IN (${input.entities.map(() => "?").join(", ")})`
      : "";
  return await queryAll<ChangeRow>(
    db,
    `SELECT seq, entity, entity_id, revision, op, changed_at FROM change_log WHERE user_id = ? AND seq > ? AND seq <= ? ${filter} ORDER BY seq LIMIT ?`,
    scope.userId,
    input.after,
    input.upTo,
    ...(input.entities ?? []),
    input.limit
  );
}

/** JOBS_DB table of each entity read by id (`posting`, `settings` and `device` are special). */
export const ENTITY_TABLES = {
  application: "applications",
  user_job: "user_jobs",
  event: "application_events",
  interview: "interviews",
  offer: "offers",
  task: "automation_tasks",
  attempt: "automation_attempts",
  approval: "approvals",
  evidence: "submission_evidence",
  rule: "automation_rules",
  source: "job_sources",
  run: "discovery_runs",
  fact: "applicant_facts",
  answer: "screening_answers",
  score: "match_scores",
  cv_variant: "cv_variants",
  file: "files",
  email: "email_applications",
} as const satisfies Partial<Record<ChangeEntity, string>>;
type TableEntity = keyof typeof ENTITY_TABLES;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function withoutRowid(row: Record<string, unknown>): Record<string, unknown> {
  const { __rowid: _drop, ...rest } = row;
  return rest;
}

async function loadTableRecords(
  db: JobsDb,
  scope: UserScope,
  entity: TableEntity,
  ids: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  const table = ENTITY_TABLES[entity];
  const out = new Map<string, Record<string, unknown>>();
  for (const group of chunk(ids, IN_CHUNK)) {
    const marks = group.map(() => "?").join(", ");
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT * FROM ${table} WHERE user_id = ? AND id IN (${marks})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      out.set(String(row.id), decodeRow(table, row));
    }
  }
  return out;
}

/** Postings the user can see (own private, or public via own user_jobs). */
export async function loadVisiblePostings(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const group of chunk(ids, IN_CHUNK)) {
    const marks = group.map(() => "?").join(", ");
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT p.* FROM job_postings p WHERE p.id IN (${marks}) AND ((p.visibility = 'private' AND p.owner_user_id = ?) OR (p.visibility = 'public' AND EXISTS (SELECT 1 FROM user_jobs u WHERE u.posting_id = p.id AND u.user_id = ?)))`,
      ...group,
      scope.userId,
      scope.userId
    );
    for (const row of rows) {
      out.set(String(row.id), decodeRow("job_postings", row));
    }
  }
  return out;
}

async function loadSettings(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!ids.includes(scope.userId)) {
    return out;
  }
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM user_settings WHERE user_id = ?",
    scope.userId
  );
  if (row) {
    out.set(scope.userId, decodeRow("user_settings", row));
  }
  return out;
}

const DEVICE_COLUMNS =
  "id, user_id, grant_id, name, platform, arch, cli_version, public_key, capabilities, accepts_tasks, created_at, last_seen_at, last_ip_hash, revoked_at, revision";

function deviceRecord(row: Record<string, unknown>): Record<string, unknown> {
  let capabilities: unknown = [];
  try {
    capabilities = JSON.parse(String(row.capabilities ?? "[]"));
  } catch {
    capabilities = [];
  }
  return {
    ...row,
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    accepts_tasks: row.accepts_tasks === 1 || row.accepts_tasks === true,
  };
}

/** The user's devices by id, from the identity database (04 §1). */
export async function loadDevices(
  identity: D1Database,
  scope: UserScope,
  ids: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const group of chunk(ids, IN_CHUNK)) {
    const marks = group.map(() => "?").join(", ");
    const result = await identity
      .prepare(
        `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = ? AND id IN (${marks})`
      )
      .bind(scope.userId, ...group)
      .all<Record<string, unknown>>();
    for (const row of result.results ?? []) {
      out.set(String(row.id), deviceRecord(row));
    }
  }
  return out;
}

/**
 * The current API records of `ids` of one entity, by id. A missing id means
 * the row is gone (or is not the user's): the feed reports a tombstone.
 */
export async function loadEntityRecords(
  identity: D1Database,
  db: JobsDb,
  scope: UserScope,
  entity: ChangeEntity,
  ids: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  switch (entity) {
    case "posting":
      return await loadVisiblePostings(db, scope, unique);
    case "settings":
      return await loadSettings(db, scope, unique);
    case "device":
      return await loadDevices(identity, scope, unique);
    default:
      return await loadTableRecords(db, scope, entity, unique);
  }
}

// ---------------------------------------------------------------------------
// Snapshot reads (20 §4.2)
// ---------------------------------------------------------------------------

/** Snapshot collections backed by one user-scoped table. */
export const SNAPSHOT_TABLES = {
  applications: "applications",
  user_jobs: "user_jobs",
  interviews: "interviews",
  offers: "offers",
  tasks: "automation_tasks",
  approvals: "approvals",
  rules: "automation_rules",
  sources: "job_sources",
  facts: "applicant_facts",
  answers: "screening_answers",
  cv_variants: "cv_variants",
} as const;
export type SnapshotTableEntity = keyof typeof SNAPSHOT_TABLES;

/** Rows per snapshot page (keyset on rowid). */
const SNAPSHOT_PAGE = 1000;

/** Every row of a snapshot collection, in insertion order. */
export async function snapshotRows(
  db: JobsDb,
  scope: UserScope,
  entity: SnapshotTableEntity
): Promise<Record<string, unknown>[]> {
  const table = SNAPSHOT_TABLES[entity];
  const out: Record<string, unknown>[] = [];
  let after = 0;
  for (;;) {
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT rowid AS __rowid, * FROM ${table} WHERE user_id = ? AND rowid > ? ORDER BY rowid LIMIT ?`,
      scope.userId,
      after,
      SNAPSHOT_PAGE
    );
    for (const row of rows) {
      out.push(decodeRow(table, withoutRowid(row)));
    }
    if (rows.length < SNAPSHOT_PAGE) {
      return out;
    }
    after = Number(rows.at(-1)?.__rowid ?? after);
  }
}

/** Every posting the user can see (snapshot `postings`). */
export async function snapshotPostings(
  db: JobsDb,
  scope: UserScope
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let after = 0;
  for (;;) {
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT p.rowid AS __rowid, p.* FROM job_postings p WHERE p.rowid > ? AND ((p.visibility = 'private' AND p.owner_user_id = ?) OR (p.visibility = 'public' AND EXISTS (SELECT 1 FROM user_jobs u WHERE u.posting_id = p.id AND u.user_id = ?))) ORDER BY p.rowid LIMIT ?`,
      after,
      scope.userId,
      scope.userId,
      SNAPSHOT_PAGE
    );
    for (const row of rows) {
      out.push(decodeRow("job_postings", withoutRowid(row)));
    }
    if (rows.length < SNAPSHOT_PAGE) {
      return out;
    }
    after = Number(rows.at(-1)?.__rowid ?? after);
  }
}
