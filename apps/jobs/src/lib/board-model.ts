// The Kanban model (06 §1): stage columns in board order, the collapsed
// Closed lane (rejected + withdrawn), filters, and the pending-move overlay
// that shows an optimistic drop until the API answers. Pure functions over
// the `GET /api/v1/board` payload; the components only render.

import type {
  BoardCard,
  BoardResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationMode,
  SourceKind,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import { STAGES } from "@pilihpendidikan/jobs-contracts/enums";

/** The open columns, left to right (06 §1.1). */
export const BOARD_STAGES = [
  "saved",
  "preparing",
  "ready",
  "applied",
  "interviewing",
  "offer",
  "accepted",
] as const satisfies readonly Stage[];

/** Collapsed into one "Closed" lane on the right. */
export const CLOSED_STAGES = [
  "rejected",
  "withdrawn",
] as const satisfies readonly Stage[];

export type ClosedStage = (typeof CLOSED_STAGES)[number];

export const DAY_MS = 86_400_000;
/** "No response in N days" default (06 §3). */
export const NO_RESPONSE_DEFAULT_DAYS = 21;

export type BoardColumns = Record<Stage, BoardCard[]>;

export function emptyColumns(): BoardColumns {
  const columns = {} as BoardColumns;
  for (const stage of STAGES) {
    columns[stage] = [];
  }
  return columns;
}

function byRank(a: BoardCard, b: BoardCard): number {
  if (a.board_rank === b.board_rank) {
    return a.id < b.id ? -1 : 1;
  }
  return a.board_rank < b.board_rank ? -1 : 1;
}

/** Every stage's cards in board_rank order (plain string compare, 06 §1.2). */
export function columnsFromBoard(board: BoardResponse): BoardColumns {
  const columns = emptyColumns();
  for (const column of board.columns) {
    columns[column.stage] = [...column.cards].sort(byRank);
  }
  return columns;
}

/** Server totals per stage (a capped closed lane has more than it shows). */
export function columnTotals(board: BoardResponse): Record<Stage, number> {
  const totals = {} as Record<Stage, number>;
  for (const stage of STAGES) {
    totals[stage] = 0;
  }
  for (const column of board.columns) {
    totals[column.stage] = column.total;
  }
  return totals;
}

export function findCard(
  columns: BoardColumns,
  cardId: string
): BoardCard | null {
  for (const stage of STAGES) {
    const card = columns[stage].find((entry) => entry.id === cardId);
    if (card) {
      return card;
    }
  }
  return null;
}

export function allCards(columns: BoardColumns): BoardCard[] {
  return STAGES.flatMap((stage) => columns[stage]);
}

/**
 * Moves `cardId` to `stage` at `index` (clamped), changing its stage. The
 * returned columns share untouched arrays with the input.
 */
export function moveCard(
  columns: BoardColumns,
  cardId: string,
  stage: Stage,
  index: number
): BoardColumns {
  const card = findCard(columns, cardId);
  if (!card) {
    return columns;
  }
  const next = { ...columns };
  next[card.stage] = columns[card.stage].filter((entry) => entry.id !== cardId);
  const target = [...next[stage]];
  const at = Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, { ...card, stage });
  next[stage] = target;
  return next;
}

/** Neighbours of position `index` in `column` once `movingId` is lifted out. */
export function neighboursAt(
  column: readonly BoardCard[],
  index: number,
  movingId: string
): { beforeId: string | null; afterId: string | null } {
  const rest = column.filter((entry) => entry.id !== movingId);
  const at = Math.max(0, Math.min(index, rest.length));
  return {
    beforeId: rest[at - 1]?.id ?? null,
    afterId: rest[at]?.id ?? null,
  };
}

/** A drop the API has not confirmed yet (06 §2.1 step 2). */
export interface PendingMove {
  /** The card that will sit right below (`after_id`), if any. */
  afterId: string | null;
  /** The card that will sit right above (`before_id`), if any. */
  beforeId: string | null;
  cardId: string;
  stage: Stage;
}

/** Where a pending move lands in its target column. */
function pendingIndex(column: readonly BoardCard[], move: PendingMove): number {
  const rest = column.filter((entry) => entry.id !== move.cardId);
  if (move.beforeId) {
    const at = rest.findIndex((entry) => entry.id === move.beforeId);
    if (at !== -1) {
      return at + 1;
    }
  }
  if (move.afterId) {
    const at = rest.findIndex((entry) => entry.id === move.afterId);
    if (at !== -1) {
      return at;
    }
  }
  return move.beforeId ? rest.length : 0;
}

/** The server columns with every pending move applied on top. */
export function applyPendingMoves(
  columns: BoardColumns,
  pending: readonly PendingMove[]
): BoardColumns {
  let next = columns;
  for (const move of pending) {
    if (!findCard(next, move.cardId)) {
      continue;
    }
    next = moveCard(
      next,
      move.cardId,
      move.stage,
      pendingIndex(next[move.stage], move)
    );
  }
  return next;
}

// ── Filters (12 §3 toolbar, 06 §3 / §7) ─────────────────────────────────────

export interface BoardFilters {
  /** Follow-up due (`follow_up_at ≤ now`). */
  followUpDue: boolean;
  mode: ApplicationMode | "any";
  /** Submission needs the user: unconfirmed or outcome unknown. */
  needsAttention: boolean;
  /** Applied N+ days ago with no stage change since (06 §3); null = off. */
  noResponseDays: number | null;
  /** High priority only. */
  priority: boolean;
  /** Free text over company, title and location. */
  q: string;
  source: SourceKind | "any";
}

export const DEFAULT_FILTERS: BoardFilters = {
  followUpDue: false,
  mode: "any",
  needsAttention: false,
  noResponseDays: null,
  priority: false,
  q: "",
  source: "any",
};

export function isFiltered(filters: BoardFilters): boolean {
  return (
    filters.followUpDue ||
    filters.mode !== "any" ||
    filters.needsAttention ||
    filters.noResponseDays !== null ||
    filters.priority ||
    filters.q.trim() !== "" ||
    filters.source !== "any"
  );
}

/** Applied `days`+ days ago and still in Applied: no answer yet. */
export function hasNoResponse(
  card: BoardCard,
  days: number,
  nowMs: number
): boolean {
  return (
    card.stage === "applied" && nowMs - card.stage_changed_at >= days * DAY_MS
  );
}

export function isFollowUpDue(card: BoardCard, nowMs: number): boolean {
  return card.follow_up_at !== null && card.follow_up_at <= nowMs;
}

export function needsAttention(card: BoardCard): boolean {
  return (
    card.submission_status === "submitted_unverified" ||
    card.submission_status === "outcome_unknown"
  );
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().normalize("NFKD");
}

export function matchesFilters(
  card: BoardCard,
  filters: BoardFilters,
  nowMs: number
): boolean {
  const query = normalize(filters.q.trim());
  if (query) {
    const haystack = normalize(
      [
        card.posting.company_name,
        card.posting.title,
        card.posting.location ?? "",
      ].join(" ")
    );
    if (!haystack.includes(query)) {
      return false;
    }
  }
  const checks: boolean[] = [
    filters.mode === "any" || card.mode === filters.mode,
    filters.source === "any" || card.posting.source_kind === filters.source,
    !filters.followUpDue || isFollowUpDue(card, nowMs),
    !filters.needsAttention || needsAttention(card),
    !filters.priority || card.priority === 1,
    filters.noResponseDays === null ||
      hasNoResponse(card, filters.noResponseDays, nowMs),
  ];
  return checks.every(Boolean);
}

export function filterColumns(
  columns: BoardColumns,
  filters: BoardFilters,
  nowMs: number
): BoardColumns {
  if (!isFiltered(filters)) {
    return columns;
  }
  const next = emptyColumns();
  for (const stage of STAGES) {
    next[stage] = columns[stage].filter((card) =>
      matchesFilters(card, filters, nowMs)
    );
  }
  return next;
}

/** Source kinds present on the board, for the Source filter. */
export function presentSources(columns: BoardColumns): SourceKind[] {
  const seen = new Set<SourceKind>();
  for (const card of allCards(columns)) {
    seen.add(card.posting.source_kind);
  }
  return [...seen].sort();
}

/** Upcoming interviews on the board (overview strip, 10 §8). */
export function upcomingInterviews(
  columns: BoardColumns,
  nowMs: number
): number {
  return allCards(columns).filter(
    (card) => card.next_interview_at !== null && card.next_interview_at >= nowMs
  ).length;
}

/** Monday 00:00 of the current week, in the browser's timezone. */
export function startOfWeek(nowMs: number): Date {
  const date = new Date(nowMs);
  const weekday = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - weekday);
  return date;
}

/** `YYYY-MM-DD` of a local date. */
export function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
