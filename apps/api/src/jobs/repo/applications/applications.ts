// Application rows (04 §2.2) for the board area (leaf-2.3, 05 §5, 06).
//
// Reads return the API representation (`decodeRow`); writes return statements
// for the caller's single batch (05 §1.4). Every statement names `user_id`.

import type {
  ApplicationMode,
  ChangeSource,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import { TASK_LIVE_STATES } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationRecord,
  LegacyJobSection,
  UserJobRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { RankedCard } from "../../core/rank";
import type { UserScope } from "../../core/scope";
import { appendChange, appendChangeFromRow } from "../core/change-log";
import type { JobsDb } from "../core/db";
import {
  decodeRow,
  encodeJson,
  guardRevision,
  queryAll,
  queryFirst,
  runBatch,
  sqlBool,
  stmt,
} from "../core/db";

const LIVE_STATES_SQL = TASK_LIVE_STATES.map((s) => `'${s}'`).join(", ");

/** The user's `user_jobs` row, or null (not owned = null). */
export async function loadUserJob(
  db: JobsDb,
  scope: UserScope,
  userJobId: string
): Promise<UserJobRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM user_jobs WHERE id = ? AND user_id = ?",
    userJobId,
    scope.userId
  );
  return row ? decodeRow<UserJobRecord>("user_jobs", row) : null;
}

/** The application tracking a user_job (one per user_job, 03 §5), or null. */
export async function findApplicationByUserJob(
  db: JobsDb,
  scope: UserScope,
  userJobId: string
): Promise<ApplicationRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM applications WHERE user_job_id = ? AND user_id = ?",
    userJobId,
    scope.userId
  );
  return row ? decodeRow<ApplicationRecord>("applications", row) : null;
}

/**
 * `user_settings.default_mode` and `timezone` without creating the row
 * (null when the user has none yet: callers fall back to the 04 §2.7
 * defaults).
 */
export async function storedSettings(
  db: JobsDb,
  scope: UserScope
): Promise<{ default_mode: ApplicationMode; timezone: string } | null> {
  return await queryFirst<{ default_mode: ApplicationMode; timezone: string }>(
    db,
    "SELECT default_mode, timezone FROM user_settings WHERE user_id = ?",
    scope.userId
  );
}

/** The highest rank of a (non-archived) column, or null when it is empty. */
export async function lastRankInColumn(
  db: JobsDb,
  scope: UserScope,
  stage: Stage
): Promise<string | null> {
  const row = await queryFirst<{ board_rank: string }>(
    db,
    "SELECT board_rank FROM applications WHERE user_id = ? AND archived = 0 AND stage = ? ORDER BY board_rank DESC LIMIT 1",
    scope.userId,
    stage
  );
  return row?.board_rank ?? null;
}

/**
 * A column in display order (`ix_apps_board` range), without `excludeId`
 * (the card being placed).
 */
export async function loadColumn(
  db: JobsDb,
  scope: UserScope,
  stage: Stage,
  excludeId: string | null
): Promise<RankedCard[]> {
  const rows = await queryAll<{ board_rank: string; id: string }>(
    db,
    "SELECT id, board_rank FROM applications WHERE user_id = ? AND archived = 0 AND stage = ? AND id != ? ORDER BY board_rank, id",
    scope.userId,
    stage,
    excludeId ?? ""
  );
  return rows.map((row) => ({ id: row.id, rank: row.board_rank }));
}

/** A live task of the application (any state of `TASK_LIVE_STATES`). */
export async function liveTasksOf(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<
  Array<{ id: string; state: string; submit_intent_at: number | null }>
> {
  return await queryAll(
    db,
    `SELECT id, state, submit_intent_at FROM automation_tasks WHERE user_id = ? AND application_id = ? AND state IN (${LIVE_STATES_SQL}) ORDER BY created_at DESC`,
    scope.userId,
    applicationId
  );
}

export interface NewApplication {
  id: string;
  mode: ApplicationMode;
  now: number;
  rank: string;
  source: ChangeSource;
  stage: Stage;
  userJobId: string;
}

/** INSERT of a new application + its change_log row (revision 1). */
export function insertApplicationStatements(
  db: JobsDb,
  scope: UserScope,
  app: NewApplication
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO applications (id, user_id, user_job_id, stage, stage_changed_at, submission_status, mode, priority, board_rank, archived, sections, last_change_source, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'not_started', ?, 0, ?, 0, '[]', ?, 1, ?, ?)",
      app.id,
      scope.userId,
      app.userJobId,
      app.stage,
      app.now,
      app.mode,
      app.rank,
      app.source,
      app.now,
      app.now
    ),
    appendChange(db, scope, {
      entity: "application",
      entityId: app.id,
      revision: 1,
      now: app.now,
    }),
  ];
}

/** The in-memory record a fresh `insertApplicationStatements` row reads as. */
export function newApplicationRecord(
  scope: UserScope,
  app: NewApplication
): ApplicationRecord {
  return {
    id: app.id,
    user_id: scope.userId,
    user_job_id: app.userJobId,
    legacy_job_id: null,
    stage: app.stage,
    stage_changed_at: app.now,
    submission_status: "not_started",
    submitted_at: null,
    submission_method: null,
    mode: app.mode,
    automation_rule_id: null,
    cv_variant_id: null,
    base_cv_id: null,
    priority: 0,
    board_rank: app.rank,
    archived: false,
    follow_up_at: null,
    sections: [],
    last_change_source: app.source,
    revision: 1,
    created_at: app.now,
    updated_at: app.now,
  };
}

/** `user_jobs.inbox_state` → `value` (+ revision, change_log). */
export function setInboxStateStatements(
  db: JobsDb,
  scope: UserScope,
  userJobId: string,
  value: "tracked" | "dismissed",
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE user_jobs SET inbox_state = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?",
      value,
      now,
      userJobId,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "user_job",
      table: "user_jobs",
      id: userJobId,
      now,
    }),
  ];
}

/**
 * Rank rewrites of a column rebalance (06 §1.2): every card except `skipId`
 * (the moved card, written by its own UPDATE) gets its new rank with
 * `revision + 1` and a change_log row. `updated_at` and the change source
 * stay: re-spacing ranks is housekeeping, not an edit of the card.
 */
export function rankRewriteStatements(
  db: JobsDb,
  scope: UserScope,
  ranks: ReadonlyArray<{ id: string; rank: string }>,
  skipId: string | null,
  now: number
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const { id, rank } of ranks) {
    if (id === skipId) {
      continue;
    }
    statements.push(
      stmt(
        db,
        "UPDATE applications SET board_rank = ?, revision = revision + 1 WHERE id = ? AND user_id = ?",
        rank,
        id,
        scope.userId
      ),
      appendChangeFromRow(db, scope, {
        entity: "application",
        table: "applications",
        id,
        now,
      })
    );
  }
  return statements;
}

/** Writable application columns of PATCH / move / archive (05 §5). */
export interface ApplicationFieldChanges {
  archived?: boolean;
  base_cv_id?: string | null;
  board_rank?: string;
  follow_up_at?: number | null;
  mode?: ApplicationMode;
  priority?: number;
  sections?: LegacyJobSection[];
  /** Only for a second stage hop planned after a transition (no bump). */
  stage?: Stage;
  stage_changed_at?: number;
}

function fieldAssignments(changes: ApplicationFieldChanges): {
  binds: unknown[];
  sets: string[];
} {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (changes.board_rank !== undefined) {
    sets.push("board_rank = ?");
    binds.push(changes.board_rank);
  }
  if (changes.mode !== undefined) {
    sets.push("mode = ?");
    binds.push(changes.mode);
  }
  if (changes.priority !== undefined) {
    sets.push("priority = ?");
    binds.push(changes.priority);
  }
  if (changes.archived !== undefined) {
    sets.push("archived = ?");
    binds.push(sqlBool(changes.archived));
  }
  if (changes.follow_up_at !== undefined) {
    sets.push("follow_up_at = ?");
    binds.push(changes.follow_up_at);
  }
  if (changes.base_cv_id !== undefined) {
    sets.push("base_cv_id = ?");
    binds.push(changes.base_cv_id);
  }
  if (changes.sections !== undefined) {
    sets.push("sections = ?");
    binds.push(encodeJson(changes.sections));
  }
  if (changes.stage !== undefined) {
    sets.push("stage = ?");
    binds.push(changes.stage);
  }
  if (changes.stage_changed_at !== undefined) {
    sets.push("stage_changed_at = ?");
    binds.push(changes.stage_changed_at);
  }
  return { sets, binds };
}

/**
 * UPDATE of the given columns, fenced on `revision = expectRevision`.
 *
 * - `bump: true`: this is the batch's write of the card: a revision guard
 *   (D-21, aborts the batch on a concurrent change), the UPDATE with
 *   `revision + 1`, `updated_at`, `last_change_source`, and the change_log row.
 * - `bump: false`: a stage transition earlier in the same batch already
 *   bumped the revision to `expectRevision` and logged it; only the columns
 *   are written.
 */
export function updateFieldsStatements(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  changes: ApplicationFieldChanges,
  options: {
    bump: boolean;
    expectRevision: number;
    now: number;
    source: ChangeSource;
  }
): D1PreparedStatement[] {
  const { sets, binds } = fieldAssignments(changes);
  if (options.bump) {
    sets.push(
      "revision = revision + 1",
      "updated_at = ?",
      "last_change_source = ?"
    );
    binds.push(options.now, options.source);
  }
  if (sets.length === 0) {
    return [];
  }
  const update = stmt(
    db,
    `UPDATE applications SET ${sets.join(", ")} WHERE id = ? AND user_id = ? AND revision = ?`,
    ...binds,
    applicationId,
    scope.userId,
    options.expectRevision
  );
  if (!options.bump) {
    return [update];
  }
  return [
    guardRevision(
      db,
      scope,
      "applications",
      applicationId,
      options.expectRevision
    ),
    update,
    appendChange(db, scope, {
      entity: "application",
      entityId: applicationId,
      revision: options.expectRevision + 1,
      now: options.now,
    }),
  ];
}

/** Runs a planned batch outside a route (services called by MCP tools). */
export async function commitApplicationBatch(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  await runBatch(db, statements);
}

/** Title and company of the posting an application tracks, or null. */
export async function postingTitleOf(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<{ company_name: string; title: string } | null> {
  return await queryFirst<{ company_name: string; title: string }>(
    db,
    "SELECT p.title, p.company_name FROM applications a JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id JOIN job_postings p ON p.id = u.posting_id WHERE a.id = ? AND a.user_id = ?",
    applicationId,
    scope.userId
  );
}
