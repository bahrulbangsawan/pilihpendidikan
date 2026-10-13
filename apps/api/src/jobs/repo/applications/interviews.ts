// Interviews (04 §2.2, 06 §6.1): one row per round of an application.

import type {
  InterviewKind,
  InterviewOutcome,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { InterviewRecord } from "@pilihpendidikan/jobs-contracts/records";
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

/** One interview of one of the user's applications, or null. */
export async function loadInterview(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  interviewId: string
): Promise<InterviewRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM interviews WHERE id = ? AND user_id = ? AND application_id = ?",
    interviewId,
    scope.userId,
    applicationId
  );
  return row ? decodeRow<InterviewRecord>("interviews", row) : null;
}

/** A page of an application's interviews by round (`limit + 1` rows). */
export async function listInterviewRows(
  db: JobsDb,
  scope: UserScope,
  query: { applicationId: string; cursor: CursorKey | null; limit: number }
): Promise<InterviewRecord[]> {
  const keyset = keysetAfter(["round", "id"], query.cursor, "asc");
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM interviews WHERE user_id = ? AND application_id = ?${keyset.sql ? ` AND ${keyset.sql}` : ""} ORDER BY round, id LIMIT ?`,
    scope.userId,
    query.applicationId,
    ...keyset.binds,
    query.limit + 1
  );
  return rows.map((row) => decodeRow<InterviewRecord>("interviews", row));
}

/** How many interviews an application has and its highest round. */
export async function interviewStats(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<{ count: number; maxRound: number }> {
  const row = await queryFirst<{ count: number; max_round: number | null }>(
    db,
    "SELECT COUNT(*) AS count, MAX(round) AS max_round FROM interviews WHERE user_id = ? AND application_id = ?",
    scope.userId,
    applicationId
  );
  return { count: row?.count ?? 0, maxRound: row?.max_round ?? 0 };
}

/** INSERT of a new interview + its change_log row. */
export function insertInterviewStatements(
  db: JobsDb,
  scope: UserScope,
  interview: InterviewRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO interviews (id, user_id, application_id, round, kind, scheduled_at, duration_min, timezone, location, interviewers, outcome, notes, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      interview.id,
      scope.userId,
      interview.application_id,
      interview.round,
      interview.kind,
      interview.scheduled_at,
      interview.duration_min,
      interview.timezone,
      interview.location,
      encodeJson(interview.interviewers),
      interview.outcome,
      interview.notes,
      interview.created_at,
      interview.updated_at
    ),
    appendChange(db, scope, {
      entity: "interview",
      entityId: interview.id,
      revision: 1,
      now: interview.created_at,
    }),
  ];
}

export interface InterviewChanges {
  duration_min?: number | null;
  interviewers?: string[];
  kind?: InterviewKind;
  location?: string | null;
  notes?: string;
  outcome?: InterviewOutcome;
  round?: number;
  scheduled_at?: number | null;
  timezone?: string | null;
}

const INTERVIEW_COLUMNS = [
  "round",
  "kind",
  "scheduled_at",
  "duration_min",
  "timezone",
  "location",
  "interviewers",
  "outcome",
  "notes",
] as const;

/** Guard + UPDATE (revision + 1) + change_log of an interview edit. */
export function updateInterviewStatements(
  db: JobsDb,
  scope: UserScope,
  interviewId: string,
  changes: InterviewChanges,
  base: number,
  now: number
): D1PreparedStatement[] {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const column of INTERVIEW_COLUMNS) {
    const value = changes[column];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      binds.push(column === "interviewers" ? encodeJson(value) : value);
    }
  }
  return [
    guardRevision(db, scope, "interviews", interviewId, base),
    stmt(
      db,
      `UPDATE interviews SET ${sets.join(", ")}, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?`,
      ...binds,
      now,
      interviewId,
      scope.userId,
      base
    ),
    appendChange(db, scope, {
      entity: "interview",
      entityId: interviewId,
      revision: base + 1,
      now,
    }),
  ];
}

/** Guard + DELETE + change_log (op delete) of an interview. */
export function deleteInterviewStatements(
  db: JobsDb,
  scope: UserScope,
  interview: Pick<InterviewRecord, "id" | "revision">,
  now: number
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "interviews", interview.id, interview.revision),
    stmt(
      db,
      "DELETE FROM interviews WHERE id = ? AND user_id = ? AND revision = ?",
      interview.id,
      scope.userId,
      interview.revision
    ),
    appendChange(db, scope, {
      entity: "interview",
      entityId: interview.id,
      revision: interview.revision + 1,
      op: "delete",
      now,
    }),
  ];
}
