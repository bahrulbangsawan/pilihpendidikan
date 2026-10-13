// The Kanban board and the card list (06 §1.3–§1.4, 05 §5).

import type {
  BoardCard,
  BoardResponse,
  LiveTaskSummary,
  PostingSummary,
  ScoreSummary,
} from "@pilihpendidikan/jobs-contracts/api";
import { BOARD_CLOSED_LANE_CAP } from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationMode,
  MatchScoreStatus,
  OfferStatus,
  PauseReason,
  PostingStatus,
  ProgressStage,
  SourceKind,
  Stage,
  SubmissionStatus,
  TaskKind,
  TaskState,
  WorkplaceType,
} from "@pilihpendidikan/jobs-contracts/enums";
import { STAGES } from "@pilihpendidikan/jobs-contracts/enums";
import { DETERMINISTIC_ONLY_MODEL } from "@pilihpendidikan/jobs-contracts/scoring";
import type { CursorKey, Page } from "../../core/pagination";
import { pageOf } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import type { CardRow } from "../../repo/applications/board";
import {
  deviceNames,
  listCardRows,
  readBoard,
} from "../../repo/applications/board";
import type { JobsDb } from "../../repo/core/db";

const CLOSED_LANES: readonly Stage[] = ["rejected", "withdrawn"];

export interface BoardOptions {
  /** Identity database `DB`, to name the devices of live tasks (04 §1). */
  identityDb?: D1Database | null;
  /** `?include_archived=1`: archived cards too (default false). */
  includeArchived?: boolean;
  now: number;
  /** The caller's current profile_version (07 §2.1) for the score badge. */
  profileVersion: number;
}

interface ScoreJson {
  confidence: number | null;
  created_at: number;
  explanation: string;
  model: string;
  profile_version: number;
  rubric_version: string;
  score: number;
  status: MatchScoreStatus;
}

interface TaskJson {
  id: string;
  kind: TaskKind;
  lease_device_id: string | null;
  pause_reason: PauseReason | null;
  progress: string | null;
  state: TaskState;
  submit_intent_at: number | null;
  target_device_id: string | null;
  updated_at: number;
}

function parseJson<T>(text: string | null): T | null {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function firstLocation(locations: string): string | null {
  const parsed = parseJson<Array<{ raw?: unknown }>>(locations);
  const raw = Array.isArray(parsed) ? parsed[0]?.raw : undefined;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function postingOf(row: CardRow): PostingSummary {
  return {
    id: row.p_id,
    title: row.p_title,
    company_name: row.p_company_name,
    company_domain: row.p_company_domain,
    location: firstLocation(row.p_locations),
    workplace_type: row.p_workplace_type as WorkplaceType | null,
    source_kind: row.p_source_kind as SourceKind,
    apply_url: row.p_apply_url,
    status: row.p_status as PostingStatus,
    closed_at: row.p_closed_at,
  };
}

function scoreOf(row: CardRow): ScoreSummary | null {
  const score = parseJson<ScoreJson>(row.score_json);
  if (!score) {
    return null;
  }
  return {
    posting_id: row.p_id,
    score: score.score,
    status: score.status,
    confidence: score.confidence,
    deterministic_only: score.model === DETERMINISTIC_ONLY_MODEL,
    profile_version: score.profile_version,
    rubric_version: score.rubric_version,
    explanation: score.explanation,
    created_at: score.created_at,
  };
}

function taskDevice(task: TaskJson): string | null {
  return task.lease_device_id ?? task.target_device_id ?? null;
}

function liveTaskOf(
  row: CardRow,
  names: ReadonlyMap<string, string>
): LiveTaskSummary | null {
  const task = parseJson<TaskJson>(row.task_json);
  if (!task) {
    return null;
  }
  const deviceId = taskDevice(task);
  const progress = parseJson<{ stage?: unknown }>(task.progress);
  return {
    id: task.id,
    kind: task.kind,
    state: task.state,
    device_id: deviceId,
    device_name: deviceId ? (names.get(deviceId) ?? null) : null,
    pause_reason: task.pause_reason,
    progress_stage:
      typeof progress?.stage === "string"
        ? (progress.stage as ProgressStage)
        : null,
    submit_intent_at: task.submit_intent_at,
    updated_at: task.updated_at,
  };
}

/** A card row → the denormalized card of 06 §1.3. */
export function toCard(
  row: CardRow,
  now: number,
  names: ReadonlyMap<string, string>
): BoardCard {
  return {
    id: row.id,
    revision: row.revision,
    user_job_id: row.user_job_id,
    legacy_job_id: row.legacy_job_id,
    stage: row.stage,
    stage_changed_at: row.stage_changed_at,
    board_rank: row.board_rank,
    submission_status: row.submission_status as SubmissionStatus,
    mode: row.mode as ApplicationMode,
    priority: row.priority,
    archived: row.archived === 1,
    follow_up_at: row.follow_up_at,
    follow_up_due: row.follow_up_at !== null && row.follow_up_at <= now,
    cv_variant_id: row.cv_variant_id,
    updated_at: row.updated_at,
    posting: postingOf(row),
    score: scoreOf(row),
    live_task: liveTaskOf(row, names),
    next_interview_at: row.next_interview_at,
    latest_offer_status: row.latest_offer_status as OfferStatus | null,
  };
}

async function namesFor(
  identityDb: D1Database | null | undefined,
  scope: UserScope,
  rows: readonly CardRow[]
): Promise<Map<string, string>> {
  if (!identityDb) {
    return new Map();
  }
  const ids: string[] = [];
  for (const row of rows) {
    const task = parseJson<TaskJson>(row.task_json);
    const deviceId = task ? taskDevice(task) : null;
    if (deviceId) {
      ids.push(deviceId);
    }
  }
  return await deviceNames(identityDb, scope, ids);
}

/** The caller's board (06 §1.4). */
export async function buildBoard(
  db: JobsDb,
  scope: UserScope,
  opts: BoardOptions
): Promise<BoardResponse> {
  const { counters, rows } = await readBoard(db, scope, {
    now: opts.now,
    profileVersion: opts.profileVersion,
    includeArchived: opts.includeArchived ?? false,
    closedLaneCap: BOARD_CLOSED_LANE_CAP,
  });
  const names = await namesFor(opts.identityDb, scope, rows);
  const byStage = new Map<Stage, { cards: BoardCard[]; total: number }>(
    STAGES.map((stage) => [stage, { cards: [], total: 0 }])
  );
  for (const row of rows) {
    const column = byStage.get(row.stage);
    if (column) {
      column.cards.push(toCard(row, opts.now, names));
      column.total = row.lane_total ?? column.cards.length;
    }
  }
  return {
    columns: STAGES.map((stage) => {
      const column = byStage.get(stage) ?? { cards: [], total: 0 };
      return {
        stage,
        cards: column.cards,
        total: column.total,
        has_more:
          CLOSED_LANES.includes(stage) && column.total > column.cards.length,
      };
    }),
    counts: {
      approvals_pending: counters.approvals_pending,
      inbox_new: counters.inbox_new,
      follow_ups_due: counters.follow_ups_due,
      unconfirmed: counters.unconfirmed,
      tasks_live: counters.tasks_live,
    },
    cursor: counters.cursor,
    generated_at: opts.now,
  };
}

export interface CardListOptions {
  cursor: CursorKey | null;
  identityDb?: D1Database | null;
  includeArchived: boolean;
  limit: number;
  now: number;
  profileVersion: number;
  q: string | null;
  stage: Stage | null;
}

/** `GET /api/v1/applications`: cards, most recently updated first. */
export async function listCards(
  db: JobsDb,
  scope: UserScope,
  opts: CardListOptions
): Promise<Page<BoardCard>> {
  const rows = await listCardRows(db, scope, {
    cursor: opts.cursor,
    includeArchived: opts.includeArchived,
    limit: opts.limit,
    profileVersion: opts.profileVersion,
    q: opts.q,
    stage: opts.stage,
  });
  const page = pageOf(rows, opts.limit, (row) => [row.updated_at, row.id]);
  const names = await namesFor(opts.identityDb, scope, page.items);
  return {
    items: page.items.map((row) => toCard(row, opts.now, names)),
    next_cursor: page.next_cursor,
  };
}
