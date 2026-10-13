// Hard delete of one application (06 §8 `DELETE …?purge=1`): the
// application, its events, interviews, offers, evidence, approvals, email
// drafts, CV variants, tasks (+ attempts) and the files only it references
// — one batch, with `change_log op=delete` rows written before the rows go.
// The `user_jobs` row stays, `inbox_state = 'dismissed'`, so a rediscovery
// does not resurrect the job. R2 objects (and tailored CV documents) are
// removed by the service after the batch commits.

import { TASK_LIVE_STATES } from "@pilihpendidikan/jobs-contracts/enums";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { guard, queryAll, stmt } from "../core/db";

const LIVE_STATES_SQL = TASK_LIVE_STATES.map((s) => `'${s}'`).join(", ");

export interface PurgeFile {
  id: string;
  r2_key: string;
}

/**
 * Files referenced by this application (CV variant PDFs, evidence
 * screenshots, run logs of its tasks, email attachments) and by nothing
 * else of the user's.
 */
export async function filesOnlyReferencedBy(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<PurgeFile[]> {
  const user = scope.userId;
  return await queryAll<PurgeFile>(
    db,
    `SELECT f.id, f.r2_key FROM files f
    WHERE f.user_id = ? AND f.id IN (
      SELECT file_id FROM cv_variants WHERE user_id = ? AND application_id = ? AND file_id IS NOT NULL
      UNION SELECT screenshot_file_id FROM submission_evidence WHERE user_id = ? AND application_id = ? AND screenshot_file_id IS NOT NULL
      UNION SELECT at.log_file_id FROM automation_attempts at JOIN automation_tasks tt ON tt.id = at.task_id AND tt.user_id = at.user_id WHERE at.user_id = ? AND tt.application_id = ? AND at.log_file_id IS NOT NULL
      UNION SELECT j.value FROM email_applications e, json_each(e.attachment_file_ids) j WHERE e.user_id = ? AND e.application_id = ?
    )
    AND NOT EXISTS (SELECT 1 FROM cv_variants v WHERE v.user_id = f.user_id AND v.file_id = f.id AND (v.application_id IS NULL OR v.application_id != ?))
    AND NOT EXISTS (SELECT 1 FROM submission_evidence s WHERE s.user_id = f.user_id AND s.screenshot_file_id = f.id AND s.application_id != ?)
    AND NOT EXISTS (SELECT 1 FROM email_applications e2, json_each(e2.attachment_file_ids) j2 WHERE e2.user_id = f.user_id AND e2.application_id != ? AND j2.value = f.id)
    AND NOT EXISTS (SELECT 1 FROM automation_attempts a2 JOIN automation_tasks t2 ON t2.id = a2.task_id AND t2.user_id = a2.user_id WHERE a2.user_id = f.user_id AND a2.log_file_id = f.id AND (t2.application_id IS NULL OR t2.application_id != ?))
    ORDER BY f.id`,
    user,
    user,
    applicationId,
    user,
    applicationId,
    user,
    applicationId,
    user,
    applicationId,
    applicationId,
    applicationId,
    applicationId,
    applicationId
  );
}

/** `tailored_cv_id`s of the application's CV variants (apps/cv documents). */
export async function tailoredCvIds(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<string[]> {
  const rows = await queryAll<{ tailored_cv_id: string }>(
    db,
    "SELECT DISTINCT tailored_cv_id FROM cv_variants WHERE user_id = ? AND application_id = ? AND tailored_cv_id IS NOT NULL",
    scope.userId,
    applicationId
  );
  return rows.map((row) => row.tailored_cv_id);
}

/** `recorded_at` of every event of the application (analytics days). */
export async function eventTimes(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<number[]> {
  const rows = await queryAll<{ recorded_at: number }>(
    db,
    "SELECT DISTINCT recorded_at FROM application_events WHERE user_id = ? AND application_id = ?",
    scope.userId,
    applicationId
  );
  return rows.map((row) => row.recorded_at);
}

// change_log `delete` rows for every child row, written before the deletes.
function deletionLogStatements(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  fileIds: readonly string[],
  now: number
): D1PreparedStatement[] {
  const user = scope.userId;
  const tasksOfApp =
    "SELECT id FROM automation_tasks WHERE user_id = ? AND application_id = ?";
  const statements = [
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'event', id, 1, 'delete', ? FROM application_events WHERE user_id = ? AND application_id = ?",
      now,
      user,
      applicationId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'interview', id, revision + 1, 'delete', ? FROM interviews WHERE user_id = ? AND application_id = ?",
      now,
      user,
      applicationId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'offer', id, revision + 1, 'delete', ? FROM offers WHERE user_id = ? AND application_id = ?",
      now,
      user,
      applicationId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'evidence', id, 1, 'delete', ? FROM submission_evidence WHERE user_id = ? AND application_id = ?",
      now,
      user,
      applicationId
    ),
    stmt(
      db,
      `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'approval', id, revision + 1, 'delete', ? FROM approvals WHERE user_id = ? AND (application_id = ? OR task_id IN (${tasksOfApp}))`,
      now,
      user,
      applicationId,
      user,
      applicationId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'email', id, revision + 1, 'delete', ? FROM email_applications WHERE user_id = ? AND application_id = ?",
      now,
      user,
      applicationId
    ),
    stmt(
      db,
      `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'attempt', id, 1, 'delete', ? FROM automation_attempts WHERE user_id = ? AND task_id IN (${tasksOfApp})`,
      now,
      user,
      user,
      applicationId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'task', id, revision + 1, 'delete', ? FROM automation_tasks WHERE user_id = ? AND application_id = ?",
      now,
      user,
      applicationId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'cv_variant', id, revision + 1, 'delete', ? FROM cv_variants WHERE user_id = ? AND application_id = ?",
      now,
      user,
      applicationId
    ),
  ];
  if (fileIds.length > 0) {
    statements.push(
      stmt(
        db,
        `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'file', id, 1, 'delete', ? FROM files WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))`,
        now,
        user,
        JSON.stringify(fileIds)
      )
    );
  }
  statements.push(
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'application', id, revision + 1, 'delete', ? FROM applications WHERE id = ? AND user_id = ?",
      now,
      applicationId,
      user
    )
  );
  return statements;
}

// Children before parents (D1 enforces the REFERENCES clauses).
function deleteStatements(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  fileIds: readonly string[]
): D1PreparedStatement[] {
  const user = scope.userId;
  const tasksOfApp =
    "SELECT id FROM automation_tasks WHERE user_id = ? AND application_id = ?";
  const statements = [
    stmt(
      db,
      `DELETE FROM automation_attempts WHERE user_id = ? AND task_id IN (${tasksOfApp})`,
      user,
      user,
      applicationId
    ),
    stmt(
      db,
      `DELETE FROM approvals WHERE user_id = ? AND (application_id = ? OR task_id IN (${tasksOfApp}))`,
      user,
      applicationId,
      user,
      applicationId
    ),
    stmt(
      db,
      "DELETE FROM submission_evidence WHERE user_id = ? AND application_id = ?",
      user,
      applicationId
    ),
    stmt(
      db,
      "DELETE FROM automation_tasks WHERE user_id = ? AND application_id = ?",
      user,
      applicationId
    ),
    stmt(
      db,
      "DELETE FROM email_applications WHERE user_id = ? AND application_id = ?",
      user,
      applicationId
    ),
    stmt(
      db,
      "DELETE FROM interviews WHERE user_id = ? AND application_id = ?",
      user,
      applicationId
    ),
    stmt(
      db,
      "DELETE FROM offers WHERE user_id = ? AND application_id = ?",
      user,
      applicationId
    ),
    stmt(
      db,
      "DELETE FROM application_events WHERE user_id = ? AND application_id = ?",
      user,
      applicationId
    ),
    stmt(
      db,
      "DELETE FROM cv_variants WHERE user_id = ? AND application_id = ?",
      user,
      applicationId
    ),
  ];
  if (fileIds.length > 0) {
    statements.push(
      stmt(
        db,
        "DELETE FROM files WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))",
        user,
        JSON.stringify(fileIds)
      )
    );
  }
  statements.push(
    stmt(
      db,
      "DELETE FROM applications WHERE id = ? AND user_id = ?",
      applicationId,
      user
    )
  );
  return statements;
}

/**
 * The purge batch: guards (the application is still the user's at the read
 * revision and has no live task), change_log deletes, the deletes, and the
 * user_job → dismissed (+ change_log).
 */
export function purgeStatements(
  db: JobsDb,
  scope: UserScope,
  input: {
    applicationId: string;
    fileIds: readonly string[];
    now: number;
    revision: number;
    userJobId: string;
  }
): D1PreparedStatement[] {
  const { applicationId, fileIds, now } = input;
  return [
    guard(
      db,
      `purge:${applicationId}`,
      `SELECT 1 FROM applications a WHERE a.id = ? AND a.user_id = ? AND a.revision = ? AND NOT EXISTS (SELECT 1 FROM automation_tasks t WHERE t.user_id = a.user_id AND t.application_id = a.id AND t.state IN (${LIVE_STATES_SQL}))`,
      applicationId,
      scope.userId,
      input.revision
    ),
    ...deletionLogStatements(db, scope, applicationId, fileIds, now),
    ...deleteStatements(db, scope, applicationId, fileIds),
    stmt(
      db,
      "UPDATE user_jobs SET inbox_state = 'dismissed', revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?",
      now,
      input.userJobId,
      scope.userId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'user_job', id, revision, 'upsert', ? FROM user_jobs WHERE id = ? AND user_id = ?",
      now,
      input.userJobId,
      scope.userId
    ),
  ];
}
