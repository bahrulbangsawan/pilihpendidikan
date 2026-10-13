// User attestation of a submission (05 §5 `…/submission`, 03 §5.2, D-18):
// `submission_evidence` rows of kind `user_attestation`, and the 21 §12 edge
// `outcome_unknown → failed` ("user: not submitted") of the application's
// apply tasks when the user denies.

import type { SubmissionEvidenceRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import { appendChange, appendChangeFromRow } from "../core/change-log";
import type { JobsDb } from "../core/db";
import { encodeJson, queryAll, stmt } from "../core/db";

/** INSERT of one evidence row + its change_log row (append-only). */
export function insertEvidenceStatements(
  db: JobsDb,
  scope: UserScope,
  evidence: SubmissionEvidenceRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO submission_evidence (id, user_id, application_id, task_id, attempt_id, kind, verdict, signals, final_url, page_title, text_excerpt, screenshot_file_id, form_hash, captured_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      evidence.id,
      scope.userId,
      evidence.application_id,
      evidence.task_id,
      evidence.attempt_id,
      evidence.kind,
      evidence.verdict,
      encodeJson(evidence.signals),
      evidence.final_url,
      evidence.page_title,
      evidence.text_excerpt,
      evidence.screenshot_file_id,
      evidence.form_hash,
      evidence.captured_at,
      evidence.recorded_at
    ),
    appendChange(db, scope, {
      entity: "evidence",
      entityId: evidence.id,
      revision: 1,
      now: evidence.recorded_at,
    }),
  ];
}

/** The application's apply tasks waiting in `outcome_unknown`. */
export async function outcomeUnknownTasks(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<Array<{ id: string; revision: number }>> {
  return await queryAll(
    db,
    "SELECT id, revision FROM automation_tasks WHERE user_id = ? AND application_id = ? AND kind = 'apply' AND state = 'outcome_unknown' ORDER BY created_at",
    scope.userId,
    applicationId
  );
}

/**
 * `outcome_unknown → failed` for one task after the user said "not
 * submitted" (21 §12): fenced on the state, logged in change_log.
 */
export function failUnknownTaskStatements(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE automation_tasks SET state = 'failed', error_message = 'Not submitted (confirmed by the user).', finished_at = COALESCE(finished_at, ?), revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'outcome_unknown'",
      now,
      now,
      taskId,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "task",
      table: "automation_tasks",
      id: taskId,
      now,
    }),
  ];
}
