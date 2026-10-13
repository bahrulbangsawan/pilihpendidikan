// Direct JOBS_DB seeding for tests (bypasses routes). Each helper inserts one
// row with valid defaults (every CHECK satisfied) and returns its id; pass
// overrides for the columns a test cares about.
//
//   const t = createTestEnv();
//   const app = seedApplication(t.jobsSqlite, userId, { stage: "ready" });
//   const task = seedTask(t.jobsSqlite, userId, { application_id: app.id });

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";

type Row = Record<string, string | number | null>;

function insert(sqlite: Database, table: string, row: Row): void {
  const columns = Object.keys(row);
  sqlite
    .query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    )
    .run(...columns.map((c) => row[c]));
}

const T0 = Date.UTC(2026, 9, 1);

/** A public posting (fingerprint = sha256 of the id: unique and schema-valid). */
export function seedPosting(
  sqlite: Database,
  overrides: Row = {}
): { id: string } {
  const id = (overrides.id as string | undefined) ?? newId("pst");
  insert(sqlite, "job_postings", {
    id,
    fingerprint: `fp1:${createHash("sha256").update(id).digest("hex")}`,
    visibility: "public",
    owner_user_id: null,
    source_kind: "greenhouse",
    source_org: "acme",
    source_job_ref: id,
    company_name: "Acme",
    title: "Backend Engineer",
    content_hash: "0".repeat(64),
    first_seen_at: T0,
    last_seen_at: T0,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  });
  return { id };
}

/** A user ↔ posting link (creates the posting when none is given). */
export function seedUserJob(
  sqlite: Database,
  userId: string,
  overrides: Row = {}
): { id: string; posting_id: string } {
  const id = (overrides.id as string | undefined) ?? newId("ujb");
  const postingId =
    (overrides.posting_id as string | undefined) ?? seedPosting(sqlite).id;
  insert(sqlite, "user_jobs", {
    id,
    user_id: userId,
    posting_id: postingId,
    origin: "manual",
    inbox_state: "tracked",
    created_at: T0,
    updated_at: T0,
    ...overrides,
  });
  return { id, posting_id: postingId };
}

/** An application (Kanban card) with its user_job and posting. */
export function seedApplication(
  sqlite: Database,
  userId: string,
  overrides: Row = {}
): { id: string; posting_id: string; user_job_id: string } {
  const id = (overrides.id as string | undefined) ?? newId("app");
  const userJob =
    overrides.user_job_id === undefined
      ? seedUserJob(sqlite, userId)
      : { id: overrides.user_job_id as string, posting_id: "" };
  insert(sqlite, "applications", {
    id,
    user_id: userId,
    user_job_id: userJob.id,
    stage: "saved",
    stage_changed_at: T0,
    submission_status: "not_started",
    mode: "approval",
    board_rank: "i",
    last_change_source: "web",
    created_at: T0,
    updated_at: T0,
    ...overrides,
  });
  return { id, user_job_id: userJob.id, posting_id: userJob.posting_id };
}

/** An automation task (queued apply by default). */
export function seedTask(
  sqlite: Database,
  userId: string,
  overrides: Row = {}
): { id: string } {
  const id = (overrides.id as string | undefined) ?? newId("tsk");
  insert(sqlite, "automation_tasks", {
    id,
    user_id: userId,
    kind: "apply",
    state: "queued",
    not_before: T0,
    expires_at: T0 + 72 * 3_600_000,
    created_by: "web",
    idempotency_key: `seed:${id}`,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  });
  return { id };
}

/** An attempt row for a task's lease. */
export function seedAttempt(
  sqlite: Database,
  userId: string,
  overrides: Row & { lease_id: string; task_id: string }
): { id: string } {
  const id = (overrides.id as string | undefined) ?? newId("att");
  insert(sqlite, "automation_attempts", {
    id,
    user_id: userId,
    device_id: "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
    attempt_no: 1,
    started_at: T0,
    last_heartbeat_at: T0,
    cli_version: "0.1.0",
    ...overrides,
  });
  return { id };
}

/** Rows of a table for one user (assertion helper). */
export function rowsOf(
  sqlite: Database,
  table: string,
  userId: string
): Record<string, unknown>[] {
  return sqlite
    .query(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY rowid`)
    .all(userId) as Record<string, unknown>[];
}
