// Stage changes of one card (03 §5.1) on top of repo/core/application-state:
// the transition (validation, in-flight refusal, events, revision bump,
// change_log) plus the card's rank in its new column (06 §1.2) and any other
// columns the same request writes.

import type {
  ActorKind,
  ChangeSource,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import { canTransition } from "@pilihpendidikan/jobs-contracts/stage";
import { invalidTransition } from "../../core/http";
import type { RankPlacement } from "../../core/rank";
import type { UserScope } from "../../core/scope";
import type { ApplicationFieldChanges } from "../../repo/applications/applications";
import {
  rankRewriteStatements,
  updateFieldsStatements,
} from "../../repo/applications/applications";
import type {
  StageOutcome,
  TransitionInput,
  TransitionPlan,
} from "../../repo/core/application-state";
import { planApplicationTransition } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import { placeAtEnd } from "./placement";

/**
 * Where a card lands when its stage moves: `"end"` (default) appends it to
 * the new column, a placement computed by the caller uses that rank,
 * `"keep"` keeps the stored rank.
 */
export type StagePlacement = "end" | "keep" | RankPlacement;

export interface StageChangeInput {
  actor: ActorKind;
  actorDeviceId?: string | null;
  applicationId: string;
  /** Strict D-21 check; omit only for writes ruled by precedence. */
  baseRevision?: number | null;
  /** Prefix of the events' idempotency keys. */
  eventKeyPrefix?: string;
  /** Other columns written in the same batch when the stage moves. */
  fields?: ApplicationFieldChanges;
  now: number;
  placement?: StagePlacement;
  reason?: string;
  source: ChangeSource;
  to: Stage;
}

export interface StageChangePlan {
  /** The card as it reads after the batch. */
  application: ApplicationRecord;
  before: ApplicationRecord;
  result: StageOutcome["result"];
  statements: D1PreparedStatement[];
}

export interface RankedTransition {
  application: ApplicationRecord;
  plan: TransitionPlan;
  statements: D1PreparedStatement[];
}

async function resolvePlacement(
  db: JobsDb,
  scope: UserScope,
  stage: Stage,
  applicationId: string,
  placement: StagePlacement
): Promise<RankPlacement | null> {
  if (placement === "keep") {
    return null;
  }
  if (placement === "end") {
    return await placeAtEnd(db, scope, stage, applicationId);
  }
  return placement;
}

/**
 * A kernel transition (stage and/or submission) plus, when the stage moved,
 * the card's rank in its new column and `fields`, all fenced on the bumped
 * revision. When the row does not change, only the plan's statements (its
 * guard, conflict events) are returned and `fields` are not written.
 */
export async function planTransitionWithRank(
  db: JobsDb,
  scope: UserScope,
  transition: TransitionInput,
  extra: { fields?: ApplicationFieldChanges; placement?: StagePlacement } = {}
): Promise<RankedTransition> {
  const plan = await planApplicationTransition(db, scope, transition);
  const statements = [...plan.statements];
  if (!plan.changed) {
    return { application: plan.after, plan, statements };
  }
  const fields: ApplicationFieldChanges = { ...extra.fields };
  const placement =
    plan.stage?.result === "applied"
      ? await resolvePlacement(
          db,
          scope,
          plan.after.stage,
          plan.after.id,
          extra.placement ?? "end"
        )
      : null;
  if (placement && fields.board_rank === undefined) {
    fields.board_rank = placement.rank;
  }
  statements.push(
    ...updateFieldsStatements(db, scope, plan.after.id, fields, {
      bump: false,
      expectRevision: plan.after.revision,
      now: transition.now,
      source: transition.source,
    })
  );
  if (placement?.rebalance) {
    statements.push(
      ...rankRewriteStatements(
        db,
        scope,
        placement.rebalance,
        plan.after.id,
        transition.now
      )
    );
  }
  return {
    application: { ...plan.after, ...fields },
    plan,
    statements,
  };
}

/** Plans one stage change with the card's new rank. */
export async function planStageChange(
  db: JobsDb,
  scope: UserScope,
  input: StageChangeInput
): Promise<StageChangePlan> {
  const ranked = await planTransitionWithRank(
    db,
    scope,
    {
      applicationId: input.applicationId,
      actor: input.actor,
      actorDeviceId: input.actorDeviceId ?? null,
      source: input.source,
      now: input.now,
      baseRevision: input.baseRevision,
      eventKeyPrefix: input.eventKeyPrefix,
      stage: input.reason
        ? { to: input.to, reason: input.reason }
        : { to: input.to },
    },
    { fields: input.fields, placement: input.placement }
  );
  return {
    application: ranked.application,
    before: ranked.plan.before,
    result: ranked.plan.stage?.result ?? "unchanged",
    statements: ranked.statements,
  };
}

/**
 * Two user moves in one batch (an offer recorded as accepted from
 * `interviewing`: → offer → accepted, 06 §3). `path` lists the stages to
 * pass through; leading stages equal to `current` are skipped. Each hop is
 * validated against 03 §5.1 and writes its own `stage_changed` event.
 */
export async function planStagePath(
  db: JobsDb,
  scope: UserScope,
  input: Omit<StageChangeInput, "to" | "placement"> & {
    current: Stage;
    path: readonly Stage[];
  }
): Promise<StageChangePlan | null> {
  const start = input.path.indexOf(input.current);
  const hops = input.path.slice(start + 1);
  const [first, second, ...rest] = hops;
  if (first === undefined) {
    return null;
  }
  if (rest.length > 0) {
    throw new Error("planStagePath supports at most two hops");
  }
  const plan = await planStageChange(db, scope, {
    ...input,
    to: first,
    fields: second === undefined ? input.fields : undefined,
    // The card only passes through `first`; it is ranked in `second`.
    placement: second === undefined ? "end" : "keep",
  });
  if (second === undefined || plan.result !== "applied") {
    return plan;
  }
  if (!canTransition(first, second, "user")) {
    throw invalidTransition(
      `Moving from ${first} to ${second} is not allowed.`,
      {
        from: first,
        to: second,
      }
    );
  }
  const event = appendEvent(
    db,
    scope,
    {
      applicationId: input.applicationId,
      type: "stage_changed",
      actorKind: input.actor,
      actorDeviceId: input.actorDeviceId ?? null,
      fromValue: first,
      toValue: second,
      payload: input.reason
        ? { from: first, to: second, reason: input.reason }
        : { from: first, to: second },
      idempotencyKey: input.eventKeyPrefix
        ? `${input.eventKeyPrefix}:stage2`
        : undefined,
    },
    input.now
  );
  const placement = await placeAtEnd(db, scope, second, input.applicationId);
  const fields: ApplicationFieldChanges = {
    ...input.fields,
    stage: second,
    stage_changed_at: input.now,
    board_rank: placement.rank,
  };
  const statements = [
    ...plan.statements,
    ...updateFieldsStatements(db, scope, input.applicationId, fields, {
      bump: false,
      expectRevision: plan.application.revision,
      now: input.now,
      source: input.source,
    }),
    ...event.statements,
  ];
  if (placement.rebalance) {
    statements.push(
      ...rankRewriteStatements(
        db,
        scope,
        placement.rebalance,
        input.applicationId,
        input.now
      )
    );
  }
  return {
    application: { ...plan.application, ...fields },
    before: plan.before,
    result: "applied",
    statements,
  };
}
