// Server-side fact and answer injection for field planning (05 §9, 19 §6.1,
// 11 §11): the server is the authority on facts; the CLI only names the keys
// it wants considered.
//
// Minimization:
//   - only facts relevant to a VISIBLE field are sent (lexicon.ts maps
//     labels to fact keys); contact facts therefore only reach the model
//     when a contact field is on the page;
//   - protected facts (`work_auth.*`) and protected answers are never sent:
//     their existence is reported (key only) so the model marks the field
//     needs_human; `auto_use = never` answers likewise;
//   - answers are sent only when they relate to a visible question (a
//     binding hint from question matching or word overlap with a label);
//   - `experience[…]` / `education[…]` facts are resolved from the owned CV
//     into `experience[<id>].company|title|start_date|end_date` and
//     `education[<id>].institution|degree|…` only when a visible field asks
//     about employment or education (03 §9: always resolved, never copied).

import type { ObservedField } from "@pilihpendidikan/jobs-contracts/agent";
import type { Sensitivity } from "@pilihpendidikan/jobs-contracts/enums";
import { factKeySpec } from "@pilihpendidikan/jobs-contracts/facts";
import { normalizeText } from "@pilihpendidikan/jobs-contracts/fingerprint";
import type { Env } from "../../../env";
import type { FactKeyMatcher } from "../../ai/lexicon";
import {
  factKeysForField,
  fieldText,
  keyMatches,
  protectedCategory,
} from "../../ai/lexicon";
import type {
  FieldPlanContext,
  PlanAnswer,
  PlanFact,
  WithheldAnswer,
} from "../../ai/provider";
import type { StoredAnswer, StoredFact } from "../../repo/ai-proxy";
import { loadOwnedCv } from "../scoring/context";

const CV_ENTRY_RE = /^(experience|education)\[([^\]]+)\]$/;
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "you",
  "your",
  "are",
  "is",
  "do",
  "will",
  "of",
  "to",
  "for",
  "in",
  "with",
  "what",
  "how",
  "have",
  "or",
  "and",
  "apakah",
  "anda",
  "yang",
  "dan",
]);

/** A fact as the planner and the validator see it. */
export interface AgentFact extends PlanFact {
  /** The parsed stored value (booleans for eligibility facts). */
  raw: unknown;
}

const ENTRY_SUFFIX_RE =
  /\.(company|title|start_date|end_date|current|institution|degree)$/;
const CV_MATCHER_RE = /experience|education/;
const KEY_SUFFIX_RE = /\.[a-z_]+$/;
const WORD_JOINERS_RE = /[._]/g;
const NON_WORD_RE = /[^\p{L}\p{N}+#]/gu;

function sensitivityOf(key: string): Sensitivity {
  return factKeySpec(key.replace(ENTRY_SUFFIX_RE, ""))?.sensitivity ?? "none";
}

function renderListItem(item: unknown): string {
  if (typeof item === "string") {
    return item;
  }
  const entry = (item ?? {}) as Record<string, unknown>;
  if (typeof entry.code === "string") {
    return typeof entry.level === "string"
      ? `${entry.code} (${entry.level})`
      : entry.code;
  }
  if (typeof entry.country_code === "string") {
    return typeof entry.city === "string"
      ? `${entry.city}, ${entry.country_code}`
      : entry.country_code;
  }
  return JSON.stringify(item);
}

function renderObject(key: string, value: object): string {
  const record = value as Record<string, unknown>;
  if (key === "prefs.min_salary") {
    return `${String(record.currency ?? "")} ${String(record.amount ?? "")} per ${String(record.period ?? "year")}`.trim();
  }
  if (typeof record.status === "string") {
    return record.status;
  }
  return JSON.stringify(value).slice(0, 300);
}

/** A fact value as text (19 §6.1 `key | value | source`). */
export function renderFactValue(key: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(renderListItem).join("; ");
  }
  return typeof value === "object" ? renderObject(key, value) : "";
}

function needsCvEntries(fields: readonly ObservedField[]): boolean {
  return fields.some((field) =>
    factKeysForField(field).some(
      (matcher) =>
        matcher instanceof RegExp && CV_MATCHER_RE.test(matcher.source)
    )
  );
}

interface EntryRef {
  cvId: string;
  entryId: string;
  key: string;
  kind: string;
  source: string;
}

function entryRefs(facts: readonly StoredFact[]): EntryRef[] {
  const refs: EntryRef[] = [];
  for (const fact of facts) {
    const match = CV_ENTRY_RE.exec(fact.key);
    const value = (fact.value ?? {}) as {
      cv_entry_id?: unknown;
      cv_id?: unknown;
    };
    const cvId = typeof value.cv_id === "string" ? value.cv_id : fact.cv_id;
    const entryId =
      typeof value.cv_entry_id === "string"
        ? value.cv_entry_id
        : fact.cv_entry_id;
    if (match && cvId && entryId) {
      refs.push({
        kind: match[1],
        key: fact.key,
        cvId,
        entryId,
        source: fact.source,
      });
    }
  }
  return refs;
}

function entryFacts(
  ref: EntryRef,
  cv: NonNullable<Awaited<ReturnType<typeof loadOwnedCv>>>
): AgentFact[] {
  let values: [string, string | boolean][] = [];
  if (ref.kind === "experience") {
    const entry = cv.experience.find((e) => e.id === ref.entryId);
    values = entry
      ? [
          ["title", entry.title],
          ["company", entry.company],
          ["start_date", entry.startDate],
          ["end_date", entry.current ? "" : entry.endDate],
          ["current", entry.current],
        ]
      : [];
  } else {
    const entry = cv.education.find((e) => e.id === ref.entryId);
    values = entry
      ? [
          ["institution", entry.institution],
          ["degree", entry.degree],
          ["start_date", entry.startDate],
          ["end_date", entry.current ? "" : entry.endDate],
        ]
      : [];
  }
  return values
    .map(([suffix, raw]) => ({
      key: `${ref.key}.${suffix}`,
      value: String(raw).trim(),
      raw,
      source: ref.source,
      sensitivity: "none" as const,
    }))
    .filter((fact) => fact.value.length > 0);
}

async function cvEntryFacts(
  env: Pick<Env, "CV_KV">,
  email: string,
  facts: readonly StoredFact[]
): Promise<AgentFact[]> {
  const out: AgentFact[] = [];
  const cvs = new Map<string, Awaited<ReturnType<typeof loadOwnedCv>>>();
  for (const ref of entryRefs(facts)) {
    if (!cvs.has(ref.cvId)) {
      cvs.set(ref.cvId, await loadOwnedCv(env, ref.cvId, email));
    }
    const cv = cvs.get(ref.cvId);
    if (cv) {
      out.push(...entryFacts(ref, cv));
    }
  }
  return out;
}

/**
 * Every usable fact of the user, rendered (CV entry references resolved when
 * the page asks about employment or education). Protected facts are kept
 * here for the validator; `planContext` never sends their values.
 */
export async function agentFacts(
  env: Pick<Env, "CV_KV">,
  email: string,
  facts: readonly StoredFact[],
  fields: readonly ObservedField[]
): Promise<AgentFact[]> {
  const out: AgentFact[] = facts
    .filter((fact) => !CV_ENTRY_RE.test(fact.key))
    .map((fact) => ({
      key: fact.key,
      value: renderFactValue(fact.key, fact.value),
      raw: fact.value,
      source: fact.source,
      sensitivity: sensitivityOf(fact.key),
    }))
    .filter((fact) => fact.value.length > 0);
  if (needsCvEntries(fields)) {
    out.push(...(await cvEntryFacts(env, email, facts)));
  }
  return out;
}

/** Content words of a text (for answer ↔ question relevance). */
export function contentWords(text: string): Set<string> {
  return new Set(
    normalizeText(text.replace(WORD_JOINERS_RE, " "))
      .split(" ")
      .map((word) => word.replace(NON_WORD_RE, ""))
      .filter((word) => word.length > 1 && !STOPWORDS.has(word))
  );
}

/** Share of the answer's words found in the question (≥ 5-letter prefix match counts). */
export function relevance(question: Set<string>, answer: Set<string>): number {
  if (answer.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const word of answer) {
    if (
      [...question].some(
        (q) =>
          q === word ||
          (q.length >= 5 &&
            word.length >= 5 &&
            q.slice(0, 5) === word.slice(0, 5))
      )
    ) {
      shared += 1;
    }
  }
  return shared / answer.size;
}

function answerWords(
  answer: Pick<StoredAnswer, "question_key" | "match_patterns">
) {
  return [answer.question_key, ...answer.match_patterns].map(contentWords);
}

/** True when an answer relates to a visible field (≥ half its words). */
export function answerRelevantTo(
  answer: Pick<StoredAnswer, "question_key" | "match_patterns">,
  fields: readonly ObservedField[]
): boolean {
  const variants = answerWords(answer);
  return fields.some((field) => {
    const question = contentWords(fieldText(field));
    return variants.some((words) => relevance(question, words) >= 0.5);
  });
}

export interface PlanContextInput {
  answers: readonly StoredAnswer[];
  facts: readonly AgentFact[];
  fields: readonly ObservedField[];
  fileSlots: FieldPlanContext["fileSlots"];
  generatedTextAllowed: boolean;
  hints: FieldPlanContext["hints"];
  /** Keys the CLI asked to consider (05 §9); undefined = all relevant. */
  requestedKeys?: readonly string[];
}

function requested(key: string, keys: ReadonlySet<string> | null): boolean {
  if (!keys) {
    return true;
  }
  const base = key.replace(KEY_SUFFIX_RE, "");
  return keys.has(key) || keys.has(base);
}

/** The minimized trusted context of one field-plan call (11 §11). */
export function planContext(input: PlanContextInput): FieldPlanContext {
  const live = input.fields.filter(
    (field) => !field.user_touched && field.kind !== "file"
  );
  const matchers: FactKeyMatcher[] = live.flatMap(factKeysForField);
  const keys = input.requestedKeys ? new Set(input.requestedKeys) : null;
  const relevantFacts = input.facts.filter(
    (fact) => keyMatches(fact.key, matchers) && requested(fact.key, keys)
  );
  const facts: PlanFact[] = relevantFacts
    .filter((fact) => fact.sensitivity !== "protected")
    .map(({ key, value, source, sensitivity }) => ({
      key,
      value: value.slice(0, 600),
      source,
      sensitivity,
    }));
  const withheldFacts = relevantFacts
    .filter((fact) => fact.sensitivity === "protected")
    .map((fact) => fact.key);
  const hinted = new Set(input.hints.map((hint) => hint.answer_id));
  const protectedFields = live.filter((field) =>
    protectedCategory(fieldText(field))
  );
  const answers: PlanAnswer[] = [];
  const withheldAnswers: WithheldAnswer[] = [];
  for (const answer of input.answers) {
    const relevant = hinted.has(answer.id) || answerRelevantTo(answer, live);
    if (answer.sensitivity === "protected") {
      const category = protectedCategory(
        `${answer.question_key.replace(/[._]/g, " ")} ${answer.match_patterns.join(" ")}`
      );
      if (
        category &&
        protectedFields.some(
          (field) => protectedCategory(fieldText(field)) === category
        )
      ) {
        withheldAnswers.push({
          question_key: answer.question_key,
          reason: "protected",
        });
      }
      continue;
    }
    if (!relevant) {
      continue;
    }
    if (answer.auto_use === "never") {
      withheldAnswers.push({
        question_key: answer.question_key,
        reason: "never",
      });
      continue;
    }
    answers.push({
      id: answer.id,
      question_key: answer.question_key,
      patterns: answer.match_patterns.slice(0, 8),
      answer: answer.answer.slice(0, 2000),
      answer_kind: answer.answer_kind,
      sensitivity: answer.sensitivity,
      auto_use: answer.auto_use,
    });
  }
  return {
    facts,
    answers,
    withheldFacts,
    withheldAnswers,
    fileSlots: input.fileSlots,
    generatedTextAllowed: input.generatedTextAllowed,
    hints: input.hints,
  };
}
