// Migrates the legacy jobs tracker from JOBS_KV to JOBS_DB (06 §12.4, D-04).
//
//   job:{id}        the legacy `JobData` blob
//   owner:job:{id}  the owner stamp (email) — the only authoritative owner
//
// Steps (06 §12.4):
//   1. Inventory  every `job:` and `owner:job:` key (cursor followed to the
//                 end, no 1,000 cap) and their values.
//   2. Classify   ok | orphan (no stamp) | invalid (unparseable JSON, not an
//                 object, unknown status) | already_migrated (the owner has an
//                 application with that `legacy_job_id`); already-migrated
//                 jobs whose KV copy is newer and whose D1 copy is untouched
//                 are flagged `stale` (re-imported only with `--refresh`).
//   3. Plan       the 06 §12.2 rows of every ok job (deterministic ids; board
//                 rank by updatedAt desc within a stage). Prints counts per
//                 class and status and the first 20 planned rows (titles
//                 kept, emails hashed), and writes `migration-plan.jsonl`.
//   4. Execute    only with `--execute`: the users are upserted in DB, then
//                 ONE JOBS_DB batch per job, led by a guard and made of
//                 `INSERT … ON CONFLICT DO NOTHING` (re-runs are no-ops).
//                 Resumable from the checkpoint file.
//   5. Verify     after execute (or alone with `--verify`): per user the KV
//                 job count equals the D1 legacy applications, per-status
//                 counts match, and a 2 % random sample is compared field by
//                 field through the facade mapping (`toJobData`). Exit 1 on
//                 any mismatch.
//   6. Record     the D1 Time Travel bookmark taken BEFORE execute, for
//                 `wrangler d1 time-travel restore pilihpendidikan-jobs
//                 --bookmark=<it>`. KV is never written or deleted.
//
// Usage (dry run unless --execute; `--execute` against production needs the
// owner's go-ahead, root CLAUDE.md § Deploy):
//
//   bun scripts/migrate-jobs-kv-to-d1.ts                       # dry run
//   bun scripts/migrate-jobs-kv-to-d1.ts --execute             # write + verify
//   bun scripts/migrate-jobs-kv-to-d1.ts --verify              # verify only
//   bun scripts/migrate-jobs-kv-to-d1.ts --execute --refresh   # + re-import stale
//   bun scripts/migrate-jobs-kv-to-d1.ts --fixture scripts/fixtures/jobs-kv-export.json [--execute]
//
// Options: --kv <JOBS_KV namespace id>, --db-id <DB id>, --jobs-db-id
// <JOBS_DB id> (defaults: wrangler.jsonc), --out <dir> (default
// tmp/jobs-kv-to-d1: migration-plan.jsonl + checkpoint.json), --checkpoint
// <file>, --sample <rate> (default 0.02). `--fixture <file>` reads a KV
// export (`[{key, value, metadata?}]`, the `wrangler kv bulk` shape) and runs
// against fresh in-memory SQLite copies of both databases: fully local.
// Remote mode needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.

import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JobStatus } from "../src/types";
import { JOB_STATUSES, normalizeJobData } from "../src/types";
import type { JobData } from "../src/types";
import { rebalanceRanks } from "../src/jobs/core/rank";
import type {
  LegacyInterviewView,
  LegacyRows,
} from "../src/jobs/legacy/mapping";
import {
  expectedFacadeView,
  isJobStatus,
  legacyTimes,
  planLegacyRows,
  STAGE_FOR_STATUS,
  STATUS_FOR_STAGE,
  toJobData,
} from "../src/jobs/legacy/mapping";
import type { SqlStatement } from "../src/jobs/repo/legacy/import";
import {
  IMPORT_GUARD_ABORT_RE,
  legacyImportGuardStatement,
  legacyImportSql,
} from "../src/jobs/repo/legacy/import";
import type { LegacyViewRow } from "../src/jobs/repo/legacy/read";
import {
  LEGACY_VIEW_BY_ID_SQL,
  legacyViewOf,
  PENDING_INTERVIEWS_SQL,
} from "../src/jobs/repo/legacy/read";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import { sha256Hex } from "@pilihpendidikan/jobs-contracts/fingerprint";
import type { CloudflareCredentials, KvKey } from "./cloudflare";
import { cloudflareKv, credentialsFromEnv, readArgs } from "./cloudflare";

// ---------------------------------------------------------------------------
// Storage interfaces (REST in production, in-memory in tests and --fixture)
// ---------------------------------------------------------------------------

/** The read side of a KV namespace (scripts/cloudflare.ts `KvStore` fits). */
export interface KvSource {
  get(key: string): Promise<string | null>;
  listKeys(prefix: string): Promise<KvKey[]>;
}

/** A D1 database: reads and one atomic batch (all statements or none). */
export interface SqlTarget {
  batch(statements: SqlStatement[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Which legacy ids were executed already (resume after an interruption). */
export interface CheckpointStore {
  load(): Promise<Set<string>>;
  save(done: ReadonlySet<string>): Promise<void>;
}

export type JobClass = "ok" | "orphan" | "invalid" | "already_migrated";

export interface ClassifiedJob {
  appId: string | null;
  class: JobClass;
  id: string;
  job: JobData | null;
  ownerEmail: string | null;
  reason?: string;
  /** Already migrated, untouched in D1, and older than the KV copy. */
  stale?: boolean;
  userId: string | null;
}

export interface VerifyReport {
  countMismatches: Array<{
    d1: number;
    kv: number;
    missing: string[];
    user: string;
  }>;
  extra: Array<{ ids: string[]; user: string }>;
  ok: boolean;
  sampleMismatches: Array<{ fields: string[]; id: string }>;
  sampled: number;
  statusMismatches: Array<{
    d1: number;
    kv: number;
    status: string;
    user: string;
  }>;
  users: number;
}

export interface MigrationReport {
  bookmark: string | null;
  classes: Record<JobClass, number>;
  executed: number;
  failed: Array<{ error: string; id: string }>;
  inventory: { jobKeys: number; ownerStamps: number; stampsWithoutJob: number };
  invalid: Array<{ id: string; reason: string }>;
  mode: "dry run" | "execute" | "verify";
  ok: boolean;
  orphans: string[];
  planFile: string | null;
  raced: number;
  refreshed: number;
  skippedByCheckpoint: number;
  stale: number;
  statuses: Record<JobStatus, number>;
  users: { existing: number; toCreate: number };
  verify: VerifyReport | null;
}

export interface MigrationOptions {
  /** The Time Travel bookmark of JOBS_DB, read right before execute. */
  bookmark?: () => Promise<string | null>;
  checkpoint?: CheckpointStore | null;
  /** Parallel KV reads (default 8). */
  concurrency?: number;
  execute: boolean;
  identity: SqlTarget;
  jobs: SqlTarget;
  kv: KvSource;
  log?: (line: string) => void;
  now?: () => number;
  /** Path of migration-plan.jsonl (null: not written). */
  planFile?: string | null;
  random?: () => number;
  /** With execute: re-import stale already-migrated jobs. */
  refresh?: boolean;
  /** Sample rate of the field-by-field verify (default 0.02). */
  sampleRate?: number;
  /** Verify only (no plan output, no writes). */
  verifyOnly?: boolean;
}

const DEFAULT_SAMPLE_RATE = 0.02;
const CHECKPOINT_EVERY = 25;
const PREVIEW_ROWS = 20;
const USER_CHUNK = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Short stable hash of an email (redacted output, 11 §8). */
async function emailHash(email: string): Promise<string> {
  return `sha256:${(await sha256Hex(normalizeEmail(email))).slice(0, 12)}`;
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );
  return out;
}

function emptyStatuses(): Record<JobStatus, number> {
  return Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<
    JobStatus,
    number
  >;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// 1. Inventory and 2. classification
// ---------------------------------------------------------------------------

function parseBlob(
  raw: string,
  id: string
): { job: JobData } | { reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reason: "unparseable_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { reason: "not_an_object" };
  }
  const job = normalizeJobData(parsed as Partial<JobData>);
  if (!isJobStatus(job.status)) {
    return { reason: "unknown_status" };
  }
  if (!Array.isArray(job.sections)) {
    return { reason: "invalid_sections" };
  }
  return { job: { ...job, id } };
}

async function lookupUsers(
  identity: SqlTarget,
  emails: readonly string[]
): Promise<Map<string, string>> {
  const users = new Map<string, string>();
  for (let i = 0; i < emails.length; i += USER_CHUNK) {
    const chunk = emails.slice(i, i + USER_CHUNK);
    const rows = await identity.query<{ email: string; id: string }>(
      `SELECT id, email FROM users WHERE email IN (${chunk.map(() => "?").join(", ")})`,
      chunk
    );
    for (const row of rows) {
      users.set(row.email, row.id);
    }
  }
  return users;
}

interface MigratedRow {
  app_id: string;
  last_change_source: string;
  legacy_job_id: string;
  revision: number;
  stage: keyof typeof STATUS_FOR_STAGE;
  touched: number;
  updated_at: number;
}

async function migratedRows(
  jobs: SqlTarget,
  userId: string
): Promise<Map<string, MigratedRow>> {
  const rows = await jobs.query<MigratedRow>(
    "SELECT a.id AS app_id, a.legacy_job_id, a.stage, a.revision, a.last_change_source, a.updated_at, (SELECT COUNT(*) FROM application_events e WHERE e.user_id = a.user_id AND e.application_id = a.id AND e.idempotency_key NOT LIKE 'legacy:%') AS touched FROM applications a WHERE a.user_id = ? AND a.legacy_job_id IS NOT NULL",
    [userId]
  );
  return new Map(rows.map((row) => [row.legacy_job_id, row]));
}

function isUntouchedImport(row: MigratedRow): boolean {
  return (
    row.revision === 1 &&
    row.last_change_source === "legacy_migration" &&
    Number(row.touched) === 0
  );
}

// ---------------------------------------------------------------------------
// 3. Plan
// ---------------------------------------------------------------------------

/** Board ranks of a user's jobs: by updatedAt desc within each stage. */
function planRanks(
  jobs: readonly ClassifiedJob[],
  now: number
): Map<string, string> {
  const byColumn = new Map<string, ClassifiedJob[]>();
  for (const item of jobs) {
    if (!(item.job && item.ownerEmail)) {
      continue;
    }
    const key = `${item.ownerEmail}|${STAGE_FOR_STATUS[item.job.status]}`;
    const column = byColumn.get(key) ?? [];
    column.push(item);
    byColumn.set(key, column);
  }
  const ranks = new Map<string, string>();
  for (const column of byColumn.values()) {
    column.sort((a, b) => {
      const ta = legacyTimes(a.job as JobData, now).updatedAt;
      const tb = legacyTimes(b.job as JobData, now).updatedAt;
      return tb - ta || (a.id < b.id ? -1 : Number(a.id > b.id));
    });
    const spaced = rebalanceRanks(column.length);
    column.forEach((item, i) => {
      ranks.set(`${item.ownerEmail}|${item.id}`, spaced[i]);
    });
  }
  return ranks;
}

async function rowsOf(
  item: ClassifiedJob,
  userId: string,
  rank: string,
  now: number
): Promise<LegacyRows> {
  return await planLegacyRows({
    job: item.job as JobData,
    legacyId: item.id,
    userId,
    now,
    rank,
    mode: "import",
    actorKind: "legacy_migration",
    source: "legacy_migration",
    userJobOrigin: "legacy",
  });
}

async function planLine(
  item: ClassifiedJob,
  rows: LegacyRows | null
): Promise<Record<string, unknown>> {
  const line: Record<string, unknown> = {
    legacy_id: item.id,
    class: item.class,
    owner: item.ownerEmail ? await emailHash(item.ownerEmail) : null,
  };
  if (item.reason) {
    line.reason = item.reason;
  }
  if (item.stale) {
    line.stale = true;
  }
  if (item.job) {
    line.title = item.job.title;
    line.status = item.job.status;
  }
  if (rows) {
    line.user_id = item.userId ?? "(created on execute)";
    line.stage = rows.application.stage;
    line.submission_status = rows.application.submission_status;
    line.app_id = rows.application.id;
    line.posting_id = rows.posting.id;
    line.board_rank = rows.application.board_rank;
    line.sections = item.job?.sections.length ?? 0;
    line.interview_at = rows.interview
      ? new Date(rows.interview.scheduled_at).toISOString()
      : null;
    line.events = rows.events.map((event) => event.type);
    line.evidence = rows.evidence !== null;
  }
  return line;
}

// ---------------------------------------------------------------------------
// 4. Execute
// ---------------------------------------------------------------------------

async function upsertUsers(
  identity: SqlTarget,
  emails: readonly string[],
  now: number
): Promise<Map<string, string>> {
  for (let i = 0; i < emails.length; i += USER_CHUNK) {
    const chunk = emails.slice(i, i + USER_CHUNK);
    await identity.batch(
      chunk.map((email) => ({
        sql: "INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING",
        params: [newId("usr", now), email, now, now],
      }))
    );
  }
  return await lookupUsers(identity, emails);
}

/**
 * Statements removing an untouched import (revision 1, written by the
 * migration, no event but its own) so the same deterministic rows can be
 * re-inserted from the newer KV copy (`--refresh`). The guard aborts the
 * batch when the application was touched in the meantime.
 */
function refreshStatements(rows: LegacyRows): SqlStatement[] {
  const { userId } = rows;
  const appId = rows.application.id;
  return [
    {
      sql: `SELECT CASE WHEN EXISTS (SELECT 1 FROM applications a WHERE a.user_id = ? AND a.id = ? AND a.legacy_job_id = ? AND a.revision = 1 AND a.last_change_source = 'legacy_migration' AND NOT EXISTS (SELECT 1 FROM application_events e WHERE e.user_id = a.user_id AND e.application_id = a.id AND e.idempotency_key NOT LIKE 'legacy:%')) THEN 1 ELSE json('{"legacy_refresh_guard":' || (SELECT count(*) FROM sqlite_master WHERE 0)) END AS legacy_guard`,
      params: [userId, appId, rows.legacyId],
    },
    {
      sql: "DELETE FROM interviews WHERE user_id = ? AND application_id = ?",
      params: [userId, appId],
    },
    {
      sql: "DELETE FROM submission_evidence WHERE user_id = ? AND application_id = ?",
      params: [userId, appId],
    },
    {
      sql: "DELETE FROM application_events WHERE user_id = ? AND application_id = ?",
      params: [userId, appId],
    },
    {
      sql: "DELETE FROM match_scores WHERE user_id = ? AND posting_id = ?",
      params: [userId, rows.posting.id],
    },
    {
      sql: "DELETE FROM applications WHERE user_id = ? AND id = ?",
      params: [userId, appId],
    },
    {
      sql: "DELETE FROM user_jobs WHERE user_id = ? AND id = ?",
      params: [userId, rows.userJob.id],
    },
    {
      sql: "DELETE FROM job_postings WHERE owner_user_id = ? AND id = ? AND visibility = 'private'",
      params: [userId, rows.posting.id],
    },
  ];
}

// ---------------------------------------------------------------------------
// 5. Verify
// ---------------------------------------------------------------------------

const COMPARED_FIELDS = [
  "id",
  "title",
  "status",
  "company",
  "companyUrl",
  "salaryRange",
  "jobDescription",
  "requirements",
  "interviewDate",
  "sections",
] as const;

/** Fields where the facade view of D1 differs from the KV job. */
export function compareJobViews(expected: JobData, actual: JobData): string[] {
  const fields: string[] = COMPARED_FIELDS.filter(
    (field) => JSON.stringify(expected[field]) !== JSON.stringify(actual[field])
  );
  // Timestamps: equal instants, any formatting (06 §12.4 step 5).
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (Date.parse(expected[field]) !== Date.parse(actual[field])) {
      fields.push(field);
    }
  }
  return fields;
}

async function facadeViewOf(
  jobs: SqlTarget,
  userId: string,
  legacyId: string
): Promise<JobData | null> {
  const [row] = await jobs.query<LegacyViewRow>(LEGACY_VIEW_BY_ID_SQL, [
    userId,
    legacyId,
  ]);
  if (!row) {
    return null;
  }
  const interviews = await jobs.query<LegacyInterviewView>(
    PENDING_INTERVIEWS_SQL,
    [userId, row.a_id]
  );
  return toJobData(legacyViewOf(row, interviews));
}

function pickSample<T>(
  items: readonly T[],
  rate: number,
  random: () => number
): T[] {
  if (items.length === 0 || rate <= 0) {
    return [];
  }
  const size = Math.min(
    items.length,
    Math.max(1, Math.ceil(items.length * rate))
  );
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size);
}

/** Count and per-status checks of one owner's KV jobs against D1. */
async function verifyUser(
  options: MigrationOptions,
  report: VerifyReport,
  items: readonly ClassifiedJob[],
  who: { user: string; userId: string | undefined }
): Promise<void> {
  const { user, userId } = who;
  const d1: Map<string, MigratedRow> = userId
    ? await migratedRows(options.jobs, userId)
    : new Map();
  const missing = items.filter((item) => !d1.has(item.id)).map((i) => i.id);
  const kvIds = new Set(items.map((item) => item.id));
  const extra = [...d1.keys()].filter((id) => !kvIds.has(id));
  if (missing.length > 0) {
    report.countMismatches.push({
      user,
      kv: items.length,
      d1: items.length - missing.length,
      missing,
    });
  }
  if (extra.length > 0) {
    report.extra.push({ user, ids: extra });
  }
  const kvStatus = emptyStatuses();
  const d1Status = emptyStatuses();
  for (const item of items) {
    kvStatus[(item.job as JobData).status] += 1;
    const row = d1.get(item.id);
    if (row) {
      d1Status[STATUS_FOR_STAGE[row.stage]] += 1;
    }
  }
  for (const status of JOB_STATUSES) {
    if (kvStatus[status] !== d1Status[status]) {
      report.statusMismatches.push({
        user,
        status,
        kv: kvStatus[status],
        d1: d1Status[status],
      });
    }
  }
}

async function verifyMigration(
  options: MigrationOptions,
  owned: readonly ClassifiedJob[],
  userIds: ReadonlyMap<string, string>,
  now: number
): Promise<VerifyReport> {
  const report: VerifyReport = {
    users: 0,
    countMismatches: [],
    statusMismatches: [],
    extra: [],
    sampled: 0,
    sampleMismatches: [],
    ok: true,
  };
  const byOwner = new Map<string, ClassifiedJob[]>();
  for (const item of owned) {
    const list = byOwner.get(item.ownerEmail as string) ?? [];
    list.push(item);
    byOwner.set(item.ownerEmail as string, list);
  }
  for (const [email, items] of byOwner) {
    report.users += 1;
    await verifyUser(options, report, items, {
      user: await emailHash(email),
      userId: userIds.get(email),
    });
  }
  const sample = pickSample(
    owned,
    options.sampleRate ?? DEFAULT_SAMPLE_RATE,
    options.random ?? Math.random
  );
  for (const item of sample) {
    report.sampled += 1;
    const userId = userIds.get(item.ownerEmail as string);
    const actual = userId
      ? await facadeViewOf(options.jobs, userId, item.id)
      : null;
    const expected = expectedFacadeView(item.job as JobData, now);
    const fields = actual ? compareJobViews(expected, actual) : ["missing"];
    if (fields.length > 0) {
      report.sampleMismatches.push({ id: item.id, fields });
    }
  }
  report.ok =
    report.countMismatches.length === 0 &&
    report.statusMismatches.length === 0 &&
    report.sampleMismatches.length === 0;
  return report;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function inventory(options: MigrationOptions): Promise<{
  items: Array<{ id: string; owner: string | null; raw: string | null }>;
  ownerStamps: number;
  stampsWithoutJob: number;
}> {
  const jobKeys = await options.kv.listKeys("job:");
  const stampKeys = await options.kv.listKeys("owner:job:");
  const ids = jobKeys.map((key) => key.name.slice("job:".length));
  const idSet = new Set(ids);
  const concurrency = options.concurrency ?? 8;
  const items = await mapPool(ids, concurrency, async (id) => ({
    id,
    raw: await options.kv.get(`job:${id}`),
    owner: await options.kv.get(`owner:job:${id}`),
  }));
  const stampsWithoutJob = stampKeys.filter(
    (key) => !idSet.has(key.name.slice("owner:job:".length))
  ).length;
  return { items, ownerStamps: stampKeys.length, stampsWithoutJob };
}

async function classify(
  options: MigrationOptions,
  items: Array<{ id: string; owner: string | null; raw: string | null }>
): Promise<{ classified: ClassifiedJob[]; userIds: Map<string, string> }> {
  const classified: ClassifiedJob[] = [];
  for (const item of items) {
    if (item.raw === null) {
      continue; // deleted between list and read
    }
    const parsed = parseBlob(item.raw, item.id);
    const owner = item.owner?.trim() ? normalizeEmail(item.owner) : null;
    const base = { id: item.id, ownerEmail: owner, userId: null, appId: null };
    if ("reason" in parsed) {
      classified.push({
        ...base,
        class: "invalid",
        reason: parsed.reason,
        job: null,
      });
    } else if (owner === null) {
      classified.push({ ...base, class: "orphan", job: parsed.job });
    } else {
      classified.push({ ...base, class: "ok", job: parsed.job });
    }
  }
  const emails = [
    ...new Set(
      classified
        .filter((c) => c.class === "ok")
        .map((c) => c.ownerEmail as string)
    ),
  ].sort();
  const userIds = await lookupUsers(options.identity, emails);
  const migrated = new Map<string, Map<string, MigratedRow>>();
  for (const [email, userId] of userIds) {
    migrated.set(email, await migratedRows(options.jobs, userId));
  }
  const now = options.now?.() ?? Date.now();
  for (const item of classified) {
    if (item.class !== "ok") {
      continue;
    }
    item.userId = userIds.get(item.ownerEmail as string) ?? null;
    const row = migrated.get(item.ownerEmail as string)?.get(item.id);
    if (row) {
      item.class = "already_migrated";
      item.appId = row.app_id;
      const kvUpdated = legacyTimes(item.job as JobData, now).updatedAt;
      item.stale = isUntouchedImport(row) && kvUpdated > row.updated_at;
    }
  }
  return { classified, userIds };
}

function countClasses(classified: readonly ClassifiedJob[]) {
  const classes: Record<JobClass, number> = {
    ok: 0,
    orphan: 0,
    invalid: 0,
    already_migrated: 0,
  };
  const statuses = emptyStatuses();
  for (const item of classified) {
    classes[item.class] += 1;
    if (item.class === "ok" && item.job) {
      statuses[item.job.status] += 1;
    }
  }
  return { classes, statuses };
}

function writePlan(path: string, lines: Record<string, unknown>[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    lines.map((line) => JSON.stringify(line)).join("\n") +
      (lines.length > 0 ? "\n" : "")
  );
}

function logClassification(
  log: (line: string) => void,
  report: MigrationReport
): void {
  const { inventory: inv, classes, statuses } = report;
  log(
    `Inventory: ${inv.jobKeys} job keys, ${inv.ownerStamps} owner stamps (${inv.stampsWithoutJob} without a job).`
  );
  log(
    `Classes: ok ${classes.ok}, orphan ${classes.orphan}, invalid ${classes.invalid}, already_migrated ${classes.already_migrated} (stale ${report.stale}).`
  );
  log(
    `Statuses (ok): ${JOB_STATUSES.map((s) => `${s} ${statuses[s]}`).join(", ")}.`
  );
  if (report.orphans.length > 0) {
    log(`Orphans (no owner stamp, skipped): ${report.orphans.join(", ")}`);
  }
  for (const bad of report.invalid) {
    log(`Invalid (skipped): ${bad.id} — ${bad.reason}`);
  }
}

/** Step 3: plan lines (all jobs), the redacted preview and the jsonl file. */
async function writePlanPhase(
  options: MigrationOptions,
  classified: readonly ClassifiedJob[],
  userIds: ReadonlyMap<string, string>,
  rankOf: (item: ClassifiedJob) => string,
  report: MigrationReport
): Promise<void> {
  const log = options.log ?? (() => undefined);
  const now = options.now?.() ?? Date.now();
  // A user created only on execute gets a stand-in id in the plan.
  const provisional = async (email: string) =>
    userIds.get(email) ??
    `usr_${(await sha256Hex(email)).slice(0, 26).toUpperCase()}`;
  const lines: Record<string, unknown>[] = [];
  const preview: string[] = [];
  for (const item of classified) {
    const writes = item.class === "ok" || (item.stale && options.refresh);
    const planned = writes
      ? await rowsOf(
          item,
          await provisional(item.ownerEmail as string),
          rankOf(item),
          now
        )
      : null;
    const line = await planLine(item, planned);
    lines.push(line);
    if (planned && preview.length < PREVIEW_ROWS) {
      preview.push(JSON.stringify(line));
    }
  }
  if (options.planFile) {
    writePlan(options.planFile, lines);
    report.planFile = options.planFile;
    log(`Plan: ${lines.length} lines written to ${options.planFile}`);
  }
  if (preview.length > 0) {
    log(`First ${preview.length} planned rows (titles kept, emails hashed):`);
    for (const row of preview) {
      log(`  ${row}`);
    }
  }
}

/**
 * Step 4 for one job: its guarded batch (a refresh first removes the
 * untouched import). True when the job is done (written or already there).
 */
async function writeOne(
  options: MigrationOptions,
  item: ClassifiedJob,
  userIds: ReadonlyMap<string, string>,
  rank: string,
  report: MigrationReport
): Promise<boolean> {
  const userId = userIds.get(item.ownerEmail as string);
  if (!userId) {
    report.failed.push({ id: item.id, error: "owner user missing" });
    return false;
  }
  const rows = await rowsOf(item, userId, rank, options.now?.() ?? Date.now());
  const refresh = item.class === "already_migrated";
  if (refresh && item.appId !== rows.application.id) {
    // Not this script's import (e.g. created through the facade).
    return false;
  }
  const statements: SqlStatement[] = refresh ? refreshStatements(rows) : [];
  statements.push(legacyImportGuardStatement(rows), ...legacyImportSql(rows));
  try {
    await options.jobs.batch(statements);
  } catch (err) {
    const message = errorText(err);
    if (!IMPORT_GUARD_ABORT_RE.test(message)) {
      report.failed.push({ id: item.id, error: message });
      return false;
    }
    // Migrated concurrently (P3 fallback) or touched since: skip.
    report.raced += 1;
    return true;
  }
  if (refresh) {
    report.refreshed += 1;
  } else {
    report.executed += 1;
  }
  return true;
}

function modeOf(options: MigrationOptions): MigrationReport["mode"] {
  if (options.verifyOnly) {
    return "verify";
  }
  return options.execute ? "execute" : "dry run";
}

function newReport(
  mode: MigrationReport["mode"],
  inv: { items: unknown[]; ownerStamps: number; stampsWithoutJob: number },
  classified: readonly ClassifiedJob[],
  userIds: ReadonlyMap<string, string>
): MigrationReport {
  const { classes, statuses } = countClasses(classified);
  return {
    mode,
    inventory: {
      jobKeys: inv.items.length,
      ownerStamps: inv.ownerStamps,
      stampsWithoutJob: inv.stampsWithoutJob,
    },
    classes,
    statuses,
    orphans: classified.filter((c) => c.class === "orphan").map((c) => c.id),
    invalid: classified
      .filter((c) => c.class === "invalid")
      .map((c) => ({ id: c.id, reason: c.reason ?? "invalid" })),
    stale: classified.filter((c) => c.stale).length,
    users: {
      existing: userIds.size,
      toCreate: new Set(
        classified
          .filter((c) => c.class === "ok" && c.userId === null)
          .map((c) => c.ownerEmail)
      ).size,
    },
    executed: 0,
    refreshed: 0,
    raced: 0,
    skippedByCheckpoint: 0,
    failed: [],
    verify: null,
    bookmark: null,
    planFile: null,
    ok: true,
  };
}

/** Step 4: bookmark, users, one guarded batch per job, checkpoints. */
async function executePhase(
  options: MigrationOptions,
  classified: readonly ClassifiedJob[],
  userIds: Map<string, string>,
  rankOf: (item: ClassifiedJob) => string,
  report: MigrationReport
): Promise<void> {
  const log = options.log ?? (() => undefined);
  const now = options.now?.() ?? Date.now();
  report.bookmark = (await options.bookmark?.()) ?? null;
  log(
    report.bookmark
      ? `Time Travel bookmark before execute: ${report.bookmark} (rollback: wrangler d1 time-travel restore pilihpendidikan-jobs --bookmark=${report.bookmark})`
      : "Time Travel bookmark: not available for this target (local fixture)."
  );
  const toWrite = classified.filter(
    (c) => c.class === "ok" || (options.refresh && c.stale)
  );
  const emails = [
    ...new Set(toWrite.map((c) => c.ownerEmail as string)),
  ].sort();
  const created = await upsertUsers(options.identity, emails, now);
  for (const [email, id] of created) {
    userIds.set(email, id);
  }
  const done = (await options.checkpoint?.load()) ?? new Set<string>();
  let sinceSave = 0;
  for (const item of toWrite) {
    if (done.has(item.id) && item.class === "ok") {
      report.skippedByCheckpoint += 1;
      continue;
    }
    if (await writeOne(options, item, userIds, rankOf(item), report)) {
      done.add(item.id);
      sinceSave += 1;
    }
    if (sinceSave >= CHECKPOINT_EVERY) {
      await options.checkpoint?.save(done);
      sinceSave = 0;
    }
  }
  await options.checkpoint?.save(done);
  log(
    `Executed ${report.executed} jobs, refreshed ${report.refreshed}, ${report.raced} already present, ${report.skippedByCheckpoint} skipped by the checkpoint, ${report.failed.length} failed.`
  );
  for (const failure of report.failed) {
    log(`Failed: ${failure.id} — ${failure.error}`);
  }
}

export async function migrateJobsKvToD1(
  options: MigrationOptions
): Promise<MigrationReport> {
  const log = options.log ?? (() => undefined);
  const now = options.now?.() ?? Date.now();
  const mode = modeOf(options);
  log(
    mode === "dry run"
      ? "Mode: dry run — nothing is written. Pass --execute to write JOBS_DB (and DB.users)."
      : `Mode: ${mode}`
  );

  // 1–2. Inventory and classification.
  const inv = await inventory(options);
  const { classified, userIds } = await classify(options, inv.items);
  const report = newReport(mode, inv, classified, userIds);
  logClassification(log, report);

  const owned = classified.filter(
    (c) => c.class === "ok" || c.class === "already_migrated"
  );
  if (options.verifyOnly) {
    report.verify = await verifyMigration(options, owned, userIds, now);
    report.ok = report.verify.ok;
    logVerify(log, report.verify);
    return report;
  }

  // 3. Plan.
  const ranks = planRanks(owned, now);
  const rankOf = (item: ClassifiedJob) =>
    ranks.get(`${item.ownerEmail}|${item.id}`) ?? "i";
  await writePlanPhase(options, classified, userIds, rankOf, report);
  if (!options.execute) {
    log(
      "Dry run complete: nothing was written. Before --execute the script reads the JOBS_DB Time Travel bookmark (wrangler d1 time-travel info pilihpendidikan-jobs) for rollback."
    );
    return report;
  }

  // 4. Execute.
  await executePhase(options, classified, userIds, rankOf, report);

  // 5. Verify.
  const { classified: after, userIds: afterUsers } = await classify(
    options,
    inv.items
  );
  report.verify = await verifyMigration(
    options,
    after.filter((c) => c.class === "ok" || c.class === "already_migrated"),
    afterUsers,
    now
  );
  logVerify(log, report.verify);
  report.ok = report.verify.ok && report.failed.length === 0;
  return report;
}

function logVerify(log: (line: string) => void, verify: VerifyReport): void {
  log(
    `Verify: ${verify.users} users, ${verify.countMismatches.length} count mismatches, ${verify.statusMismatches.length} status mismatches, ${verify.sampleMismatches.length}/${verify.sampled} sampled jobs differ — ${verify.ok ? "OK" : "MISMATCH"}.`
  );
  for (const mismatch of verify.countMismatches) {
    log(
      `  count ${mismatch.user}: kv ${mismatch.kv}, d1 ${mismatch.d1}, missing ${mismatch.missing.join(", ")}`
    );
  }
  for (const mismatch of verify.statusMismatches) {
    log(
      `  status ${mismatch.user} ${mismatch.status}: kv ${mismatch.kv}, d1 ${mismatch.d1}`
    );
  }
  for (const mismatch of verify.sampleMismatches) {
    log(`  sample ${mismatch.id}: ${mismatch.fields.join(", ")}`);
  }
  for (const extra of verify.extra) {
    log(
      `  note ${extra.user}: ${extra.ids.length} D1 legacy ids without a KV job (created through the facade)`
    );
  }
}

// ---------------------------------------------------------------------------
// Targets: local SQLite (tests, --fixture) and the Cloudflare REST API
// ---------------------------------------------------------------------------

const API_DIR = resolve(import.meta.dir, "..");

function sqlParams(
  params: readonly unknown[] = []
): Array<string | number | null> {
  return params.map((value) => {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    return value as string | number;
  });
}

/** A SqlTarget over a bun:sqlite database (atomic batches). */
export function sqliteTarget(sqlite: Database): SqlTarget {
  return {
    query<T>(sql: string, params?: unknown[]) {
      return Promise.resolve(
        sqlite.query(sql).all(...sqlParams(params)) as T[]
      );
    },
    batch(statements) {
      sqlite.exec("BEGIN");
      try {
        for (const statement of statements) {
          sqlite.query(statement.sql).all(...sqlParams(statement.params));
        }
        sqlite.exec("COMMIT");
        return Promise.resolve();
      } catch (err) {
        sqlite.exec("ROLLBACK");
        return Promise.reject(err);
      }
    },
  };
}

/** A fresh in-memory database with the `.sql` migrations of `dir` applied. */
export function migratedSqlite(dir: string): Database {
  const sqlite = new Database(":memory:");
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith(".sql")) {
      sqlite.exec(readFileSync(join(dir, file), "utf8"));
    }
  }
  return sqlite;
}

export interface FixtureEntry {
  key: string;
  metadata?: unknown;
  value: string;
}

/** A KV export file: `[{key, value, metadata?}]` or `{entries: […]}`. */
export function readKvExport(path: string): FixtureEntry[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as
    | FixtureEntry[]
    | { entries: FixtureEntry[] };
  return Array.isArray(parsed) ? parsed : parsed.entries;
}

/** A KvSource over export entries. */
/**
 * A KvSource over a Workers KV binding, following list cursors to the end
 * (tests drive it over the fake KV, which pages by 1,000 like KV does).
 */
export function bindingKv(kv: KVNamespace): KvSource {
  return {
    async listKeys(prefix) {
      const keys: KvKey[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page: KVNamespaceListResult<unknown> = await kv.list({
          prefix,
          limit: 1000,
          cursor,
        });
        keys.push(
          ...page.keys.map((key) => ({
            name: key.name,
            metadata: key.metadata,
          }))
        );
        if (page.list_complete) {
          return keys;
        }
        cursor = page.cursor;
      }
    },
    get(key) {
      return kv.get(key);
    },
  };
}

export function memoryKv(entries: readonly FixtureEntry[]): KvSource {
  const data = new Map(entries.map((entry) => [entry.key, entry]));
  return {
    listKeys(prefix) {
      return Promise.resolve(
        [...data.keys()]
          .filter((key) => key.startsWith(prefix))
          .sort()
          .map((name) => ({ name, metadata: data.get(name)?.metadata }))
      );
    },
    get(key) {
      return Promise.resolve(data.get(key)?.value ?? null);
    },
  };
}

const API_BASE = "https://api.cloudflare.com/client/v4";

interface ApiEnvelope<T> {
  errors?: Array<{ message: string }>;
  result: T;
  success: boolean;
}

async function cloudflareApi<T>(
  creds: CloudflareCredentials,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${creds.apiToken}`);
  const res = await fetch(`${API_BASE}/accounts/${creds.accountId}${path}`, {
    ...init,
    headers,
  });
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!(res.ok && body.success)) {
    const reason = body.errors?.map((e) => e.message).join("; ") ?? res.status;
    throw new Error(`Cloudflare API ${path} failed: ${reason}`);
  }
  return body.result;
}

/**
 * A SqlTarget over the D1 REST API: `query` runs one statement; `batch`
 * sends `{batch: [{sql, params}]}`, which D1 runs as one transaction.
 */
export function d1RestTarget(
  creds: CloudflareCredentials,
  databaseId: string
): SqlTarget {
  const path = `/d1/database/${databaseId}/query`;
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const result = await cloudflareApi<Array<{ results: T[] }>>(creds, path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params: sqlParams(params) }),
      });
      return result[0]?.results ?? [];
    },
    async batch(statements) {
      await cloudflareApi<unknown>(creds, path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch: statements.map((s) => ({
            sql: s.sql,
            params: sqlParams(s.params),
          })),
        }),
      });
    },
  };
}

/** The current Time Travel bookmark of a D1 database. */
export async function timeTravelBookmark(
  creds: CloudflareCredentials,
  databaseId: string
): Promise<string> {
  const result = await cloudflareApi<{ bookmark: string }>(
    creds,
    `/d1/database/${databaseId}/time_travel/bookmark`
  );
  return result.bookmark;
}

/** A checkpoint file `{"done": [legacy ids]}`. */
export function fileCheckpoint(path: string): CheckpointStore {
  return {
    load() {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as {
          done?: string[];
        };
        return Promise.resolve(new Set(parsed.done ?? []));
      } catch {
        return Promise.resolve(new Set());
      }
    },
    save(done) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        `${JSON.stringify({ done: [...done].sort(), saved_at: new Date().toISOString() })}\n`
      );
      return Promise.resolve();
    },
  };
}

const TRAILING_COMMA_RE = /,(\s*[}\]])/g;

// A JSON string, a // comment or a /* */ comment (strings win, so a URL's
// "//" is never taken for a comment).
const JSONC_TOKEN_RE = /"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

// Strips comments and trailing commas outside strings (wrangler.jsonc).
function stripJsonComments(source: string): string {
  return source
    .replace(JSONC_TOKEN_RE, (token) => (token.startsWith('"') ? token : ""))
    .replace(TRAILING_COMMA_RE, "$1");
}

export interface WranglerIds {
  db: string | null;
  jobsDb: string | null;
  jobsKv: string | null;
}

/** DB / JOBS_DB / JOBS_KV ids from apps/api/wrangler.jsonc. */
export function wranglerIds(
  path = join(API_DIR, "wrangler.jsonc")
): WranglerIds {
  const config = JSON.parse(stripJsonComments(readFileSync(path, "utf8"))) as {
    d1_databases?: Array<{ binding: string; database_id: string }>;
    kv_namespaces?: Array<{ binding: string; id: string }>;
  };
  const d1 = (binding: string) =>
    config.d1_databases?.find((d) => d.binding === binding)?.database_id ??
    null;
  return {
    db: d1("DB"),
    jobsDb: d1("JOBS_DB"),
    jobsKv:
      config.kv_namespaces?.find((k) => k.binding === "JOBS_KV")?.id ?? null,
  };
}

function requireId(value: string | null | undefined, what: string): string {
  if (!value || value.startsWith("REPLACE_WITH_")) {
    throw new Error(`${what} is not configured: pass it explicitly.`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const execute = args.has("--execute");
  const outDir = resolve(args.value("--out") ?? "tmp/jobs-kv-to-d1");
  const sample = Number(args.value("--sample") ?? DEFAULT_SAMPLE_RATE);
  const fixture = args.value("--fixture");
  const common = {
    execute,
    refresh: args.has("--refresh"),
    verifyOnly: args.has("--verify") && !execute,
    sampleRate: Number.isFinite(sample) ? sample : DEFAULT_SAMPLE_RATE,
    planFile: join(outDir, "migration-plan.jsonl"),
    checkpoint: fileCheckpoint(
      resolve(args.value("--checkpoint") ?? join(outDir, "checkpoint.json"))
    ),
    log: (line: string) => console.log(line),
  };
  let report: MigrationReport;
  if (fixture) {
    console.log(
      `Target: local fixture ${fixture} (in-memory SQLite copies of DB and JOBS_DB; nothing remote is read or written).`
    );
    report = await migrateJobsKvToD1({
      ...common,
      // A fixture run has no previous state to resume from.
      checkpoint: null,
      kv: memoryKv(readKvExport(resolve(fixture))),
      identity: sqliteTarget(migratedSqlite(join(API_DIR, "migrations"))),
      jobs: sqliteTarget(migratedSqlite(join(API_DIR, "migrations-jobs"))),
      bookmark: () => Promise.resolve(null),
    });
  } else {
    const ids = wranglerIds();
    const creds = credentialsFromEnv();
    const jobsDbId = requireId(
      args.value("--jobs-db-id") ?? ids.jobsDb,
      "JOBS_DB database_id (--jobs-db-id)"
    );
    report = await migrateJobsKvToD1({
      ...common,
      kv: cloudflareKv(
        creds,
        requireId(
          args.value("--kv") ?? ids.jobsKv,
          "JOBS_KV namespace id (--kv)"
        )
      ),
      identity: d1RestTarget(
        creds,
        requireId(args.value("--db-id") ?? ids.db, "DB database_id (--db-id)")
      ),
      jobs: d1RestTarget(creds, jobsDbId),
      bookmark: () => timeTravelBookmark(creds, jobsDbId),
    });
  }
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        inventory: report.inventory,
        classes: report.classes,
        statuses: report.statuses,
        users: report.users,
        executed: report.executed,
        refreshed: report.refreshed,
        failed: report.failed.length,
        verify: report.verify
          ? { ok: report.verify.ok, sampled: report.verify.sampled }
          : null,
        bookmark: report.bookmark,
        plan: report.planFile,
      },
      null,
      2
    )
  );
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
