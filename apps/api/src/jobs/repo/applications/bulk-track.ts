// Set-based tracking of many user_jobs in ONE batch (05 §4 `inbox:bulk`
// track, ≤ 200 ids). The single-card path (`insertApplicationStatements`,
// `setInboxStateStatements`, `appendEvent`) costs ~8 queries per card; these
// helpers load the user_jobs / applications with `IN (…)` lists and write
// multi-row statements, each with at most 100 bound parameters (D1 limit),
// so 200 cards fit in ~30 statements (D1: ≤ 1,000 queries per invocation).
//
// Rows read exactly as the single-card path writes them: application
// (revision 1) + change_log, user_job → `tracked` (revision + 1) + change_log,
// `created` event + change_log.

import type {
  ActorKind,
  ApplicationMode,
  ChangeSource,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { UserJobRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeRow, encodeJson, queryAll, stmt } from "../core/db";

/** Bound parameters per D1 statement. */
export const BULK_MAX_PARAMS = 100;
/** Ids per `IN (…)` list (two other binds share the statement). */
const ID_CHUNK = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function valueRows(count: number, width: number): string {
  const row = `(${marks(width)})`;
  return Array.from({ length: count }, () => row).join(", ");
}

/** Rows per multi-row statement with `shared` + `width` binds per row. */
function rowsPerStatement(shared: number, width: number): number {
  return Math.max(1, Math.floor((BULK_MAX_PARAMS - shared) / width));
}

/** The caller's user_jobs among `ids` (others are simply absent). */
export async function loadUserJobsByIds(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[]
): Promise<Map<string, UserJobRecord>> {
  const out = new Map<string, UserJobRecord>();
  for (const group of chunk([...new Set(ids)], ID_CHUNK)) {
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT * FROM user_jobs WHERE user_id = ? AND id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      const record = decodeRow<UserJobRecord>("user_jobs", row);
      out.set(record.id, record);
    }
  }
  return out;
}

/** user_job id → its application id, for the tracked ones among `ids`. */
export async function applicationIdsByUserJob(
  db: JobsDb,
  scope: UserScope,
  userJobIds: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const group of chunk([...new Set(userJobIds)], ID_CHUNK)) {
    const rows = await queryAll<{ id: string; user_job_id: string }>(
      db,
      `SELECT id, user_job_id FROM applications WHERE user_id = ? AND user_job_id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      out.set(row.user_job_id, row.id);
    }
  }
  return out;
}

export interface BulkNewApplication {
  /** `created` event id. */
  eventId: string;
  /** `created` event idempotency key. */
  eventKey: string;
  id: string;
  origin: string;
  rank: string;
  userJobId: string;
}

export interface BulkTrackInput {
  actorKind: ActorKind;
  apps: readonly BulkNewApplication[];
  mode: ApplicationMode;
  now: number;
  source: ChangeSource;
  stage: Stage;
}

/**
 * Statements tracking `input.apps` (all new, all the caller's user_jobs):
 * applications + change_log, user_jobs `tracked` + change_log, `created`
 * events + change_log. Every statement binds ≤ 100 parameters.
 */
export function bulkTrackStatements(
  db: JobsDb,
  scope: UserScope,
  input: BulkTrackInput
): D1PreparedStatement[] {
  const { apps, now } = input;
  if (apps.length === 0) {
    return [];
  }
  const statements: D1PreparedStatement[] = [];
  // applications: 7 shared binds, 3 per row.
  for (const group of chunk(apps, rowsPerStatement(7, 3))) {
    statements.push(
      stmt(
        db,
        `INSERT INTO applications (id, user_id, user_job_id, stage, stage_changed_at, submission_status, mode, priority, board_rank, archived, sections, last_change_source, revision, created_at, updated_at) SELECT v.column1, ?, v.column2, ?, ?, 'not_started', ?, 0, v.column3, 0, '[]', ?, 1, ?, ? FROM (VALUES ${valueRows(group.length, 3)}) AS v`,
        scope.userId,
        input.stage,
        now,
        input.mode,
        input.source,
        now,
        now,
        ...group.flatMap((app) => [app.id, app.userJobId, app.rank])
      )
    );
  }
  const appIds = apps.map((app) => app.id);
  for (const group of chunk(appIds, ID_CHUNK)) {
    statements.push(
      stmt(
        db,
        `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'application', id, revision, 'upsert', ? FROM applications WHERE user_id = ? AND id IN (${marks(group.length)})`,
        now,
        scope.userId,
        ...group
      )
    );
  }
  const userJobIds = apps.map((app) => app.userJobId);
  for (const group of chunk(userJobIds, ID_CHUNK)) {
    statements.push(
      stmt(
        db,
        `UPDATE user_jobs SET inbox_state = 'tracked', revision = revision + 1, updated_at = ? WHERE user_id = ? AND id IN (${marks(group.length)})`,
        now,
        scope.userId,
        ...group
      ),
      stmt(
        db,
        `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'user_job', id, revision, 'upsert', ? FROM user_jobs WHERE user_id = ? AND id IN (${marks(group.length)})`,
        now,
        scope.userId,
        ...group
      )
    );
  }
  // created events: 5 shared binds, 4 per row; a replayed key is a no-op.
  for (const group of chunk(apps, rowsPerStatement(5, 4))) {
    statements.push(
      stmt(
        db,
        `INSERT INTO application_events (id, user_id, application_id, type, from_value, to_value, payload, actor_kind, actor_device_id, task_id, attempt_id, applied_to_state, occurred_at, recorded_at, idempotency_key) SELECT v.column1, ?, v.column2, 'created', NULL, ?, v.column3, ?, NULL, NULL, NULL, 1, ?, ?, v.column4 FROM (VALUES ${valueRows(group.length, 4)}) AS v WHERE true ON CONFLICT(user_id, idempotency_key) DO NOTHING`,
        scope.userId,
        input.stage,
        input.actorKind,
        now,
        now,
        ...group.flatMap((app) => [
          app.eventId,
          app.id,
          encodeJson({ origin: app.origin, stage: input.stage }),
          app.eventKey,
        ])
      )
    );
  }
  const eventIds = apps.map((app) => app.eventId);
  for (const group of chunk(eventIds, ID_CHUNK)) {
    statements.push(
      stmt(
        db,
        `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'event', id, 1, 'upsert', ? FROM application_events WHERE user_id = ? AND id IN (${marks(group.length)})`,
        now,
        scope.userId,
        ...group
      )
    );
  }
  return statements;
}
