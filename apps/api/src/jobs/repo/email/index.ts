// Email applications (04 §2.5, 09): `email_applications` rows, their `submit`
// approvals (03 §8, payload type `email_submit`), the `email_sent` evidence
// and the counts behind the server_send limits (09 §8). Every statement is
// user-scoped (04 §5); writes come with their change_log rows.

import type {
  ApprovalRecord,
  EmailApplicationRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import { appendChange } from "../core/change-log";
import type { JobsDb } from "../core/db";
import {
  decodeRow,
  encodeJson,
  guard,
  guardRevision,
  queryAll,
  queryFirst,
  runBatch,
  stmt,
} from "../core/db";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadEmail(
  db: JobsDb,
  scope: UserScope,
  emailId: string
): Promise<EmailApplicationRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM email_applications WHERE id = ? AND user_id = ?",
    emailId,
    scope.userId
  );
  return row
    ? decodeRow<EmailApplicationRecord>("email_applications", row)
    : null;
}

/** The posting fields an email application needs (09 §1, §5.1). */
export interface EmailPostingRow {
  application_support: string;
  apply_domain: string | null;
  apply_url: string | null;
  company_domain: string | null;
  company_name: string;
  description_text: string;
  extraction: string | null;
  id: string;
  source_job_ref: string | null;
  title: string;
}

export async function loadApplicationPosting(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<EmailPostingRow | null> {
  return await queryFirst<EmailPostingRow>(
    db,
    "SELECT p.id, p.title, p.company_name, p.company_domain, p.apply_domain, p.apply_url, p.source_job_ref, p.description_text, p.extraction, p.application_support FROM applications a JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id JOIN job_postings p ON p.id = u.posting_id WHERE a.id = ? AND a.user_id = ?",
    applicationId,
    scope.userId
  );
}

export interface EmailVariantRow {
  base_cv_id: string;
  file_id: string | null;
  id: string;
  status: string;
  tailored_cv_id: string | null;
}

export async function loadCvVariant(
  db: JobsDb,
  scope: UserScope,
  variantId: string
): Promise<EmailVariantRow | null> {
  return await queryFirst<EmailVariantRow>(
    db,
    "SELECT id, status, file_id, tailored_cv_id, base_cv_id FROM cv_variants WHERE id = ? AND user_id = ?",
    variantId,
    scope.userId
  );
}

export interface EmailFileRow {
  content_type: string;
  id: string;
  kind: string;
  original_name: string | null;
  r2_key: string;
  sha256: string;
  size_bytes: number;
  status: string;
}

/** The user's file rows among `ids` (others' files are simply absent). */
export async function loadFiles(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[]
): Promise<EmailFileRow[]> {
  if (ids.length === 0) {
    return [];
  }
  return await queryAll<EmailFileRow>(
    db,
    "SELECT id, kind, r2_key, content_type, size_bytes, sha256, original_name, status FROM files WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))",
    scope.userId,
    JSON.stringify(ids)
  );
}

/** Applicant facts by key (values parsed). */
export async function loadFacts(
  db: JobsDb,
  scope: UserScope,
  keys: readonly string[]
): Promise<Map<string, unknown>> {
  const rows = await queryAll<{ key: string; value: string }>(
    db,
    "SELECT key, value FROM applicant_facts WHERE user_id = ? AND key IN (SELECT value FROM json_each(?))",
    scope.userId,
    JSON.stringify(keys)
  );
  const out = new Map<string, unknown>();
  for (const row of rows) {
    try {
      out.set(row.key, JSON.parse(row.value));
    } catch {
      out.set(row.key, row.value);
    }
  }
  return out;
}

/** The `submit` approvals of one email application, newest first. */
export async function listEmailApprovals(
  db: JobsDb,
  scope: UserScope,
  email: Pick<EmailApplicationRecord, "application_id" | "id">
): Promise<ApprovalRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM approvals WHERE user_id = ? AND application_id = ? AND kind = 'submit' AND json_extract(payload, '$.type') = 'email_submit' AND json_extract(payload, '$.email_application_id') = ? ORDER BY created_at DESC, rowid DESC",
    scope.userId,
    email.application_id,
    email.id
  );
  return rows.map((row) => decodeRow<ApprovalRecord>("approvals", row));
}

/** Pending email approvals of OTHER drafts of the application (superseded). */
export async function listSupersededApprovals(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<ApprovalRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM approvals WHERE user_id = ? AND application_id = ? AND kind = 'submit' AND state = 'pending' AND json_extract(payload, '$.type') = 'email_submit'",
    scope.userId,
    applicationId
  );
  return rows.map((row) => decodeRow<ApprovalRecord>("approvals", row));
}

/** Recipient addresses and send times of the user's sent emails since `since`. */
export async function listSentSince(
  db: JobsDb,
  scope: UserScope,
  since: number
): Promise<Array<{ sent_at: number; to_address: string }>> {
  return await queryAll(
    db,
    "SELECT to_address, sent_at FROM email_applications WHERE user_id = ? AND status = 'sent' AND sent_at >= ?",
    scope.userId,
    since
  );
}

// ---------------------------------------------------------------------------
// Writes (statements for one batch)
// ---------------------------------------------------------------------------

export function insertEmailStatements(
  db: JobsDb,
  scope: UserScope,
  email: EmailApplicationRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO email_applications (id, user_id, application_id, to_address, subject, body_text, attachment_file_ids, delivery, status, provider_message_id, approved_at, sent_at, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      email.id,
      scope.userId,
      email.application_id,
      email.to_address,
      email.subject,
      email.body_text,
      encodeJson(email.attachment_file_ids),
      email.delivery,
      email.status,
      email.provider_message_id,
      email.approved_at,
      email.sent_at,
      email.revision,
      email.created_at,
      email.updated_at
    ),
    appendChange(db, scope, {
      entity: "email",
      entityId: email.id,
      revision: email.revision,
      now: email.created_at,
    }),
  ];
}

/**
 * Moves an email row from `before.revision` to `after` (status, provider id,
 * approval and send times): revision guard, UPDATE, change_log.
 */
export function updateEmailStatements(
  db: JobsDb,
  scope: UserScope,
  before: Pick<EmailApplicationRecord, "id" | "revision">,
  after: EmailApplicationRecord
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "email_applications", before.id, before.revision),
    stmt(
      db,
      "UPDATE email_applications SET status = ?, provider_message_id = ?, approved_at = ?, sent_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?",
      after.status,
      after.provider_message_id,
      after.approved_at,
      after.sent_at,
      after.updated_at,
      before.id,
      scope.userId,
      before.revision
    ),
    appendChange(db, scope, {
      entity: "email",
      entityId: before.id,
      revision: before.revision + 1,
      now: after.updated_at,
    }),
  ];
}

export function insertApprovalStatements(
  db: JobsDb,
  scope: UserScope,
  approval: ApprovalRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO approvals (id, user_id, kind, task_id, application_id, payload, payload_hash, state, response, decided_via, decided_by_user_id, decided_at, expires_at, created_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      approval.id,
      scope.userId,
      approval.kind,
      approval.task_id,
      approval.application_id,
      encodeJson(approval.payload),
      approval.payload_hash,
      approval.state,
      approval.response === null ? null : encodeJson(approval.response),
      approval.decided_via,
      approval.decided_by_user_id,
      approval.decided_at,
      approval.expires_at,
      approval.created_at,
      approval.revision
    ),
    appendChange(db, scope, {
      entity: "approval",
      entityId: approval.id,
      revision: approval.revision,
      now: approval.created_at,
    }),
  ];
}

/**
 * Decides a pending approval as `after` (first decision wins: the guard
 * aborts the batch when it is no longer pending at `before.revision`).
 */
export function decideApprovalStatements(
  db: JobsDb,
  scope: UserScope,
  before: ApprovalRecord,
  after: ApprovalRecord
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `approval-pending:${before.id}`,
      "SELECT 1 FROM approvals WHERE id = ? AND user_id = ? AND state = 'pending' AND revision = ?",
      before.id,
      scope.userId,
      before.revision
    ),
    stmt(
      db,
      "UPDATE approvals SET state = ?, payload = ?, decided_via = ?, decided_by_user_id = ?, decided_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND state = 'pending'",
      after.state,
      encodeJson(after.payload),
      after.decided_via,
      after.decided_by_user_id,
      after.decided_at,
      before.id,
      scope.userId
    ),
    appendChange(db, scope, {
      entity: "approval",
      entityId: before.id,
      revision: before.revision + 1,
      now: after.decided_at ?? before.created_at,
    }),
  ];
}

/** Expires pending approvals (superseded drafts). */
export function expireApprovalStatements(
  db: JobsDb,
  scope: UserScope,
  approvals: readonly ApprovalRecord[],
  now: number
): D1PreparedStatement[] {
  return approvals.flatMap((approval) => [
    stmt(
      db,
      "UPDATE approvals SET state = 'expired', revision = revision + 1 WHERE id = ? AND user_id = ? AND state = 'pending'",
      approval.id,
      scope.userId
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'approval', id, revision, 'upsert', ? FROM approvals WHERE id = ? AND user_id = ? AND state = 'expired' AND revision = ?",
      now,
      approval.id,
      scope.userId,
      approval.revision + 1
    ),
  ]);
}

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

/**
 * Runs one batch of email statements outside `c.commit` (the server_send
 * claim before the provider call, and the record after it).
 */
export async function runEmailBatch(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  await runBatch(db, statements);
}
