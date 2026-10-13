// The row set of one legacy job as SQL (06 §12.2, §12.4 step 4): shared by
// the P3 on-the-fly migration and facade creates (as D1 statements) and by
// `scripts/migrate-jobs-kv-to-d1.ts` (as `{sql, params}` sent over the D1
// REST API or run against a local SQLite in `--fixture` mode).
//
// The batch is led by a guard that aborts it when the user already has an
// application with this legacy id (`ux_apps_legacy`), and every INSERT is
// `ON CONFLICT DO NOTHING` with deterministic ids, so a re-run is a no-op.

import type { LegacyRows } from "../../legacy/mapping";
import type { UserScope } from "../../core/scope";
import type { JobsDb, SqlValue } from "../core/db";
import { guard, stmt } from "../core/db";

export interface SqlStatement {
  params: SqlValue[];
  sql: string;
}

/** Guard condition: the user has no application holding this legacy id yet. */
export function legacyImportGuard(rows: LegacyRows): SqlStatement {
  return {
    sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM applications WHERE user_id = ? AND legacy_job_id = ?)",
    params: [rows.userId, rows.legacyId],
  };
}

/**
 * The guard as a plain statement for targets outside the Worker (the
 * migration script over D1 REST or a local SQLite): like the kernel guard it
 * aborts the whole batch with a "malformed JSON" error when the condition is
 * false.
 */
export function legacyImportGuardStatement(rows: LegacyRows): SqlStatement {
  const condition = legacyImportGuard(rows);
  return {
    sql: `SELECT CASE WHEN EXISTS (${condition.sql}) THEN 1 ELSE json('{"legacy_import_guard":' || (SELECT count(*) FROM sqlite_master WHERE 0)) END AS legacy_guard`,
    params: condition.params,
  };
}

/** How a failed import guard surfaces in a batch error message. */
export const IMPORT_GUARD_ABORT_RE = /malformed JSON/i;

/** Label of the import guard (a `GuardFailedError` = already migrated). */
export function legacyImportGuardLabel(rows: LegacyRows): string {
  return `legacy_import:${rows.legacyId}`;
}

function change(
  rows: LegacyRows,
  entity: string,
  entityId: string
): SqlStatement {
  return {
    sql: "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) VALUES (?, ?, ?, 1, 'upsert', ?)",
    params: [rows.userId, entity, entityId, rows.now],
  };
}

/** The INSERTs of one legacy job (without the guard), in FK order. */
export function legacyImportSql(rows: LegacyRows): SqlStatement[] {
  const { posting, userJob, application, interview, evidence } = rows;
  const statements: SqlStatement[] = [
    {
      // sql-allow: public-posting — a private posting owned by the importing
      // user (owner_user_id is that user's id)
      sql: "INSERT INTO job_postings (id, fingerprint, visibility, owner_user_id, source_kind, canonical_url, company_name, company_domain, title, locations, salary, description_text, description_truncated, requirements, content_hash, first_seen_at, last_seen_at, status, missed_runs, extraction, application_support, revision, created_at, updated_at) VALUES (?, ?, 'private', ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, 'open', 0, '{}', 'unknown', 1, ?, ?) ON CONFLICT DO NOTHING",
      params: [
        posting.id,
        posting.fingerprint,
        posting.owner_user_id,
        posting.source_kind,
        posting.canonical_url,
        posting.company_name,
        posting.company_domain,
        posting.title,
        posting.salary,
        posting.description_text,
        posting.description_truncated,
        posting.requirements,
        posting.content_hash,
        posting.first_seen_at,
        posting.last_seen_at,
        posting.created_at,
        posting.updated_at,
      ],
    },
    {
      sql: "INSERT INTO user_jobs (id, user_id, posting_id, origin, inbox_state, user_notes, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 'tracked', '', 1, ?, ?) ON CONFLICT DO NOTHING",
      params: [
        userJob.id,
        userJob.user_id,
        userJob.posting_id,
        userJob.origin,
        userJob.created_at,
        userJob.updated_at,
      ],
    },
    {
      sql: "INSERT INTO applications (id, user_id, user_job_id, legacy_job_id, stage, stage_changed_at, submission_status, submitted_at, submission_method, mode, priority, board_rank, archived, sections, last_change_source, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 0, ?, 0, ?, ?, 1, ?, ?) ON CONFLICT DO NOTHING",
      params: [
        application.id,
        application.user_id,
        application.user_job_id,
        application.legacy_job_id,
        application.stage,
        application.stage_changed_at,
        application.submission_status,
        application.submitted_at,
        application.submission_method,
        application.board_rank,
        application.sections,
        application.last_change_source,
        application.created_at,
        application.updated_at,
      ],
    },
  ];
  for (const event of rows.events) {
    statements.push({
      sql: "INSERT INTO application_events (id, user_id, application_id, type, from_value, to_value, payload, actor_kind, actor_device_id, task_id, attempt_id, applied_to_state, occurred_at, recorded_at, idempotency_key) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?, ?) ON CONFLICT DO NOTHING",
      params: [
        event.id,
        event.user_id,
        event.application_id,
        event.type,
        event.to_value,
        event.payload,
        event.actor_kind,
        event.occurred_at,
        event.recorded_at,
        event.idempotency_key,
      ],
    });
  }
  if (interview) {
    statements.push({
      sql: "INSERT INTO interviews (id, user_id, application_id, round, kind, scheduled_at, duration_min, timezone, location, interviewers, outcome, notes, revision, created_at, updated_at) VALUES (?, ?, ?, 1, 'other', ?, NULL, NULL, NULL, '[]', 'pending', '', 1, ?, ?) ON CONFLICT DO NOTHING",
      params: [
        interview.id,
        interview.user_id,
        interview.application_id,
        interview.scheduled_at,
        interview.created_at,
        interview.updated_at,
      ],
    });
  }
  if (evidence) {
    statements.push({
      sql: "INSERT INTO submission_evidence (id, user_id, application_id, task_id, attempt_id, kind, verdict, signals, captured_at, recorded_at) VALUES (?, ?, ?, NULL, NULL, 'user_attestation', 'verified', ?, ?, ?) ON CONFLICT DO NOTHING",
      params: [
        evidence.id,
        evidence.user_id,
        evidence.application_id,
        evidence.signals,
        evidence.captured_at,
        evidence.recorded_at,
      ],
    });
  }
  statements.push(
    change(rows, "posting", posting.id),
    change(rows, "user_job", userJob.id),
    change(rows, "application", application.id),
    ...rows.events.map((event) => change(rows, "event", event.id))
  );
  if (interview) {
    statements.push(change(rows, "interview", interview.id));
  }
  if (evidence) {
    statements.push(change(rows, "evidence", evidence.id));
  }
  return statements;
}

/** The guarded import batch as D1 statements (facade path, kernel guard). */
export function legacyImportStatements(
  db: JobsDb,
  scope: UserScope,
  rows: LegacyRows
): D1PreparedStatement[] {
  if (rows.userId !== scope.userId) {
    throw new Error("legacy import rows belong to another user");
  }
  const condition = legacyImportGuard(rows);
  return [
    guard(db, legacyImportGuardLabel(rows), condition.sql, ...condition.params),
    ...legacyImportSql(rows).map((s) => stmt(db, s.sql, ...s.params)),
  ];
}
