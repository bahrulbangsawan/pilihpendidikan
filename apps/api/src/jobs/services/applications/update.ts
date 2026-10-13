// `PATCH /api/v1/applications/{app_id}` and `POST …/move` (05 §5, 06 §2).

import type {
  MoveApplicationRequest,
  UpdateApplicationRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  ActorKind,
  ChangeSource,
} from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationRecord,
  LegacyJobSection,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  SECTIONS_MAX_BYTES,
  SECTIONS_MAX_ITEMS,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  apiError,
  invalidRequest,
  invalidTransition,
  notFound,
  revisionConflict,
} from "../../core/http";
import { isValidRank } from "../../core/rank";
import type { UserScope } from "../../core/scope";
import type { ApplicationFieldChanges } from "../../repo/applications/applications";
import {
  rankRewriteStatements,
  updateFieldsStatements,
} from "../../repo/applications/applications";
import {
  liveSubmitIntentTask,
  loadApplication,
} from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { placeBetween } from "./placement";
import { planStageChange } from "./stage";

export interface WriteContext {
  actor: ActorKind;
  actorDeviceId: string | null;
  now: number;
  source: ChangeSource;
}

export interface ApplicationWrite {
  application: ApplicationRecord;
  statements: D1PreparedStatement[];
}

/** 06 §5: 200 items and 64 KB serialized → 413 payload_too_large. */
export function assertSectionsWithinCaps(sections: LegacyJobSection[]): void {
  let items = 0;
  for (const section of sections) {
    items += section.items.length;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(sections)).byteLength;
  if (items > SECTIONS_MAX_ITEMS || bytes > SECTIONS_MAX_BYTES) {
    throw apiError(
      "payload_too_large",
      `Checklists are limited to ${SECTIONS_MAX_ITEMS} items and ${SECTIONS_MAX_BYTES / 1024} KB.`,
      {
        details: {
          items,
          bytes,
          max_items: SECTIONS_MAX_ITEMS,
          max_bytes: SECTIONS_MAX_BYTES,
        },
      }
    );
  }
}

/** The PATCH fields that differ from the stored card (stage excluded). */
function changedFields(
  app: ApplicationRecord,
  body: Omit<UpdateApplicationRequest, "base_revision" | "stage">
): ApplicationFieldChanges {
  const fields: ApplicationFieldChanges = {};
  if (body.board_rank !== undefined && body.board_rank !== app.board_rank) {
    fields.board_rank = body.board_rank;
  }
  if (body.mode !== undefined && body.mode !== app.mode) {
    fields.mode = body.mode;
  }
  if (body.priority !== undefined && body.priority !== app.priority) {
    fields.priority = body.priority;
  }
  if (body.archived !== undefined && body.archived !== app.archived) {
    fields.archived = body.archived;
  }
  if (
    body.follow_up_at !== undefined &&
    body.follow_up_at !== app.follow_up_at
  ) {
    fields.follow_up_at = body.follow_up_at;
  }
  if (body.base_cv_id !== undefined && body.base_cv_id !== app.base_cv_id) {
    fields.base_cv_id = body.base_cv_id;
  }
  if (
    body.sections !== undefined &&
    JSON.stringify(body.sections) !== JSON.stringify(app.sections)
  ) {
    fields.sections = body.sections;
  }
  return fields;
}

async function loadOwned(
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

/**
 * PATCH: strict `base_revision` (D-21); a stage change goes through 03 §5.1
 * (422) and lands at the bottom of its new column unless `board_rank` is
 * sent; `sections` replaces the checklist array under the 06 §5 caps.
 * Nothing changed → no statements.
 */
export async function planUpdate(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & {
    applicationId: string;
    baseRevision: number;
    body: Omit<UpdateApplicationRequest, "base_revision">;
  }
): Promise<ApplicationWrite> {
  const { body } = input;
  if (body.sections !== undefined) {
    assertSectionsWithinCaps(body.sections);
  }
  if (body.board_rank !== undefined && !isValidRank(body.board_rank)) {
    throw invalidRequest(
      "board_rank must be a base-36 rank (0-9a-z) that does not end in 0."
    );
  }
  const app = await loadOwned(db, scope, input.applicationId);
  if (app.revision !== input.baseRevision) {
    throw revisionConflict(
      app,
      `Application changed since revision ${input.baseRevision} (now ${app.revision}).`
    );
  }
  const fields = changedFields(app, body);
  if (body.stage !== undefined && body.stage !== app.stage) {
    const plan = await planStageChange(db, scope, {
      applicationId: app.id,
      to: body.stage,
      actor: input.actor,
      actorDeviceId: input.actorDeviceId,
      source: input.source,
      now: input.now,
      baseRevision: input.baseRevision,
      fields,
      placement: fields.board_rank === undefined ? "end" : "keep",
    });
    return { application: plan.application, statements: plan.statements };
  }
  if (Object.keys(fields).length === 0) {
    return { application: app, statements: [] };
  }
  return {
    application: {
      ...app,
      ...fields,
      revision: app.revision + 1,
      updated_at: input.now,
      last_change_source: input.source,
    },
    statements: updateFieldsStatements(db, scope, app.id, fields, {
      bump: true,
      expectRevision: app.revision,
      now: input.now,
      source: input.source,
    }),
  };
}

/**
 * Drag-and-drop (06 §2.1): the server computes the rank from the
 * neighbours. A stale `base_revision` with the card still in the requested
 * column is a rank-only conflict and auto-resolves against the current
 * neighbours (200); a stale revision with another stage is a stage conflict
 * (409 with `details.current`). A card whose live task is past
 * `submit_intent` cannot be moved (422 `submission_in_flight`, 06 §2.3).
 */
export async function planMove(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & {
    applicationId: string;
    baseRevision: number;
    body: Omit<MoveApplicationRequest, "base_revision">;
  }
): Promise<ApplicationWrite> {
  const { body } = input;
  const app = await loadOwned(db, scope, input.applicationId);
  const inFlight = await liveSubmitIntentTask(db, scope, app.id);
  if (inFlight) {
    throw invalidTransition("A submission for this application is in flight.", {
      reason: "submission_in_flight",
      task_id: inFlight.id,
    });
  }
  if (app.revision !== input.baseRevision && app.stage !== body.stage) {
    throw revisionConflict(
      app,
      `Application moved to ${app.stage} since revision ${input.baseRevision} (now ${app.revision}).`
    );
  }
  const placement = await placeBetween(db, scope, body.stage, app.id, {
    beforeId: body.before_id ?? null,
    afterId: body.after_id ?? null,
  });
  if (body.stage !== app.stage) {
    const plan = await planStageChange(db, scope, {
      applicationId: app.id,
      to: body.stage,
      actor: input.actor,
      actorDeviceId: input.actorDeviceId,
      source: input.source,
      now: input.now,
      baseRevision: app.revision,
      placement,
    });
    return { application: plan.application, statements: plan.statements };
  }
  const statements = updateFieldsStatements(
    db,
    scope,
    app.id,
    { board_rank: placement.rank },
    {
      bump: true,
      expectRevision: app.revision,
      now: input.now,
      source: input.source,
    }
  );
  if (placement.rebalance) {
    statements.push(
      ...rankRewriteStatements(
        db,
        scope,
        placement.rebalance,
        app.id,
        input.now
      )
    );
  }
  return {
    application: {
      ...app,
      board_rank: placement.rank,
      revision: app.revision + 1,
      updated_at: input.now,
      last_change_source: input.source,
    },
    statements,
  };
}

/** Archive (`DELETE` without `?purge=1`, 06 §8): hides the card, keeps the stage. */
export async function planArchive(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & { applicationId: string; baseRevision: number | null }
): Promise<ApplicationWrite> {
  const app = await loadOwned(db, scope, input.applicationId);
  if (input.baseRevision !== null && app.revision !== input.baseRevision) {
    throw revisionConflict(
      app,
      `Application changed since revision ${input.baseRevision} (now ${app.revision}).`
    );
  }
  if (app.archived) {
    return { application: app, statements: [] };
  }
  return {
    application: {
      ...app,
      archived: true,
      revision: app.revision + 1,
      updated_at: input.now,
      last_change_source: input.source,
    },
    statements: updateFieldsStatements(
      db,
      scope,
      app.id,
      { archived: true },
      {
        bump: true,
        expectRevision: app.revision,
        now: input.now,
        source: input.source,
      }
    ),
  };
}
