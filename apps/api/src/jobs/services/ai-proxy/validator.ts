// The field-plan validator of 19 §6.4 (server side; the CLI re-validates the
// structure with identical rules). The model PROPOSES; this decides. Every
// value that leaves the server is recomputed from a stored fact, a stored
// answer, an option of the field or an attached file slot, so a fabricated
// value can never be typed (11 T-13).
//
//   fact            fact exists for the user, value equals it after kind
//                   normalization only (phone digits, date format, URL scheme,
//                   case) → value := the fact; else needs_human
//   answer          answer exists, auto_use ≠ never, value equals it (or the
//                   matching option) → value := the answer; else needs_human
//   option          option_value ∈ the field's enabled options AND entailed by
//                   a cited fact or answer; else needs_human
//   cv / cover file field is a file input, slot attached, PDF accepted; a
//                   missing cover letter on an optional field is skipped
//   generated_text  only with generated_text_allowed, never in auto mode,
//                   only motivation / cover-letter / additional-info text
//                   fields, ≤ 2,000 chars
//   protected       (model OR lexicon) never auto-filled; a stored answer
//                   with auto_use = approval is proposed (needs_human with the
//                   suggestion), else needs_human
//   personal        auto-filled only from an answer with auto_use = always;
//                   otherwise proposed via approval
//   user_touched    skip (the human's input wins)
//   has_value       skip unless the field is invalid (never overwrite ATS
//                   prefill)
//   confidence      < 0.75 → needs_human
//   unknown ref / signature mismatch → dropped (`schema_mismatch`)
// Fields the model left out are added as needs_human (or skip when touched /
// prefilled). `missing` is recomputed from the needs_human items that carry
// no suggestion.

import type {
  FieldPlan,
  FieldPlanItem,
  ObservedField,
  PageObservation,
} from "@pilihpendidikan/jobs-contracts/agent";
import { AGENT_THRESHOLDS } from "@pilihpendidikan/jobs-contracts/agent";
import type {
  ApplicationMode,
  Sensitivity,
} from "@pilihpendidikan/jobs-contracts/enums";
import { normalizeText } from "@pilihpendidikan/jobs-contracts/fingerprint";
import type { ProtectedCategory } from "../../ai/lexicon";
import {
  acceptsPdf,
  booleanFlag,
  fieldText,
  isFreeTextMotivation,
  isPersonalQuestion,
  protectedCategory,
  yesNo,
} from "../../ai/lexicon";
import type { StoredAnswer } from "../../repo/ai-proxy";
import type { AgentFact } from "./facts";

/** 19 §6.4: generated text is capped at 2,000 characters. */
export const GENERATED_TEXT_MAX = 2000;
const REASON_MAX = 300;
const CHOICE_KINDS = new Set([
  "select",
  "radio_group",
  "combobox",
  "checkbox_group",
]);
const NON_DIGIT_RE = /\D+/g;
const SCHEME_RE = /^https?:\/\//i;
const WWW_RE = /^www\./i;
const TRAILING_SLASH_RE = /\/+$/;
const SPACES_RE = /\s+/g;

const RANK: Readonly<Record<Sensitivity, number>> = {
  none: 0,
  personal: 1,
  protected: 2,
};

function maxSensitivity(...values: Sensitivity[]): Sensitivity {
  return values.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "none");
}

export interface ValidationInput {
  answers: readonly StoredAnswer[];
  facts: readonly AgentFact[];
  fileSlots: { cover_letter_file: boolean; cv_file: boolean };
  generatedTextAllowed: boolean;
  /** Binding hints of question matching (ref → answer). */
  hints: ReadonlyArray<{
    answer_id: string;
    question_key: string;
    ref: string;
  }>;
  /** The task's mode (`auto` forbids generated text). */
  mode: ApplicationMode | string | null;
  observation: PageObservation;
  /** Lexicon hits by ref (19 §6.2). */
  protectedRefs: ReadonlyMap<string, ProtectedCategory>;
}

export interface ValidationReport {
  /** Refs of items dropped as `schema_mismatch`. */
  dropped: string[];
  /** Items the validator turned into needs_human. */
  downgraded: number;
  plan: FieldPlan;
}

// ---------------------------------------------------------------------------
// Normalization for the field kind only (19 §6.4: never changes content)
// ---------------------------------------------------------------------------

function collapse(text: string): string {
  return text.replace(SPACES_RE, " ").trim();
}

function phoneEquals(a: string, b: string): boolean {
  const left = a.replace(NON_DIGIT_RE, "");
  const right = b.replace(NON_DIGIT_RE, "");
  if (!(left && right)) {
    return false;
  }
  if (left === right) {
    return true;
  }
  // National "0812…" vs E.164 "+62 812…": same subscriber number.
  const national = (x: string, y: string) =>
    x.startsWith("0") &&
    y.endsWith(x.slice(1)) &&
    y.length - (x.length - 1) <= 3 &&
    y.length - (x.length - 1) >= 1;
  return national(left, right) || national(right, left);
}

function urlEquals(a: string, b: string): boolean {
  const strip = (url: string) =>
    collapse(url)
      .replace(SCHEME_RE, "")
      .replace(WWW_RE, "")
      .replace(TRAILING_SLASH_RE, "")
      .toLowerCase();
  return strip(a) === strip(b);
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  mei: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  agu: 8,
  agt: 8,
  sep: 9,
  oct: 10,
  okt: 10,
  nov: 11,
  dec: 12,
  des: 12,
};

const ISO_DATE_RE = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/;
const MONTH_YEAR_RE = /^(\d{1,2})[/.](\d{4})$/;
const NAMED_MONTH_RE = /^([a-z]{3})[a-z]*\.? (\d{4})$/;

/** `YYYY-MM[-DD]` of common date spellings, or null. */
export function canonicalDate(text: string): string | null {
  const value = collapse(text).toLowerCase();
  let match = ISO_DATE_RE.exec(value);
  if (match) {
    return [match[1], match[2].padStart(2, "0"), match[3]?.padStart(2, "0")]
      .filter(Boolean)
      .join("-");
  }
  match = MONTH_YEAR_RE.exec(value);
  if (match) {
    return `${match[2]}-${match[1].padStart(2, "0")}`;
  }
  match = NAMED_MONTH_RE.exec(value);
  if (match && MONTHS[match[1]]) {
    return `${match[2]}-${String(MONTHS[match[1]]).padStart(2, "0")}`;
  }
  return null;
}

/** Equality of a proposed value and a stored one for this field kind. */
export function valuesEqual(
  kind: string,
  proposed: string,
  stored: string
): boolean {
  if (kind === "tel") {
    return phoneEquals(proposed, stored);
  }
  if (kind === "url") {
    return urlEquals(proposed, stored);
  }
  if (kind === "date" || kind === "month") {
    const a = canonicalDate(proposed);
    const b = canonicalDate(stored);
    if (a && b) {
      return kind === "month" ? a.slice(0, 7) === b.slice(0, 7) : a === b;
    }
  }
  if (kind === "email") {
    return collapse(proposed).toLowerCase() === collapse(stored).toLowerCase();
  }
  return collapse(proposed).toLowerCase() === collapse(stored).toLowerCase();
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

type Option = ObservedField["options"][number];

function enabledOption(
  field: ObservedField,
  wanted: string | null
): Option | null {
  if (wanted === null) {
    return null;
  }
  const target = normalizeText(wanted);
  return (
    field.options.find(
      (option) => !option.disabled && option.value === wanted
    ) ??
    field.options.find(
      (option) =>
        !option.disabled &&
        (normalizeText(option.value) === target ||
          normalizeText(option.label) === target)
    ) ??
    null
  );
}

/** An option is entailed by a stored value: same text, or the same yes/no. */
function optionEntailed(option: Option, raw: unknown, text: string): boolean {
  const target = normalizeText(text);
  if (
    target &&
    (normalizeText(option.label) === target ||
      normalizeText(option.value) === target)
  ) {
    return true;
  }
  const stored = booleanFlag(raw, text);
  return (
    stored !== null &&
    (yesNo(option.label) === stored || yesNo(option.value) === stored)
  );
}

function optionFor(
  field: ObservedField,
  raw: unknown,
  text: string
): Option | null {
  return (
    field.options.find(
      (option) => !option.disabled && optionEntailed(option, raw, text)
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

interface Source {
  answer?: StoredAnswer;
  fact?: AgentFact;
}

function naturalAction(field: ObservedField): FieldPlanItem["action"] {
  if (field.kind === "file") {
    return "upload";
  }
  if (field.kind === "checkbox") {
    return "check";
  }
  return CHOICE_KINDS.has(field.kind) ? "select" : "fill";
}

function reasonOf(item: FieldPlanItem, note: string): string {
  return `${note}${item.reason ? ` · ${item.reason}` : ""}`.slice(
    0,
    REASON_MAX
  );
}

function needsHuman(
  item: FieldPlanItem,
  field: ObservedField,
  note: string
): FieldPlanItem {
  return {
    ...item,
    action: naturalAction(field),
    value_source: "none",
    fact_key: null,
    answer_id: null,
    option_value: null,
    value: null,
    needs_human: true,
    reason: reasonOf(item, note),
  };
}

function skip(item: FieldPlanItem, note: string): FieldPlanItem {
  return {
    ...item,
    action: "skip",
    value_source: "none",
    fact_key: null,
    answer_id: null,
    option_value: null,
    value: null,
    needs_human: false,
    reason: reasonOf(item, note),
  };
}

/** The value a stored source gives this field, or a failure note. */
function resolveValue(
  item: FieldPlanItem,
  field: ObservedField,
  source: { raw: unknown; text: string }
): { item: FieldPlanItem } | { fail: string } {
  if (field.kind === "file") {
    return { fail: "a stored value cannot fill a file input" };
  }
  if (field.kind === "checkbox") {
    const flag = booleanFlag(source.raw, source.text);
    if (!flag) {
      return { fail: "stored value is not yes/no" };
    }
    return {
      item: {
        ...item,
        action: flag === "yes" ? "check" : "uncheck",
        option_value: null,
        value: flag === "yes" ? "true" : "false",
      },
    };
  }
  if (CHOICE_KINDS.has(field.kind)) {
    const proposed = enabledOption(field, item.option_value ?? item.value);
    const option =
      proposed && optionEntailed(proposed, source.raw, source.text)
        ? proposed
        : optionFor(field, source.raw, source.text);
    if (!option) {
      return { fail: "no enabled option equals the stored value" };
    }
    if (proposed && proposed !== option) {
      return { fail: "proposed option differs from the stored value" };
    }
    return {
      item: {
        ...item,
        action: "select",
        option_value: option.value,
        value: option.label,
      },
    };
  }
  if (
    item.value !== null &&
    !valuesEqual(field.kind, item.value, source.text)
  ) {
    return { fail: "proposed value differs from the stored value" };
  }
  return {
    item: { ...item, action: "fill", option_value: null, value: source.text },
  };
}

interface Checked {
  item: FieldPlanItem;
  /** Proposed via approval instead of auto-filled. */
  suggestion: boolean;
}

function checkSourced(
  item: FieldPlanItem,
  field: ObservedField,
  source: Source,
  sensitivity: Sensitivity
): Checked | { fail: string } {
  const text = source.fact?.value ?? source.answer?.answer ?? "";
  const raw = source.fact ? source.fact.raw : source.answer?.answer;
  const resolved = resolveValue(item, field, { raw, text });
  if ("fail" in resolved) {
    return resolved;
  }
  const answer = source.answer;
  if (sensitivity === "protected") {
    return answer && answer.auto_use === "approval"
      ? { item: resolved.item, suggestion: true }
      : { fail: "protected question: never auto-filled" };
  }
  // A fact has no auto_use: auto-filled unless personal (03 §9: personal
  // values are filled only from an answer with auto_use = always).
  const approvalOnly = answer
    ? answer.auto_use === "approval" ||
      (sensitivity === "personal" && answer.auto_use !== "always")
    : sensitivity === "personal";
  return { item: resolved.item, suggestion: approvalOnly };
}

type Check = Checked | { fail: string } | { skip: string };

interface Lookups {
  answers: ReadonlyMap<string, StoredAnswer>;
  facts: ReadonlyMap<string, AgentFact>;
}

function checkFact(
  item: FieldPlanItem,
  field: ObservedField,
  fact: AgentFact | undefined
): Check {
  return fact
    ? checkSourced(
        { ...item, answer_id: null },
        field,
        { fact },
        item.sensitivity
      )
    : { fail: "fact_key is not a fact of this user" };
}

function checkAnswer(
  item: FieldPlanItem,
  field: ObservedField,
  answer: StoredAnswer | undefined
): Check {
  if (!answer) {
    return { fail: "answer_id is not an answer of this user" };
  }
  if (answer.auto_use === "never") {
    return { fail: "answer is never auto-used" };
  }
  return checkSourced(
    { ...item, fact_key: null },
    field,
    { answer },
    item.sensitivity
  );
}

function checkOption(
  item: FieldPlanItem,
  field: ObservedField,
  source: Source
): Check {
  const option = enabledOption(field, item.option_value);
  if (!(CHOICE_KINDS.has(field.kind) && option)) {
    return { fail: "option_value is not an enabled option of the field" };
  }
  let checked: Check;
  if (source.answer && source.answer.auto_use !== "never") {
    checked = checkSourced(
      { ...item, option_value: option.value, fact_key: null },
      field,
      { answer: source.answer },
      item.sensitivity
    );
  } else if (source.fact) {
    checked = checkSourced(
      { ...item, option_value: option.value, answer_id: null },
      field,
      { fact: source.fact },
      item.sensitivity
    );
  } else {
    return { fail: "option is not entailed by a fact or answer" };
  }
  if ("item" in checked) {
    checked.item.value_source = "option";
  }
  return checked;
}

function checkFile(
  item: FieldPlanItem,
  field: ObservedField,
  input: ValidationInput
): Check {
  const slot =
    item.value_source === "cover_letter_file" ? "cover_letter_file" : "cv_file";
  if (field.kind !== "file") {
    return { fail: "file slot on a non-file field" };
  }
  if (!input.fileSlots[slot]) {
    return slot === "cover_letter_file" && !field.required
      ? { skip: "no cover letter attached; optional field skipped" }
      : { fail: `no ${slot} attached` };
  }
  if (!acceptsPdf(field.accept)) {
    return { fail: "unsupported_file_type: the field does not accept PDF" };
  }
  return {
    item: {
      ...item,
      action: "upload",
      fact_key: null,
      answer_id: null,
      option_value: null,
      value: null,
    },
    suggestion: false,
  };
}

function checkGenerated(
  item: FieldPlanItem,
  field: ObservedField,
  input: ValidationInput
): Check {
  const value = item.value?.trim() ?? "";
  if (!input.generatedTextAllowed) {
    return { fail: "generated text is not allowed by the user" };
  }
  if (input.mode === "auto") {
    return { fail: "generated text is forbidden in auto mode" };
  }
  if (!isFreeTextMotivation(field)) {
    return { fail: "generated text only for motivation / cover-letter fields" };
  }
  if (!value || value.length > GENERATED_TEXT_MAX) {
    return { fail: "generated text empty or over 2,000 characters" };
  }
  if (item.sensitivity === "protected") {
    return { fail: "protected question: never auto-filled" };
  }
  return {
    item: {
      ...item,
      action: "fill",
      fact_key: null,
      answer_id: null,
      option_value: null,
      value,
    },
    suggestion: false,
  };
}

function checkSource(
  item: FieldPlanItem,
  field: ObservedField,
  input: ValidationInput,
  source: Source
): Check | null {
  switch (item.value_source) {
    case "fact":
      return checkFact(item, field, source.fact);
    case "answer":
      return checkAnswer(item, field, source.answer);
    case "option":
      return checkOption(item, field, source);
    case "cv_file":
    case "cover_letter_file":
      return checkFile(item, field, input);
    case "generated_text":
      return checkGenerated(item, field, input);
    default:
      return null;
  }
}

/** The item with the model's claims replaced by what the stored data allows. */
function prepared(
  raw: FieldPlanItem,
  field: ObservedField,
  input: ValidationInput,
  source: Source
): FieldPlanItem {
  const text = fieldText(field);
  const lexicon =
    input.protectedRefs.has(field.ref) || protectedCategory(text) !== null;
  return {
    ...raw,
    ref: field.ref,
    signature: field.signature,
    sensitivity: maxSensitivity(
      raw.sensitivity,
      lexicon ? "protected" : "none",
      isPersonalQuestion(text) ? "personal" : "none",
      source.fact?.sensitivity ?? "none",
      source.answer?.sensitivity ?? "none"
    ),
    reason: raw.reason.slice(0, REASON_MAX),
  };
}

function checkItem(
  raw: FieldPlanItem,
  field: ObservedField,
  input: ValidationInput,
  lookups: Lookups
): FieldPlanItem {
  const source: Source = {
    fact: raw.fact_key ? lookups.facts.get(raw.fact_key) : undefined,
    answer: raw.answer_id ? lookups.answers.get(raw.answer_id) : undefined,
  };
  const item = prepared(raw, field, input, source);
  if (field.user_touched) {
    return skip(item, "user_touched: the human's input wins");
  }
  if (field.has_value && !field.invalid) {
    return skip(item, "prefilled: never overwrite an existing value");
  }
  const checked = checkSource(item, field, input, source);
  if (checked === null) {
    return item.action === "skip" && !item.needs_human && !field.required
      ? skip(item, "optional field left empty")
      : needsHuman(item, field, "no fact or answer supports a value");
  }
  if ("skip" in checked) {
    return skip(item, checked.skip);
  }
  if ("fail" in checked) {
    return needsHuman(item, field, `validator: ${checked.fail}`);
  }
  const result: FieldPlanItem = {
    ...checked.item,
    needs_human: checked.suggestion,
  };
  if (result.confidence < AGENT_THRESHOLDS.fieldConfidence) {
    result.needs_human = true;
    result.reason = reasonOf(result, "validator: confidence below 0.75");
  }
  if (checked.suggestion) {
    result.reason = reasonOf(result, "proposed via approval");
  }
  return result;
}

/** Protected fields with no suggestion get the user's stored approval answer of the same class. */
function proposeProtected(
  item: FieldPlanItem,
  field: ObservedField,
  input: ValidationInput
): FieldPlanItem {
  if (
    !(
      item.needs_human &&
      item.value === null &&
      item.sensitivity === "protected"
    )
  ) {
    return item;
  }
  const category =
    input.protectedRefs.get(field.ref) ?? protectedCategory(fieldText(field));
  if (!category) {
    return item;
  }
  const candidates = input.answers.filter(
    (answer) =>
      answer.auto_use === "approval" &&
      protectedCategory(
        `${answer.question_key.replace(/[._]/g, " ")} ${answer.match_patterns.join(" ")}`
      ) === category
  );
  if (candidates.length !== 1) {
    return item;
  }
  const answer = candidates[0];
  const resolved = resolveValue(
    { ...item, option_value: null, value: null },
    field,
    { raw: answer.answer, text: answer.answer }
  );
  if ("fail" in resolved) {
    return item;
  }
  return {
    ...resolved.item,
    value_source: "answer",
    answer_id: answer.id,
    fact_key: null,
    question_key: answer.question_key,
    needs_human: true,
    reason: reasonOf(
      item,
      "protected: your saved answer, proposed via approval"
    ),
  };
}

/** Applies 19 §6.4 to a proposed plan (null = refusal: everything needs the human). */
export function validateFieldPlan(
  proposed: FieldPlan | null,
  input: ValidationInput
): ValidationReport {
  const fields = new Map(
    input.observation.fields.map((field) => [field.ref, field])
  );
  const lookups = {
    facts: new Map(input.facts.map((fact) => [fact.key, fact])),
    answers: new Map(input.answers.map((answer) => [answer.id, answer])),
  };
  const knownKeys = new Set(input.answers.map((answer) => answer.question_key));
  const hints = new Map(input.hints.map((hint) => [hint.ref, hint]));
  const dropped: string[] = [];
  const byRef = new Map<string, FieldPlanItem>();
  for (const raw of proposed?.items ?? []) {
    const field = fields.get(raw.ref);
    if (!field || raw.signature !== field.signature || byRef.has(raw.ref)) {
      dropped.push(raw.ref);
      continue;
    }
    byRef.set(raw.ref, raw);
  }
  let downgraded = 0;
  const items: FieldPlanItem[] = [];
  input.observation.fields.forEach((field, index) => {
    const raw: FieldPlanItem = byRef.get(field.ref) ?? {
      plan_item: "",
      ref: field.ref,
      signature: field.signature,
      action: naturalAction(field),
      value_source: "none",
      fact_key: null,
      answer_id: null,
      option_value: null,
      value: null,
      confidence: 0,
      sensitivity: "none",
      needs_human: true,
      question_key: null,
      reason: proposed
        ? "not planned by the model"
        : "the model refused to plan",
    };
    let item = checkItem(raw, field, input, lookups);
    item = proposeProtected(item, field, input);
    const hint = hints.get(field.ref);
    const answer = item.answer_id
      ? lookups.answers.get(item.answer_id)
      : undefined;
    item.question_key =
      answer?.question_key ??
      hint?.question_key ??
      (item.question_key && knownKeys.has(item.question_key)
        ? item.question_key
        : null);
    item.plan_item = `p${index + 1}`;
    if (item.needs_human && !raw.needs_human && byRef.has(field.ref)) {
      downgraded += 1;
    }
    items.push(item);
  });
  const whyByRef = new Map(
    (proposed?.missing ?? []).map((entry) => [entry.ref, entry.why])
  );
  const missing = items
    .filter((item) => item.needs_human && item.value === null)
    .map((item) => ({
      ref: item.ref,
      label: (fields.get(item.ref)?.label ?? "").slice(0, 300),
      question_key: item.question_key,
      why: (whyByRef.get(item.ref) ?? item.reason).slice(0, 200),
    }));
  return { plan: { items, missing }, dropped, downgraded };
}

/** A field plan's file-slot need, for logging (counts only, never values). */
export function planStats(plan: FieldPlan): Record<string, number> {
  const stats: Record<string, number> = {
    needs_human: 0,
    items: plan.items.length,
  };
  for (const item of plan.items) {
    stats[item.value_source] = (stats[item.value_source] ?? 0) + 1;
    if (item.needs_human) {
      stats.needs_human += 1;
    }
  }
  return stats;
}
