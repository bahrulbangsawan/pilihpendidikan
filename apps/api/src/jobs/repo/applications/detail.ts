// Application detail (05 §5): the card with its posting, CV variants,
// interviews, offers, open approvals, tasks, evidence and emails — read in
// one batch (one consistent snapshot), every statement scoped to the user.

import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeRow, runBatch, stmt } from "../core/db";

/** Tasks and evidence rows returned with the detail (newest first). */
export const DETAIL_HISTORY_LIMIT = 50;

export interface DetailRows {
  application: Record<string, unknown> | null;
  approvals: Record<string, unknown>[];
  cvVariants: Record<string, unknown>[];
  emails: Record<string, unknown>[];
  evidence: Record<string, unknown>[];
  interviews: Record<string, unknown>[];
  offers: Record<string, unknown>[];
  posting: Record<string, unknown> | null;
  score: Record<string, unknown> | null;
  tasks: Record<string, unknown>[];
  userJob: Record<string, unknown> | null;
}

function rowsOf(result: D1Result | undefined): Record<string, unknown>[] {
  return (result?.results ?? []) as Record<string, unknown>[];
}

function decodeAll(
  table: string,
  result: D1Result | undefined
): Record<string, unknown>[] {
  return rowsOf(result).map((row) => decodeRow(table, row));
}

function decodeFirst(
  table: string,
  result: D1Result | undefined
): Record<string, unknown> | null {
  const row = rowsOf(result)[0];
  return row ? decodeRow(table, row) : null;
}

/**
 * Everything the detail shows. `profileVersion` selects the score row of
 * that version (null: the newest score of any version).
 */
export async function readDetail(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  profileVersion: number | null
): Promise<DetailRows> {
  const user = scope.userId;
  const versionFilter =
    profileVersion === null ? "" : " AND s.profile_version = ?";
  const versionBinds = profileVersion === null ? [] : [profileVersion];
  const results = await runBatch(db, [
    stmt(
      db,
      "SELECT * FROM applications WHERE id = ? AND user_id = ?",
      applicationId,
      user
    ),
    stmt(
      db,
      "SELECT u.* FROM user_jobs u JOIN applications a ON a.user_job_id = u.id WHERE a.id = ? AND a.user_id = ? AND u.user_id = ?",
      applicationId,
      user,
      user
    ),
    stmt(
      db,
      "SELECT p.* FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id JOIN applications a ON a.user_job_id = u.id WHERE a.id = ? AND a.user_id = ? AND u.user_id = ?",
      applicationId,
      user,
      user
    ),
    stmt(
      db,
      `SELECT s.* FROM match_scores s JOIN user_jobs u ON u.posting_id = s.posting_id AND u.user_id = s.user_id JOIN applications a ON a.user_job_id = u.id WHERE a.id = ? AND a.user_id = ? AND s.user_id = ?${versionFilter} ORDER BY (s.rubric_version = ?) DESC, s.created_at DESC LIMIT 1`,
      applicationId,
      user,
      user,
      ...versionBinds,
      RUBRIC_VERSION
    ),
    stmt(
      db,
      "SELECT * FROM cv_variants WHERE user_id = ? AND application_id = ? ORDER BY created_at DESC, id DESC",
      user,
      applicationId
    ),
    stmt(
      db,
      "SELECT * FROM interviews WHERE user_id = ? AND application_id = ? ORDER BY round, created_at, id",
      user,
      applicationId
    ),
    stmt(
      db,
      "SELECT * FROM offers WHERE user_id = ? AND application_id = ? ORDER BY received_at DESC, id DESC",
      user,
      applicationId
    ),
    stmt(
      db,
      "SELECT * FROM approvals WHERE user_id = ? AND application_id = ? AND state = 'pending' ORDER BY created_at DESC, id DESC",
      user,
      applicationId
    ),
    stmt(
      db,
      "SELECT * FROM automation_tasks WHERE user_id = ? AND application_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      user,
      applicationId,
      DETAIL_HISTORY_LIMIT
    ),
    stmt(
      db,
      "SELECT * FROM submission_evidence WHERE user_id = ? AND application_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ?",
      user,
      applicationId,
      DETAIL_HISTORY_LIMIT
    ),
    stmt(
      db,
      "SELECT * FROM email_applications WHERE user_id = ? AND application_id = ? ORDER BY created_at DESC, id DESC",
      user,
      applicationId
    ),
  ]);
  return {
    application: decodeFirst("applications", results[0]),
    userJob: decodeFirst("user_jobs", results[1]),
    posting: decodeFirst("job_postings", results[2]),
    score: decodeFirst("match_scores", results[3]),
    cvVariants: decodeAll("cv_variants", results[4]),
    interviews: decodeAll("interviews", results[5]),
    offers: decodeAll("offers", results[6]),
    approvals: decodeAll("approvals", results[7]),
    tasks: decodeAll("automation_tasks", results[8]),
    evidence: decodeAll("submission_evidence", results[9]),
    emails: decodeAll("email_applications", results[10]),
  };
}
