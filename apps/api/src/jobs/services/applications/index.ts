// The applications service (leaf-2.3): the cross-area entry points of the
// board area (PLAN C5). Routes, the inbox (leaf-2.4), CV variants
// (leaf-2.6), email hand-off (leaf-2.9) and the legacy facade / MCP tools
// (leaf-2.10) call these instead of touching application rows themselves.
//
//   planTrackApplication  statements that track a user_job (one batch)
//   planTrackApplications the same for many user_jobs (set-based, ≤ 200)
//   trackApplication      the same, committed (callers outside a route)
//   changeStage           statements of a stage change (03 §5.1) + re-rank
//   getBoard              the board of 06 §1.4 (one indexed range query)
//   getApplicationDetail  the detail of 05 §5

import type {
  ActorKind,
  ApplicationMode,
  ChangeSource,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationDetail,
  BoardResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import { commitApplicationBatch } from "../../repo/applications/applications";
import type { JobsDb } from "../../repo/core/db";
import { UniqueViolationError } from "../../repo/core/db";
import type { BoardOptions } from "./board";
import { buildBoard } from "./board";
import type { DetailOptions } from "./detail";
import { loadDetail } from "./detail";
import type { StageChangeInput, StageChangePlan } from "./stage";
import { planStageChange } from "./stage";
import type {
  TrackApplicationInput,
  TrackApplicationPlan,
  TrackManyInput,
  TrackManyPlan,
} from "./track";
import { planTrack, planTrackMany } from "./track";

/**
 * Plans tracking a user_job: the application (appended to its column), the
 * `created` event, `user_jobs.inbox_state = 'tracked'` and the change_log
 * rows, as statements for the caller's batch. When the user_job is already
 * tracked, `statements` is empty and `applicationId` is the existing card.
 * Throws 404 `not_found` when the user_job is not the caller's.
 */
export async function planTrackApplication(
  db: JobsDb,
  scope: UserScope,
  input: {
    actorKind: ActorKind;
    afterRank?: string | null;
    idempotencyKey?: string;
    mode?: ApplicationMode;
    now: number;
    source: ChangeSource;
    stage?: Stage;
    userJobId: string;
  }
): Promise<TrackApplicationPlan> {
  return await planTrack(db, scope, input);
}

/**
 * Plans tracking many user_jobs in one batch (05 §4 `inbox:bulk` track):
 * set-based reads and multi-row writes (≤ 100 bound parameters per
 * statement, ~30 statements for 200 cards). Per id: the application id
 * (new or existing) or null when the user_job is not the caller's.
 */
export async function planTrackApplications(
  db: JobsDb,
  scope: UserScope,
  input: TrackManyInput
): Promise<TrackManyPlan> {
  return await planTrackMany(db, scope, input);
}

/**
 * Tracks a user_job and commits the batch (for callers without a route
 * context, e.g. MCP tools). A concurrent track of the same user_job resolves
 * to the winner's application.
 */
export async function trackApplication(
  db: JobsDb,
  scope: UserScope,
  input: TrackApplicationInput
): Promise<{ application: ApplicationRecord; created: boolean }> {
  const plan = await planTrack(db, scope, input);
  if (plan.statements.length === 0) {
    return { application: plan.application, created: false };
  }
  try {
    await commitApplicationBatch(db, plan.statements);
  } catch (err) {
    if (
      !(err instanceof UniqueViolationError && err.table === "applications")
    ) {
      throw err;
    }
    const winner = await planTrack(db, scope, input);
    return { application: winner.application, created: false };
  }
  return { application: plan.application, created: true };
}

/**
 * Plans a stage change (03 §5.1 via repo/core/application-state): the
 * transition statements and, when the stage moves, the card's new rank at the
 * bottom of its new column. User/MCP moves throw 422 `invalid_transition`
 * (incl. `details.reason = "submission_in_flight"`); a stale
 * `baseRevision` throws 409 `revision_conflict` with `details.current`.
 */
export async function changeStage(
  db: JobsDb,
  scope: UserScope,
  input: StageChangeInput
): Promise<StageChangePlan> {
  return await planStageChange(db, scope, input);
}

/** The caller's board (06 §1.4): columns, `counts`, `cursor`. */
export async function getBoard(
  db: JobsDb,
  scope: UserScope,
  opts: BoardOptions
): Promise<BoardResponse> {
  return await buildBoard(db, scope, opts);
}

/** Application detail (05 §5); 404 `not_found` when not the caller's. */
export async function getApplicationDetail(
  db: JobsDb,
  scope: UserScope,
  id: string,
  opts: DetailOptions = {}
): Promise<ApplicationDetail> {
  return await loadDetail(db, scope, id, opts);
}
