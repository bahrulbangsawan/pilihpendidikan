// The answer bank (05 §10, 03 §9, 19 §6.2).
//
// Policy, enforced on create and on every update (the merged result):
//   - the protected-class lexicon of 19 §6.2 (gender, race/ethnicity,
//     disability, veteran, sexual orientation, criminal history, age/date of
//     birth, religion, health, union membership, citizenship/visa) runs over
//     the question key and every match pattern; a hit forces
//     `sensitivity = protected` whatever the client sent;
//   - `protected` + `auto_use = always` → 422 `policy_violation` (11 T-14:
//     protected answers are never used without an explicit approval);
//   - `answer_kind` constrains the stored text (number, boolean, date).
// Match patterns are stored normalized (normalizeText), deduplicated.

import type {
  CreateAnswerRequest,
  UpdateAnswerRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  AnswerKind,
  Sensitivity,
} from "@pilihpendidikan/jobs-contracts/enums";
import { normalizeText } from "@pilihpendidikan/jobs-contracts/fingerprint";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { ScreeningAnswerRecord } from "@pilihpendidikan/jobs-contracts/records";
import { protectedCategory } from "../../ai/lexicon";
import { apiError, invalidRequest, notFound } from "../../core/http";
import { assertRevision } from "../../core/revision";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import type { AnswerFields } from "../../repo/profile/answers";
import {
  deleteAnswerStatements,
  insertAnswerStatements,
  loadAnswer,
  updateAnswerStatements,
} from "../../repo/profile/answers";

/** Question keys whose answers feed the scoring profile (07 §2.1). */
export const YEARS_EXPERIENCE_PREFIX = "years_experience.";

const KEY_SEPARATORS_RE = /[_.:[\]/-]+/g;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const BOOLEAN_RE = /^(?:true|false|yes|no|ya|tidak)$/i;
const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/;
const MAX_PATTERNS = 50;

/** The protected class a question key or phrasing asks about, or null. */
export function protectedClassOf(
  questionKey: string,
  patterns: readonly string[]
): string | null {
  const texts = [questionKey.replace(KEY_SEPARATORS_RE, " "), ...patterns];
  for (const textValue of texts) {
    const hit = protectedCategory(textValue);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** Normalized, deduplicated, non-empty match patterns (≤ 50). */
export function normalizePatterns(patterns: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const normalized = normalizeText(pattern).slice(0, 300);
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out.slice(0, MAX_PATTERNS);
}

function checkAnswerKind(kind: AnswerKind, answer: string): void {
  const value = answer.trim();
  const ok =
    (kind === "number" && NUMBER_RE.test(value)) ||
    (kind === "boolean" && BOOLEAN_RE.test(value)) ||
    (kind === "date" && DATE_RE.test(value)) ||
    kind === "text" ||
    kind === "choice";
  if (!ok) {
    throw invalidRequest(`The answer is not a valid ${kind}.`, [
      {
        code: "custom",
        path: ["answer"],
        message: `expected a ${kind} answer`,
      },
    ]);
  }
}

/**
 * Applies the policy to a complete answer: the lexicon may raise the
 * sensitivity to `protected`; `protected` + `always` is refused.
 */
export function enforceAnswerPolicy(fields: AnswerFields): AnswerFields {
  const category = protectedClassOf(fields.questionKey, fields.matchPatterns);
  const sensitivity: Sensitivity = category ? "protected" : fields.sensitivity;
  if (sensitivity === "protected" && fields.autoUse === "always") {
    throw apiError(
      "policy_violation",
      'Protected answers are never used automatically: choose auto_use "approval" or "never".',
      {
        details: {
          sensitivity,
          auto_use: fields.autoUse,
          ...(category ? { protected_class: category } : {}),
        },
      }
    );
  }
  checkAnswerKind(fields.answerKind, fields.answer);
  return { ...fields, sensitivity };
}

function recordOf(
  scope: UserScope,
  fields: AnswerFields,
  meta: { createdAt: number; id: string; revision: number; updatedAt: number }
): ScreeningAnswerRecord {
  return {
    id: meta.id,
    user_id: scope.userId,
    question_key: fields.questionKey,
    match_patterns: [...fields.matchPatterns],
    answer: fields.answer,
    answer_kind: fields.answerKind,
    sensitivity: fields.sensitivity,
    auto_use: fields.autoUse,
    revision: meta.revision,
    created_at: meta.createdAt,
    updated_at: meta.updatedAt,
  };
}

export interface AnswerWrite {
  answer: ScreeningAnswerRecord;
  /** The write touched a `years_experience.*` answer (07 §2.1). */
  affectsProfile: boolean;
  statements: D1PreparedStatement[];
}

function touchesProfile(...keys: string[]): boolean {
  return keys.some((key) => key.startsWith(YEARS_EXPERIENCE_PREFIX));
}

/** Plans `POST /api/v1/profile/answers`. */
export function planCreateAnswer(
  db: JobsDb,
  scope: UserScope,
  body: CreateAnswerRequest,
  now: number
): AnswerWrite {
  const fields = enforceAnswerPolicy({
    questionKey: body.question_key.trim(),
    matchPatterns: normalizePatterns(body.match_patterns ?? []),
    answer: body.answer,
    answerKind: body.answer_kind,
    sensitivity: body.sensitivity,
    autoUse: body.auto_use,
  });
  if (fields.questionKey.length === 0) {
    throw invalidRequest("question_key must not be blank.");
  }
  const id = newId("ans", now);
  return {
    answer: recordOf(scope, fields, {
      id,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }),
    affectsProfile: touchesProfile(fields.questionKey),
    statements: insertAnswerStatements(db, scope, { ...fields, id, now }),
  };
}

/** The user's answer or 404 (not owned = not found). */
export async function requireAnswer(
  db: JobsDb,
  scope: UserScope,
  id: string
): Promise<ScreeningAnswerRecord> {
  const answer = await loadAnswer(db, scope, id);
  if (!answer) {
    throw notFound("Answer not found.");
  }
  return answer;
}

/** Plans `PATCH /api/v1/profile/answers/{ans_id}`. */
export async function planUpdateAnswer(
  db: JobsDb,
  scope: UserScope,
  input: {
    baseRevision: number;
    body: UpdateAnswerRequest;
    id: string;
    now: number;
  }
): Promise<AnswerWrite & { changed: boolean }> {
  const current = await requireAnswer(db, scope, input.id);
  assertRevision(current, input.baseRevision);
  const { body } = input;
  const fields = enforceAnswerPolicy({
    questionKey: (body.question_key ?? current.question_key).trim(),
    matchPatterns:
      body.match_patterns === undefined
        ? current.match_patterns
        : normalizePatterns(body.match_patterns),
    answer: body.answer ?? current.answer,
    answerKind: body.answer_kind ?? current.answer_kind,
    sensitivity: body.sensitivity ?? current.sensitivity,
    autoUse: body.auto_use ?? current.auto_use,
  });
  if (fields.questionKey.length === 0) {
    throw invalidRequest("question_key must not be blank.");
  }
  const unchanged =
    fields.questionKey === current.question_key &&
    JSON.stringify(fields.matchPatterns) ===
      JSON.stringify(current.match_patterns) &&
    fields.answer === current.answer &&
    fields.answerKind === current.answer_kind &&
    fields.sensitivity === current.sensitivity &&
    fields.autoUse === current.auto_use;
  if (unchanged) {
    return {
      answer: current,
      affectsProfile: false,
      changed: false,
      statements: [],
    };
  }
  return {
    answer: recordOf(scope, fields, {
      id: current.id,
      revision: current.revision + 1,
      createdAt: current.created_at,
      updatedAt: input.now,
    }),
    affectsProfile: touchesProfile(current.question_key, fields.questionKey),
    changed: true,
    statements: updateAnswerStatements(db, scope, {
      ...fields,
      id: current.id,
      baseRevision: current.revision,
      now: input.now,
    }),
  };
}

/** Plans `DELETE /api/v1/profile/answers/{ans_id}`. */
export async function planDeleteAnswer(
  db: JobsDb,
  scope: UserScope,
  input: { baseRevision: number | null; id: string; now: number }
): Promise<{ affectsProfile: boolean; statements: D1PreparedStatement[] }> {
  const current = await requireAnswer(db, scope, input.id);
  if (input.baseRevision !== null) {
    assertRevision(current, input.baseRevision);
  }
  return {
    affectsProfile: touchesProfile(current.question_key),
    statements: deleteAnswerStatements(db, scope, {
      id: current.id,
      revision: current.revision,
      now: input.now,
    }),
  };
}
