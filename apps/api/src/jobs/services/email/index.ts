// The email-applications service (09, 05 §13) for routes and other areas.
//
//   planEmailDraft(db, scope, appId, input)    POST …/applications/{app}/emails
//   approveEmail(db, scope, input)             POST /emails/{eml}/approve
//   getEmailDetail(db, scope, env, emailId)    GET /emails/{eml}
//   planHandOff(db, scope, input)              POST /emails/{eml}/handed-off
//   planEmailApprovalDecision(db, scope, input)
//       an `email_submit` approval decided from the generic approval queue
//       (POST /approvals/{id}/decide, leaf-2.7): commit the statements in one
//       batch; same effects as POST …/approve for a local hand-off

import type { Env } from "../../../env";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import {
  approveEmail as approve,
  planEmailApprovalDecision as decideFromQueue,
} from "./approve";
import { planEmailDraft as planDraft } from "./drafts";
import { planHandOff as handOff } from "./handoff";
import type { EmailDetail } from "./show";
import { getEmailDetail as showEmail } from "./show";

import type {
  ApproveInput,
  ApproveResult,
  QueueDecisionInput,
} from "./approve";
import type { DraftInput, DraftPlan } from "./drafts";
import type { HandOffInput, HandOffPlan } from "./handoff";

/** Plans a draft (validation, template, optional AI paragraph). */
export async function planEmailDraft(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  input: DraftInput
): Promise<DraftPlan> {
  return await planDraft(db, scope, applicationId, input);
}

/** Approves an email (server_send sends and records it itself). */
export async function approveEmail(
  db: JobsDb,
  scope: UserScope,
  input: ApproveInput
): Promise<ApproveResult> {
  return await approve(db, scope, input);
}

/** One email with its current approval and payload hash. */
export async function getEmailDetail(
  db: JobsDb,
  scope: UserScope,
  env: Pick<Env, "DB">,
  emailId: string
): Promise<EmailDetail> {
  return await showEmail(db, scope, env, emailId);
}

/** Plans the CLI's hand-off report. */
export async function planHandOff(
  db: JobsDb,
  scope: UserScope,
  input: HandOffInput
): Promise<HandOffPlan> {
  return await handOff(db, scope, input);
}

/** Plans a queue decision on an `email_submit` approval (leaf-2.7). */
export async function planEmailApprovalDecision(
  db: JobsDb,
  scope: UserScope,
  input: QueueDecisionInput
) {
  return await decideFromQueue(db, scope, input);
}
