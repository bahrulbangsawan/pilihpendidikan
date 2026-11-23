// The application's "Next step" (12 §5.1): exactly one recommended action
// computed from the state — the screen's single primary button. Manual
// tracking only: review a tailored CV, record that you applied, add the
// interview.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";

export type NextStepKind = "review_cv" | "mark_applied" | "add_interview";

export interface NextStep {
  /** The variant to review (review_cv). */
  cvVariantId?: string;
  kind: NextStepKind;
}

const PREP_STAGES = new Set(["saved", "preparing", "ready"]);
const INTERVIEW_STAGES = new Set(["applied", "interviewing"]);

/**
 * Before applying: a draft CV waits for review first, then "Mark as
 * applied". After applying: add the interview. Null when there is nothing to
 * recommend (offer, accepted, closed).
 */
export function computeNextStep(detail: ApplicationDetail): NextStep | null {
  const { application } = detail;
  if (PREP_STAGES.has(application.stage)) {
    const draft = detail.cv_variants.find(
      (variant) => variant.status === "draft"
    );
    if (draft) {
      return { kind: "review_cv", cvVariantId: draft.id };
    }
    return { kind: "mark_applied" };
  }
  if (INTERVIEW_STAGES.has(application.stage)) {
    return { kind: "add_interview" };
  }
  return null;
}
