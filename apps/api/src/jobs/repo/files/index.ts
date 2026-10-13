// `files` rows (04 §2.5, 14 §5): the only SQL of the files area.
//
// Lifecycle: an upload inserts a `pending` row before streaming to R2, then
// flips it to `ready` (with its links) in the request's single commit batch;
// a failed upload removes the pending row again. DELETE marks a row
// `deleted`; the R2 object goes when nothing references it any more. The
// daily retention cron (cron/handlers/file-retention.ts) scans with system
// statements and acts per user with a trusted scope.
//
// "Referenced" (14 §5.4) = a live CV variant (generating / draft / approved),
// an email application attachment, an attempt's step log or a submission
// evidence screenshot points at the file.

import type {
  FileKind,
  FileStatus,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { FileView } from "@pilihpendidikan/jobs-contracts/api";
import { notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { appendChange } from "../core/change-log";
import type { JobsDb } from "../core/db";
import { guard, queryAll, queryFirst, runBatch, stmt } from "../core/db";

export interface FileRow {
  content_type: string;
  created_at: number;
  id: string;
  kind: FileKind;
  original_name: string | null;
  r2_key: string;
  retention_until: number | null;
  sha256: string;
  size_bytes: number;
  status: FileStatus;
  user_id: string;
}

const FILE_COLUMNS =
  "id, user_id, kind, r2_key, content_type, size_bytes, sha256, original_name, status, retention_until, created_at";

/** The API view of a row: everything but the R2 key (FileViewSchema). */
export function toFileView(row: FileRow): FileView {
  return {
    id: row.id,
    user_id: row.user_id,
    kind: row.kind,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    original_name: row.original_name,
    status: row.status,
    retention_until: row.retention_until,
    created_at: row.created_at,
  } as FileView;
}

/** The user's file row, or null (not owned = not found). */
export async function loadFile(
  db: JobsDb,
  scope: UserScope,
  fileId: string
): Promise<FileRow | null> {
  return await queryFirst<FileRow>(
    db,
    `SELECT ${FILE_COLUMNS} FROM files WHERE id = ? AND user_id = ?`,
    fileId,
    scope.userId
  );
}

export interface PendingFile {
  contentType: string;
  id: string;
  kind: FileKind;
  now: number;
  originalName: string | null;
  r2Key: string;
  sha256: string;
  sizeBytes: number;
}

/** 14 §5.2 step 3: the `pending` row, written before any byte reaches R2. */
export async function insertPendingFile(
  db: JobsDb,
  scope: UserScope,
  file: PendingFile
): Promise<void> {
  await runBatch(db, [
    stmt(
      db,
      "INSERT INTO files (id, user_id, kind, r2_key, content_type, size_bytes, sha256, original_name, status, retention_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)",
      file.id,
      scope.userId,
      file.kind,
      file.r2Key,
      file.contentType,
      file.sizeBytes,
      file.sha256,
      file.originalName,
      file.now
    ),
  ]);
}

/** Drops a pending row after a failed upload (never a ready one). */
export async function discardPendingFile(
  db: JobsDb,
  scope: UserScope,
  fileId: string
): Promise<void> {
  await runBatch(db, [
    stmt(
      db,
      "DELETE FROM files WHERE id = ? AND user_id = ? AND status = 'pending'",
      fileId,
      scope.userId
    ),
  ]);
}

/**
 * 14 §5.2 step 7: pending → ready (+ change_log). Guarded: a row that is no
 * longer pending aborts the whole batch.
 */
export function markFileReadyStatements(
  db: JobsDb,
  scope: UserScope,
  file: { id: string; now: number; retentionUntil: number | null }
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `file_pending:${file.id}`,
      "SELECT 1 FROM files WHERE id = ? AND user_id = ? AND status = 'pending'",
      file.id,
      scope.userId
    ),
    stmt(
      db,
      "UPDATE files SET status = 'ready', retention_until = ? WHERE id = ? AND user_id = ? AND status = 'pending'",
      file.retentionUntil,
      file.id,
      scope.userId
    ),
    appendChange(db, scope, {
      entity: "file",
      entityId: file.id,
      revision: 1,
      now: file.now,
    }),
  ];
}

/** Sets `retention_until` of one of the user's files (null = keep while referenced). */
export function setFileRetentionStatement(
  db: JobsDb,
  scope: UserScope,
  fileId: string,
  retentionUntil: number | null
): D1PreparedStatement {
  return stmt(
    db,
    "UPDATE files SET retention_until = ? WHERE id = ? AND user_id = ? AND status = 'ready'",
    retentionUntil,
    fileId,
    scope.userId
  );
}

/** ready/pending → deleted (+ change_log op delete). */
export function markFileDeletedStatements(
  db: JobsDb,
  scope: UserScope,
  fileId: string,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE files SET status = 'deleted', retention_until = NULL WHERE id = ? AND user_id = ? AND status != 'deleted'",
      fileId,
      scope.userId
    ),
    appendChange(db, scope, {
      entity: "file",
      entityId: fileId,
      revision: 1,
      op: "delete",
      now,
    }),
  ];
}

/** Removes a purged row (its R2 object is gone; nothing references it). */
export function removeFileRowStatement(
  db: JobsDb,
  scope: UserScope,
  fileId: string
): D1PreparedStatement {
  return stmt(
    db,
    "DELETE FROM files WHERE id = ? AND user_id = ? AND status = 'deleted'",
    fileId,
    scope.userId
  );
}

/** True when a live record still points at the file (14 §5.4). */
export async function fileReferenced(
  db: JobsDb,
  scope: UserScope,
  fileId: string
): Promise<boolean> {
  const row = await queryFirst<{ referenced: number }>(
    db,
    `SELECT (
       EXISTS (SELECT 1 FROM cv_variants WHERE user_id = ? AND file_id = ? AND status IN ('generating', 'draft', 'approved'))
       OR EXISTS (SELECT 1 FROM email_applications AS e, json_each(e.attachment_file_ids) AS j WHERE e.user_id = ? AND j.value = ?)
       OR EXISTS (SELECT 1 FROM automation_attempts WHERE user_id = ? AND log_file_id = ?)
       OR EXISTS (SELECT 1 FROM submission_evidence WHERE user_id = ? AND screenshot_file_id = ?)
     ) AS referenced`,
    scope.userId,
    fileId,
    scope.userId,
    fileId,
    scope.userId,
    fileId,
    scope.userId,
    fileId
  );
  return (row?.referenced ?? 0) === 1;
}

export interface UploadLinks {
  application_id?: string;
  attempt_id?: string;
  email_application_id?: string;
}

/**
 * The upload's link targets must be the caller's own rows (11 §6.1 rule 5):
 * any miss is `404 not_found`, exactly like a missing id.
 */
export async function assertLinkTargetsOwned(
  db: JobsDb,
  scope: UserScope,
  links: UploadLinks
): Promise<void> {
  const checks: [string | undefined, string][] = [
    [
      links.application_id,
      "SELECT 1 AS hit FROM applications WHERE id = ? AND user_id = ?",
    ],
    [
      links.attempt_id,
      "SELECT 1 AS hit FROM automation_attempts WHERE id = ? AND user_id = ?",
    ],
    [
      links.email_application_id,
      "SELECT 1 AS hit FROM email_applications WHERE id = ? AND user_id = ?",
    ],
  ];
  for (const [id, sql] of checks) {
    if (id !== undefined) {
      const hit = await queryFirst<{ hit: number }>(db, sql, id, scope.userId);
      if (!hit) {
        throw notFound("A linked record was not found.");
      }
    }
  }
}

/** Runs one batch of files-area statements (services, cron). */
export async function commitFileStatements(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  await runBatch(db, statements);
}

// ---------------------------------------------------------------------------
// Retention scans (cron, 14 §5.4). System statements across users; every
// action afterwards runs with the row owner's trusted scope.
// ---------------------------------------------------------------------------

export interface RetentionRow {
  id: string;
  kind: FileKind;
  r2_key: string;
  retention_until: number | null;
  status: FileStatus;
  user_id: string;
}

const RETENTION_COLUMNS = "id, user_id, kind, r2_key, status, retention_until";

/** `pending` uploads older than `before` (abandoned, 14 §5.4). */
export async function listAbandonedUploads(
  db: JobsDb,
  options: { afterId: string; before: number; limit: number }
): Promise<RetentionRow[]> {
  // sql-allow: system — the retention cron scans every user's abandoned uploads
  const sql = `SELECT ${RETENTION_COLUMNS} FROM files WHERE status = 'pending' AND created_at < ? AND id > ? ORDER BY id LIMIT ?`;
  return await queryAll<RetentionRow>(
    db,
    sql,
    options.before,
    options.afterId,
    options.limit
  );
}

/** Ready files whose `retention_until` has passed. */
export async function listExpiredFiles(
  db: JobsDb,
  options: { afterId: string; limit: number; now: number }
): Promise<RetentionRow[]> {
  // sql-allow: system — the retention cron scans every user's expired files
  const sql = `SELECT ${RETENTION_COLUMNS} FROM files WHERE status = 'ready' AND retention_until IS NOT NULL AND retention_until < ? AND id > ? ORDER BY id LIMIT ?`;
  return await queryAll<RetentionRow>(
    db,
    sql,
    options.now,
    options.afterId,
    options.limit
  );
}

/**
 * Ready CV PDFs, letters and attachments kept "while referenced" (NULL
 * retention) that nothing references any more: their 30-day clock starts.
 */
export async function listOrphanCandidates(
  db: JobsDb,
  options: { afterId: string; limit: number }
): Promise<RetentionRow[]> {
  // sql-allow: system — the retention cron finds unreferenced files across users
  const sql = `SELECT ${RETENTION_COLUMNS} FROM files AS f WHERE f.status = 'ready' AND f.retention_until IS NULL AND f.kind IN ('cv_pdf', 'cover_letter', 'attachment') AND f.id > ?
     AND NOT EXISTS (SELECT 1 FROM cv_variants AS v WHERE v.user_id = f.user_id AND v.file_id = f.id AND v.status IN ('generating', 'draft', 'approved'))
     AND NOT EXISTS (SELECT 1 FROM email_applications AS e, json_each(e.attachment_file_ids) AS j WHERE e.user_id = f.user_id AND j.value = f.id)
     AND NOT EXISTS (SELECT 1 FROM automation_attempts AS a WHERE a.user_id = f.user_id AND a.log_file_id = f.id)
     AND NOT EXISTS (SELECT 1 FROM submission_evidence AS s WHERE s.user_id = f.user_id AND s.screenshot_file_id = f.id)
     ORDER BY f.id LIMIT ?`;
  return await queryAll<RetentionRow>(db, sql, options.afterId, options.limit);
}

/** Rows marked `deleted` whose R2 object may still exist. */
export async function listDeletedFiles(
  db: JobsDb,
  options: { afterId: string; limit: number }
): Promise<RetentionRow[]> {
  // sql-allow: system — the retention cron purges deleted files across users
  const sql = `SELECT ${RETENTION_COLUMNS} FROM files WHERE status = 'deleted' AND id > ? ORDER BY id LIMIT ?`;
  return await queryAll<RetentionRow>(db, sql, options.afterId, options.limit);
}
