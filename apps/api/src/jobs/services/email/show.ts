// GET /api/v1/emails/{eml_id} — one email application with the approval that
// binds its current content and the `payload_hash` an approve call must echo
// (`pilih-jobs email show`, 09 §10). Not the caller's → 404.

import type {
  ApprovalRecord,
  EmailApplicationRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import { ApiError, notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { listEmailApprovals, loadEmail, loadFiles } from "../../repo/email";
import { ccFor, checkAttachments, emailPayloadHash } from "./content";
import { accountEmail } from "./shared";

export interface EmailDetail {
  /**
   * The approval of the current content (approved or pending), else the
   * newest submit approval of this email, else null.
   */
  approval: ApprovalRecord | null;
  email: EmailApplicationRecord;
  /** Hash of the current content; null when an attachment is gone. */
  payload_hash: string | null;
}

/** The current content's hash, or null when an attachment is unavailable. */
async function currentHash(
  db: JobsDb,
  scope: UserScope,
  env: Pick<Env, "DB">,
  email: EmailApplicationRecord
): Promise<string | null> {
  const [files, account] = await Promise.all([
    loadFiles(db, scope, email.attachment_file_ids),
    accountEmail(env, scope),
  ]);
  try {
    const attachments = checkAttachments(email.attachment_file_ids, files);
    return await emailPayloadHash({
      to: email.to_address,
      cc: ccFor(email.delivery, account.email),
      subject: email.subject,
      body_text: email.body_text,
      attachments,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return null;
    }
    throw error;
  }
}

export async function getEmailDetail(
  db: JobsDb,
  scope: UserScope,
  env: Pick<Env, "DB">,
  emailId: string
): Promise<EmailDetail> {
  const email = await loadEmail(db, scope, emailId);
  if (!email) {
    throw notFound("Email application not found.");
  }
  const [approvals, hash] = await Promise.all([
    listEmailApprovals(db, scope, email),
    currentHash(db, scope, env, email),
  ]);
  const current = approvals.find(
    (approval) =>
      approval.payload_hash === hash &&
      (approval.state === "approved" || approval.state === "pending")
  );
  return {
    email,
    approval: current ?? approvals[0] ?? null,
    payload_hash: hash,
  };
}
