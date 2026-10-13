// The answer bank write of an approved `answer` approval (21 §6.3): an
// answer the user ticked "save for future" is upserted into
// `screening_answers` by its question key (03 §9). Protected answers are
// never stored with `auto_use = always` (the table CHECK enforces it too).

import type {
  AnswerKind,
  AutoUse,
  Sensitivity,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { encodeJson, stmt } from "../core/db";

export interface AnswerUpsert {
  answer: string;
  answerKind: AnswerKind;
  autoUse: AutoUse;
  id: string;
  matchPatterns: string[];
  now: number;
  questionKey: string;
  sensitivity: Sensitivity;
}

export function upsertAnswerStatements(
  db: JobsDb,
  scope: UserScope,
  input: AnswerUpsert
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO screening_answers (id, user_id, question_key, match_patterns, answer, answer_kind, sensitivity, auto_use, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(user_id, question_key) DO UPDATE SET answer = excluded.answer, answer_kind = excluded.answer_kind, sensitivity = excluded.sensitivity, auto_use = excluded.auto_use, revision = screening_answers.revision + 1, updated_at = excluded.updated_at",
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
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'answer', id, revision, 'upsert', ? FROM screening_answers WHERE user_id = ? AND question_key = ?",
      input.now,
      scope.userId,
      input.questionKey
    ),
  ];
}
