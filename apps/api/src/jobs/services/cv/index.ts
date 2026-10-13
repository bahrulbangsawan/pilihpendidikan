// biome-ignore-all lint/performance/noBarrelFile: the CV area's public service surface (PLAN C5) — other areas import only from here.
// The CV area's services (08, 05 §7) for routes, the queue, the cron and other
// areas:
//
//   planCreateCvVariant(db, scope, env, {applicationId, baseCvId, template,
//     tailor, now, actorKind}) → {cvVariantId, variant, statements,
//     afterCommit}      leaf-2.7 rules with cv_policy.tailor; commit the
//                       statements in ONE batch, then await afterCommit()
//                       (it sends the tailor_cv message)
//   planCvVariantApprovalDecision(…)   POST /approvals/{id}/decide for
//                       kind = cv_variant (leaf-2.7)
//   issueRenderTicket(env, {userId, cvvId, now})   render_cv claim context
//   failCvVariant(db, scope, {cvvId, now})         the DLQ for tailor_cv
//   planPurgeApplicationCvVariants(…)              06 §8 hard delete
//   newTokens / postingTermsOf          the V4 token check (email paragraph)
//   sweepCvVariants(cc)                            render fallback + stalled
//                       tailoring safety net (daily file-retention cron;
//                       safe on the 5-minute schedule too)

export { cvVariantPayloadHash } from "./canonical";
export { sweepCvVariants } from "./sweep";
export { runTailorCv } from "./tailoring/run";
export type { NewToken } from "./tailoring/tokens";
export { newTokens, postingTermsOf } from "./tailoring/tokens";
export type { IssuedRenderTicket, RenderTicketGrant } from "./ticket";
export {
  issueRenderTicket,
  RENDER_TICKET_HEADER,
  RENDER_TICKET_TTL_SECONDS,
  renderTicketAuth,
  renderTicketOf,
} from "./ticket";
export type {
  AttachPlan,
  CreateCvVariantInput,
  CreateCvVariantPlan,
  DecisionInput,
  DecisionPlan,
} from "./variants";
export {
  assertVariantAcceptsPdf,
  COPY_MODEL,
  editedAfterApproval,
  ensureRenderFallbackTask,
  failCvVariant,
  getCvVariantDetail,
  issueVariantRenderTicket,
  loadOwnedCv,
  planApproveCvVariant,
  planAttachRenderedFile,
  planCreateCvVariant,
  planCvVariantApprovalDecision,
  planPurgeApplicationCvVariants,
  planRejectCvVariant,
  RENDER_FALLBACK_DELAY_MS,
  tailorCvMessage,
} from "./variants";
export { listOwnedCvs } from "./base-cvs";
