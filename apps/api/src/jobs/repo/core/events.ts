// Append-only application history (03 §6, 04 §2.2): `application_events`.
//
// Events are never updated or deleted (except by account deletion). Each one
// carries `actor_kind`, the optional device/task/attempt, `occurred_at`
// (client clock, informational), `recorded_at` (server clock, authoritative
// order), `applied_to_state` (false = recorded but rejected as stale or
// conflicting, 20 §6.2) and a per-user unique `idempotency_key`.
//
// `appendEvent` returns the INSERT plus its change_log row. By default a
// duplicate `idempotency_key` is IGNORED (a replayed CLI event is a no-op) and
// the change_log row is only written when this event was actually inserted.
// Pass `onDuplicate: "abort"` to make a duplicate abort the whole batch
// (`UniqueViolationError` on `application_events`).

import type {
  ActorKind,
  EventType,
} from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "./db";
import { encodeJson, sqlBool, stmt } from "./db";

export interface EventInput {
  actorDeviceId?: string | null;
  actorKind: ActorKind;
  applicationId: string;
  /** Default true. */
  appliedToState?: boolean;
  attemptId?: string | null;
  fromValue?: string | null;
  /** Client-generated `evt_` id (03 §1) or a fresh one. */
  id?: string;
  /** Default: `evt:<event id>`. */
  idempotencyKey?: string;
  /** Client clock; default `now`. */
  occurredAt?: number;
  onDuplicate?: "ignore" | "abort";
  payload?: Record<string, unknown>;
  taskId?: string | null;
  toValue?: string | null;
  type: EventType;
}

export interface AppendedEvent {
  id: string;
  idempotencyKey: string;
  statements: D1PreparedStatement[];
}

/** INSERT of one event (+ its change_log row, entity "event"). */
export function appendEvent(
  db: JobsDb,
  scope: UserScope,
  input: EventInput,
  now: number
): AppendedEvent {
  const id = input.id ?? newId("evt", now);
  const idempotencyKey = input.idempotencyKey ?? `evt:${id}`;
  const conflict =
    input.onDuplicate === "abort"
      ? ""
      : " ON CONFLICT(user_id, idempotency_key) DO NOTHING";
  const insert = stmt(
    db,
    `INSERT INTO application_events (id, user_id, application_id, type, from_value, to_value, payload, actor_kind, actor_device_id, task_id, attempt_id, applied_to_state, occurred_at, recorded_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${conflict}`,
    id,
    scope.userId,
    input.applicationId,
    input.type,
    input.fromValue ?? null,
    input.toValue ?? null,
    encodeJson(input.payload ?? {}),
    input.actorKind,
    input.actorDeviceId ?? null,
    input.taskId ?? null,
    input.attemptId ?? null,
    sqlBool(input.appliedToState ?? true),
    input.occurredAt ?? now,
    now,
    idempotencyKey
  );
  const change = stmt(
    db,
    "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'event', id, 1, 'upsert', ? FROM application_events WHERE id = ? AND user_id = ?",
    now,
    id,
    scope.userId
  );
  return { id, idempotencyKey, statements: [insert, change] };
}
