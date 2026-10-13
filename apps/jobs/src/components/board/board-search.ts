// Board filters in the URL (`/board?due=1&mode=auto…`) so a filtered board
// can be linked, e.g. from the Stats "unconfirmed submissions" callout.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { BoardFilters } from "@/lib/board-model";
import type { MoveRequest } from "./use-move-card";

export interface BoardSearch {
  archived?: 1;
  attention?: 1;
  due?: 1;
  mode?: BoardFilters["mode"];
  noResponse?: number;
  priority?: 1;
  q?: string;
  source?: BoardFilters["source"];
}

export function filtersFromSearch(search: BoardSearch): BoardFilters {
  return {
    q: search.q ?? "",
    mode: search.mode ?? "any",
    source: search.source ?? "any",
    followUpDue: search.due === 1,
    needsAttention: search.attention === 1,
    priority: search.priority === 1,
    noResponseDays: search.noResponse ?? null,
  };
}

export function searchFromFilters(
  filters: BoardFilters,
  archived: boolean
): BoardSearch {
  return {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.mode === "any" ? {} : { mode: filters.mode }),
    ...(filters.source === "any" ? {} : { source: filters.source }),
    ...(filters.followUpDue ? { due: 1 } : {}),
    ...(filters.needsAttention ? { attention: 1 } : {}),
    ...(filters.priority ? { priority: 1 } : {}),
    ...(filters.noResponseDays === null
      ? {}
      : { noResponse: filters.noResponseDays }),
    ...(archived ? { archived: 1 } : {}),
  };
}

/** A board card as the subject of a move. */
export function moveSubject(card: BoardCard): MoveRequest["card"] {
  return {
    id: card.id,
    stage: card.stage,
    revision: card.revision,
    submission_status: card.submission_status,
    live_task: card.live_task,
    company: card.posting.company_name,
    title: card.posting.title,
  };
}
