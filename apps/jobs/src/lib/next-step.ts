// The application's "Next step" rail (12 §5.1): exactly one recommended
// action computed from the state — the page's single primary button.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";

export type NextStepKind =
  | "review_outcome"
  | "confirm_submission"
  | "approve_submission"
  | "review_cv"
  | "generate_cv"
  | "start_apply"
  | "add_interview";

export interface NextStep {
  /** The approval to decide (approve_submission). */
  approvalId?: string;
  /** The variant to review (review_cv). */
  cvVariantId?: string;
  kind: NextStepKind;
}

const LIVE_TASK_STATES = new Set([
  "queued",
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
]);
const PREP_STAGES = new Set(["saved", "preparing", "ready"]);
const INTERVIEW_STAGES = new Set(["applied", "interviewing"]);

/**
 * Priority: what needs the user's decision about a submission comes first
 * (outcome unknown, unconfirmed, a pending submit approval), then the
 * preparation chain (CV → apply), then interviews. Null when there is
 * nothing to recommend (closed, offer, or a run is already working on it).
 */
export function computeNextStep(detail: ApplicationDetail): NextStep | null {
  const { application } = detail;
  if (application.submission_status === "outcome_unknown") {
    return { kind: "review_outcome" };
  }
  if (application.submission_status === "submitted_unverified") {
    return { kind: "confirm_submission" };
  }
  const submitApproval = detail.approvals.find(
    (approval) => approval.kind === "submit" && approval.state === "pending"
  );
  if (submitApproval) {
    return { kind: "approve_submission", approvalId: submitApproval.id };
  }
  if (PREP_STAGES.has(application.stage)) {
    if (detail.tasks.some((task) => LIVE_TASK_STATES.has(task.state))) {
      return null;
    }
    const draft = detail.cv_variants.find(
      (variant) => variant.status === "draft"
    );
    if (draft) {
      return { kind: "review_cv", cvVariantId: draft.id };
    }
    const usable = detail.cv_variants.some(
      (variant) =>
        variant.status === "approved" || variant.status === "generating"
    );
    if (!usable && application.mode !== "manual") {
      return { kind: "generate_cv" };
    }
    return { kind: "start_apply" };
  }
  if (INTERVIEW_STAGES.has(application.stage)) {
    return { kind: "add_interview" };
  }
  return null;
}
