// `job_postings` and `user_jobs` access for discovery (03 §4, 04 §2.1,
// 20 §6.2/§7). Shared public rows carry no `user_id`: their statements are
// keyed by fingerprint or posting id and marked `sql-allow: public-posting`;
// every read that RETURNS posting content joins through the caller's
// `user_jobs` (11 §6.1 rule 4) — except the batch planner's lookup by
// fingerprint, which reads only merge metadata and never returns it to the
// client unless the batch links the posting to the caller.

import type { JobPostingRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeRow, encodeJson, queryAll, queryFirst, stmt } from "../core/db";
import { chunk, IN_CHUNK, insertRows, marks } from "./sql";

/** Every `job_postings` column, in table order (04 §2.1). */
export const POSTING_COLUMNS = [
  "id",
  "fingerprint",
  "visibility",
  "owner_user_id",
  "source_kind",
  "source_org",
  "source_job_ref",
  "canonical_url",
  "apply_url",
  "apply_domain",
  "company_name",
  "company_domain",
  "title",
  "department",
  "locations",
  "workplace_type",
  "employment_type",
  "seniority",
  "salary",
  "description_text",
  "description_truncated",
  "requirements",
  "content_hash",
  "dedupe_group",
  "posted_at",
  "first_seen_at",
  "last_seen_at",
  "last_checked_at",
  "status",
  "closed_at",
  "missed_runs",
  "extraction",
  "application_support",
  "revision",
  "created_at",
  "updated_at",
] as const;
export type PostingColumn = (typeof POSTING_COLUMNS)[number];

/** Columns read for merging (everything but the 64 KB description). */
const MERGE_COLUMNS = POSTING_COLUMNS.filter(
  (column) => column !== "description_text"
);
const MERGE_SELECT = MERGE_COLUMNS.join(", ");

/**
 * A posting in its API representation (JSON parsed, flags boolean) without
 * `description_text`: what the batch planner merges against.
 */
export type StoredPosting = Omit<JobPostingRecord, "description_text">;

/** Column values of a posting row to write, API representation. */
export type PostingValues = Omit<JobPostingRecord, "id">;

function encodeColumn(column: PostingColumn, value: unknown): unknown {
  switch (column) {
    case "locations":
    case "requirements":
    case "extraction":
      return encodeJson(value);
    case "salary":
      return value === null || value === undefined ? null : encodeJson(value);
    case "description_truncated":
      return value ? 1 : 0;
    default:
      return value ?? null;
  }
}

/** The posting's merge view by fingerprint, keyed `${visibility}|${fp}`. */
export async function findPostingsByFingerprint(
  db: JobsDb,
  scope: UserScope,
  fingerprints: readonly string[]
): Promise<Map<string, StoredPosting>> {
  const found = new Map<string, StoredPosting>();
  const unique = [...new Set(fingerprints)];
  for (const group of chunk(unique, IN_CHUNK)) {
    const rows = await queryAll<Record<string, unknown>>(
      db,
      // sql-allow: public-posting — the planner resolves shared rows by
      // fingerprint; nothing read here is returned unless the batch links it
      `SELECT ${MERGE_SELECT} FROM job_postings WHERE visibility = 'public' AND fingerprint IN (${marks(group.length)})`,
      ...group
    );
    const own = await queryAll<Record<string, unknown>>(
      db,
      `SELECT ${MERGE_SELECT} FROM job_postings WHERE owner_user_id = ? AND visibility = 'private' AND fingerprint IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of [...rows, ...own]) {
      const posting = decodeRow<StoredPosting>("job_postings", row);
      found.set(`${posting.visibility}|${posting.fingerprint}`, posting);
    }
  }
  return found;
}

/**
 * Public postings by fingerprint, keyed `public|${fp}`: the merge view of
 * system ingestion (cloud discovery, 24 §6.5), which has no caller.
 */
export async function findPublicPostingsByFingerprint(
  db: JobsDb,
  fingerprints: readonly string[]
): Promise<Map<string, StoredPosting>> {
  const found = new Map<string, StoredPosting>();
  for (const group of chunk([...new Set(fingerprints)], IN_CHUNK)) {
    const rows = await queryAll<Record<string, unknown>>(
      db,
      // sql-allow: public-posting — system ingestion merges shared rows by
      // fingerprint; nothing read here reaches a client
      `SELECT ${MERGE_SELECT} FROM job_postings WHERE visibility = 'public' AND fingerprint IN (${marks(group.length)})`,
      ...group
    );
    for (const row of rows) {
      const posting = decodeRow<StoredPosting>("job_postings", row);
      found.set(`public|${posting.fingerprint}`, posting);
    }
  }
  return found;
}

export interface UserJobLink {
  id: string;
  inbox_state: string;
  posting_id: string;
  revision: number;
}

/** The caller's `user_jobs` links of `postingIds`, keyed by posting id. */
export async function findLinks(
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[]
): Promise<Map<string, UserJobLink>> {
  const links = new Map<string, UserJobLink>();
  for (const group of chunk([...new Set(postingIds)], IN_CHUNK)) {
    const rows = await queryAll<UserJobLink>(
      db,
      `SELECT id, posting_id, inbox_state, revision FROM user_jobs WHERE user_id = ? AND posting_id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      links.set(row.posting_id, row);
    }
  }
  return links;
}

/** INSERT of a new posting row (public rows are shared, D-05 / 03 §4.1). */
export function insertPostingStatement(
  db: JobsDb,
  id: string,
  values: PostingValues
): D1PreparedStatement {
  const row: Record<string, unknown> = { ...values, id };
  return stmt(
    db,
    // sql-allow: public-posting — a public posting has no owner; private rows
    // carry owner_user_id = the caller (validated by the planner)
    `INSERT INTO job_postings (${POSTING_COLUMNS.join(", ")}) VALUES (${marks(POSTING_COLUMNS.length)})`,
    ...POSTING_COLUMNS.map((column) => encodeColumn(column, row[column]))
  );
}

/** Changes the batch applies to an existing posting. */
export interface PostingUpdate {
  /** Content columns to overwrite (field-level merge already applied). */
  content: Partial<PostingValues> | null;
  /** New extraction JSON (alternates recorded), or null to keep it. */
  extraction: Record<string, unknown> | null;
  id: string;
  /** max(last_checked_at, …) when a status check reported. */
  lastCheckedAt: number | null;
  /** Bump revision + updated_at (content / status / provenance change). */
  revisionBump: boolean;
  /** max(last_seen_at, …) and missed_runs = 0 when sighted. */
  sightedAt: number | null;
  status: { closedAt: number | null; status: string } | null;
}

/** The UPDATE of an existing posting; null when there is nothing to write. */
export function updatePostingStatement(
  db: JobsDb,
  update: PostingUpdate,
  now: number
): D1PreparedStatement | null {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [column, value] of Object.entries(update.content ?? {})) {
    if (!(POSTING_COLUMNS as readonly string[]).includes(column)) {
      throw new Error(`not a posting column: ${column}`);
    }
    sets.push(`${column} = ?`);
    binds.push(encodeColumn(column as PostingColumn, value));
  }
  if (update.extraction) {
    sets.push("extraction = ?");
    binds.push(encodeJson(update.extraction));
  }
  if (update.status) {
    sets.push("status = ?", "closed_at = ?");
    binds.push(update.status.status, update.status.closedAt);
  }
  if (update.sightedAt !== null) {
    sets.push("last_seen_at = max(last_seen_at, ?)", "missed_runs = 0");
    binds.push(update.sightedAt);
  }
  if (update.lastCheckedAt !== null) {
    sets.push("last_checked_at = max(coalesce(last_checked_at, 0), ?)");
    binds.push(update.lastCheckedAt);
  }
  if (update.revisionBump) {
    sets.push("revision = revision + 1", "updated_at = ?");
    binds.push(now);
  }
  if (sets.length === 0) {
    return null;
  }
  return stmt(
    db,
    // sql-allow: public-posting — the planner only updates postings it
    // resolved for the caller (public by fingerprint or the caller's own)
    `UPDATE job_postings SET ${sets.join(", ")} WHERE id = ?`,
    ...binds,
    update.id
  );
}

/**
 * change_log rows (`posting`) for EVERY user linked to the given postings:
 * a shared posting's change reaches all their feeds (15 §12, 20 §4). Place
 * it after the posting UPDATEs and user_jobs INSERTs of the batch.
 */
export function postingFanoutStatements(
  db: JobsDb,
  postingIds: readonly string[],
  now: number
): D1PreparedStatement[] {
  return chunk([...new Set(postingIds)], IN_CHUNK).map((group) =>
    stmt(
      db,
      // sql-allow: public-posting — the change feed of a shared posting goes
      // to every user linked to it; rows carry only the posting id + revision
      `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT u.user_id, 'posting', p.id, p.revision, 'upsert', ? FROM user_jobs u JOIN job_postings p ON p.id = u.posting_id WHERE p.id IN (${marks(group.length)})`,
      now,
      ...group
    )
  );
}

/** Revision guard for a posting the batch changes (re-planned on failure). */
export function postingGuardSql(): string {
  // sql-allow: public-posting — guards the merge of a shared row
  return "SELECT 1 FROM job_postings WHERE id = ? AND revision = ? AND last_seen_at = ?";
}

export interface NewUserJob {
  firstRunId: string | null;
  id: string;
  inboxState: "new" | "seen" | "tracked" | "dismissed";
  origin: "discovered" | "manual";
  postingId: string;
  sourceId: string | null;
  userNotes: string;
}

/** Multi-row INSERTs of the caller's new `user_jobs` links. */
export function insertUserJobStatements(
  db: JobsDb,
  scope: UserScope,
  rows: readonly NewUserJob[],
  now: number
): D1PreparedStatement[] {
  return insertRows(
    db,
    {
      head: "INSERT INTO user_jobs (id, user_id, posting_id, origin, inbox_state, first_run_id, source_id, user_notes, created_at, updated_at)",
      rowSql: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    },
    rows.map((row) => [
      row.id,
      scope.userId,
      row.postingId,
      row.origin,
      row.inboxState,
      row.firstRunId,
      row.sourceId,
      row.userNotes,
      now,
      now,
    ])
  );
}

/** Multi-row INSERTs of `discovery_run_items` (first outcome per run wins). */
export function insertRunItemStatements(
  db: JobsDb,
  scope: UserScope,
  runId: string,
  rows: readonly { outcome: string; postingId: string }[]
): D1PreparedStatement[] {
  return insertRows(
    db,
    {
      head: "INSERT INTO discovery_run_items (run_id, posting_id, user_id, outcome)",
      rowSql: "(?, ?, ?, ?)",
      tail: "ON CONFLICT (run_id, posting_id) DO NOTHING",
    },
    rows.map((row) => [runId, row.postingId, scope.userId, row.outcome])
  );
}

/** The caller's posting (full record) through their user_jobs link. */
export async function getLinkedPosting(
  db: JobsDb,
  scope: UserScope,
  postingId: string
): Promise<JobPostingRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT p.* FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id WHERE u.user_id = ? AND p.id = ?",
    scope.userId,
    postingId
  );
  return row ? decodeRow<JobPostingRecord>("job_postings", row) : null;
}

/** Full posting records linked to the caller, keyed by id. */
export async function getLinkedPostings(
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[]
): Promise<Map<string, JobPostingRecord>> {
  const out = new Map<string, JobPostingRecord>();
  for (const group of chunk([...new Set(postingIds)], IN_CHUNK)) {
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT p.* FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id WHERE u.user_id = ? AND p.id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      const posting = decodeRow<JobPostingRecord>("job_postings", row);
      out.set(posting.id, posting);
    }
  }
  return out;
}

/** The caller's own source ids among `ids` (others are ignored). */
export async function ownedSourceIds(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[]
): Promise<Map<string, { adapter: string; config: Record<string, unknown> }>> {
  const out = new Map<
    string,
    { adapter: string; config: Record<string, unknown> }
  >();
  for (const group of chunk([...new Set(ids)], IN_CHUNK)) {
    const rows = await queryAll<{
      adapter: string;
      config: string;
      id: string;
    }>(
      db,
      `SELECT id, adapter, config FROM job_sources WHERE user_id = ? AND id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      const decoded = decodeRow<{
        adapter: string;
        config: Record<string, unknown>;
        id: string;
      }>("job_sources", row);
      out.set(row.id, { adapter: decoded.adapter, config: decoded.config });
    }
  }
  return out;
}

/**
 * One of the caller's own private postings (its user_job may be gone, e.g.
 * after retention), for re-linking a manual add.
 */
export async function getOwnedPrivatePosting(
  db: JobsDb,
  scope: UserScope,
  postingId: string
): Promise<JobPostingRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM job_postings WHERE id = ? AND owner_user_id = ? AND visibility = 'private'",
    postingId,
    scope.userId
  );
  return row ? decodeRow<JobPostingRecord>("job_postings", row) : null;
}
