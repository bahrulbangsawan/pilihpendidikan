// Fixtures of the analytics tests: applications with a hand-written event
// history, inserted straight into JOBS_DB (no routes involved).

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

type Row = Record<string, string | number | null>;

function insert(sqlite: Database, table: string, row: Row): void {
  const columns = Object.keys(row);
  sqlite
    .query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    )
    .run(...columns.map((column) => row[column] ?? null));
}

let counter = 0;
function key(prefix: string): string {
  counter += 1;
  return `${prefix}:${counter}`;
}

export interface EventSpec {
  applied?: boolean;
  attemptId?: string | null;
  from?: string | null;
  occurredAt?: number;
  payload?: Record<string, unknown>;
  taskId?: string | null;
  to?: string | null;
  type: string;
}

export function insertEvent(
  sqlite: Database,
  userId: string,
  applicationId: string,
  at: number,
  spec: EventSpec
): string {
  const id = newId("evt", at);
  insert(sqlite, "application_events", {
    id,
    user_id: userId,
    application_id: applicationId,
    type: spec.type,
    from_value: spec.from ?? null,
    to_value: spec.to ?? null,
    payload: JSON.stringify(spec.payload ?? {}),
    actor_kind: "user",
    task_id: spec.taskId ?? null,
    attempt_id: spec.attemptId ?? null,
    applied_to_state: spec.applied === false ? 0 : 1,
    occurred_at: spec.occurredAt ?? at,
    recorded_at: at,
    idempotency_key: key("evt"),
  });
  return id;
}

export interface PostingSpec {
  company_domain?: string | null;
  company_name?: string;
  seniority?: string | null;
  source_kind?: string;
  title?: string;
  workplace_type?: string | null;
}

export interface AppSpec {
  createdAt: number;
  cvVariantId?: string | null;
  followUpAt?: number | null;
  legacy?: { status: string; updatedAt: number } | null;
  mode?: string;
  origin?: string;
  posting?: PostingSpec;
  sourceId?: string | null;
  stage?: string;
  submissionStatus?: string;
  submissionMethod?: string | null;
}

/** A posting + user_job + application, with its `created` event. */
export function seedApp(
  sqlite: Database,
  userId: string,
  spec: AppSpec
): { id: string; postingId: string; userJobId: string } {
  const at = spec.createdAt;
  const postingId = newId("pst", at);
  insert(sqlite, "job_postings", {
    id: postingId,
    fingerprint: `fp1:${createHash("sha256").update(postingId).digest("hex")}`,
    visibility: "public",
    source_kind: spec.posting?.source_kind ?? "greenhouse",
    source_org: "acme",
    company_name: spec.posting?.company_name ?? "Acme",
    company_domain: spec.posting?.company_domain ?? null,
    title: spec.posting?.title ?? "Backend Engineer",
    workplace_type: spec.posting?.workplace_type ?? null,
    seniority: spec.posting?.seniority ?? null,
    content_hash: "0".repeat(64),
    first_seen_at: at,
    last_seen_at: at,
    created_at: at,
    updated_at: at,
  });
  const userJobId = newId("ujb", at);
  insert(sqlite, "user_jobs", {
    id: userJobId,
    user_id: userId,
    posting_id: postingId,
    origin: spec.origin ?? (spec.legacy ? "legacy" : "manual"),
    inbox_state: "tracked",
    source_id: spec.sourceId ?? null,
    created_at: at,
    updated_at: at,
  });
  const id = newId("app", at);
  const stage = spec.legacy?.status ?? spec.stage ?? "saved";
  const legacyJobId = spec.legacy ? key("legacy") : null;
  insert(sqlite, "applications", {
    id,
    user_id: userId,
    user_job_id: userJobId,
    legacy_job_id: legacyJobId,
    stage,
    stage_changed_at: at,
    submission_status: spec.submissionStatus ?? "not_started",
    submission_method: spec.submissionMethod ?? null,
    mode: spec.mode ?? "approval",
    cv_variant_id: spec.cvVariantId ?? null,
    follow_up_at: spec.followUpAt ?? null,
    board_rank: "i",
    last_change_source: spec.legacy ? "legacy_migration" : "web",
    created_at: at,
    updated_at: spec.legacy?.updatedAt ?? at,
  });
  if (spec.legacy) {
    insertEvent(sqlite, userId, id, at, {
      type: "created",
      to: stage,
      occurredAt: spec.legacy.updatedAt,
      payload: {
        origin: "legacy",
        stage,
        legacy_status: spec.legacy.status,
      },
    });
    insertEvent(sqlite, userId, id, at, {
      type: "legacy_imported",
      occurredAt: spec.legacy.updatedAt,
      payload: {
        legacy_job_id: legacyJobId,
        legacy_status: spec.legacy.status,
        legacy_updated_at: spec.legacy.updatedAt,
      },
    });
  } else {
    insertEvent(sqlite, userId, id, at, {
      type: "created",
      to: stage,
      payload: { origin: "manual", stage },
    });
  }
  return { id, postingId, userJobId };
}

/** Builds a stage history: each `to` writes an applied `stage_changed` event. */
export class Story {
  readonly id: string;
  readonly postingId: string;
  stage: string;
  readonly #sqlite: Database;
  readonly #userId: string;
  readonly #mode: string;

  constructor(sqlite: Database, userId: string, spec: AppSpec) {
    const app = seedApp(sqlite, userId, spec);
    this.id = app.id;
    this.postingId = app.postingId;
    this.stage = spec.stage ?? "saved";
    this.#sqlite = sqlite;
    this.#userId = userId;
    this.#mode = spec.mode ?? "approval";
  }

  to(stage: string, at: number, options: { applied?: boolean } = {}): this {
    insertEvent(this.#sqlite, this.#userId, this.id, at, {
      type: "stage_changed",
      from: this.stage,
      to: stage,
      applied: options.applied,
      payload: { from: this.stage, to: stage, mode: this.#mode },
    });
    if (options.applied !== false) {
      this.stage = stage;
      this.#sqlite
        .query(
          "UPDATE applications SET stage = ?, stage_changed_at = ? WHERE id = ?"
        )
        .run(stage, at, this.id);
    }
    return this;
  }

  submission(status: string, at: number): this {
    insertEvent(this.#sqlite, this.#userId, this.id, at, {
      type: "submission_status_changed",
      to: status,
      payload: { to: status },
    });
    this.#sqlite
      .query("UPDATE applications SET submission_status = ? WHERE id = ?")
      .run(status, this.id);
    return this;
  }

  interview(round: number, at: number): this {
    insert(this.#sqlite, "interviews", {
      id: newId("ivw", at),
      user_id: this.#userId,
      application_id: this.id,
      round,
      kind: "technical",
      created_at: at,
      updated_at: at,
    });
    insertEvent(this.#sqlite, this.#userId, this.id, at, {
      type: "interview_scheduled",
      payload: { round },
    });
    return this;
  }
}

/** A ready match score of a posting at `at`. */
export function seedScore(
  sqlite: Database,
  userId: string,
  postingId: string,
  score: number,
  at: number,
  profileVersion: number
): void {
  insert(sqlite, "match_scores", {
    id: newId("scr", at),
    user_id: userId,
    posting_id: postingId,
    profile_version: profileVersion,
    rubric_version: "r1",
    model: "deterministic-only",
    score,
    components: "{}",
    status: "ready",
    created_at: at,
  });
}

/** An apply task that finished at `at` (with an optional verified evidence). */
export function seedFinishedTask(
  sqlite: Database,
  userId: string,
  applicationId: string,
  at: number,
  spec: { errorClass?: string; state: string; verified?: boolean }
): { attemptId: string; taskId: string } {
  const taskId = newId("tsk", at);
  insert(sqlite, "automation_tasks", {
    id: taskId,
    user_id: userId,
    kind: "apply",
    application_id: applicationId,
    state: spec.state,
    not_before: at - HOUR,
    expires_at: at + 72 * HOUR,
    created_by: "web",
    idempotency_key: key("task"),
    error_class: spec.errorClass ?? null,
    created_at: at - HOUR,
    updated_at: at,
    finished_at: at,
  });
  const attemptId = newId("att", at);
  insert(sqlite, "automation_attempts", {
    id: attemptId,
    task_id: taskId,
    user_id: userId,
    device_id: "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
    lease_id: newId("lse", at),
    attempt_no: 1,
    started_at: at - HOUR,
    last_heartbeat_at: at,
    ended_at: at,
    outcome: spec.state === "submitted" ? "submitted" : "failed",
    cli_version: "0.1.0",
  });
  if (spec.verified) {
    insert(sqlite, "submission_evidence", {
      id: newId("evd", at),
      user_id: userId,
      application_id: applicationId,
      task_id: taskId,
      kind: "browser_confirmation",
      verdict: "verified",
      signals: "{}",
      captured_at: at,
      recorded_at: at,
    });
  }
  return { taskId, attemptId };
}

/** A user_job delivered by discovery at `at`. */
export function seedDiscovered(
  sqlite: Database,
  userId: string,
  at: number
): void {
  const postingId = newId("pst", at);
  insert(sqlite, "job_postings", {
    id: postingId,
    fingerprint: `fp1:${createHash("sha256").update(postingId).digest("hex")}`,
    visibility: "public",
    source_kind: "lever",
    company_name: "Found Co",
    title: "Data Engineer",
    content_hash: "0".repeat(64),
    first_seen_at: at,
    last_seen_at: at,
    created_at: at,
    updated_at: at,
  });
  insert(sqlite, "user_jobs", {
    id: newId("ujb", at),
    user_id: userId,
    posting_id: postingId,
    origin: "discovered",
    inbox_state: "new",
    created_at: at,
    updated_at: at,
  });
}

/** analytics_daily rows of a user as `{day: metrics}`. */
export function dailyRows(
  sqlite: Database,
  userId: string
): Record<string, Record<string, unknown>> {
  const rows = sqlite
    .query(
      "SELECT day, metrics FROM analytics_daily WHERE user_id = ? ORDER BY day"
    )
    .all(userId) as Array<{ day: string; metrics: string }>;
  return Object.fromEntries(
    rows.map((row) => [row.day, JSON.parse(row.metrics)])
  );
}
