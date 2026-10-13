// Inbox filters (12 §4, 07 §12). The URL carries them so a filtered inbox
// can be linked; `state`, `min`, `source` and `q` go to `GET /api/v1/inbox`
// (05 §4), the rest — workplace, posted within, score band, hide blockers —
// filter the loaded rows in the browser (the API has no such parameters).

import type { InboxItem } from "@pilihpendidikan/jobs-contracts/api";
import type { WorkplaceType } from "@pilihpendidikan/jobs-contracts/enums";
import { WORKPLACE_TYPES } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApiQuery } from "./api-routes";
import type { ScoreBand } from "./inbox-score";
import { hasBlocker, SCORE_BANDS, scoreBandOf } from "./inbox-score";

/** The inbox's state tabs (12 §4 toolbar: New · Seen · Dismissed). */
export const INBOX_TABS = ["new", "seen", "dismissed"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];
export const DEFAULT_INBOX_TAB: InboxTab = "new";

/** "Posted within" choices, in days. */
export const POSTED_WITHIN_DAYS = [1, 7, 30] as const;
export type PostedWithin = (typeof POSTED_WITHIN_DAYS)[number];

/** Rows per `GET /api/v1/inbox` page (05 §1.5 default). */
export const INBOX_PAGE_SIZE = 50;

const DAY_MS = 86_400_000;
const MAX_QUERY_LENGTH = 200;
const SOURCE_RE = /^[A-Za-z0-9_]{1,64}$/;

export interface InboxSearch {
  /** Score band (client-side). */
  band?: ScoreBand;
  /** 1 = hide postings with a blocking or possible gate (client-side). */
  blockers?: 1;
  /** Minimum ready score (server-side `min_score`). */
  min?: number;
  /** Posted within N days (client-side). */
  posted?: PostedWithin;
  /** Title / company search (server-side `q`). */
  q?: string;
  /** A `src_…` id or a source kind (server-side `source`). */
  source?: string;
  /** The state tab; absent = New. */
  state?: InboxTab;
  /** Workplace type (client-side). */
  workplace?: WorkplaceType;
}

function includes<T extends string>(
  values: readonly T[],
  value: unknown
): value is T {
  return (values as readonly unknown[]).includes(value);
}

/** Parses the URL search of `/inbox`, dropping anything malformed. */
export function validateInboxSearch(
  search: Record<string, unknown>
): InboxSearch {
  const result: InboxSearch = {};
  if (includes(INBOX_TABS, search.state) && search.state !== "new") {
    result.state = search.state;
  }
  if (
    typeof search.q === "string" &&
    search.q.trim().length > 0 &&
    search.q.length <= MAX_QUERY_LENGTH
  ) {
    result.q = search.q;
  }
  const min = Number(search.min);
  if (search.min !== undefined && Number.isInteger(min) && min > 0) {
    result.min = Math.min(100, min);
  }
  if (typeof search.source === "string" && SOURCE_RE.test(search.source)) {
    result.source = search.source;
  }
  if (includes(WORKPLACE_TYPES, search.workplace)) {
    result.workplace = search.workplace;
  }
  const posted = POSTED_WITHIN_DAYS.find(
    (days) => String(days) === String(search.posted)
  );
  if (posted !== undefined) {
    result.posted = posted;
  }
  if (includes(SCORE_BANDS, search.band)) {
    result.band = search.band;
  }
  if (search.blockers === 1 || search.blockers === "1") {
    result.blockers = 1;
  }
  return result;
}

export function tabOf(search: InboxSearch): InboxTab {
  return search.state ?? DEFAULT_INBOX_TAB;
}

/** The `GET /api/v1/inbox` query for these filters (no cursor). */
export function inboxApiQuery(
  search: InboxSearch
): ApiQuery<"GET /api/v1/inbox"> {
  const query: ApiQuery<"GET /api/v1/inbox"> = {
    state: tabOf(search),
    limit: INBOX_PAGE_SIZE,
  };
  if (search.min !== undefined) {
    query.min_score = search.min;
  }
  if (search.source) {
    query.source = search.source;
  }
  const q = search.q?.trim();
  if (q) {
    query.q = q;
  }
  return query;
}

/** Filters the API cannot apply, applied to the loaded rows. */
export function applyClientFilters(
  items: readonly InboxItem[],
  search: InboxSearch,
  nowMs: number
): InboxItem[] {
  return items.filter((item) => {
    if (search.workplace && item.posting.workplace_type !== search.workplace) {
      return false;
    }
    if (search.posted !== undefined) {
      const posted = item.posting.posted_at ?? item.posting.first_seen_at;
      if (nowMs - posted > search.posted * DAY_MS) {
        return false;
      }
    }
    if (search.band && scoreBandOf(item.score) !== search.band) {
      return false;
    }
    if (search.blockers === 1 && hasBlocker(item.score)) {
      return false;
    }
    return true;
  });
}

/** How many filters beyond the tab and the search box are on. */
export function activeFilterCount(search: InboxSearch): number {
  return [
    search.min,
    search.source,
    search.workplace,
    search.posted,
    search.band,
    search.blockers,
  ].filter((value) => value !== undefined).length;
}

/** True when any filter (search included) narrows the list. */
export function isFiltered(search: InboxSearch): boolean {
  return activeFilterCount(search) > 0 || Boolean(search.q?.trim());
}

/** The search with every filter cleared, keeping the tab. */
export function clearedSearch(search: InboxSearch): InboxSearch {
  return search.state ? { state: search.state } : {};
}
