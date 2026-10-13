// Shared pieces of the email-application flows (09): the loaded context of
// one email, its current content + hash, the approval payload, and the
// helpers that build approval / evidence records and events.

import type {
  ActorKind,
  ChangeSource,
} from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationRecord,
  ApprovalPayload,
  ApprovalRecord,
  EmailApplicationRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { APPROVAL_EXPIRY_MS } from "@pilihpendidikan/jobs-contracts/stage";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { Env } from "../../../env";
import { apiError, notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import { findUserById } from "../../repo/core/users";
import type { EmailFileRow, EmailPostingRow } from "../../repo/email";
import {
  listEmailApprovals,
  loadApplicationPosting,
  loadEmail,
  loadFiles,
} from "../../repo/email";
import type { ContentAttachment, EmailContent } from "./content";
import { ccFor, checkAttachments, emailPayloadHash } from "./content";
import type { RecipientCheck } from "./recipient";
import { checkRecipient } from "./recipient";

/** `approvals.payload` of an email application (09 §4). */
export type EmailSubmitApprovalPayload = Extract<
  ApprovalPayload,
  { type: "email_submit" }
>;

/** Who decided (approvals.decided_via) for a change source. */
export function decidedVia(source: ChangeSource): "web" | "cli" | "mcp" {
  if (source === "cli" || source === "mcp") {
    return source;
  }
  return "web";
}

/** The event actor of a change source (MCP writes as `mcp`, 03 §6). */
export function actorOf(source: ChangeSource): ActorKind {
  return source === "mcp" ? "mcp" : "user";
}

/** The verified account address (users.email; never a typed fact, 09 §6.2). */
export async function accountEmail(
  env: Pick<Env, "DB">,
  scope: UserScope
): Promise<{ createdAt: number; email: string }> {
  const user = await findUserById(env.DB, scope.userId);
  if (!user || user.deleted_at !== null) {
    throw notFound("User not found.");
  }
  return { email: user.email, createdAt: user.created_at };
}

export interface EmailContext {
  account: { createdAt: number; email: string };
  application: ApplicationRecord;
  /** The email's approvals, newest first. */
  approvals: ApprovalRecord[];
  attachments: ContentAttachment[];
  content: EmailContent;
  email: EmailApplicationRecord;
  files: EmailFileRow[];
  /** `payload_hash` of the current content. */
  hash: string;
  posting: EmailPostingRow;
  recipient: RecipientCheck;
}

/**
 * Loads an email with everything its approval binds (404 when missing or
 * not the caller's). The current attachments must still be available
 * (`policy_violation` otherwise).
 */
export async function loadEmailContext(
  db: JobsDb,
  scope: UserScope,
  env: Pick<Env, "DB">,
  emailId: string
): Promise<EmailContext> {
  const email = await loadEmail(db, scope, emailId);
  if (!email) {
    throw notFound("Email application not found.");
  }
  const [application, posting, files, approvals, account] = await Promise.all([
    loadApplication(db, scope, email.application_id),
    loadApplicationPosting(db, scope, email.application_id),
    loadFiles(db, scope, email.attachment_file_ids),
    listEmailApprovals(db, scope, email),
    accountEmail(env, scope),
  ]);
  if (!(application && posting)) {
    throw notFound("Email application not found.");
  }
  const attachments = checkAttachments(email.attachment_file_ids, files);
  const content: EmailContent = {
    to: email.to_address,
    cc: ccFor(email.delivery, account.email),
    subject: email.subject,
    body_text: email.body_text,
    attachments,
  };
  return {
    email,
    application,
    posting,
    files,
    approvals,
    account,
    attachments,
    content,
    hash: await emailPayloadHash(content),
    recipient: checkRecipient(email.to_address, {
      companyDomain: posting.company_domain,
      applyDomain: posting.apply_domain,
    }),
  };
}

/** The approval payload of the content (contracts `EmailSubmitApprovalPayload`). */
export function approvalPayloadOf(
  email: Pick<EmailApplicationRecord, "id">,
  content: EmailContent,
  flags: { aiDrafted: boolean; recipientConfirmed: boolean }
): EmailSubmitApprovalPayload {
  return {
    type: "email_submit",
    email_application_id: email.id,
    to: content.to,
    cc: [...content.cc],
    subject: content.subject,
    body_text: content.body_text,
    attachments: content.attachments.map((attachment) => ({
      file_id: attachment.file_id,
      sha256: attachment.sha256,
      name: attachment.name,
    })),
    ai_drafted: flags.aiDrafted,
    recipient_confirmed: flags.recipientConfirmed,
  };
}

/** The email payload of an approval, or null for another payload type. */
export function emailPayloadOf(
  approval: ApprovalRecord
): EmailSubmitApprovalPayload | null {
  return approval.payload.type === "email_submit" ? approval.payload : null;
}

/** A new `submit` approval for the email content. */
export function newApproval(
  scope: UserScope,
  input: {
    applicationId: string;
    decided: { by: string; via: "web" | "cli" | "mcp" } | null;
    hash: string;
    now: number;
    payload: EmailSubmitApprovalPayload;
  }
): ApprovalRecord {
  return {
    id: newId("apr", input.now),
    user_id: scope.userId,
    kind: "submit",
    task_id: null,
    application_id: input.applicationId,
    payload: input.payload,
    payload_hash: input.hash,
    state: input.decided ? "approved" : "pending",
    response: null,
    decided_via: input.decided?.via ?? null,
    decided_by_user_id: input.decided?.by ?? null,
    decided_at: input.decided ? input.now : null,
    expires_at: input.now + APPROVAL_EXPIRY_MS.submit,
    created_at: input.now,
    revision: 1,
  };
}

/** `approval_requested` / `approval_decided` on the application (03 §6). */
export function approvalEventStatements(
  db: JobsDb,
  scope: UserScope,
  input: {
    actor: ActorKind;
    approval: ApprovalRecord;
    decision?: "approved" | "rejected";
    now: number;
  }
): D1PreparedStatement[] {
  const decided = input.decision !== undefined;
  return appendEvent(
    db,
    scope,
    {
      applicationId: input.approval.application_id as string,
      type: decided ? "approval_decided" : "approval_requested",
      actorKind: input.actor,
      payload: decided
        ? {
            approval_id: input.approval.id,
            kind: "submit",
            decision: input.decision,
          }
        : { approval_id: input.approval.id, kind: "submit" },
      idempotencyKey: `approval:${input.approval.id}:${decided ? "decided" : "requested"}`,
    },
    input.now
  ).statements;
}

/** 409 when the email was already sent or handed off. */
export function assertNotDelivered(email: EmailApplicationRecord): void {
  if (email.status === "sent" || email.status === "handed_off") {
    throw apiError(
      "revision_conflict",
      email.status === "sent"
        ? "This email application was already sent."
        : "This email application was already handed off.",
      { details: { reason: "already_delivered", current: email } }
    );
  }
}

/** The approved approval bound to the current content, if any. */
export function validApproval(context: EmailContext): ApprovalRecord | null {
  return (
    context.approvals.find(
      (approval) =>
        approval.state === "approved" && approval.payload_hash === context.hash
    ) ?? null
  );
}
