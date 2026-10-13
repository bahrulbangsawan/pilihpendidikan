// Where a card lands in a column (06 §1.2): the server computes every rank.

import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import type { RankPlacement } from "../../core/rank";
import {
  isValidRank,
  placeInColumn,
  RANK_MAX_LENGTH,
  rankBetween,
  rebalanceRanks,
} from "../../core/rank";
import type { UserScope } from "../../core/scope";
import {
  lastRankInColumn,
  loadColumn,
} from "../../repo/applications/applications";
import type { JobsDb } from "../../repo/core/db";

/**
 * A rank at the bottom of `stage`'s column. `afterRank` overrides the stored
 * last rank (bulk tracking plans several cards before any is written). When
 * the next rank would exceed 32 characters, or the stored ranks are not
 * valid, the whole column is rebalanced.
 */
export async function placeAtEnd(
  db: JobsDb,
  scope: UserScope,
  stage: Stage,
  movingId: string,
  afterRank?: string | null
): Promise<RankPlacement> {
  const last =
    afterRank === undefined
      ? await lastRankInColumn(db, scope, stage)
      : afterRank;
  if (last === null || isValidRank(last)) {
    const rank = rankBetween(last, null);
    if (rank.length <= RANK_MAX_LENGTH) {
      return { rank, rebalance: null };
    }
  }
  const column = await loadColumn(db, scope, stage, movingId);
  return placeInColumn(column, movingId, {});
}

/** A rank between the given neighbours of `stage`'s current column. */
export async function placeBetween(
  db: JobsDb,
  scope: UserScope,
  stage: Stage,
  movingId: string,
  neighbours: { afterId?: string | null; beforeId?: string | null }
): Promise<RankPlacement> {
  const column = await loadColumn(db, scope, stage, movingId);
  return placeInColumn(column, movingId, neighbours);
}

/** `count` ascending ranks strictly between `lower` and `upper` (bisection). */
function spreadBetween(
  lower: string | null,
  upper: string | null,
  count: number,
  out: string[]
): void {
  if (count <= 0) {
    return;
  }
  const mid = rankBetween(lower, upper);
  const left = Math.floor((count - 1) / 2);
  spreadBetween(lower, mid, left, out);
  out.push(mid);
  spreadBetween(mid, upper, count - 1 - left, out);
}

/**
 * Ranks for `movingIds` appended (in order) at the bottom of `stage`'s
 * column, for bulk tracking. The new ranks are spread by bisection after the
 * column's last rank (their length grows with log₂ of the count, not the
 * count). When one would exceed 32 characters, or the stored ranks are not
 * valid, the whole column plus the new cards is rebalanced.
 */
export async function placeManyAtEnd(
  db: JobsDb,
  scope: UserScope,
  stage: Stage,
  movingIds: readonly string[]
): Promise<{
  ranks: Map<string, string>;
  rebalance: Array<{ id: string; rank: string }> | null;
}> {
  const ranks = new Map<string, string>();
  if (movingIds.length === 0) {
    return { ranks, rebalance: null };
  }
  const last = await lastRankInColumn(db, scope, stage);
  if (last === null || isValidRank(last)) {
    const spread: string[] = [];
    spreadBetween(last, null, movingIds.length, spread);
    if (spread.every((rank) => rank.length <= RANK_MAX_LENGTH)) {
      for (const [i, id] of movingIds.entries()) {
        ranks.set(id, spread[i]);
      }
      return { ranks, rebalance: null };
    }
  }
  const column = await loadColumn(db, scope, stage, null);
  const ordered = [...column.map((card) => card.id), ...movingIds];
  const fresh = rebalanceRanks(ordered.length);
  const rebalance = ordered.map((id, i) => ({ id, rank: fresh[i] }));
  for (const { id, rank } of rebalance) {
    ranks.set(id, rank);
  }
  return { ranks, rebalance };
}
