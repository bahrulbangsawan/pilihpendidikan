// The application detail (05 §5 `GET /applications/{id}`) and its timeline
// (`…/events`, 50 per page). 12 §10: 15 s while visible, 2 s while a task for
// this application is claimed / running / awaiting approval (10 s hidden).

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { QueryClient } from "@tanstack/react-query";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { api } from "@/lib/api-client";
import { isLivePollState, POLL_POLICIES, pollInterval } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { usePollingQuery } from "./use-polling-query";

export const EVENTS_PAGE = 50;

export function isLiveDetail(detail: ApplicationDetail | undefined): boolean {
  return detail?.tasks.some((task) => isLivePollState(task.state)) ?? false;
}

export function useApplication(appId: string) {
  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<ApplicationDetail>(
    queryKeys.application(appId)
  );
  const live = isLiveDetail(cached);
  return usePollingQuery({
    queryKey: queryKeys.application(appId),
    queryFn: () =>
      api("GET /api/v1/applications/{app_id}", { params: { app_id: appId } }),
    policy: live ? POLL_POLICIES.applicationLive : POLL_POLICIES.application,
  });
}

/** Replaces the application row inside the cached detail. */
export function patchDetailApplication(
  queryClient: QueryClient,
  application: ApplicationDetail["application"]
): void {
  queryClient.setQueryData<ApplicationDetail>(
    queryKeys.application(application.id),
    (detail) => (detail ? { ...detail, application } : detail)
  );
}

export function useApplicationEvents(appId: string, live: boolean) {
  const failures = useRef(0);
  const policy = live
    ? POLL_POLICIES.applicationLive
    : POLL_POLICIES.application;
  const query = useInfiniteQuery({
    queryKey: queryKeys.applicationEvents(appId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      try {
        const page = await api("GET /api/v1/applications/{app_id}/events", {
          params: { app_id: appId },
          query: {
            limit: EVENTS_PAGE,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
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
      pollInterval(policy, {
        hidden: typeof document !== "undefined" && document.hidden,
        failures: failures.current,
      }),
    refetchIntervalInBackground: policy.hidden !== false,
  });
  /** Newest first (06 §4), by the server's authoritative recorded_at. */
  const events = useMemo<ApplicationEventRecord[]>(() => {
    const byId = new Map<string, ApplicationEventRecord>();
    for (const page of query.data?.pages ?? []) {
      for (const event of page.items) {
        byId.set(event.id, event);
      }
    }
    return [...byId.values()].sort((a, b) => b.recorded_at - a.recorded_at);
  }, [query.data]);
  return { ...query, events };
}
