// The board query (06 §1.4, 12 §3): `GET /api/v1/board` polled every 15 s
// while visible, with `If-None-Match` so an unchanged board costs a 304. The
// cached value keeps the ETag; pending moves are an overlay on top of it
// (src/lib/board-model.ts), so a poll landing mid-move never undoes the drop.

import type { BoardResponse } from "@pilihpendidikan/jobs-contracts/api";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { apiCall } from "@/lib/api-client";
import type { PendingMove } from "@/lib/board-model";
import { applyPendingMoves, columnsFromBoard } from "@/lib/board-model";
import type { PollPolicy } from "@/lib/polling";
import { POLL_POLICIES } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { usePollingQuery } from "./use-polling-query";

export interface BoardData {
  board: BoardResponse;
  etag: string | null;
  /** When this copy was confirmed by the server (a 304 refreshes it). */
  fetchedAt: number;
}

/** Fetches the board, reusing the cached copy on 304 Not Modified. */
export async function fetchBoard(
  queryClient: QueryClient,
  includeArchived: boolean
): Promise<BoardData> {
  const key = queryKeys.board(includeArchived);
  const previous = queryClient.getQueryData<BoardData>(key);
  const result = await apiCall("GET /api/v1/board", {
    query: includeArchived ? { include_archived: "1" } : {},
    ...(previous?.etag ? { ifNoneMatch: previous.etag } : {}),
  });
  if (result.notModified && previous) {
    return { ...previous, fetchedAt: Date.now() };
  }
  if (!result.data) {
    throw new Error("Empty board response.");
  }
  return { board: result.data, etag: result.etag, fetchedAt: Date.now() };
}

// ── Pending moves (optimistic overlay) ──────────────────────────────────────

export interface PendingMovesStore {
  add: (move: PendingMove) => void;
  getSnapshot: () => readonly PendingMove[];
  remove: (cardId: string) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPendingMovesStore(): PendingMovesStore {
  let moves: readonly PendingMove[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    getSnapshot: () => moves,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add: (move) => {
      moves = [...moves.filter((entry) => entry.cardId !== move.cardId), move];
      emit();
    },
    remove: (cardId) => {
      if (moves.some((entry) => entry.cardId === cardId)) {
        moves = moves.filter((entry) => entry.cardId !== cardId);
        emit();
      }
    },
  };
}

/** The app's one overlay (moves are made from the board and the detail page). */
export const pendingMoves = createPendingMovesStore();
const NO_MOVES: readonly PendingMove[] = [];

export function usePendingMoves(): readonly PendingMove[] {
  return useSyncExternalStore(
    pendingMoves.subscribe,
    pendingMoves.getSnapshot,
    () => NO_MOVES
  );
}

/** The board copy with `application`'s confirmed fields applied. */
export function patchBoardWithApplication(
  data: BoardData,
  application: ApplicationRecord,
  includeArchived: boolean
): BoardData {
  const original = data.board.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === application.id);
  if (!original) {
    return data;
  }
  const updated = {
    ...original,
    stage: application.stage,
    stage_changed_at: application.stage_changed_at,
    board_rank: application.board_rank,
    revision: application.revision,
    submission_status: application.submission_status,
    mode: application.mode,
    priority: application.priority,
    archived: application.archived,
    follow_up_at: application.follow_up_at,
    follow_up_due:
      application.follow_up_at !== null &&
      application.follow_up_at <= Date.now(),
    cv_variant_id: application.cv_variant_id,
    updated_at: application.updated_at,
  };
  const keep = includeArchived || !updated.archived;
  const columns = data.board.columns.map((column) => {
    let cards = column.cards.filter((card) => card.id !== application.id);
    let total = column.total - (column.stage === original.stage ? 1 : 0);
    if (keep && column.stage === updated.stage) {
      cards = [...cards, updated];
      total += 1;
    }
    return { ...column, cards, total: Math.max(0, total) };
  });
  return { ...data, board: { ...data.board, columns } };
}

/** Writes a confirmed application row into every cached board copy. */
export function commitApplicationToBoard(
  queryClient: QueryClient,
  application: ApplicationRecord
): void {
  for (const [key, data] of queryClient.getQueriesData<BoardData>({
    queryKey: queryKeys.boardAll,
  })) {
    if (!data) {
      continue;
    }
    const scope = key[1] as { includeArchived?: boolean } | undefined;
    queryClient.setQueryData<BoardData>(
      key,
      patchBoardWithApplication(
        data,
        application,
        scope?.includeArchived === true
      )
    );
  }
}

export interface UseBoardOptions {
  enabled?: boolean;
  includeArchived?: boolean;
  policy?: PollPolicy;
}

export function useBoard(options: UseBoardOptions = {}) {
  const queryClient = useQueryClient();
  const includeArchived = options.includeArchived ?? false;
  const query = usePollingQuery({
    queryKey: queryKeys.board(includeArchived),
    queryFn: () => fetchBoard(queryClient, includeArchived),
    policy: options.policy ?? POLL_POLICIES.board,
    enabled: options.enabled ?? true,
  });
  const pending = usePendingMoves();
  const columns = useMemo(
    () =>
      query.data
        ? applyPendingMoves(columnsFromBoard(query.data.board), pending)
        : null,
    [query.data, pending]
  );
  const pendingIds = useMemo(
    () => new Set(pending.map((move) => move.cardId)),
    [pending]
  );
  return { ...query, columns, pendingIds };
}
