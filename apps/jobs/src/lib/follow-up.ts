// Follow-ups (06 §7). `follow_up_at` is set by the user — a date or a preset —
// or by accepting a suggestion. Suggestions are computed here and only shown;
// nothing writes `follow_up_at` until the user accepts (T6-17).

import type {
  ApplicationRecord,
  InterviewRecord,
  OfferRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { DAY_MS } from "./board-model";

export const HOUR_MS = 3_600_000;

export const FOLLOW_UP_PRESETS = [
  { key: "3d", days: 3 },
  { key: "1w", days: 7 },
  { key: "2w", days: 14 },
] as const;

export type FollowUpPresetKey = (typeof FOLLOW_UP_PRESETS)[number]["key"];

/** 09:00 local time `days` days from now. */
export function presetFollowUpAt(nowMs: number, days: number): number {
  const date = new Date(nowMs + days * DAY_MS);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

export type FollowUpReason =
  | "after_applied"
  | "after_interview"
  | "offer_deadline";

export interface FollowUpSuggestion {
  /** When to follow up (never earlier than now). */
  at: number;
  /** The event the suggestion is based on. */
  basis: number;
  reason: FollowUpReason;
}

export interface FollowUpInput {
  application: Pick<
    ApplicationRecord,
    "follow_up_at" | "stage" | "submitted_at" | "stage_changed_at"
  >;
  interviews: readonly Pick<InterviewRecord, "scheduled_at" | "outcome">[];
  offers: readonly Pick<OfferRecord, "deadline_at" | "status">[];
}

const CLOSED_STAGES = new Set(["accepted", "rejected", "withdrawn"]);

/**
 * The suggested follow-up for an application without one (06 §7): an open
 * offer's deadline − 48 h first, then 3 days after the latest interview, then
 * 7 days after applying. Null when a follow-up is already set or the
 * application is closed.
 */
export function suggestFollowUp(
  input: FollowUpInput,
  nowMs: number
): FollowUpSuggestion | null {
  const { application } = input;
  if (
    application.follow_up_at !== null ||
    CLOSED_STAGES.has(application.stage)
  ) {
    return null;
  }
  const deadline = input.offers
    .filter((offer) => offer.status === "open" && offer.deadline_at !== null)
    .map((offer) => offer.deadline_at as number)
    .sort((a, b) => a - b)[0];
  if (deadline !== undefined && deadline > nowMs) {
    return {
      reason: "offer_deadline",
      basis: deadline,
      at: Math.max(nowMs, deadline - 48 * HOUR_MS),
    };
  }
  const lastInterview = input.interviews
    .filter(
      (interview) =>
        interview.scheduled_at !== null && interview.outcome !== "cancelled"
    )
    .map((interview) => interview.scheduled_at as number)
    .sort((a, b) => b - a)[0];
  if (lastInterview !== undefined) {
    return {
      reason: "after_interview",
      basis: lastInterview,
      at: Math.max(nowMs, lastInterview + 3 * DAY_MS),
    };
  }
  if (application.stage === "applied") {
    const applied = application.submitted_at ?? application.stage_changed_at;
    return {
      reason: "after_applied",
      basis: applied,
      at: Math.max(nowMs, applied + 7 * DAY_MS),
    };
  }
  return null;
}
