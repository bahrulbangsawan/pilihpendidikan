// Screening question → answer bank (19 §6.2), before the field-plan call.
//
//   - question-like fields: a label ending in "?", yes/no or range options,
//     or a textarea outside the contact and education sections;
//   - the protected-class lexicon runs on every field in parallel: a hit
//     forces `sensitivity = protected` whatever the model says, and such a
//     field is never matched against the answer bank by the model;
//   - the rest go to Decisions, one `choice` per question, ≤ 6 questions per
//     request, the user's question keys (≤ 38, protected and `never` answers
//     excluded) plus "none";
//   - `confidence ≥ 0.80` and not "none" → a binding hint (`answer_id`).

import type { ObservedField } from "@pilihpendidikan/jobs-contracts/agent";
import { AGENT_THRESHOLDS } from "@pilihpendidikan/jobs-contracts/agent";
import { matchRequests, QUESTION_KEYS_MAX } from "../../ai/compose";
import type { ProtectedCategory } from "../../ai/lexicon";
import {
  fieldText,
  isQuestionField,
  protectedCategory,
} from "../../ai/lexicon";
import type {
  AiProvider,
  FieldPlanContext,
  QuestionMatchInput,
} from "../../ai/provider";
import type { AiUsage } from "../../ai/primitives";
import { estimateDecisionCost, ZERO_USAGE } from "../../ai/primitives";
import type { StoredAnswer } from "../../repo/ai-proxy";
import { contentWords, relevance } from "./facts";

/** Lexicon hits by field ref (19 §6.2). */
export function protectedFields(
  fields: readonly ObservedField[]
): Map<string, ProtectedCategory> {
  const out = new Map<string, ProtectedCategory>();
  for (const field of fields) {
    const category = protectedCategory(fieldText(field));
    if (category) {
      out.set(field.ref, category);
    }
  }
  return out;
}

/** The fields worth matching against the answer bank. */
export function questionFields(
  fields: readonly ObservedField[],
  protectedRefs: ReadonlyMap<string, ProtectedCategory>
): ObservedField[] {
  return fields.filter(
    (field) =>
      field.kind !== "file" &&
      !field.user_touched &&
      !protectedRefs.has(field.ref) &&
      isQuestionField(field)
  );
}

function humanize(key: string): string {
  return key.replace(/[._]+/g, " ").trim();
}

/** The answer-bank keys offered as choices (≤ 38, most relevant first). */
export function bankKeys(
  answers: readonly StoredAnswer[],
  questions: readonly ObservedField[]
): QuestionMatchInput["keys"] {
  const usable = answers.filter(
    (answer) =>
      answer.auto_use !== "never" && answer.sensitivity !== "protected"
  );
  const asked = questions.map((field) => contentWords(fieldText(field)));
  const scored = usable.map((answer) => {
    const words = contentWords(
      `${answer.question_key} ${answer.match_patterns.join(" ")}`
    );
    const score = Math.max(0, ...asked.map((q) => relevance(q, words)));
    return { answer, score };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.answer.question_key.localeCompare(b.answer.question_key)
  );
  return scored.slice(0, QUESTION_KEYS_MAX).map(({ answer }) => ({
    value: answer.question_key,
    description: [
      humanize(answer.question_key),
      ...answer.match_patterns.slice(0, 2),
    ]
      .join(" / ")
      .slice(0, 120),
  }));
}

export interface QuestionMatching {
  calls: number;
  hints: FieldPlanContext["hints"];
  usage: AiUsage;
}

/** The match input of a page (also used for the budget estimate). */
export function matchInputFor(
  fields: readonly ObservedField[],
  answers: readonly StoredAnswer[],
  protectedRefs: ReadonlyMap<string, ProtectedCategory>
): QuestionMatchInput {
  const questions = questionFields(fields, protectedRefs);
  return {
    keys: questions.length > 0 ? bankKeys(answers, questions) : [],
    questions: questions.map((field) => ({
      id: field.ref,
      text: `${field.label} ${field.description}`.trim(),
      options: field.options
        .filter((option) => !option.disabled)
        .map((option) => option.label || option.value),
    })),
  };
}

/** Estimated cost of the matching requests of a page (micro-USD). */
export function matchingEstimate(input: QuestionMatchInput): number {
  if (input.keys.length === 0 || input.questions.length === 0) {
    return 0;
  }
  return matchRequests(input).reduce(
    (total, { request }) => total + estimateDecisionCost(request),
    0
  );
}

/** Runs the Decisions matching and returns the binding hints. */
export async function matchQuestionsToBank(
  ai: AiProvider,
  input: QuestionMatchInput,
  answers: readonly StoredAnswer[]
): Promise<QuestionMatching> {
  if (input.keys.length === 0 || input.questions.length === 0) {
    return { hints: [], usage: { ...ZERO_USAGE }, calls: 0 };
  }
  const result = await ai.matchQuestions(input);
  const byKey = new Map(answers.map((answer) => [answer.question_key, answer]));
  const offered = new Set(input.keys.map((key) => key.value));
  const hints: FieldPlanContext["hints"] = [];
  for (const match of result.matches) {
    const answer = match.question_key
      ? byKey.get(match.question_key)
      : undefined;
    if (
      answer &&
      match.question_key &&
      offered.has(match.question_key) &&
      !match.refused &&
      (match.confidence ?? 0) >= AGENT_THRESHOLDS.questionMatch
    ) {
      hints.push({
        ref: match.id,
        answer_id: answer.id,
        question_key: answer.question_key,
      });
    }
  }
  return { hints, usage: result.usage, calls: result.calls };
}
