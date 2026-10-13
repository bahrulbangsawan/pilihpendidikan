// Application timeline reads (06 §4): `application_events` newest first,
// keyset-paged on `(recorded_at, id)`. In the default view a `note_deleted`
// event hides the note it names and is itself hidden (the original stays in
// the audit trail, 06 §4 decision).

import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { CursorKey } from "../../core/pagination";
import { keysetAfter } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeRow, queryAll, queryFirst } from "../core/db";

/** A page of events (`limit + 1` rows; the extra one flags a next page). */
export async function listEventRows(
  db: JobsDb,
  scope: UserScope,
  query: {
    applicationId: string;
    cursor: CursorKey | null;
    includeHidden: boolean;
    limit: number;
  }
): Promise<ApplicationEventRecord[]> {
  const keyset = keysetAfter(["e.recorded_at", "e.id"], query.cursor, "desc");
  const hidden = query.includeHidden
    ? ""
    : " AND e.type != 'note_deleted' AND NOT (e.type = 'note_added' AND EXISTS (SELECT 1 FROM application_events d WHERE d.user_id = e.user_id AND d.application_id = e.application_id AND d.type = 'note_deleted' AND json_extract(d.payload, '$.note_event_id') = e.id))";
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT e.* FROM application_events e WHERE e.user_id = ? AND e.application_id = ?${hidden}${keyset.sql ? ` AND ${keyset.sql}` : ""} ORDER BY e.recorded_at DESC, e.id DESC LIMIT ?`,
    scope.userId,
    query.applicationId,
    ...keyset.binds,
    query.limit + 1
  );
  return rows.map((row) =>
    decodeRow<ApplicationEventRecord>("application_events", row)
  );
}

/** The user's event with this idempotency key (any application), or null. */
export async function findEventByKey(
  db: JobsDb,
  scope: UserScope,
  idempotencyKey: string
): Promise<ApplicationEventRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM application_events WHERE user_id = ? AND idempotency_key = ?",
    scope.userId,
    idempotencyKey
  );
  return row
    ? decodeRow<ApplicationEventRecord>("application_events", row)
    : null;
}

/** One event of an application, or null. */
export async function findEvent(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  eventId: string
): Promise<ApplicationEventRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM application_events WHERE id = ? AND user_id = ? AND application_id = ?",
    eventId,
    scope.userId,
    applicationId
  );
  return row
    ? decodeRow<ApplicationEventRecord>("application_events", row)
    : null;
}

/** The `note_deleted` event that hides `noteEventId`, or null. */
export async function findNoteDeletion(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  noteEventId: string
): Promise<ApplicationEventRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM application_events WHERE user_id = ? AND application_id = ? AND type = 'note_deleted' AND json_extract(payload, '$.note_event_id') = ? ORDER BY recorded_at, id LIMIT 1",
    scope.userId,
    applicationId,
    noteEventId
  );
  return row
    ? decodeRow<ApplicationEventRecord>("application_events", row)
    : null;
}
