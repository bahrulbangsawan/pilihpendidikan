// Offers (04 §2.2, 06 §6.2): several per application (e.g. a revised offer).

import type { OfferStatus } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  OfferCompensation,
  OfferRecord,
} from "@pilihpendidikan/jobs-contracts/records";
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

/** One offer of one of the user's applications, or null. */
export async function loadOffer(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  offerId: string
): Promise<OfferRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM offers WHERE id = ? AND user_id = ? AND application_id = ?",
    offerId,
    scope.userId,
    applicationId
  );
  return row ? decodeRow<OfferRecord>("offers", row) : null;
}

/** A page of an application's offers, newest first (`limit + 1` rows). */
export async function listOfferRows(
  db: JobsDb,
  scope: UserScope,
  query: { applicationId: string; cursor: CursorKey | null; limit: number }
): Promise<OfferRecord[]> {
  const keyset = keysetAfter(["received_at", "id"], query.cursor, "desc");
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM offers WHERE user_id = ? AND application_id = ?${keyset.sql ? ` AND ${keyset.sql}` : ""} ORDER BY received_at DESC, id DESC LIMIT ?`,
    scope.userId,
    query.applicationId,
    ...keyset.binds,
    query.limit + 1
  );
  return rows.map((row) => decodeRow<OfferRecord>("offers", row));
}

/** INSERT of a new offer + its change_log row. */
export function insertOfferStatements(
  db: JobsDb,
  scope: UserScope,
  offer: OfferRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO offers (id, user_id, application_id, received_at, compensation, deadline_at, status, notes, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      offer.id,
      scope.userId,
      offer.application_id,
      offer.received_at,
      encodeJson(offer.compensation),
      offer.deadline_at,
      offer.status,
      offer.notes,
      offer.created_at,
      offer.updated_at
    ),
    appendChange(db, scope, {
      entity: "offer",
      entityId: offer.id,
      revision: 1,
      now: offer.created_at,
    }),
  ];
}

export interface OfferChanges {
  compensation?: OfferCompensation;
  deadline_at?: number | null;
  notes?: string;
  received_at?: number;
  status?: OfferStatus;
}

const OFFER_COLUMNS = [
  "received_at",
  "compensation",
  "deadline_at",
  "status",
  "notes",
] as const;

/** Guard + UPDATE (revision + 1) + change_log of an offer edit. */
export function updateOfferStatements(
  db: JobsDb,
  scope: UserScope,
  offerId: string,
  changes: OfferChanges,
  base: number,
  now: number
): D1PreparedStatement[] {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const column of OFFER_COLUMNS) {
    const value = changes[column];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      binds.push(column === "compensation" ? encodeJson(value) : value);
    }
  }
  return [
    guardRevision(db, scope, "offers", offerId, base),
    stmt(
      db,
      `UPDATE offers SET ${sets.join(", ")}, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?`,
      ...binds,
      now,
      offerId,
      scope.userId,
      base
    ),
    appendChange(db, scope, {
      entity: "offer",
      entityId: offerId,
      revision: base + 1,
      now,
    }),
  ];
}

/** Guard + DELETE + change_log (op delete) of an offer. */
export function deleteOfferStatements(
  db: JobsDb,
  scope: UserScope,
  offer: Pick<OfferRecord, "id" | "revision">,
  now: number
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "offers", offer.id, offer.revision),
    stmt(
      db,
      "DELETE FROM offers WHERE id = ? AND user_id = ? AND revision = ?",
      offer.id,
      scope.userId,
      offer.revision
    ),
    appendChange(db, scope, {
      entity: "offer",
      entityId: offer.id,
      revision: offer.revision + 1,
      op: "delete",
      now,
    }),
  ];
}
