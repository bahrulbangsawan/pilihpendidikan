// Timeline and notes (06 §4–§5, 05 §5 `/applications/{app_id}/events`).
//
// Notes are append-only `note_added` events; deleting one appends
// `note_deleted {note_event_id}`, which hides the original from the default
// view. The body's `idempotency_key` is the event's own key (UNIQUE per
// user): re-sending it returns the stored event instead of a second note.

import type { CreateEventRequest } from "@pilihpendidikan/jobs-contracts/api";
import type { ActorKind } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import { apiError, notFound } from "../../core/http";
import type { CursorKey, Page } from "../../core/pagination";
import { pageOf } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import {
  findEvent,
  findEventByKey,
  findNoteDeletion,
  listEventRows,
} from "../../repo/applications/events";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";

/** `GET …/events`: newest first, 50 per page by default. */
export async function listTimeline(
  db: JobsDb,
  scope: UserScope,
  query: {
    applicationId: string;
    cursor: CursorKey | null;
    includeHidden: boolean;
    limit: number;
  }
): Promise<Page<ApplicationEventRecord>> {
  const app = await loadApplication(db, scope, query.applicationId);
  if (!app) {
    throw notFound("Application not found.");
  }
  const rows = await listEventRows(db, scope, query);
  return pageOf(rows, query.limit, (row) => [row.recorded_at, row.id]);
}

export interface NoteEventPlan {
  event: ApplicationEventRecord;
  /** True when the request repeats a stored event (no statements). */
  replay: boolean;
  statements: D1PreparedStatement[];
}

/** A stored event answering a repeated key, or a 409 for a reused key. */
async function existingForKey(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  body: CreateEventRequest
): Promise<ApplicationEventRecord | null> {
  const existing = await findEventByKey(db, scope, body.idempotency_key);
  if (!existing) {
    return null;
  }
  if (
    existing.application_id !== applicationId ||
    existing.type !== body.type
  ) {
    throw apiError(
      "duplicate",
      "This idempotency_key already belongs to another event.",
      { details: { event_id: existing.id } }
    );
  }
  return existing;
}

/**
 * The stored payload: only the keys of 03 §6 (`{text, kind?}` /
 * `{note_event_id}`). The contract objects are open for forward
 * compatibility; unknown client keys are not persisted.
 */
function notePayload(body: CreateEventRequest): Record<string, unknown> {
  if (body.type === "note_deleted") {
    return { note_event_id: body.payload.note_event_id };
  }
  const { text, kind } = body.payload;
  return kind === undefined ? { text } : { text, kind };
}

/** Plans a `note_added` / `note_deleted` event (`POST …/events`). */
export async function planNoteEvent(
  db: JobsDb,
  scope: UserScope,
  input: {
    actor: ActorKind;
    actorDeviceId: string | null;
    applicationId: string;
    body: CreateEventRequest;
    now: number;
  }
): Promise<NoteEventPlan> {
  const { body, now } = input;
  const app = await loadApplication(db, scope, input.applicationId);
  if (!app) {
    throw notFound("Application not found.");
  }
  const existing = await existingForKey(db, scope, app.id, body);
  if (existing) {
    return { event: existing, replay: true, statements: [] };
  }
  if (body.type === "note_deleted") {
    const note = await findEvent(db, scope, app.id, body.payload.note_event_id);
    if (note?.type !== "note_added") {
      throw notFound("Note not found.");
    }
    const deletion = await findNoteDeletion(db, scope, app.id, note.id);
    if (deletion) {
      return { event: deletion, replay: true, statements: [] };
    }
  }
  const payload = notePayload(body);
  const occurredAt = body.occurred_at ?? now;
  const appended = appendEvent(
    db,
    scope,
    {
      applicationId: app.id,
      type: body.type,
      actorKind: input.actor,
      actorDeviceId: input.actorDeviceId,
      payload,
      occurredAt,
      idempotencyKey: body.idempotency_key,
      onDuplicate: "abort",
    },
    now
  );
  const event = {
    id: appended.id,
    user_id: scope.userId,
    application_id: app.id,
    type: body.type,
    from_value: null,
    to_value: null,
    payload,
    actor_kind: input.actor,
    actor_device_id: input.actorDeviceId,
    task_id: null,
    attempt_id: null,
    applied_to_state: true,
    occurred_at: occurredAt,
    recorded_at: now,
    idempotency_key: body.idempotency_key,
  } as ApplicationEventRecord;
  return { event, replay: false, statements: appended.statements };
}

/** The stored event of a key that won a concurrent insert. */
export async function eventForKey(
  db: JobsDb,
  scope: UserScope,
  idempotencyKey: string
): Promise<ApplicationEventRecord | null> {
  return await findEventByKey(db, scope, idempotencyKey);
}
