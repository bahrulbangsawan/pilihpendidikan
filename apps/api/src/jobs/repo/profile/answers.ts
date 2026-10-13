// `screening_answers` (04 §2.3, 03 §9, 19 §6.2): the answer bank. One row per
// canonical question key (`UNIQUE (user_id, question_key)`); the table CHECK
// refuses `protected` + `always` as a last line of defence behind the
// service's 422 `policy_violation`.

import type {
  AnswerKind,
  AutoUse,
  Sensitivity,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { ScreeningAnswerRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { CursorKey } from "../../core/pagination";
import { keysetAfter } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import { appendChange } from "../core/change-log";
import type { JobsDb } from "../core/db";
import {
  decodeRow,
  encodeJson,
  guardRevision,
  queryAll,
  queryFirst,
  stmt,
} from "../core/db";

const ANSWER_COLUMNS =
  "id, user_id, question_key, match_patterns, answer, answer_kind, sensitivity, auto_use, revision, created_at, updated_at";

/** The API record of a stored row (`match_patterns` parsed). */
export function answerRecord(
  row: Record<string, unknown>
): ScreeningAnswerRecord {
  return decodeRow<ScreeningAnswerRecord>("screening_answers", row);
}

/** One of the user's answers, or null (not owned = not found). */
export async function loadAnswer(
  db: JobsDb,
  scope: UserScope,
  id: string
): Promise<ScreeningAnswerRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT ${ANSWER_COLUMNS} FROM screening_answers WHERE id = ? AND user_id = ?`,
    id,
    scope.userId
  );
  return row ? answerRecord(row) : null;
}

/** The user's answer for a question key, or null. */
export async function answerByQuestionKey(
  db: JobsDb,
  scope: UserScope,
  questionKey: string
): Promise<ScreeningAnswerRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT ${ANSWER_COLUMNS} FROM screening_answers WHERE user_id = ? AND question_key = ?`,
    scope.userId,
    questionKey
  );
  return row ? answerRecord(row) : null;
}

/** One page of answers ordered by `(question_key, id)`; `limit + 1` rows. */
export async function listAnswerRows(
  db: JobsDb,
  scope: UserScope,
  page: { cursor: CursorKey | null; limit: number }
): Promise<ScreeningAnswerRecord[]> {
  const where = keysetAfter(["question_key", "id"], page.cursor, "asc");
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT ${ANSWER_COLUMNS} FROM screening_answers WHERE user_id = ? ${where.sql ? `AND ${where.sql}` : ""} ORDER BY question_key, id LIMIT ?`,
    scope.userId,
    ...where.binds,
    page.limit + 1
  );
  return rows.map(answerRecord);
}

/** Every answer of the user (snapshot), ordered by question key. */
export async function listAllAnswers(
  db: JobsDb,
  scope: UserScope
): Promise<ScreeningAnswerRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT ${ANSWER_COLUMNS} FROM screening_answers WHERE user_id = ? ORDER BY question_key, id`,
    scope.userId
  );
  return rows.map(answerRecord);
}

export interface AnswerFields {
  answer: string;
  answerKind: AnswerKind;
  autoUse: AutoUse;
  matchPatterns: readonly string[];
  questionKey: string;
  sensitivity: Sensitivity;
}

/** INSERT of a new answer (revision 1) + its change. */
export function insertAnswerStatements(
  db: JobsDb,
  scope: UserScope,
  input: AnswerFields & { id: string; now: number }
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO screening_answers (id, user_id, question_key, match_patterns, answer, answer_kind, sensitivity, auto_use, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      input.id,
      scope.userId,
      input.questionKey,
      encodeJson(input.matchPatterns),
      input.answer,
      input.answerKind,
      input.sensitivity,
      input.autoUse,
      input.now,
      input.now
    ),
    appendChange(db, scope, {
      entity: "answer",
      entityId: input.id,
      revision: 1,
      now: input.now,
    }),
  ];
}

/** Guarded UPDATE of every answer field at `baseRevision` + its change. */
export function updateAnswerStatements(
  db: JobsDb,
  scope: UserScope,
  input: AnswerFields & { baseRevision: number; id: string; now: number }
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "screening_answers", input.id, input.baseRevision),
    stmt(
      db,
      "UPDATE screening_answers SET question_key = ?, match_patterns = ?, answer = ?, answer_kind = ?, sensitivity = ?, auto_use = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?",
      input.questionKey,
      encodeJson(input.matchPatterns),
      input.answer,
      input.answerKind,
      input.sensitivity,
      input.autoUse,
      input.now,
      input.id,
      scope.userId,
      input.baseRevision
    ),
    appendChange(db, scope, {
      entity: "answer",
      entityId: input.id,
      revision: input.baseRevision + 1,
      now: input.now,
    }),
  ];
}

/** Guarded DELETE of an answer + its `delete` tombstone. */
export function deleteAnswerStatements(
  db: JobsDb,
  scope: UserScope,
  input: { id: string; now: number; revision: number }
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "screening_answers", input.id, input.revision),
    stmt(
      db,
      "DELETE FROM screening_answers WHERE id = ? AND user_id = ? AND revision = ?",
      input.id,
      scope.userId,
      input.revision
    ),
    appendChange(db, scope, {
      entity: "answer",
      entityId: input.id,
      revision: input.revision + 1,
      op: "delete",
      now: input.now,
    }),
  ];
}
