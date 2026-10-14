// Inbox data (12 §4, §10): the cursor-paged list, the discovery runs that
// decide whether it polls (30 s while any run is `running`, otherwise only
// on focus), the source list for the filter and empty states, the lazily
// loaded score components, and the bulk mutation.

import type {
  InboxBulkResponse,
  InboxItem,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  InboxBulkAction,
  InboxState,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { DiscoveryRunRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { api } from "@/lib/api-client";
import type { BulkRowResult, InboxBulkSummary } from "@/lib/inbox-bulk";
import { runInboxBulk, summarizeInboxBulk } from "@/lib/inbox-bulk";
import type { InboxSearch } from "@/lib/inbox-filters";
import { inboxApiQuery } from "@/lib/inbox-filters";
import { anyRunActive } from "@/lib/inbox-state";
import { isStale, POLL_POLICIES, pollInterval } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { useDocumentHidden } from "./use-polling-query";

/** Recent runs are enough for the strip and the "running" check. */
const RUNS_LIMIT = 20;
const SOURCES_LIMIT = 200;
const MINUTE_MS = 60_000;

/** Query keys of the inbox's own views (prefix-invalidated with the areas). */
const inboxKeys = {
  runs: [...queryKeys.discoveryRuns, "inbox"] as const,
  sources: [...queryKeys.sources, "inbox-options"] as const,
};

/** Discovery runs, polled every 30 s only while one is running. */
export function useInboxRuns() {
  const hidden = useDocumentHidden();
  return useQuery({
    queryKey: inboxKeys.runs,
    queryFn: async () =>
      (
        await api("GET /api/v1/discovery/runs", {
          query: { limit: RUNS_LIMIT },
        })
      ).items as DiscoveryRunRecord[],
    staleTime: 30_000,
    refetchInterval: (query) =>
      anyRunActive(query.state.data)
        ? pollInterval(POLL_POLICIES.inboxActive, { hidden, failures: 0 })
        : false,
    refetchIntervalInBackground: false,
  });
}

/** The caller's sources (filter options, empty states). */
export function useInboxSources() {
  return useQuery({
    queryKey: inboxKeys.sources,
    queryFn: async () =>
      (await api("GET /api/v1/sources", { query: { limit: SOURCES_LIMIT } }))
        .items,
    staleTime: 5 * MINUTE_MS,
  });
}

/**
 * Cloud boards the user follows (24 §5.3): their postings carry the `csr_…`
 * id as the inbox source, so the source filter offers them by name. Shares
 * the /sources list cache; a failure only hides the options.
 */
export function useFollowedCloudSources() {
  return useQuery({
    queryKey: queryKeys.cloudSources,
    queryFn: () => api("GET /api/v1/cloud-sources", {}),
    select: (data) => data.items.filter((source) => source.following),
    staleTime: 5 * MINUTE_MS,
    retry: false,
  });
}

/** The inbox list for `search`, 50 rows a page, "Load more" for the next. */
export function useInboxItems(search: InboxSearch, runActive: boolean) {
  const failures = useRef(0);
  const query = useMemo(() => inboxApiQuery(search), [search]);
  const result = useInfiniteQuery({
    queryKey: queryKeys.inbox(query),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      try {
        const page = await api("GET /api/v1/inbox", {
          query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) },
        });
        failures.current = 0;
        return page;
      } catch (error) {
        failures.current += 1;
        throw error;
      }
    },
    getNextPageParam: (page) => page.next_cursor,
    retry: false,
    refetchInterval: () =>
      runActive
        ? pollInterval(POLL_POLICIES.inboxActive, {
            hidden: typeof document !== "undefined" && document.hidden,
            failures: failures.current,
          })
        : false,
    refetchIntervalInBackground: false,
  });
  const items = useMemo<InboxItem[]>(() => {
    const byId = new Map<string, InboxItem>();
    for (const page of result.data?.pages ?? []) {
      for (const item of page.items) {
        byId.set(item.user_job.id, item);
      }
    }
    return [...byId.values()];
  }, [result.data]);
  return { ...result, items, stale: isStale(failures.current) };
}

/** Full score row with components, fetched when a breakdown is opened. */
export function useScoreDetail(postingId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.score(postingId),
    queryFn: () =>
      api("GET /api/v1/scores/{posting_id}", {
        params: { posting_id: postingId },
      }),
    enabled,
    staleTime: 5 * MINUTE_MS,
  });
}

export interface BulkOutcome {
  results: BulkRowResult[];
  summary: InboxBulkSummary;
}

/** Runs an inbox bulk action and refreshes the inbox, board and scores. */
export function useInboxBulk() {
  const queryClient = useQueryClient();
  return useCallback(
    async (
      action: InboxBulkAction,
      ids: readonly string[],
      previous: ReadonlyMap<string, InboxState>
    ): Promise<BulkOutcome> => {
      const results = await runInboxBulk(
        action,
        ids,
        (body, idempotencyKey): Promise<InboxBulkResponse> =>
          api("POST /api/v1/inbox:bulk", { body, idempotencyKey })
      );
      const summary = summarizeInboxBulk(action, results, previous);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inboxAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.boardAll }),
        ...(action === "score"
          ? [queryClient.invalidateQueries({ queryKey: ["score"] })]
          : []),
      ]);
      return { results, summary };
    },
    [queryClient]
  );
}
