// POST /api/v1/emails/{eml_id}/handed-off (09 §6.1, §9; 05 §13): the CLI
// reports the user's answer after opening the approved message in their own
// mail client.
//
//   sent_confirmed: true   email `handed_off` (sent_at), evidence `email_sent`
//                          verdict `unverified` (we cannot see the mailbox),
//                          submission → submitted_unverified and the card →
//                          applied from saved / preparing / ready, recorded as
//                          the user's act (06 §3, 03 §5.1)
//   sent_confirmed: false  "not sent": the email stays `approved`
//                          (re-sendable), the submission → `failed`
//
// The content must still be the approved content (`payload_hash` of an
// approved approval = the hash now); otherwise `409` and a new approval is
// needed. An email whose approval was decided in the approval queue counts
// as approved.

import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationRecord,
  EmailApplicationRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { ChangeSource } from "@pilihpendidikan/jobs-contracts/enums";
import type { Env } from "../../../env";
import { apiError, invalidTransition } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { planApplicationTransition } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import {
  insertEvidenceStatements,
  updateEmailStatements,
} from "../../repo/email";
import type { EmailContext } from "./shared";
import { actorOf, loadEmailContext, validApproval } from "./shared";

const PREP_STAGES = new Set(["saved", "preparing", "ready"]);

export interface HandOffInput {
  body: { sent_at?: number; sent_confirmed: boolean };
  emailId: string;
  env: Env;
  now: number;
  source: ChangeSource;
}

export interface HandOffBody {
  application: ApplicationRecord;
  email: EmailApplicationRecord;
  evidence: SubmissionEvidenceRecord | null;
}

export interface HandOffPlan {
  body: HandOffBody;
  statements: D1PreparedStatement[];
}

function assertHandOffAllowed(context: EmailContext): void {
  const { email } = context;
  if (email.delivery !== "local_handoff") {
    throw invalidTransition(
      "This email is sent by pilihpendidikan, not handed off.",
      { reason: "server_send" }
    );
  }
  if (email.status === "handed_off" || email.status === "sent") {
    throw apiError(
      "revision_conflict",
      "This email application was already handed off.",
      { details: { reason: "already_delivered", current: email } }
    );
  }
  if (!validApproval(context)) {
    const approvedBefore = context.approvals.some(
      (approval) => approval.state === "approved"
    );
    throw apiError(
      "revision_conflict",
      approvedBefore
        ? "The email changed after it was approved: approve the current content again."
        : "Approve the email before sending it.",
      {
        details: {
          reason: approvedBefore ? "approval_invalidated" : "not_approved",
          payload_hash: context.hash,
          current: email,
        },
      }
    );
  }
}

/** The send time: the reported one, kept within [approval, now]. */
function sentAtOf(
  context: EmailContext,
  reported: number | undefined,
  now: number
): number {
  if (reported === undefined) {
    return now;
  }
  const floor = context.email.approved_at ?? context.email.created_at;
  return Math.min(Math.max(reported, floor), now);
}

/** Plans the hand-off report (one batch). */
export async function planHandOff(
  db: JobsDb,
  scope: UserScope,
  input: HandOffInput
): Promise<HandOffPlan> {
  const context = await loadEmailContext(db, scope, input.env, input.emailId);
  assertHandOffAllowed(context);
  const { email, application } = context;
  const { now } = input;
  const approval = validApproval(context);
  if (!input.body.sent_confirmed) {
    // Not sent: the email stays approved; the submission failed (03 §5.2).
    const statements: D1PreparedStatement[] = [];
    let after = application;
    if (
      application.submission_status === "in_progress" ||
      application.submission_status === "not_started"
    ) {
      const transition = await planApplicationTransition(db, scope, {
        applicationId: email.application_id,
        actor: actorOf(input.source),
        source: input.source,
        now,
        allowDuringSubmission: true,
        submission: { to: "failed" },
      });
      statements.push(...transition.statements);
      after = transition.after;
    }
    return { statements, body: { email, application: after, evidence: null } };
  }
  const sentAt = sentAtOf(context, input.body.sent_at, now);
  const handedOff: EmailApplicationRecord = {
    ...email,
    status: "handed_off",
    approved_at: email.approved_at ?? approval?.decided_at ?? now,
    sent_at: sentAt,
    updated_at: now,
    revision: email.revision + 1,
  };
  const evidence = {
    id: newId("evd", now),
    user_id: scope.userId,
    application_id: email.application_id,
    task_id: null,
    attempt_id: null,
    kind: "email_sent",
    verdict: "unverified",
    signals: {
      method: "local_handoff",
      user_confirmed: true,
      email_application_id: email.id,
    },
    final_url: null,
    page_title: null,
    text_excerpt: null,
    screenshot_file_id: null,
    form_hash: context.hash,
    captured_at: sentAt,
    recorded_at: now,
  } as SubmissionEvidenceRecord;
  const actor = actorOf(input.source);
  const statements: D1PreparedStatement[] = [
    ...updateEmailStatements(db, scope, email, handedOff),
    ...insertEvidenceStatements(db, scope, evidence),
    ...appendEvent(
      db,
      scope,
      {
        applicationId: email.application_id,
        type: "email_sent",
        actorKind: actor,
        occurredAt: sentAt,
        payload: { email_application_id: email.id, message_id: null },
        idempotencyKey: `email:${email.id}:handed_off`,
      },
      now
    ).statements,
  ];
  const moveStage = PREP_STAGES.has(application.stage);
  const confirmUnverified =
    application.submission_status !== "submitted_verified" &&
    application.submission_status !== "submitted_unverified";
  let after = application;
  if (moveStage || confirmUnverified) {
    const transition = await planApplicationTransition(db, scope, {
      applicationId: email.application_id,
      actor,
      source: input.source,
      now,
      occurredAt: sentAt,
      allowDuringSubmission: true,
      stage: moveStage ? { to: "applied", reason: "email_sent" } : undefined,
      submission: confirmUnverified
        ? {
            to: "submitted_unverified",
            evidenceId: evidence.id,
            method: "email",
            submittedAt: sentAt,
          }
        : undefined,
    });
    statements.push(...transition.statements);
    after = transition.after;
  }
  return {
    statements,
    body: { email: handedOff, application: after, evidence },
  };
}
