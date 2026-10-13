// Analytics reads and the `analytics_daily` writes (10, 04 §2.7). Every
// statement is user-scoped (04 §5); analytics never reads another database
// (10 §1: no cross-database joins). The only system statement is the cron's
// candidate scan (`listRollupCandidates`).
//
// Loaders return plain rows; the arithmetic lives in services/analytics so
// the summary, the daily rollup and the rebuild share one definition of every
// metric (T10-07, S-27). Only `applied_to_state = 1` events are read (10 §1).
//
// `analytics_daily.metrics.ai_cost_micro_usd` is written by the AI budget
// (repo/core/ai-usage.ts) and is not derivable from events: every write here
// keeps it (an upsert copies it over, a day without activity keeps a
// `{ai_cost_micro_usd}` row instead of being deleted).

import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeJson, queryAll, queryFirst, runBatch, stmt } from "../core/db";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface ApplicationFactRow {
  archived: number;
  created_at: number;
  cv_variant_id: string | null;
  follow_up_at: number | null;
  id: string;
  legacy_job_id: string | null;
  mode: string;
  posting_id: string;
  source_id: string | null;
  stage: string;
  submission_method: string | null;
  submission_status: string;
  updated_at: number;
}

/** `created`, `stage_changed` and `legacy_imported` events (payload fields extracted). */
export interface StageEventRow {
  application_id: string;
  from_value: string | null;
  id: string;
  legacy_status: string | null;
  legacy_updated_at: number | null;
  /** `payload.mode` of a stage change (the mode when it happened). */
  mode: string | null;
  occurred_at: number;
  /** `payload.stage` of a `created` event. */
  payload_stage: string | null;
  recorded_at: number;
  to_value: string | null;
  type: "created" | "stage_changed" | "legacy_imported";
}

export interface InterviewFactRow {
  application_id: string;
  created_at: number;
  round: number;
}

export interface SubmissionEventRow {
  application_id: string;
  recorded_at: number;
  to_value: string | null;
}

export interface ActivityEventRow {
  application_id: string;
  attempt_id: string | null;
  pause_reason: string | null;
  recorded_at: number;
  type: "interview_scheduled" | "automation_task_paused" | "note_added";
}

export interface TaskFactRow {
  error_class: string | null;
  finished_at: number;
  id: string;
  state: string;
  verified: number;
}

export interface AttemptFactRow {
  ended_at: number | null;
  id: string;
  paused: number;
  started_at: number;
}

/** Everything the summary and the rollup need for one user. */
export interface AnalyticsData {
  activity: ActivityEventRow[];
  answerApprovals: number[];
  applications: ApplicationFactRow[];
  attempts: AttemptFactRow[];
  discovered: number[];
  interviews: InterviewFactRow[];
  scored: number[];
  stageEvents: StageEventRow[];
  submissionEvents: SubmissionEventRow[];
  tasks: TaskFactRow[];
}

/** `[fromMs, toMs)` of the time-bounded parts (activity, tasks, attempts…). */
export interface TimeRange {
  fromMs: number;
  toMs: number;
}

const TERMINAL_APPLY_STATES =
  "'submitted', 'failed', 'cancelled', 'outcome_unknown', 'expired'";

export type TimelineData = Pick<
  AnalyticsData,
  "applications" | "stageEvents" | "interviews"
>;

/**
 * The whole stage history of one user: applications, `created` /
 * `stage_changed` / `legacy_imported` events and interviews. "Reached" needs
 * every application's first time per stage, so these are never time-bounded.
 */
export async function loadTimelineData(
  db: JobsDb,
  scope: UserScope
): Promise<TimelineData> {
  const user = scope.userId;
  const [applications, stageEvents, interviews] = await Promise.all([
    queryAll<ApplicationFactRow>(
      db,
      "SELECT a.id, a.created_at, a.updated_at, a.stage, a.submission_status, a.submission_method, a.mode, a.cv_variant_id, a.legacy_job_id, a.follow_up_at, a.archived, u.posting_id, u.source_id FROM applications a JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id WHERE a.user_id = ?",
      user
    ),
    queryAll<StageEventRow>(
      db,
      "SELECT id, application_id, type, from_value, to_value, recorded_at, occurred_at, json_extract(payload, '$.legacy_status') AS legacy_status, json_extract(payload, '$.legacy_updated_at') AS legacy_updated_at, json_extract(payload, '$.mode') AS mode, json_extract(payload, '$.stage') AS payload_stage FROM application_events WHERE user_id = ? AND applied_to_state = 1 AND type IN ('created', 'stage_changed', 'legacy_imported') ORDER BY application_id, recorded_at, id",
      user
    ),
    queryAll<InterviewFactRow>(
      db,
      "SELECT application_id, round, created_at FROM interviews WHERE user_id = ?",
      user
    ),
  ]);
  return {
    applications,
    stageEvents: stageEvents.map(normalizeStageEvent),
    interviews,
  };
}

/**
 * Loads one user's analytics inputs: the stage history whole
 * (`loadTimelineData`), everything else only inside `range`.
 */
export async function loadAnalyticsData(
  db: JobsDb,
  scope: UserScope,
  range: TimeRange
): Promise<AnalyticsData> {
  const user = scope.userId;
  const { fromMs, toMs } = range;
  const [
    timeline,
    submissionEvents,
    activity,
    tasks,
    attempts,
    answerApprovals,
    discovered,
    scored,
  ] = await Promise.all([
    loadTimelineData(db, scope),
    queryAll<SubmissionEventRow>(
      db,
      "SELECT application_id, to_value, recorded_at FROM application_events WHERE user_id = ? AND applied_to_state = 1 AND type = 'submission_status_changed' AND recorded_at >= ? AND recorded_at < ?",
      user,
      fromMs,
      toMs
    ),
    queryAll<ActivityEventRow>(
      db,
      "SELECT type, application_id, attempt_id, recorded_at, json_extract(payload, '$.pause_reason') AS pause_reason FROM application_events WHERE user_id = ? AND applied_to_state = 1 AND recorded_at >= ? AND recorded_at < ? AND (type IN ('interview_scheduled', 'automation_task_paused') OR (type = 'note_added' AND json_extract(payload, '$.kind') = 'follow_up_done'))",
      user,
      fromMs,
      toMs
    ),
    queryAll<TaskFactRow>(
      db,
      `SELECT t.id, t.state, t.error_class, COALESCE(t.finished_at, t.updated_at) AS finished_at, EXISTS (SELECT 1 FROM submission_evidence e WHERE e.user_id = t.user_id AND e.task_id = t.id AND e.verdict = 'verified') AS verified FROM automation_tasks t WHERE t.user_id = ? AND t.kind = 'apply' AND t.state IN (${TERMINAL_APPLY_STATES}) AND COALESCE(t.finished_at, t.updated_at) >= ? AND COALESCE(t.finished_at, t.updated_at) < ?`,
      user,
      fromMs,
      toMs
    ),
    queryAll<AttemptFactRow>(
      db,
      "SELECT a.id, a.started_at, a.ended_at, EXISTS (SELECT 1 FROM application_events e WHERE e.user_id = a.user_id AND e.attempt_id = a.id AND e.type = 'automation_task_paused' AND e.applied_to_state = 1) AS paused FROM automation_attempts a JOIN automation_tasks t ON t.id = a.task_id AND t.user_id = a.user_id WHERE a.user_id = ? AND t.kind = 'apply' AND a.started_at >= ? AND a.started_at < ?",
      user,
      fromMs,
      toMs
    ),
    timesOf(
      db,
      "SELECT created_at AS at FROM approvals WHERE user_id = ? AND kind = 'answer' AND created_at >= ? AND created_at < ?",
      user,
      fromMs,
      toMs
    ),
    timesOf(
      db,
      "SELECT created_at AS at FROM user_jobs WHERE user_id = ? AND origin = 'discovered' AND created_at >= ? AND created_at < ?",
      user,
      fromMs,
      toMs
    ),
    timesOf(
      db,
      "SELECT created_at AS at FROM match_scores WHERE user_id = ? AND status = 'ready' AND created_at >= ? AND created_at < ?",
      user,
      fromMs,
      toMs
    ),
  ]);
  return {
    ...timeline,
    submissionEvents,
    activity,
    tasks,
    attempts,
    answerApprovals,
    discovered,
    scored,
  };
}

/**
 * The user's IANA zone (`user_settings.timezone`), or null without a settings
 * row. Read-only: analytics never creates the lazy settings row (a purged
 * user must not get one back from a late rollup message).
 */
export async function readUserTimezone(
  db: JobsDb,
  scope: UserScope
): Promise<string | null> {
  const row = await queryFirst<{ timezone: string }>(
    db,
    "SELECT timezone FROM user_settings WHERE user_id = ?",
    scope.userId
  );
  return row?.timezone ?? null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function normalizeStageEvent(row: StageEventRow): StageEventRow {
  return {
    ...row,
    legacy_status: stringOrNull(row.legacy_status),
    legacy_updated_at: numberOrNull(row.legacy_updated_at),
    mode: stringOrNull(row.mode),
    payload_stage: stringOrNull(row.payload_stage),
  };
}

async function timesOf(
  db: JobsDb,
  sql: string,
  ...binds: unknown[]
): Promise<number[]> {
  const rows = await queryAll<{ at: number }>(db, sql, ...binds);
  return rows.map((row) => row.at);
}

// ---------------------------------------------------------------------------
// Breakdown dimensions (10 §2.6)
// ---------------------------------------------------------------------------

export interface PostingFactRow {
  company_name: string;
  id: string;
  seniority: string | null;
  source_kind: string;
  workplace_type: string | null;
}

/** The postings behind the user's applications. */
export async function loadApplicationPostings(
  db: JobsDb,
  scope: UserScope
): Promise<PostingFactRow[]> {
  return await queryAll<PostingFactRow>(
    db,
    "SELECT DISTINCT p.id, p.source_kind, p.company_name, p.workplace_type, p.seniority FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id JOIN applications a ON a.user_job_id = u.id AND a.user_id = u.user_id WHERE u.user_id = ?",
    scope.userId
  );
}

export interface SourceFactRow {
  adapter: string;
  id: string;
  label: string;
}

export async function loadSources(
  db: JobsDb,
  scope: UserScope
): Promise<SourceFactRow[]> {
  return await queryAll<SourceFactRow>(
    db,
    "SELECT id, adapter, label FROM job_sources WHERE user_id = ?",
    scope.userId
  );
}

export interface ScoreFactRow {
  created_at: number;
  posting_id: string;
  score: number;
}

/** Every ready score of the postings the user applies to (oldest first). */
export async function loadApplicationScores(
  db: JobsDb,
  scope: UserScope
): Promise<ScoreFactRow[]> {
  return await queryAll<ScoreFactRow>(
    db,
    "SELECT posting_id, score, created_at FROM match_scores WHERE user_id = ? AND status = 'ready' AND posting_id IN (SELECT u.posting_id FROM applications a JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id WHERE a.user_id = ?) ORDER BY posting_id, created_at, id",
    scope.userId,
    scope.userId
  );
}

export interface VariantFactRow {
  id: string;
  template: string;
}

export async function loadAttachedVariants(
  db: JobsDb,
  scope: UserScope
): Promise<VariantFactRow[]> {
  return await queryAll<VariantFactRow>(
    db,
    "SELECT id, template FROM cv_variants WHERE user_id = ? AND id IN (SELECT cv_variant_id FROM applications WHERE user_id = ? AND cv_variant_id IS NOT NULL)",
    scope.userId,
    scope.userId
  );
}

// ---------------------------------------------------------------------------
// analytics_daily
// ---------------------------------------------------------------------------

export interface DailyRow {
  day: string;
  metrics: Record<string, unknown>;
}

/** The user's rollup rows with `from <= day <= to`, in day order. */
export async function listDailyRows(
  db: JobsDb,
  scope: UserScope,
  from: string,
  to: string
): Promise<DailyRow[]> {
  const rows = await queryAll<{ day: string; metrics: string }>(
    db,
    "SELECT day, metrics FROM analytics_daily WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day",
    scope.userId,
    from,
    to
  );
  return rows.map((row) => ({
    day: row.day,
    metrics: decodeJson<Record<string, unknown>>(row.metrics, {}),
  }));
}

/** Every rollup row of the user (scripts, tests). */
export async function listAllDailyRows(
  db: JobsDb,
  scope: UserScope
): Promise<DailyRow[]> {
  return await listDailyRows(db, scope, "0000-00-00", "9999-99-99");
}

const KEEP_AI_COST =
  "CASE WHEN json_extract(analytics_daily.metrics, '$.ai_cost_micro_usd') IS NULL THEN excluded.metrics ELSE json_set(excluded.metrics, '$.ai_cost_micro_usd', json_extract(analytics_daily.metrics, '$.ai_cost_micro_usd')) END";

/**
 * Statements that make `day` hold exactly `metrics` (event counters) while
 * keeping its AI spend. `null` = no activity that day: the row goes away,
 * or shrinks to `{ai_cost_micro_usd}` when there was AI spend.
 */
export function writeDayStatements(
  db: JobsDb,
  scope: UserScope,
  day: string,
  metrics: Record<string, unknown> | null
): D1PreparedStatement[] {
  if (metrics) {
    return [
      stmt(
        db,
        `INSERT INTO analytics_daily (user_id, day, metrics) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET metrics = ${KEEP_AI_COST}`,
        scope.userId,
        day,
        JSON.stringify(metrics)
      ),
    ];
  }
  return [
    stmt(
      db,
      "DELETE FROM analytics_daily WHERE user_id = ? AND day = ? AND COALESCE(json_extract(metrics, '$.ai_cost_micro_usd'), 0) = 0",
      scope.userId,
      day
    ),
    stmt(
      db,
      "UPDATE analytics_daily SET metrics = json_object('ai_cost_micro_usd', json_extract(metrics, '$.ai_cost_micro_usd')) WHERE user_id = ? AND day = ? AND COALESCE(json_extract(metrics, '$.ai_cost_micro_usd'), 0) > 0",
      scope.userId,
      day
    ),
  ];
}

/**
 * Statements of a rebuild for the days NOT in `keepDays`: rows without AI
 * spend are deleted, the others shrink to `{ai_cost_micro_usd}`.
 */
export function clearOtherDaysStatements(
  db: JobsDb,
  scope: UserScope,
  keepDays: readonly string[]
): D1PreparedStatement[] {
  const keep = JSON.stringify(keepDays);
  return [
    stmt(
      db,
      "DELETE FROM analytics_daily WHERE user_id = ? AND day NOT IN (SELECT value FROM json_each(?)) AND COALESCE(json_extract(metrics, '$.ai_cost_micro_usd'), 0) = 0",
      scope.userId,
      keep
    ),
    stmt(
      db,
      "UPDATE analytics_daily SET metrics = json_object('ai_cost_micro_usd', json_extract(metrics, '$.ai_cost_micro_usd')) WHERE user_id = ? AND day NOT IN (SELECT value FROM json_each(?)) AND COALESCE(json_extract(metrics, '$.ai_cost_micro_usd'), 0) > 0",
      scope.userId,
      keep
    ),
  ];
}

/** Statements per batch of a rollup write (D1 batches stay small). */
export const DAILY_WRITE_CHUNK = 100;

/**
 * Runs the rollup writes. Every statement is self-contained (it re-reads the
 * AI spend it keeps), so the chunks need not share one transaction; a
 * replay writes the same rows (14 §6).
 */
export async function runDailyWrites(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  for (let i = 0; i < statements.length; i += DAILY_WRITE_CHUNK) {
    await runBatch(db, statements.slice(i, i + DAILY_WRITE_CHUNK));
  }
}

/** Applications with an unconfirmed submission recorded in `[fromMs, toMs)`. */
export async function countUnconfirmed(
  db: JobsDb,
  scope: UserScope,
  range: TimeRange
): Promise<number> {
  const row = await queryFirst<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND submission_status = 'submitted_unverified' AND submitted_at >= ? AND submitted_at < ?",
    scope.userId,
    range.fromMs,
    range.toMs
  );
  return row?.n ?? 0;
}

/** Applications with a follow-up due in `[fromMs, toMs)` (10 §2.5). */
export async function countFollowUpsDue(
  db: JobsDb,
  scope: UserScope,
  range: TimeRange
): Promise<number> {
  const row = await queryFirst<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND follow_up_at >= ? AND follow_up_at < ?",
    scope.userId,
    range.fromMs,
    range.toMs
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// The daily cron (10 §4, 14 §7)
// ---------------------------------------------------------------------------

export interface RollupCandidate {
  timezone: string | null;
  user_id: string;
}

/**
 * Users with activity since `since` (events, discovered jobs, scores or
 * apply tasks), in user-id order after `afterUserId`, with their timezone.
 */
export async function listRollupCandidates(
  db: JobsDb,
  options: { afterUserId: string; limit: number; since: number }
): Promise<RollupCandidate[]> {
  // sql-allow: system — the daily analytics cron finds every user with recent activity (14 §7); each user is then rolled up with a trusted scope
  const sql = `SELECT c.user_id, s.timezone FROM (
      SELECT user_id FROM application_events WHERE recorded_at >= ?
      UNION SELECT user_id FROM user_jobs WHERE created_at >= ?
      UNION SELECT user_id FROM match_scores WHERE created_at >= ?
      UNION SELECT user_id FROM automation_tasks WHERE updated_at >= ?
    ) AS c LEFT JOIN user_settings s ON s.user_id = c.user_id
    WHERE c.user_id > ? ORDER BY c.user_id LIMIT ?`;
  return await queryAll<RollupCandidate>(
    db,
    sql,
    options.since,
    options.since,
    options.since,
    options.since,
    options.afterUserId,
    options.limit
  );
}
