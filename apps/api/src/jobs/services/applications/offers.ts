// Offers (06 §6.2, 05 §5 `/applications/{app_id}/offers[/{ofr_id}]`).
//
// Toggles (06 §3, `move_application`, default on):
// - recording an offer moves `applied` / `interviewing` → `offer`;
// - an offer marked `accepted` (on create or later) moves the card on to
//   `accepted` (through `offer` when needed, two events in one batch).
// `declined` never moves the card ("Withdraw application?" is the user's
// separate choice).

import type {
  CreateOfferRequest,
  UpdateOfferRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import type { OfferStatus, Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationRecord,
  OfferRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { notFound, revisionConflict } from "../../core/http";
import type { CursorKey, Page } from "../../core/pagination";
import { pageOf } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import type { OfferChanges } from "../../repo/applications/offers";
import {
  deleteOfferStatements,
  insertOfferStatements,
  listOfferRows,
  loadOffer,
  updateOfferStatements,
} from "../../repo/applications/offers";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import type { StageChangePlan } from "./stage";
import { planStagePath } from "./stage";
import type { WriteContext } from "./update";

const OFFER_FROM: readonly Stage[] = ["applied", "interviewing"];

export interface OfferWrite {
  /** Present when the request moved the application's stage. */
  application?: ApplicationRecord;
  offer: OfferRecord;
  statements: D1PreparedStatement[];
}

async function ownedApplication(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<ApplicationRecord> {
  const app = await loadApplication(db, scope, applicationId);
  if (!app) {
    throw notFound("Application not found.");
  }
  return app;
}

/** One offer of the caller's application; 404 otherwise. */
export async function getOffer(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  offerId: string
): Promise<OfferRecord> {
  const offer = await loadOffer(db, scope, applicationId, offerId);
  if (!offer) {
    throw notFound("Offer not found.");
  }
  return offer;
}

/** The application's offers, newest first. */
export async function listOffers(
  db: JobsDb,
  scope: UserScope,
  query: { applicationId: string; cursor: CursorKey | null; limit: number }
): Promise<Page<OfferRecord>> {
  await ownedApplication(db, scope, query.applicationId);
  const rows = await listOfferRows(db, scope, query);
  return pageOf(rows, query.limit, (row) => [row.received_at, row.id]);
}

/** The stages an offer in `status` moves the card through (06 §3). */
function offerPath(app: ApplicationRecord, status: OfferStatus): Stage[] {
  const path: Stage[] = [];
  if (OFFER_FROM.includes(app.stage)) {
    path.push("offer");
  }
  if (status === "accepted" && (path.length > 0 || app.stage === "offer")) {
    path.push("accepted");
  }
  return path;
}

async function planOfferMove(
  db: JobsDb,
  scope: UserScope,
  app: ApplicationRecord,
  status: OfferStatus,
  input: WriteContext
): Promise<StageChangePlan | null> {
  const path = offerPath(app, status);
  if (path.length === 0) {
    return null;
  }
  return await planStagePath(db, scope, {
    applicationId: app.id,
    current: app.stage,
    path: [app.stage, ...path],
    reason: status === "accepted" ? "offer_accepted" : "offer_recorded",
    actor: input.actor,
    actorDeviceId: input.actorDeviceId,
    source: input.source,
    now: input.now,
  });
}

function offerEvent(
  db: JobsDb,
  scope: UserScope,
  offer: OfferRecord,
  input: WriteContext,
  extra: Record<string, unknown> = {}
): D1PreparedStatement[] {
  return appendEvent(
    db,
    scope,
    {
      applicationId: offer.application_id,
      type: "offer_recorded",
      actorKind: input.actor,
      actorDeviceId: input.actorDeviceId,
      payload: { offer_id: offer.id, status: offer.status, ...extra },
    },
    input.now
  ).statements;
}

/** Plans `POST …/offers`. */
export async function planCreateOffer(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & { applicationId: string; body: CreateOfferRequest }
): Promise<OfferWrite> {
  const { body, now } = input;
  const app = await ownedApplication(db, scope, input.applicationId);
  const offer: OfferRecord = {
    id: newId("ofr", now),
    user_id: scope.userId,
    application_id: app.id,
    received_at: body.received_at,
    compensation: body.compensation ?? {},
    deadline_at: body.deadline_at ?? null,
    status: body.status ?? "open",
    notes: body.notes ?? "",
    revision: 1,
    created_at: now,
    updated_at: now,
  };
  const statements = [
    ...insertOfferStatements(db, scope, offer),
    ...offerEvent(db, scope, offer, input),
  ];
  const move =
    (body.move_application ?? true)
      ? await planOfferMove(db, scope, app, offer.status, input)
      : null;
  if (!move || move.result !== "applied") {
    return { offer, statements: [...(move?.statements ?? []), ...statements] };
  }
  return {
    offer,
    application: move.application,
    statements: [...move.statements, ...statements],
  };
}

function changedOfferFields(
  current: OfferRecord,
  body: Omit<UpdateOfferRequest, "base_revision" | "move_application">
): OfferChanges {
  const changes: OfferChanges = {};
  if (
    body.received_at !== undefined &&
    body.received_at !== current.received_at
  ) {
    changes.received_at = body.received_at;
  }
  if (
    body.compensation !== undefined &&
    JSON.stringify(body.compensation) !== JSON.stringify(current.compensation)
  ) {
    changes.compensation = body.compensation;
  }
  if (
    body.deadline_at !== undefined &&
    body.deadline_at !== current.deadline_at
  ) {
    changes.deadline_at = body.deadline_at;
  }
  if (body.status !== undefined && body.status !== current.status) {
    changes.status = body.status;
  }
  if (body.notes !== undefined && body.notes !== current.notes) {
    changes.notes = body.notes;
  }
  return changes;
}

/** Plans `PATCH …/offers/{ofr_id}` (strict base_revision). */
export async function planUpdateOffer(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & {
    applicationId: string;
    baseRevision: number;
    body: Omit<UpdateOfferRequest, "base_revision">;
    offerId: string;
  }
): Promise<OfferWrite> {
  const { body, now } = input;
  const current = await getOffer(db, scope, input.applicationId, input.offerId);
  if (current.revision !== input.baseRevision) {
    throw revisionConflict(
      current,
      `Offer changed since revision ${input.baseRevision} (now ${current.revision}).`
    );
  }
  const changes = changedOfferFields(current, body);
  if (Object.keys(changes).length === 0) {
    return { offer: current, statements: [] };
  }
  const offer: OfferRecord = {
    ...current,
    ...changes,
    revision: current.revision + 1,
    updated_at: now,
  };
  const statements = updateOfferStatements(
    db,
    scope,
    current.id,
    changes,
    current.revision,
    now
  );
  if (changes.status === undefined) {
    return { offer, statements };
  }
  statements.push(
    ...offerEvent(db, scope, offer, input, { previous_status: current.status })
  );
  if (changes.status !== "accepted" || body.move_application === false) {
    return { offer, statements };
  }
  const app = await ownedApplication(db, scope, input.applicationId);
  const move = await planOfferMove(db, scope, app, "accepted", input);
  if (!move || move.result !== "applied") {
    return { offer, statements: [...(move?.statements ?? []), ...statements] };
  }
  return {
    offer,
    application: move.application,
    statements: [...move.statements, ...statements],
  };
}

/** Plans `DELETE …/offers/{ofr_id}` (optional base_revision / If-Match). */
export async function planDeleteOffer(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & {
    applicationId: string;
    baseRevision: number | null;
    offerId: string;
  }
): Promise<{ statements: D1PreparedStatement[] }> {
  const current = await getOffer(db, scope, input.applicationId, input.offerId);
  if (input.baseRevision !== null && current.revision !== input.baseRevision) {
    throw revisionConflict(
      current,
      `Offer changed since revision ${input.baseRevision} (now ${current.revision}).`
    );
  }
  return {
    statements: [
      ...deleteOfferStatements(db, scope, current, input.now),
      ...offerEvent(db, scope, current, input, { deleted: true }),
    ],
  };
}
