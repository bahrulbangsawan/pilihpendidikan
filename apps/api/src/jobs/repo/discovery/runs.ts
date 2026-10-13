// `discovery_runs`, `discovery_run_items` and run completion (05 §4,
// 15 §9 / §12, 03 §4.3).
//
// Completion closes postings by absence: for each source the CLI enumerated
// completely, the caller's linked postings of that source that this run did
// not see get `missed_runs + 1`, and those reaching 2 are closed. The planner
// reads the candidates first; the batch re-checks them with a checksum guard
// (count, Σ missed_runs, Σ revision) so a concurrent sighting re-plans the
// completion instead of closing a posting that was just seen.

import type { DiscoveryRunRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { CursorKey } from "../../core/pagination";
import { keysetAfter } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import {
  decodeRow,
  encodeJson,
  guard,
  queryAll,
  queryFirst,
  stmt,
} from "../core/db";
import { appendChange } from "../core/change-log";
import { chunk, IN_CHUNK, marks } from "./sql";

/** Missed complete runs after which a posting is closed (03 §4.3). */
export const CLOSE_AFTER_MISSED_RUNS = 2;

export async function getRun(
  db: JobsDb,
  scope: UserScope,
  runId: string
): Promise<DiscoveryRunRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM discovery_runs WHERE id = ? AND user_id = ?",
    runId,
    scope.userId
  );
  return row ? decodeRow<DiscoveryRunRecord>("discovery_runs", row) : null;
}

/** True when `taskId` is one of the caller's automation tasks. */
export async function ownsTask(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<boolean> {
  const row = await queryFirst<{ one: number }>(
    db,
    "SELECT 1 AS one FROM automation_tasks WHERE id = ? AND user_id = ?",
    taskId,
    scope.userId
  );
  return row !== null;
}

/** The INSERT of a new run (+ its change_log row). */
export function insertRunStatements(
  db: JobsDb,
  scope: UserScope,
  run: DiscoveryRunRecord,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO discovery_runs (id, user_id, device_id, task_id, sources, status, started_at, finished_at, stats, errors, engine_version, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      run.id,
      scope.userId,
      run.device_id,
      run.task_id,
      encodeJson(run.sources),
      run.status,
      run.started_at,
      run.finished_at,
      encodeJson(run.stats),
      encodeJson(run.errors),
      run.engine_version,
      run.revision
    ),
    appendChange(db, scope, {
      entity: "run",
      entityId: run.id,
      revision: run.revision,
      now,
    }),
  ];
}

/** The caller's runs, newest first (keyset on started_at, id). */
export async function listRuns(
  db: JobsDb,
  scope: UserScope,
  page: { cursor: CursorKey | null; limit: number }
): Promise<DiscoveryRunRecord[]> {
  const after = keysetAfter(["started_at", "id"], page.cursor, "desc");
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM discovery_runs WHERE user_id = ?${after.sql ? ` AND ${after.sql}` : ""} ORDER BY started_at DESC, id DESC LIMIT ?`,
    scope.userId,
    ...after.binds,
    page.limit + 1
  );
  return rows.map((row) =>
    decodeRow<DiscoveryRunRecord>("discovery_runs", row)
  );
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/** A fully enumerated source of the run, resolved for the caller. */
export interface CompleteSourceFilter {
  /** Set: match the caller's postings first delivered by this source. */
  sourceId: string | null;
  sourceKind: string;
  /** Used (and required) when `sourceId` is null. */
  sourceOrg: string | null;
}

export interface MissedCandidate {
  id: string;
  missed_runs: number;
  revision: number;
}

/**
 * The caller's open/unknown postings of `filter` not seen in `runId`
 * (03 §4.3 "not seen in this run").
 */
export async function missedCandidates(
  db: JobsDb,
  scope: UserScope,
  runId: string,
  filter: CompleteSourceFilter
): Promise<MissedCandidate[]> {
  if (filter.sourceId) {
    return await queryAll<MissedCandidate>(
      db,
      "SELECT DISTINCT p.id, p.missed_runs, p.revision FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id WHERE u.user_id = ? AND u.source_id = ? AND p.source_kind = ? AND p.status != 'closed' AND NOT EXISTS (SELECT 1 FROM discovery_run_items r WHERE r.run_id = ? AND r.user_id = ? AND r.posting_id = p.id)",
      scope.userId,
      filter.sourceId,
      filter.sourceKind,
      runId,
      scope.userId
    );
  }
  return await queryAll<MissedCandidate>(
    db,
    "SELECT DISTINCT p.id, p.missed_runs, p.revision FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id WHERE u.user_id = ? AND p.source_kind = ? AND p.source_org = ? AND p.status != 'closed' AND NOT EXISTS (SELECT 1 FROM discovery_run_items r WHERE r.run_id = ? AND r.user_id = ? AND r.posting_id = p.id)",
    scope.userId,
    filter.sourceKind,
    filter.sourceOrg,
    runId,
    scope.userId
  );
}

/** Checksum of a candidate chunk: `count:Σmissed_runs:Σrevision`. */
export function candidateChecksum(
  candidates: readonly MissedCandidate[]
): string {
  let missed = 0;
  let revisions = 0;
  for (const candidate of candidates) {
    missed += candidate.missed_runs;
    revisions += candidate.revision;
  }
  return `${candidates.length}:${missed}:${revisions}`;
}

/**
 * Guard + UPDATE per chunk of candidates: `missed_runs + 1`, and those
 * reaching 2 closed (`closed_at = now`, revision + 1).
 */
export function missedRunStatements(
  db: JobsDb,
  scope: UserScope,
  runId: string,
  candidates: readonly MissedCandidate[],
  now: number
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const group of chunk(candidates, IN_CHUNK)) {
    const ids = group.map((candidate) => candidate.id);
    const inList = marks(ids.length);
    statements.push(
      guard(
        db,
        `missed:${runId}:${ids[0]}`,
        `SELECT 1 FROM (SELECT count(*) || ':' || coalesce(sum(p.missed_runs), 0) || ':' || coalesce(sum(p.revision), 0) AS checksum FROM job_postings p WHERE p.id IN (${inList}) AND p.status != 'closed' AND p.id IN (SELECT u.posting_id FROM user_jobs u WHERE u.user_id = ?) AND NOT EXISTS (SELECT 1 FROM discovery_run_items r WHERE r.run_id = ? AND r.user_id = ? AND r.posting_id = p.id)) WHERE checksum = ?`,
        ...ids,
        scope.userId,
        runId,
        scope.userId,
        candidateChecksum(group)
      ),
      stmt(
        db,
        `UPDATE job_postings SET missed_runs = missed_runs + 1, status = CASE WHEN missed_runs + 1 >= ? THEN 'closed' ELSE status END, closed_at = CASE WHEN missed_runs + 1 >= ? THEN ? ELSE closed_at END, revision = CASE WHEN missed_runs + 1 >= ? THEN revision + 1 ELSE revision END, updated_at = CASE WHEN missed_runs + 1 >= ? THEN ? ELSE updated_at END WHERE id IN (${inList}) AND status != 'closed' AND id IN (SELECT posting_id FROM user_jobs WHERE user_id = ?)`,
        CLOSE_AFTER_MISSED_RUNS,
        CLOSE_AFTER_MISSED_RUNS,
        now,
        CLOSE_AFTER_MISSED_RUNS,
        CLOSE_AFTER_MISSED_RUNS,
        now,
        ...ids,
        scope.userId
      )
    );
  }
  return statements;
}

export interface RunCompletion {
  errors: unknown[];
  finishedAt: number;
  revision: number;
  stats: Record<string, unknown>;
  status: string;
}

/** Guard (still running at `revision`) + UPDATE + change_log of the run. */
export function completeRunStatements(
  db: JobsDb,
  scope: UserScope,
  runId: string,
  completion: RunCompletion,
  now: number
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `run:${runId}`,
      "SELECT 1 FROM discovery_runs WHERE id = ? AND user_id = ? AND status = 'running' AND revision = ?",
      runId,
      scope.userId,
      completion.revision
    ),
    stmt(
      db,
      "UPDATE discovery_runs SET status = ?, finished_at = ?, stats = ?, errors = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND status = 'running'",
      completion.status,
      completion.finishedAt,
      encodeJson(completion.stats),
      encodeJson(completion.errors),
      runId,
      scope.userId
    ),
    appendChange(db, scope, {
      entity: "run",
      entityId: runId,
      revision: completion.revision + 1,
      now,
    }),
  ];
}

export interface SourceRunUpdate {
  /** New cursor state (15 §9), or null to keep it. */
  cursorState: Record<string, unknown> | null;
  /** Fully enumerated in a successful run: last_success_at = finished_at. */
  success: boolean;
  sourceId: string;
}

/**
 * The run's effect on one of the caller's sources: last_run_id,
 * last_success_at and cursor_state — applied only when no newer run (by
 * started_at) already updated the source, so a stale device keeps the other
 * device's cursor (20 §6.2 "CLI auto"). The change_log row is written only
 * when the UPDATE applied.
 */
export function sourceRunStatements(
  db: JobsDb,
  scope: UserScope,
  run: { finishedAt: number; id: string; startedAt: number },
  update: SourceRunUpdate,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "UPDATE job_sources SET last_run_id = ?, last_success_at = CASE WHEN ? = 1 THEN max(coalesce(last_success_at, 0), ?) ELSE last_success_at END, cursor_state = coalesce(?, cursor_state), revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND (last_run_id IS NULL OR last_run_id = ? OR coalesce((SELECT r.started_at FROM discovery_runs r WHERE r.id = job_sources.last_run_id AND r.user_id = ?), 0) <= ?)",
      run.id,
      update.success ? 1 : 0,
      run.finishedAt,
      update.cursorState ? encodeJson(update.cursorState) : null,
      now,
      update.sourceId,
      scope.userId,
      run.id,
      scope.userId,
      run.startedAt
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'source', id, revision, 'upsert', ? FROM job_sources WHERE id = ? AND user_id = ? AND last_run_id = ? AND updated_at = ?",
      now,
      update.sourceId,
      scope.userId,
      run.id,
      now
    ),
  ];
}
