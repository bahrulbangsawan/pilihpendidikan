// Pure helpers of the approval queue (12 §6.1, 03 §8, 21 §6.3): where each
// value came from, contact masking, the answer-approval response (03 §9:
// a protected answer is never saved as "always"), how a failed decision
// reads, and the expiry countdown.

import type {
  AutoUse,
  Sensitivity,
} from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApprovalPayload,
  ApprovalRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { APPROVAL_FIELD_VALUE_SOURCES } from "@pilihpendidikan/jobs-contracts/records";
import { isApiError } from "./api-client";

export type ApprovalResponse = NonNullable<ApprovalRecord["response"]>;
export type FieldValueSource = (typeof APPROVAL_FIELD_VALUE_SOURCES)[number];
export type AnswerQuestion = Extract<
  ApprovalPayload,
  { type: "answer" }
>["questions"][number];
export type SubmitField = Extract<
  ApprovalPayload,
  { type: "browser_submit" }
>["fields"][number];

/** The i18n key of a value's provenance chip ("Fact", "Typed by you"…). */
export function valueSourceKey(source: FieldValueSource): string {
  return `approvals.sources.${source}`;
}

/**
 * Contact-like values (sensitivity `personal`) start masked with a reveal
 * toggle (12 §6.1). Protected values arrive already replaced by "(your saved
 * answer)" (records.ts) and are shown as sent.
 */
export function isMaskedByDefault(field: Pick<SubmitField, "sensitivity">) {
  return field.sensitivity === "personal";
}

const EMAIL_RE = /^([^@\s])[^@\s]*(@[^@\s]+)$/;
const MASK = "…";
const VISIBLE_TAIL = 2;
const MIN_TAIL_LENGTH = 6;

/** "r…@example.com", "+6…90", "R…": enough to recognise, not to read. */
export function maskValue(value: string): string {
  const text = value.trim();
  if (text.length === 0) {
    return text;
  }
  const email = EMAIL_RE.exec(text);
  if (email) {
    return `${email[1]}${MASK}${email[2]}`;
  }
  const head = text.slice(0, 1);
  if (text.length < MIN_TAIL_LENGTH) {
    return `${head}${MASK}`;
  }
  return `${head}${MASK}${text.slice(-VISIBLE_TAIL)}`;
}

/** The most a saved answer of this sensitivity may be used without asking. */
export function maxAutoUse(sensitivity: Sensitivity): AutoUse {
  return sensitivity === "protected" ? "approval" : "always";
}

/** The preselected auto-use of a newly saved answer (03 §9). */
export function defaultAutoUse(sensitivity: Sensitivity): AutoUse {
  return sensitivity === "none" ? "always" : "approval";
}

const AUTO_USE_ORDER: readonly AutoUse[] = ["never", "approval", "always"];

/** Lowers `autoUse` to what `sensitivity` allows (never `always` for protected). */
export function clampAutoUse(autoUse: AutoUse, sensitivity: Sensitivity) {
  const max = maxAutoUse(sensitivity);
  return AUTO_USE_ORDER.indexOf(autoUse) > AUTO_USE_ORDER.indexOf(max)
    ? max
    : autoUse;
}

export interface AnswerInput {
  autoUse: AutoUse;
  saveToBank: boolean;
  sensitivity: Sensitivity;
  value: string;
}

/** The initial answer of a question: the suggestion, its sensitivity. */
export function initialAnswer(question: AnswerQuestion): AnswerInput {
  return {
    value: question.suggestion?.value ?? "",
    saveToBank: false,
    sensitivity: question.sensitivity,
    autoUse: defaultAutoUse(question.sensitivity),
  };
}

/** True when every required question has an answer. */
export function answersComplete(
  questions: readonly AnswerQuestion[],
  inputs: Readonly<Record<string, AnswerInput>>
): boolean {
  return questions.every(
    (question) =>
      !question.required || (inputs[question.ref]?.value.trim().length ?? 0) > 0
  );
}

/**
 * `approvals.response` of an answer approval (21 §6.3): one entry per
 * answered question; bank fields only when the user ticked "Save to my
 * answer bank", with protected answers capped at `approval`.
 */
export function buildAnswerResponse(
  questions: readonly AnswerQuestion[],
  inputs: Readonly<Record<string, AnswerInput>>
): ApprovalResponse {
  const answers: NonNullable<ApprovalResponse["answers"]> = [];
  for (const question of questions) {
    const input = inputs[question.ref];
    const value = input?.value.trim() ?? "";
    if (!input || value.length === 0) {
      continue;
    }
    // A question the page marked protected stays protected whatever the
    // user picked; the stricter of the two sensitivities wins.
    const sensitivity: Sensitivity =
      question.sensitivity === "protected" ? "protected" : input.sensitivity;
    answers.push(
      input.saveToBank
        ? {
            ref: question.ref,
            value,
            save_to_bank: true,
            sensitivity,
            auto_use: clampAutoUse(input.autoUse, sensitivity),
          }
        : { ref: question.ref, value, save_to_bank: false }
    );
  }
  return { answers };
}

export type DecideFailure =
  | "hash_mismatch"
  | "already_decided"
  | "rule_changed"
  | "expired"
  | "not_allowed"
  | "gone"
  | "failed";

const HASH_REASONS = new Set(["payload_hash_mismatch", "payload_mismatch"]);
const HASH_CODES = new Set(["payload_mismatch", "payload_hash_mismatch"]);

function detailReason(details: Record<string, unknown> | undefined): string {
  const reason = details?.reason;
  return typeof reason === "string" ? reason : "";
}

/** How a failed `POST /approvals/{id}/decide` reads to the user. */
export function decideFailure(error: unknown): DecideFailure {
  if (!isApiError(error)) {
    return "failed";
  }
  const reason = detailReason(error.details);
  if (HASH_CODES.has(error.code) || HASH_REASONS.has(reason)) {
    return "hash_mismatch";
  }
  if (error.code === "approval_expired" || error.status === 410) {
    return "expired";
  }
  if (error.status === 404) {
    return "gone";
  }
  if (error.code === "mode_not_allowed") {
    return "not_allowed";
  }
  if (error.status === 409 || error.status === 422) {
    if (reason === "rule_changed") {
      return "rule_changed";
    }
    // A 409 without a hash reason: someone decided first (20 §6.2) — or a
    // conflict code the API may use for a changed form.
    return error.code === "conflict" ? "hash_mismatch" : "already_decided";
  }
  return "failed";
}

/** The i18n key of a decision failure. */
export function decideFailureKey(failure: DecideFailure): string {
  return `approvals.errors.${failure}`;
}

export interface Countdown {
  expired: boolean;
  hours: number;
  minutes: number;
}

/** Time left until `expiresAt` in whole hours and minutes. */
export function countdown(expiresAt: number, nowMs: number): Countdown {
  const left = Math.max(0, expiresAt - nowMs);
  const minutes = Math.floor(left / 60_000);
  return {
    expired: left === 0,
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  };
}

/** Pending approvals first by expiry; decided ones newest first. */
export function sortApprovals(
  approvals: readonly ApprovalRecord[]
): ApprovalRecord[] {
  return [...approvals].sort((a, b) => {
    if (a.state === "pending" && b.state === "pending") {
      return a.expires_at - b.expires_at;
    }
    if (a.state === "pending") {
      return -1;
    }
    if (b.state === "pending") {
      return 1;
    }
    return (b.decided_at ?? b.created_at) - (a.decided_at ?? a.created_at);
  });
}

/** The approval after `currentId` in `list` (J) or before it (K), wrapping. */
export function stepSelection(
  list: readonly { id: string }[],
  currentId: string | null,
  direction: 1 | -1
): string | null {
  if (list.length === 0) {
    return null;
  }
  const index = list.findIndex((entry) => entry.id === currentId);
  if (index === -1) {
    return list[direction === 1 ? 0 : list.length - 1]?.id ?? null;
  }
  const next = (index + direction + list.length) % list.length;
  return list[next]?.id ?? null;
}

/**
 * Why a selected approval is left out of a bulk decision. Bulk approve only
 * covers approvals whose single decision needs nothing but a confirmation:
 * a submission is reviewed one by one (12 §6.1), an answer needs typed
 * answers (21 §6.3), a rule activation needs its name typed (D-35).
 */
export type BulkDecideSkip =
  | "not_pending"
  | "expired"
  | "submit_review"
  | "answer_input"
  | "rule_name";

export function bulkDecideSkip(
  approval: Pick<ApprovalRecord, "state" | "kind" | "expires_at">,
  decision: "approve" | "reject",
  nowMs: number
): BulkDecideSkip | null {
  if (approval.state !== "pending") {
    return "not_pending";
  }
  if (approval.expires_at <= nowMs) {
    return "expired";
  }
  if (decision === "reject") {
    return null;
  }
  switch (approval.kind) {
    case "submit":
      return "submit_review";
    case "answer":
      return "answer_input";
    case "rule_activation":
      return "rule_name";
    default:
      return null;
  }
}

export interface BulkDecidePlan<T> {
  send: T[];
  skip: { approval: T; reason: BulkDecideSkip }[];
}

/** Splits a selection into what a bulk decision sends and what it skips. */
export function planBulkDecision<
  T extends Pick<ApprovalRecord, "state" | "kind" | "expires_at">,
>(
  approvals: readonly T[],
  decision: "approve" | "reject",
  nowMs: number
): BulkDecidePlan<T> {
  const plan: BulkDecidePlan<T> = { send: [], skip: [] };
  for (const approval of approvals) {
    const reason = bulkDecideSkip(approval, decision, nowMs);
    if (reason) {
      plan.skip.push({ approval, reason });
    } else {
      plan.send.push(approval);
    }
  }
  return plan;
}
