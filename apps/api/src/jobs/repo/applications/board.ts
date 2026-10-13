// Board and list reads (06 §1.3–§1.4, 05 §5).
//
// The board is ONE statement over the `ix_apps_board(user_id, archived,
// stage, board_rank)` range (04 §3): applications joined to their user_job
// and posting, with the denormalized card fields as correlated subqueries
// (score of the current profile_version, live apply task, next pending
// interview, latest offer). The closed lanes (`rejected`, `withdrawn`) keep
// their 200 most recently updated cards (window function over the same
// range); `lane_total` carries the full count. A second statement in the
// same read batch (one snapshot) returns the header counters and the
// change_log cursor.

import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { TASK_LIVE_STATES } from "@pilihpendidikan/jobs-contracts/enums";
import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import type { CursorKey } from "../../core/pagination";
import { keysetAfter } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { queryAll, runBatch, stmt } from "../core/db";

const LIVE_STATES_SQL = TASK_LIVE_STATES.map((s) => `'${s}'`).join(", ");
const CLOSED_LANES_SQL = "'rejected', 'withdrawn'";
const LIKE_SPECIAL_RE = /[\\%_]/g;

/** A card row: application columns, `p_*` posting columns, JSON subqueries. */
export interface CardRow {
  archived: number;
  board_rank: string;
  cv_variant_id: string | null;
  follow_up_at: number | null;
  id: string;
  /** Rows of the card's stage (board only). */
  lane_total?: number;
  latest_offer_status: string | null;
  legacy_job_id: string | null;
  mode: string;
  next_interview_at: number | null;
  p_apply_url: string | null;
  p_closed_at: number | null;
  p_company_domain: string | null;
  p_company_name: string;
  p_id: string;
  p_locations: string;
  p_source_kind: string;
  p_status: string;
  p_title: string;
  p_workplace_type: string | null;
  priority: number;
  revision: number;
  score_json: string | null;
  stage: Stage;
  stage_changed_at: number;
  submission_status: string;
  task_json: string | null;
  updated_at: number;
  user_job_id: string;
}

export interface BoardCounters {
  approvals_pending: number;
  cursor: number;
  follow_ups_due: number;
  inbox_new: number;
  tasks_live: number;
  unconfirmed: number;
}

// The card's posting summary and denormalized fields; `a` is the application
// (or the windowed derived table over it), `p` the posting.
const CARD_SELECT = `a.id, a.revision, a.user_job_id, a.legacy_job_id, a.stage, a.stage_changed_at, a.board_rank, a.submission_status, a.mode, a.priority, a.archived, a.follow_up_at, a.cv_variant_id, a.updated_at,
  p.id AS p_id, p.title AS p_title, p.company_name AS p_company_name, p.company_domain AS p_company_domain, p.locations AS p_locations, p.workplace_type AS p_workplace_type, p.source_kind AS p_source_kind, p.apply_url AS p_apply_url, p.status AS p_status, p.closed_at AS p_closed_at,
  (SELECT json_object('score', s.score, 'status', s.status, 'confidence', s.confidence, 'model', s.model, 'profile_version', s.profile_version, 'rubric_version', s.rubric_version, 'explanation', s.explanation, 'created_at', s.created_at) FROM match_scores s WHERE s.user_id = a.user_id AND s.posting_id = p.id AND s.profile_version = ? ORDER BY (s.rubric_version = ?) DESC, s.created_at DESC LIMIT 1) AS score_json,
  (SELECT json_object('id', t.id, 'kind', t.kind, 'state', t.state, 'lease_device_id', t.lease_device_id, 'target_device_id', t.target_device_id, 'pause_reason', t.pause_reason, 'progress', t.progress, 'submit_intent_at', t.submit_intent_at, 'updated_at', t.updated_at) FROM automation_tasks t WHERE t.user_id = a.user_id AND t.application_id = a.id AND t.kind = 'apply' AND t.state IN (${LIVE_STATES_SQL}) ORDER BY t.created_at DESC LIMIT 1) AS task_json,
  (SELECT MIN(i.scheduled_at) FROM interviews i WHERE i.user_id = a.user_id AND i.application_id = a.id AND i.outcome = 'pending' AND i.scheduled_at IS NOT NULL) AS next_interview_at,
  (SELECT o.status FROM offers o WHERE o.user_id = a.user_id AND o.application_id = a.id ORDER BY o.received_at DESC, o.created_at DESC, o.id DESC LIMIT 1) AS latest_offer_status`;

/**
 * The board statement (binds: profile_version, rubric_version, user_id,
 * closed-lane cap). The applications are read with one range of
 * `ix_apps_board(user_id, archived, …)`; the subqueries are per-card index
 * lookups.
 */
export function boardSql(includeArchived: boolean): string {
  const archived = includeArchived ? "" : " AND x.archived = 0";
  return `SELECT ${CARD_SELECT}, a.lane_total
    FROM (
      SELECT x.*,
        ROW_NUMBER() OVER (PARTITION BY x.stage ORDER BY x.updated_at DESC, x.id DESC) AS lane_pos,
        COUNT(*) OVER (PARTITION BY x.stage) AS lane_total
      FROM applications x
      WHERE x.user_id = ?${archived}
    ) a
    JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id
    JOIN job_postings p ON p.id = u.posting_id
    WHERE a.stage NOT IN (${CLOSED_LANES_SQL}) OR a.lane_pos <= ?
    ORDER BY a.stage, a.board_rank, a.id`;
}

export interface BoardQuery {
  /** Cap of each closed lane (06 §1.4). */
  closedLaneCap: number;
  includeArchived: boolean;
  now: number;
  profileVersion: number;
}

/**
 * The board rows (ordered by stage, board_rank) and the header counters,
 * read in one batch so the cursor matches the cards.
 */
export async function readBoard(
  db: JobsDb,
  scope: UserScope,
  query: BoardQuery
): Promise<{ counters: BoardCounters; rows: CardRow[] }> {
  const counters = stmt(
    db,
    `SELECT
      (SELECT COUNT(*) FROM approvals WHERE user_id = ? AND state = 'pending' AND expires_at > ?) AS approvals_pending,
      (SELECT COUNT(*) FROM user_jobs WHERE user_id = ? AND inbox_state = 'new') AS inbox_new,
      (SELECT COUNT(*) FROM applications WHERE user_id = ? AND archived = 0 AND follow_up_at IS NOT NULL AND follow_up_at <= ?) AS follow_ups_due,
      (SELECT COUNT(*) FROM applications WHERE user_id = ? AND archived = 0 AND submission_status IN ('submitted_unverified', 'outcome_unknown')) AS unconfirmed,
      (SELECT COUNT(*) FROM automation_tasks WHERE user_id = ? AND state IN (${LIVE_STATES_SQL})) AS tasks_live,
      (SELECT COALESCE(MAX(seq), 0) FROM change_log WHERE user_id = ?) AS cursor`,
    scope.userId,
    query.now,
    scope.userId,
    scope.userId,
    query.now,
    scope.userId,
    scope.userId,
    scope.userId
  );
  const board = stmt(
    db,
    boardSql(query.includeArchived),
    query.profileVersion,
    RUBRIC_VERSION,
    scope.userId,
    query.closedLaneCap
  );
  const [counterResult, boardResult] = await runBatch(db, [counters, board]);
  const counterRow = (counterResult?.results?.[0] ??
    {}) as Partial<BoardCounters>;
  return {
    counters: {
      approvals_pending: counterRow.approvals_pending ?? 0,
      inbox_new: counterRow.inbox_new ?? 0,
      follow_ups_due: counterRow.follow_ups_due ?? 0,
      unconfirmed: counterRow.unconfirmed ?? 0,
      tasks_live: counterRow.tasks_live ?? 0,
      cursor: counterRow.cursor ?? 0,
    },
    rows: (boardResult?.results ?? []) as CardRow[],
  };
}

export interface CardListQuery {
  cursor: CursorKey | null;
  includeArchived: boolean;
  limit: number;
  profileVersion: number;
  /** Free-text filter on title and company. */
  q: string | null;
  stage: Stage | null;
}

function likePattern(text: string): string {
  return `%${text.replace(LIKE_SPECIAL_RE, (c) => `\\${c}`)}%`;
}

/**
 * A page of cards, most recently updated first (`ix_apps_updated`), keyset
 * on `(updated_at, id)`. Fetches `limit + 1` rows (the extra one signals a
 * next page).
 */
export async function listCardRows(
  db: JobsDb,
  scope: UserScope,
  query: CardListQuery
): Promise<CardRow[]> {
  const filters: string[] = [];
  const binds: unknown[] = [];
  if (!query.includeArchived) {
    filters.push("a.archived = 0");
  }
  if (query.stage) {
    filters.push("a.stage = ?");
    binds.push(query.stage);
  }
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      "(p.title LIKE ? ESCAPE '\\' OR p.company_name LIKE ? ESCAPE '\\')"
    );
    binds.push(pattern, pattern);
  }
  const keyset = keysetAfter(["a.updated_at", "a.id"], query.cursor, "desc");
  if (keyset.sql) {
    filters.push(keyset.sql);
    binds.push(...keyset.binds);
  }
  const where = filters.map((f) => ` AND ${f}`).join("");
  return await queryAll<CardRow>(
    db,
    `SELECT ${CARD_SELECT}
    FROM applications a
    JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id
    JOIN job_postings p ON p.id = u.posting_id
    WHERE a.user_id = ?${where}
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ?`,
    query.profileVersion,
    RUBRIC_VERSION,
    scope.userId,
    ...binds,
    query.limit + 1
  );
}

/** Device ids per lookup (D1 binds at most 100 parameters). */
const DEVICE_LOOKUP_CHUNK = 90;

/** Names of the user's devices (identity database `DB`, 04 §1). */
export async function deviceNames(
  identityDb: D1Database,
  scope: UserScope,
  deviceIds: readonly string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(deviceIds)];
  for (let i = 0; i < unique.length; i += DEVICE_LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + DEVICE_LOOKUP_CHUNK);
    const result = await identityDb
      .prepare(
        `SELECT id, name FROM devices WHERE user_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`
      )
      .bind(scope.userId, ...chunk)
      .all<{ id: string; name: string }>();
    for (const row of result.results ?? []) {
      names.set(row.id, row.name);
    }
  }
  return names;
}
