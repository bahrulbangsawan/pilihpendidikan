// Tracking a job (05 §5 `POST /api/v1/applications`, 03 §5): one
// application per user_job, appended to its column, with a `created` event,
// the user_job moved to `tracked`, and change_log rows — all as statements
// for ONE batch. Used by the board route, the inbox (leaf-2.4), and the
// legacy facade / MCP tools (leaf-2.10).

import type {
  ActorKind,
  ApplicationMode,
  ChangeSource,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationRecord,
  UserJobRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import {
  findApplicationByUserJob,
  insertApplicationStatements,
  loadUserJob,
  newApplicationRecord,
  rankRewriteStatements,
  setInboxStateStatements,
  storedSettings,
} from "../../repo/applications/applications";
import {
  applicationIdsByUserJob,
  bulkTrackStatements,
  loadUserJobsByIds,
} from "../../repo/applications/bulk-track";
import { appendEvent } from "../../repo/core/events";
import type { JobsDb } from "../../repo/core/db";
import { USER_SETTINGS_DEFAULTS } from "../../repo/core/settings";
import { placeAtEnd, placeManyAtEnd } from "./placement";

export interface TrackApplicationInput {
  actorKind: ActorKind;
  /**
   * Rank of the card the new one goes below (default: the column's current
   * last card). Bulk callers planning several cards for one batch pass the
   * previous plan's `rank`.
   */
  afterRank?: string | null;
  /** Prefix of the `created` event's idempotency key. */
  idempotencyKey?: string;
  /** Default: the user's `user_settings.default_mode` (03 §5.3). */
  mode?: ApplicationMode;
  now: number;
  source: ChangeSource;
  /** Default `saved`. */
  stage?: Stage;
  userJobId: string;
}

export interface TrackApplicationPlan {
  /** The application as it reads after the batch (the existing one when tracked). */
  application: ApplicationRecord;
  applicationId: string;
  /** False when the user_job was already tracked (no statements). */
  created: boolean;
  /** The new card's rank (feed it to the next plan's `afterRank`). */
  rank: string;
  statements: D1PreparedStatement[];
}

/**
 * Plans tracking one user_job. Throws 404 when the user_job is not the
 * caller's. Returns no statements and the existing application when the
 * user_job is already tracked.
 */
export async function planTrack(
  db: JobsDb,
  scope: UserScope,
  input: TrackApplicationInput
): Promise<TrackApplicationPlan> {
  const userJob = await loadUserJob(db, scope, input.userJobId);
  if (!userJob) {
    throw notFound("Tracked job not found.");
  }
  const existing = await findApplicationByUserJob(db, scope, userJob.id);
  if (existing) {
    return {
      application: existing,
      applicationId: existing.id,
      created: false,
      rank: existing.board_rank,
      statements: [],
    };
  }
  const id = newId("app", input.now);
  const stage = input.stage ?? "saved";
  const mode =
    input.mode ??
    (await storedSettings(db, scope))?.default_mode ??
    USER_SETTINGS_DEFAULTS.default_mode;
  const placement = await placeAtEnd(db, scope, stage, id, input.afterRank);
  const app = {
    id,
    userJobId: userJob.id,
    stage,
    mode,
    rank: placement.rank,
    source: input.source,
    now: input.now,
  };
  const created = appendEvent(
    db,
    scope,
    {
      applicationId: id,
      type: "created",
      actorKind: input.actorKind,
      toValue: stage,
      payload: { origin: userJob.origin, stage },
      idempotencyKey: input.idempotencyKey
        ? `${input.idempotencyKey}:created`
        : `created:${id}`,
    },
    input.now
  );
  const statements = [
    ...insertApplicationStatements(db, scope, app),
    ...setInboxStateStatements(db, scope, userJob.id, "tracked", input.now),
    ...created.statements,
  ];
  if (placement.rebalance) {
    statements.push(
      ...rankRewriteStatements(db, scope, placement.rebalance, id, input.now)
    );
  }
  return {
    application: newApplicationRecord(scope, app),
    applicationId: id,
    created: true,
    rank: placement.rank,
    statements,
  };
}

export interface TrackManyInput {
  actorKind: ActorKind;
  /** Prefix of each `created` event key (`<prefix>:<ujb_id>:created`). */
  idempotencyKey?: string;
  /** Default: the user's `user_settings.default_mode` (03 §5.3). */
  mode?: ApplicationMode;
  now: number;
  source: ChangeSource;
  /** Default `saved`. */
  stage?: Stage;
  userJobIds: readonly string[];
}

export interface TrackManyResult {
  /** The application tracking the user_job (null when not the caller's). */
  applicationId: string | null;
  /** True when this plan creates the application. */
  created: boolean;
  /** The user_job's inbox state before the plan (null when not found). */
  inboxState: UserJobRecord["inbox_state"] | null;
  userJobId: string;
}

export interface TrackManyPlan {
  /** New applications as they read after the batch. */
  applications: ApplicationRecord[];
  /** One entry per requested id, in request order (duplicates repeat). */
  results: TrackManyResult[];
  statements: D1PreparedStatement[];
}

/**
 * Plans tracking many user_jobs in ONE batch (05 §4 `inbox:bulk` track,
 * ≤ 200 ids): two set-based reads, then multi-row statements (≤ 100 bound
 * parameters each, ~30 statements for 200 new cards). Same rows as
 * `planTrack` per card. Ids that are not the caller's come back with
 * `applicationId: null` (the caller answers `not_found`); already tracked
 * ones resolve to their existing application without statements.
 */
export async function planTrackMany(
  db: JobsDb,
  scope: UserScope,
  input: TrackManyInput
): Promise<TrackManyPlan> {
  const jobs = await loadUserJobsByIds(db, scope, input.userJobIds);
  const existing = await applicationIdsByUserJob(db, scope, [...jobs.keys()]);
  const stage = input.stage ?? "saved";
  const fresh: UserJobRecord[] = [];
  const planned = new Map<string, string>();
  for (const id of input.userJobIds) {
    const job = jobs.get(id);
    if (job && !existing.has(id) && !planned.has(id)) {
      planned.set(id, newId("app", input.now));
      fresh.push(job);
    }
  }
  const results: TrackManyResult[] = input.userJobIds.map((id) => {
    const job = jobs.get(id);
    return {
      userJobId: id,
      applicationId: existing.get(id) ?? planned.get(id) ?? null,
      created: planned.has(id) && !existing.has(id),
      inboxState: job?.inbox_state ?? null,
    };
  });
  if (fresh.length === 0) {
    return { applications: [], results, statements: [] };
  }
  const mode =
    input.mode ??
    (await storedSettings(db, scope))?.default_mode ??
    USER_SETTINGS_DEFAULTS.default_mode;
  const appIds = fresh.map((job) => planned.get(job.id) as string);
  const placement = await placeManyAtEnd(db, scope, stage, appIds);
  const apps = fresh.map((job) => {
    const id = planned.get(job.id) as string;
    return {
      id,
      userJobId: job.id,
      origin: job.origin,
      rank: placement.ranks.get(id) as string,
      eventId: newId("evt", input.now),
      eventKey: input.idempotencyKey
        ? `${input.idempotencyKey}:${job.id}:created`
        : `created:${id}`,
    };
  });
  const statements = bulkTrackStatements(db, scope, {
    actorKind: input.actorKind,
    apps,
    mode,
    now: input.now,
    source: input.source,
    stage,
  });
  if (placement.rebalance) {
    const fresher = new Set(appIds);
    statements.push(
      ...rankRewriteStatements(
        db,
        scope,
        placement.rebalance.filter((r) => !fresher.has(r.id)),
        null,
        input.now
      )
    );
  }
  return {
    applications: apps.map((app) =>
      newApplicationRecord(scope, {
        id: app.id,
        userJobId: app.userJobId,
        stage,
        mode,
        rank: app.rank,
        source: input.source,
        now: input.now,
      })
    ),
    results,
    statements,
  };
}
