// Board ranks (06 §1.2): fractional index strings over base 36 (`0-9a-z`),
// compared as plain strings so `ix_apps_board(user_id, archived, stage,
// board_rank)` returns a column in display order.
//
// - `rankBetween(lower, upper)` returns the midpoint string strictly between
//   two ranks (null = open end). Ranks never end in "0", which guarantees a
//   midpoint always exists.
// - When a midpoint would exceed 32 characters the server rebalances the
//   column: every card gets an evenly spaced 6-character rank, written in one
//   `batch()` with `revision + 1` and a change_log entry per card.
// - Clients never compute ranks: `/move` sends `before_id` (the card that
//   will sit above) and `after_id` (the card below), and the server calls
//   `placeInColumn`.

export const RANK_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = RANK_DIGITS.length;
const ZERO = RANK_DIGITS[0];

/** A midpoint longer than this triggers a column rebalance. */
export const RANK_MAX_LENGTH = 32;
/** Length of the evenly spaced ranks a rebalance writes. */
export const REBALANCE_RANK_LENGTH = 6;

const RANK_RE = /^[0-9a-z]*[1-9a-z]$/;

/** Non-empty, base-36 lowercase, no trailing "0". */
export function isValidRank(value: string): boolean {
  return RANK_RE.test(value);
}

function digit(char: string): number {
  return RANK_DIGITS.indexOf(char);
}

// Midpoint of the base-36 fractions 0.a and 0.b (b = null means 1.0).
// `a` may be "" (= 0). Neither ends in "0". Requires a < b.
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) {
      n++;
    }
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
  }
  const digitA = a ? digit(a[0]) : 0;
  const digitB = b === null ? BASE : digit(b[0]);
  if (digitB - digitA > 1) {
    return RANK_DIGITS[Math.round((digitA + digitB) / 2)];
  }
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return RANK_DIGITS[digitA] + midpoint(a.slice(1), null);
}

/**
 * A rank strictly between `lower` and `upper` (either may be null for an open
 * end). Throws when an input is not a valid rank or `lower >= upper`.
 */
export function rankBetween(
  lower: string | null,
  upper: string | null
): string {
  if (lower !== null && !isValidRank(lower)) {
    throw new Error(`invalid rank "${lower}"`);
  }
  if (upper !== null && !isValidRank(upper)) {
    throw new Error(`invalid rank "${upper}"`);
  }
  if (lower !== null && upper !== null && lower >= upper) {
    throw new Error(
      `rankBetween needs lower < upper ("${lower}" ≥ "${upper}")`
    );
  }
  return midpoint(lower ?? "", upper);
}

/** `count` evenly spaced 6-character ranks in ascending order. */
export function rebalanceRanks(count: number): string[] {
  const space = BASE ** REBALANCE_RANK_LENGTH;
  if (!Number.isInteger(count) || count < 0 || count > space / 4) {
    throw new Error(`cannot rebalance ${count} ranks`);
  }
  const step = space / (count + 1);
  const ranks: string[] = [];
  for (let i = 1; i <= count; i++) {
    let value = Math.floor(step * i);
    if (value % BASE === 0) {
      value += 1;
    }
    ranks.push(value.toString(BASE).padStart(REBALANCE_RANK_LENGTH, ZERO));
  }
  return ranks;
}

export interface RankedCard {
  id: string;
  rank: string;
}

export type RankPlacement =
  | { rank: string; rebalance: null }
  | {
      rank: string;
      /** New ranks for every card of the column (the moved card included). */
      rebalance: Array<{ id: string; rank: string }>;
    };

function safeRankBetween(
  lower: string | null,
  upper: string | null
): string | null {
  try {
    return rankBetween(lower, upper);
  } catch {
    return null;
  }
}

function anchorIndex(
  column: readonly RankedCard[],
  id: string | null | undefined
): number {
  return id ? column.findIndex((card) => card.id === id) : -1;
}

/**
 * Where a card lands in a column (06 §2.1, rank-only conflicts auto-resolve).
 *
 * `column` is the target column in display order WITHOUT the moving card.
 * `beforeId` is the card that should end up directly above, `afterId` the one
 * directly below. Stale neighbours are resolved against the current column:
 * an existing `beforeId` wins (the card goes right below it), else an existing
 * `afterId` (right above it), else the card is appended at the bottom.
 */
export function placeInColumn(
  column: readonly RankedCard[],
  movingId: string,
  neighbours: { afterId?: string | null; beforeId?: string | null }
): RankPlacement {
  const others = column.filter((card) => card.id !== movingId);
  const beforeIndex = anchorIndex(others, neighbours.beforeId);
  const afterIndex = anchorIndex(others, neighbours.afterId);
  let insertAt: number;
  if (beforeIndex !== -1) {
    insertAt = beforeIndex + 1;
  } else if (afterIndex === -1) {
    insertAt = others.length;
  } else {
    insertAt = afterIndex;
  }
  const lower = insertAt > 0 ? others[insertAt - 1].rank : null;
  const upper = insertAt < others.length ? others[insertAt].rank : null;
  const rank = safeRankBetween(lower, upper);
  if (rank !== null && rank.length <= RANK_MAX_LENGTH) {
    return { rank, rebalance: null };
  }
  // Too long, or the stored neighbours are not valid ascending ranks (e.g.
  // duplicates written by an old client): rewrite the whole column.
  const ordered = [
    ...others.slice(0, insertAt).map((card) => card.id),
    movingId,
    ...others.slice(insertAt).map((card) => card.id),
  ];
  const ranks = rebalanceRanks(ordered.length);
  const rebalance = ordered.map((id, i) => ({ id, rank: ranks[i] }));
  return { rank: ranks[insertAt], rebalance };
}

/** Rank for a card appended below `lastRank` (null = empty column). */
export function rankAfter(lastRank: string | null): string {
  return rankBetween(lastRank, null);
}
