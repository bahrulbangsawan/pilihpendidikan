// POST /api/v1/emails/{eml_id}/approve (09 §4, §6; 05 §13). Needs
// `automation:manage` (web session or interactive CLI step-up); MCP clients
// can draft but never approve (06 §11).
//
// The request carries the `payload_hash` of the content the user reviewed;
// it must equal the hash of the email as stored now (recipient, Cc, subject,
// body, attachment SHA-256s) — otherwise `409 revision_conflict` with the
// current email and hash: any edit after review needs a new approval. The
// recipient tick (09 §1) comes from this request or the draft.
//
//   local_handoff  the `submit` approval is decided (or created) approved,
//                  the email becomes `approved` (released to the CLI) and the
//                  application's submission moves to `in_progress`
//   server_send    behind JOBS_EMAIL_SERVER_SEND_ENABLED: limits, R2
//                  attachments re-hashed, the email row claimed, ONE provider
//                  call, then ONE batch: email `sent` + approval + evidence
//                  `email_sent` (verified = the provider accepted it) +
//                  submitted_verified + → applied (actor user) + events. A
//                  provider failure records `failed` (submission `failed`, no
//                  stage change); retrying needs no new approval while the
//                  content is unchanged.

import type {
  ChangeSource,
  SubmissionStatus,
} from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationRecord,
  ApprovalRecord,
  EmailApplicationRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import type { FeatureFlags } from "../../core/flags";
import { apiError, invalidTransition } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { TransitionPlan } from "../../repo/core/application-state";
import {
  liveSubmitIntentTask,
  planApplicationTransition,
} from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { GuardFailedError } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import {
  decideApprovalStatements,
  expireApprovalStatements,
  insertApprovalStatements,
  insertEvidenceStatements,
  loadFacts,
  runEmailBatch,
  updateEmailStatements,
} from "../../repo/email";
import { recipientAccepted } from "./recipient";
import {
  assertSendAllowed,
  buildServerMessage,
  loadVerifiedAttachments,
  sendThroughProvider,
} from "./send";
import type { EmailContext } from "./shared";
import {
  approvalEventStatements,
  approvalPayloadOf,
  assertNotDelivered,
  decidedVia,
  emailPayloadOf,
  loadEmailContext,
  newApproval,
} from "./shared";

const PREP_STAGES = new Set(["saved", "preparing", "ready"]);
/** Submission statuses an approval (re)starts from (03 §5.2). */
const RESTARTABLE = new Set<SubmissionStatus>([
  "not_started",
  "failed",
  "outcome_unknown",
]);
const SUBMITTED = new Set<SubmissionStatus>([
  "submitted_verified",
  "submitted_unverified",
]);
const FINAL_COMMIT_TRIES = 3;

export interface ApproveBody {
  payload_hash: string;
  recipient_confirmed?: boolean;
}

export interface ApproveInput {
  body: ApproveBody;
  emailId: string;
  env: Env;
  flags: FeatureFlags;
  /** Statements recording the response under the request's Idempotency-Key. */
  idempotency: (status: number, body: unknown) => D1PreparedStatement[];
  now: number;
  source: ChangeSource;
}

export interface ApproveBodyOut {
  application: ApplicationRecord;
  approval: ApprovalRecord;
  /** server_send only: whether the provider accepted the message. */
  delivery?: { error?: string; ok: boolean };
  email: EmailApplicationRecord;
  evidence: SubmissionEvidenceRecord | null;
}

/** `committed: false` → commit `statements`; true → already recorded. */
export type ApproveResult =
  | {
      body: ApproveBodyOut;
      committed: false;
      statements: D1PreparedStatement[];
    }
  | { body: ApproveBodyOut; committed: true };

/** 409 unless the reviewed hash is the hash of the email as stored now. */
export function assertReviewedHash(
  context: EmailContext,
  reviewed: string
): void {
  if (reviewed !== context.hash) {
    throw apiError(
      "revision_conflict",
      "The email changed since you reviewed it: review it again and approve the current content.",
      {
        details: {
          reason: "payload_hash_mismatch",
          payload_hash: context.hash,
          current: context.email,
        },
      }
    );
  }
}

/** The recipient tick recorded with the draft (same recipient only). */
function draftTick(context: EmailContext): boolean {
  return context.approvals.some((approval) => {
    const payload = emailPayloadOf(approval);
    return (
      payload !== null &&
      payload.to === context.content.to &&
      payload.recipient_confirmed
    );
  });
}

function aiDrafted(context: EmailContext): boolean {
  const latest = context.approvals.map(emailPayloadOf).find((p) => p !== null);
  return latest?.ai_drafted ?? false;
}

/** 422 unless the recipient is the employer's or the user ticked it (09 §1). */
export function assertRecipientConfirmed(
  context: EmailContext,
  tick: boolean | undefined
): boolean {
  const confirmed = tick ?? draftTick(context);
  if (!recipientAccepted(context.recipient, confirmed)) {
    throw apiError(
      "policy_violation",
      context.recipient.freeMail
        ? "Free-mail addresses need your confirmation that they belong to the employer (recruiter scams use them)."
        : "Confirm that this address belongs to the employer: its domain does not match the posting.",
      {
        details: {
          reason: "recipient_unconfirmed",
          free_mail: context.recipient.freeMail,
          employer_domains: context.recipient.employerDomains,
          domain: context.recipient.domain,
        },
      }
    );
  }
  return context.recipient.confirmationRequired ? true : confirmed;
}

async function assertNoBrowserSubmission(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<void> {
  const inFlight = await liveSubmitIntentTask(db, scope, applicationId);
  if (inFlight) {
    throw invalidTransition(
      "A browser submission for this application is in flight.",
      { reason: "submission_in_flight", task_id: inFlight.id }
    );
  }
}

interface ApprovalPlan {
  approval: ApprovalRecord;
  statements: D1PreparedStatement[];
}

/**
 * The approval of the current content: an approved one is reused, a pending
 * one decided, otherwise a new one is recorded approved. Other pending
 * approvals of this email (older content) are expired.
 */
export function planApproval(
  db: JobsDb,
  scope: UserScope,
  context: EmailContext,
  input: { confirmed: boolean; now: number; source: ChangeSource }
): ApprovalPlan {
  const { now } = input;
  const stale = context.approvals.filter(
    (approval) =>
      approval.state === "pending" && approval.payload_hash !== context.hash
  );
  const statements = expireApprovalStatements(db, scope, stale, now);
  const approved = context.approvals.find(
    (approval) =>
      approval.state === "approved" && approval.payload_hash === context.hash
  );
  if (approved) {
    return { approval: approved, statements };
  }
  const payload = approvalPayloadOf(context.email, context.content, {
    aiDrafted: aiDrafted(context),
    recipientConfirmed: input.confirmed,
  });
  const decided = { by: scope.userId, via: decidedVia(input.source) };
  const pending = context.approvals.find(
    (approval) =>
      approval.state === "pending" &&
      approval.payload_hash === context.hash &&
      approval.expires_at > now
  );
  let approval: ApprovalRecord;
  if (pending) {
    approval = {
      ...pending,
      payload,
      state: "approved",
      decided_via: decided.via,
      decided_by_user_id: decided.by,
      decided_at: now,
      revision: pending.revision + 1,
    };
    statements.push(...decideApprovalStatements(db, scope, pending, approval));
  } else {
    approval = newApproval(scope, {
      applicationId: context.email.application_id,
      decided,
      hash: context.hash,
      now,
      payload,
    });
    statements.push(...insertApprovalStatements(db, scope, approval));
  }
  statements.push(
    ...approvalEventStatements(db, scope, {
      actor: "user",
      approval,
      decision: "approved",
      now,
    })
  );
  return { approval, statements };
}

/**
 * local_handoff approval effects: email `approved`, submission
 * `in_progress` (from not_started / failed / outcome_unknown).
 */
export async function planLocalApproval(
  db: JobsDb,
  scope: UserScope,
  context: EmailContext,
  input: { approval: ApprovalPlan; now: number; source: ChangeSource }
): Promise<{ body: ApproveBodyOut; statements: D1PreparedStatement[] }> {
  const { email } = context;
  const { now } = input;
  const statements = [...input.approval.statements];
  let after = email;
  if (email.status !== "approved") {
    after = {
      ...email,
      status: "approved",
      approved_at: now,
      updated_at: now,
      revision: email.revision + 1,
    };
    statements.push(...updateEmailStatements(db, scope, email, after));
  }
  let application = context.application;
  if (RESTARTABLE.has(context.application.submission_status)) {
    const transition = await planApplicationTransition(db, scope, {
      applicationId: email.application_id,
      actor: "user",
      source: input.source,
      now,
      submission: { to: "in_progress" },
    });
    statements.push(...transition.statements);
    application = transition.after;
  }
  return {
    statements,
    body: {
      email: after,
      approval: input.approval.approval,
      application,
      evidence: null,
    },
  };
}

/** Plans POST …/approve; server_send sends and records it itself. */
export async function approveEmail(
  db: JobsDb,
  scope: UserScope,
  input: ApproveInput
): Promise<ApproveResult> {
  const context = await loadEmailContext(db, scope, input.env, input.emailId);
  assertNotDelivered(context.email);
  assertReviewedHash(context, input.body.payload_hash);
  const confirmed = assertRecipientConfirmed(
    context,
    input.body.recipient_confirmed
  );
  await assertNoBrowserSubmission(db, scope, context.email.application_id);
  if (context.email.delivery === "server_send") {
    return await serverSend(db, scope, context, { ...input, confirmed });
  }
  const approval = planApproval(db, scope, context, {
    confirmed,
    now: input.now,
    source: input.source,
  });
  const planned = await planLocalApproval(db, scope, context, {
    approval,
    now: input.now,
    source: input.source,
  });
  return { committed: false, ...planned };
}

// ---------------------------------------------------------------------------
// server_send
// ---------------------------------------------------------------------------

function submissionAfterSend(
  current: SubmissionStatus,
  ok: boolean
): SubmissionStatus | null {
  if (ok) {
    return current === "submitted_verified" ? null : "submitted_verified";
  }
  return SUBMITTED.has(current) ? null : "failed";
}

type SendResult = Awaited<ReturnType<typeof sendThroughProvider>>;

/** Evidence + `email_sent` event of an accepted message (09 §6.2). */
function sentEvidence(
  db: JobsDb,
  scope: UserScope,
  input: {
    email: EmailApplicationRecord;
    hash: string;
    messageId: string;
    now: number;
  }
): { evidence: SubmissionEvidenceRecord; statements: D1PreparedStatement[] } {
  const { email, now } = input;
  const evidence = {
    id: newId("evd", now),
    user_id: scope.userId,
    application_id: email.application_id,
    task_id: null,
    attempt_id: null,
    kind: "email_sent",
    verdict: "verified",
    signals: {
      method: "server_send",
      provider_accepted: true,
      message_id: input.messageId,
    },
    final_url: null,
    page_title: null,
    text_excerpt: null,
    screenshot_file_id: null,
    form_hash: input.hash,
    captured_at: now,
    recorded_at: now,
  } as SubmissionEvidenceRecord;
  return {
    evidence,
    statements: [
      ...insertEvidenceStatements(db, scope, evidence),
      ...appendEvent(
        db,
        scope,
        {
          applicationId: email.application_id,
          type: "email_sent",
          actorKind: "system",
          payload: {
            email_application_id: email.id,
            message_id: input.messageId,
          },
          idempotencyKey: `email:${email.id}:sent`,
        },
        now
      ).statements,
    ],
  };
}

/** The application effects of a send: applied + submitted_verified, or failed. */
async function sendTransition(
  db: JobsDb,
  scope: UserScope,
  input: {
    application: ApplicationRecord;
    evidenceId: string | null;
    now: number;
    ok: boolean;
    source: ChangeSource;
  }
): Promise<TransitionPlan | null> {
  const { ok, now } = input;
  const target = submissionAfterSend(input.application.submission_status, ok);
  const moveStage = ok && PREP_STAGES.has(input.application.stage);
  if (!(target || moveStage)) {
    return null;
  }
  return await planApplicationTransition(db, scope, {
    applicationId: input.application.id,
    actor: "user",
    source: input.source,
    now,
    allowDuringSubmission: true,
    stage: moveStage ? { to: "applied", reason: "email_sent" } : undefined,
    submission: target
      ? {
          to: target,
          evidenceId: input.evidenceId,
          method: ok ? "email" : null,
          submittedAt: ok ? now : null,
        }
      : undefined,
  });
}

/** Plans the record of one send (re-read: approvals and the application may move). */
async function planSendRecord(
  db: JobsDb,
  scope: UserScope,
  context: EmailContext,
  input: ApproveInput & {
    claimed: EmailApplicationRecord;
    confirmed: boolean;
    outcome: SendResult;
  }
): Promise<{ body: ApproveBodyOut; statements: D1PreparedStatement[] }> {
  const { now, outcome, claimed } = input;
  const fresh = await loadEmailContext(db, scope, input.env, input.emailId);
  const approval = planApproval(db, scope, fresh, {
    confirmed: input.confirmed,
    now,
    source: input.source,
  });
  const after: EmailApplicationRecord = {
    ...claimed,
    status: outcome.ok ? "sent" : "failed",
    provider_message_id: outcome.ok ? outcome.messageId : null,
    sent_at: outcome.ok ? now : null,
    updated_at: now,
    revision: claimed.revision + 1,
  };
  const statements = [
    ...approval.statements,
    ...updateEmailStatements(db, scope, claimed, after),
  ];
  const sent = outcome.ok
    ? sentEvidence(db, scope, {
        email: claimed,
        hash: context.hash,
        messageId: outcome.messageId,
        now,
      })
    : null;
  statements.push(...(sent?.statements ?? []));
  const transition = await sendTransition(db, scope, {
    application: fresh.application,
    evidenceId: sent?.evidence.id ?? null,
    now,
    ok: outcome.ok,
    source: input.source,
  });
  statements.push(...(transition?.statements ?? []));
  return {
    statements,
    body: {
      email: after,
      approval: approval.approval,
      application: transition?.after ?? fresh.application,
      evidence: sent?.evidence ?? null,
      delivery: outcome.ok ? { ok: true } : { ok: false, error: outcome.error },
    },
  };
}

/** Records the send in ONE batch (re-planned when a concurrent write raced). */
async function recordSend(
  db: JobsDb,
  scope: UserScope,
  context: EmailContext,
  input: ApproveInput & {
    claimed: EmailApplicationRecord;
    confirmed: boolean;
    outcome: SendResult;
  }
): Promise<ApproveBodyOut> {
  for (let attempt = 1; ; attempt++) {
    const plan = await planSendRecord(db, scope, context, input);
    try {
      await runEmailBatch(db, [
        ...plan.statements,
        ...input.idempotency(200, plan.body),
      ]);
      return plan.body;
    } catch (err) {
      if (!(err instanceof GuardFailedError) || attempt >= FINAL_COMMIT_TRIES) {
        throw err;
      }
    }
  }
}

async function serverSend(
  db: JobsDb,
  scope: UserScope,
  context: EmailContext,
  input: ApproveInput & { confirmed: boolean }
): Promise<ApproveResult> {
  const { now } = input;
  if (context.recipient.ownDomain) {
    throw apiError(
      "policy_violation",
      "pilihpendidikan addresses cannot receive applications.",
      { details: { reason: "recipient_not_allowed" } }
    );
  }
  await assertSendAllowed(db, scope, {
    flags: input.flags,
    now,
    accountCreatedAt: context.account.createdAt,
    to: context.content.to,
  });
  const [attachments, facts] = await Promise.all([
    loadVerifiedAttachments(input.env, context.attachments, context.files),
    loadFacts(db, scope, ["contact.full_name"]),
  ]);
  // Claim the row first: two concurrent approvals cannot both send.
  const claimed: EmailApplicationRecord = {
    ...context.email,
    status: "approved",
    approved_at: now,
    updated_at: now,
    revision: context.email.revision + 1,
  };
  try {
    await runEmailBatch(
      db,
      updateEmailStatements(db, scope, context.email, claimed)
    );
  } catch (err) {
    if (err instanceof GuardFailedError) {
      throw apiError(
        "revision_conflict",
        "This email is being approved in another request.",
        { details: { reason: "concurrent_approval", current: context.email } }
      );
    }
    throw err;
  }
  const outcome = await sendThroughProvider(
    input.env,
    buildServerMessage({
      content: context.content,
      attachments,
      accountEmail: context.account.email,
      fullName: facts.get("contact.full_name"),
    })
  );
  const body = await recordSend(db, scope, context, {
    ...input,
    claimed,
    outcome,
  });
  return { committed: true, body };
}

// ---------------------------------------------------------------------------
// Decisions from the approval queue (POST /api/v1/approvals/{id}/decide)
// ---------------------------------------------------------------------------

export interface QueueDecisionInput {
  approval: ApprovalRecord;
  decision: "approve" | "reject";
  env: Env;
  now: number;
  payloadHash: string;
  source: ChangeSource;
}

/**
 * Plans a decision on an `email_submit` approval taken from the generic
 * approval queue (leaf-2.7's decideApproval delegates here). Approving a
 * local hand-off has the effects of POST …/approve; a server_send must be
 * approved on the email itself (the send happens in that request). A
 * rejection leaves the draft as it is.
 */
export async function planEmailApprovalDecision(
  db: JobsDb,
  scope: UserScope,
  input: QueueDecisionInput
): Promise<{ approval: ApprovalRecord; statements: D1PreparedStatement[] }> {
  const payload = emailPayloadOf(input.approval);
  if (!payload) {
    throw new Error("planEmailApprovalDecision needs an email_submit approval");
  }
  if (input.payloadHash !== input.approval.payload_hash) {
    throw apiError(
      "revision_conflict",
      "The approval changed: review the current content and decide again.",
      {
        details: { reason: "payload_hash_mismatch", current: input.approval },
      }
    );
  }
  const context = await loadEmailContext(
    db,
    scope,
    input.env,
    payload.email_application_id
  );
  assertNotDelivered(context.email);
  if (input.approval.payload_hash !== context.hash) {
    throw apiError(
      "revision_conflict",
      "The email changed after this approval was requested.",
      {
        details: {
          reason: "payload_hash_mismatch",
          payload_hash: context.hash,
          current: context.email,
        },
      }
    );
  }
  const via = decidedVia(input.source);
  if (input.decision === "reject") {
    const rejected: ApprovalRecord = {
      ...input.approval,
      state: "rejected",
      decided_via: via,
      decided_by_user_id: scope.userId,
      decided_at: input.now,
      revision: input.approval.revision + 1,
    };
    return {
      approval: rejected,
      statements: [
        ...decideApprovalStatements(db, scope, input.approval, rejected),
        ...approvalEventStatements(db, scope, {
          actor: "user",
          approval: rejected,
          decision: "rejected",
          now: input.now,
        }),
      ],
    };
  }
  if (context.email.delivery === "server_send") {
    throw apiError(
      "policy_violation",
      "Approve server-sent emails on the email itself: it is sent in that step.",
      {
        details: {
          reason: "approve_on_email",
          email_application_id: context.email.id,
        },
      }
    );
  }
  const confirmed = assertRecipientConfirmed(context, undefined);
  await assertNoBrowserSubmission(db, scope, context.email.application_id);
  const approval = planApproval(db, scope, context, {
    confirmed,
    now: input.now,
    source: input.source,
  });
  const planned = await planLocalApproval(db, scope, context, {
    approval,
    now: input.now,
    source: input.source,
  });
  return { approval: approval.approval, statements: planned.statements };
}
