// JOBS_DB access for the repository layer (04 §5, 11 §6.1). Only modules
// under src/jobs/repo/** import this file (the T11-JOBSDB test enforces it).
//
// The opaque `JobsDb` handle
// ---------------------------
// Routes, services, queue and cron code receive a `JobsDb` (`c.db`, `qc.db`,
// `cc.db`) and can only hand it to repo functions: the type has no `prepare`,
// so SQL cannot be written outside repo/**. Repo functions unwrap it here.
//
// Statements and batches
// ----------------------
//   stmt(db, sql, ...binds)           → D1PreparedStatement for a batch
//   queryFirst / queryAll / execute   → single statements
//   runBatch(db, statements)          → one transactional `batch()` (D1
//                                       batches are SQL transactions: all or
//                                       nothing, 03 §10)
//
// Guards (all-or-nothing writes)
// ------------------------------
// D1 has no interactive transactions, so a read-check-write could race. Put a
// guard first in the batch: when its condition is false at execution time it
// aborts the whole batch (nothing is written) and `runBatch` throws
// `GuardFailedError`. Typical use is the revision check of D-21:
//
//   await runBatch(db, [
//     guardRevision(db, scope, "applications", id, base),   // abort if stale
//     stmt(db, "UPDATE applications SET … revision = revision + 1 … WHERE id = ? AND user_id = ?", …),
//     appendChange(db, scope, { entity: "application", entityId: id, revision: base + 1, now }),
//   ]);
//
// The router maps an uncaught `GuardFailedError` to `409 revision_conflict`;
// services that can do better (re-read and answer with `details.current`)
// catch it themselves.
//
// JSON codecs
// -----------
// JSON columns are TEXT; booleans are 0/1 (04). `decodeRow(table, row)`
// returns the API representation of PLAN C2 (JSON parsed, flags as booleans)
// for every JOBS_DB table; `encodeJson` / `sqlBool` go the other way.

import type { Env } from "../../../env";

declare const JOBS_DB_BRAND: unique symbol;

/** Opaque handle to `env.JOBS_DB`; only repo functions can use it. */
export interface JobsDb {
  readonly [JOBS_DB_BRAND]: true;
}

/** Wraps the binding (the router, queue consumer and cron do this). */
export function jobsDb(env: Pick<Env, "JOBS_DB">): JobsDb {
  return env.JOBS_DB as unknown as JobsDb;
}

/** The underlying D1 binding. Repo-internal. */
export function d1(db: JobsDb): D1Database {
  return db as unknown as D1Database;
}

export type SqlValue = string | number | null;

function bindable(values: readonly unknown[]): SqlValue[] {
  return values.map((value) => {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    if (typeof value === "string" || typeof value === "number") {
      return value;
    }
    throw new TypeError(`cannot bind ${typeof value} to SQL`);
  });
}

/** A prepared statement with its parameters bound. */
export function stmt(
  db: JobsDb,
  sql: string,
  ...binds: readonly unknown[]
): D1PreparedStatement {
  return d1(db)
    .prepare(sql)
    .bind(...bindable(binds));
}

export async function queryFirst<T>(
  db: JobsDb,
  sql: string,
  ...binds: readonly unknown[]
): Promise<T | null> {
  return (await stmt(db, sql, ...binds).first<T>()) ?? null;
}

export async function queryAll<T>(
  db: JobsDb,
  sql: string,
  ...binds: readonly unknown[]
): Promise<T[]> {
  const result = await stmt(db, sql, ...binds).all<T>();
  return result.results ?? [];
}

/** Runs one write; returns the number of changed rows. */
export async function execute(
  db: JobsDb,
  sql: string,
  ...binds: readonly unknown[]
): Promise<number> {
  const result = await stmt(db, sql, ...binds).run();
  return result.meta?.changes ?? 0;
}

// ---------------------------------------------------------------------------
// Guards and errors
// ---------------------------------------------------------------------------

/** A guard of the batch was false; nothing in the batch was written. */
export class GuardFailedError extends Error {
  readonly label: string;
  constructor(label: string) {
    super(`guard failed: ${label}`);
    this.name = "GuardFailedError";
    this.label = label;
  }
}

/** A UNIQUE / PRIMARY KEY constraint aborted the batch. */
export class UniqueViolationError extends Error {
  /** e.g. "idempotency_keys.user_id, idempotency_keys.key". */
  readonly constraint: string;
  readonly table: string;
  constructor(constraint: string) {
    super(`unique constraint failed: ${constraint}`);
    this.name = "UniqueViolationError";
    this.constraint = constraint;
    this.table = constraint.split(".")[0]?.trim() ?? "";
  }
}

// A guard aborts its batch by evaluating json() on malformed input, which
// raises "malformed JSON" in SQLite and D1 alike; the subquery keeps the
// argument non-constant so it is only evaluated when the condition is false.
const GUARD_ABORT =
  "json('{\"kernel_guard\":' || (SELECT count(*) FROM sqlite_master WHERE 0))";
const guardLabels = new WeakMap<D1PreparedStatement, string>();
const MALFORMED_JSON_RE = /malformed JSON/i;
const UNIQUE_RE =
  /UNIQUE constraint failed: ([^:\n]+?)(?::|\s*$|\s*\(|,\s*SQLITE)/i;

/**
 * A batch statement that aborts the whole batch unless `EXISTS (conditionSql)`.
 * `conditionSql` is a full SELECT (put the `user_id = ?` predicate in it).
 */
export function guard(
  db: JobsDb,
  label: string,
  conditionSql: string,
  ...binds: readonly unknown[]
): D1PreparedStatement {
  const statement = stmt(
    db,
    `SELECT CASE WHEN EXISTS (${conditionSql}) THEN 1 ELSE ${GUARD_ABORT} END AS kernel_guard`,
    ...binds
  );
  guardLabels.set(statement, label);
  return statement;
}

/**
 * Tables with a `revision` column that guards and change_log helpers may name.
 * Values are trusted identifiers; never interpolate user input.
 */
export const REVISIONED_TABLES = [
  "job_postings",
  "user_jobs",
  "applications",
  "interviews",
  "offers",
  "applicant_facts",
  "screening_answers",
  "automation_rules",
  "job_sources",
  "discovery_runs",
  "cv_variants",
  "email_applications",
  "automation_tasks",
  "approvals",
  "user_settings",
] as const;
export type RevisionedTable = (typeof REVISIONED_TABLES)[number];

function assertRevisionedTable(
  table: string
): asserts table is RevisionedTable {
  if (!(REVISIONED_TABLES as readonly string[]).includes(table)) {
    throw new Error(`"${table}" is not a revisioned JOBS_DB table`);
  }
}

/** Guard: the user's row `id` of `table` is still at `revision` (D-21). */
export function guardRevision(
  db: JobsDb,
  scope: { readonly userId: string },
  table: RevisionedTable,
  id: string,
  revision: number
): D1PreparedStatement {
  assertRevisionedTable(table);
  const idColumn = table === "user_settings" ? "user_id" : "id";
  return guard(
    db,
    `revision:${table}:${id}`,
    `SELECT 1 FROM ${table} WHERE ${idColumn} = ? AND user_id = ? AND revision = ?`,
    id,
    scope.userId,
    revision
  );
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error
      ? `${err.message} ${cause.message}`
      : err.message;
  }
  return String(err);
}

/**
 * Runs one transactional batch. Translates a failed guard into
 * `GuardFailedError` and a UNIQUE violation into `UniqueViolationError`;
 * everything else propagates (the router answers 503).
 */
export async function runBatch(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<D1Result[]> {
  if (statements.length === 0) {
    return [];
  }
  try {
    return await d1(db).batch([...statements]);
  } catch (err) {
    const text = errorText(err);
    const guardLabel = statements
      .map((s) => guardLabels.get(s))
      .find((label) => label !== undefined);
    if (guardLabel !== undefined && MALFORMED_JSON_RE.test(text)) {
      throw new GuardFailedError(guardLabel);
    }
    const unique = UNIQUE_RE.exec(text);
    if (unique) {
      throw new UniqueViolationError(unique[1].trim());
    }
    throw err;
  }
}

/**
 * Re-runs `plan-and-commit` when a guard reports a concurrent change
 * (default 3 tries), then lets the last `GuardFailedError` through.
 */
export async function retryOnGuardFailure<T>(
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof GuardFailedError) || attempt >= attempts) {
        throw err;
      }
    }
  }
}

/** Rows a RETURNING statement of a batch produced. */
export function returnedRows<T>(result: D1Result | undefined): T[] {
  return (result?.results as T[] | undefined) ?? [];
}

// ---------------------------------------------------------------------------
// JSON and boolean codecs
// ---------------------------------------------------------------------------

/** JSON text for a JSON column (undefined → "null"). */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Parsed JSON column; `fallback` when null or unparseable. */
export function decodeJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function sqlBool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function fromSqlBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

interface ColumnCodec {
  /** 0/1 columns returned as booleans. */
  bool: readonly string[];
  /** TEXT JSON columns returned parsed: column → fallback when NULL/broken. */
  json: Readonly<Record<string, unknown>>;
}

/** JSON and boolean columns of every JOBS_DB table (04 §2). */
export const ROW_CODECS: Readonly<Record<string, ColumnCodec>> = {
  job_postings: {
    json: { locations: [], salary: null, requirements: [], extraction: {} },
    bool: ["description_truncated"],
  },
  user_jobs: { json: {}, bool: [] },
  applications: { json: { sections: [] }, bool: ["archived"] },
  application_events: { json: { payload: {} }, bool: ["applied_to_state"] },
  interviews: { json: { interviewers: [] }, bool: [] },
  offers: { json: { compensation: {} }, bool: [] },
  applicant_facts: { json: { value: null }, bool: [] },
  screening_answers: { json: { match_patterns: [] }, bool: [] },
  match_scores: { json: { components: {} }, bool: [] },
  automation_rules: {
    json: { criteria: {}, limits: {}, allowed_domains: [], cv_policy: {} },
    bool: ["enabled"],
  },
  job_sources: { json: { config: {}, cursor_state: {} }, bool: ["enabled"] },
  discovery_runs: { json: { sources: [], stats: {}, errors: [] }, bool: [] },
  discovery_run_items: { json: {}, bool: [] },
  files: { json: {}, bool: [] },
  cv_variants: { json: { diff: {} }, bool: [] },
  email_applications: { json: { attachment_file_ids: [] }, bool: [] },
  automation_tasks: {
    json: { payload: {}, required_capabilities: [], progress: {} },
    bool: ["resume_requested", "cancel_requested"],
  },
  automation_attempts: { json: {}, bool: [] },
  approvals: { json: { payload: {}, response: null }, bool: [] },
  submission_evidence: { json: { signals: {} }, bool: [] },
  change_log: { json: {}, bool: [] },
  idempotency_keys: { json: {}, bool: [] },
  user_settings: {
    json: {},
    bool: [
      "automation_paused",
      "generated_text_allowed",
      "allow_mcp_approvals",
      "ai_scoring_sensitive",
    ],
  },
  ai_usage: { json: {}, bool: [] },
  telemetry_daily: { json: { counters: {} }, bool: [] },
  analytics_daily: { json: { metrics: {} }, bool: [] },
};

/**
 * A stored row in its API representation (PLAN C2): JSON columns parsed,
 * 0/1 flags as booleans, everything else untouched.
 */
export function decodeRow<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>
): T {
  const codec = ROW_CODECS[table];
  if (!codec) {
    throw new Error(`no codec for table "${table}"`);
  }
  const out: Record<string, unknown> = { ...row };
  for (const [column, fallback] of Object.entries(codec.json)) {
    if (column in out) {
      out[column] = decodeJson(out[column] as string | null, fallback);
    }
  }
  for (const column of codec.bool) {
    if (column in out) {
      out[column] = fromSqlBool(out[column]);
    }
  }
  return out as T;
}
