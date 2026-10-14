// The cloud catalog (05 §15, 24 §5): the list (polled 30 s, 5 s while a
// source scrapes or a run the user just queued is live), one source's detail
// and run history, follow / unfollow (optimistic, rolled back on failure)
// and the operator writes (PATCH under the 12 §11 conflict rules, run /
// retry / re-probe, add a board, refresh the directory). One idempotency key
// per user intent.

import type {
  CloudRunView,
  CloudSourceListResponse,
  CloudSourceView,
  CreateCloudSourceRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import type { CloudSourceChanges } from "@/lib/cloud-sources-model";
import {
  CLOUD_SOURCE_FIELDS,
  hasLiveCloudWork,
  isLiveRun,
} from "@/lib/cloud-sources-model";
import { newIdempotencyKey } from "@/lib/idempotency";
import { POLL_POLICIES, pollInterval } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { useConflictWrite } from "./use-conflict-write";
import { usePollingQuery } from "./use-polling-query";

/** How long the list polls fast after the user queues a run. */
export const WATCH_MS = 3 * 60_000;
const RUNS_PAGE = 20;

// "A run I just queued" (module state: the list and the sheet share it).
let watchUntil = 0;
const watchers = new Set<() => void>();

export function watchCloudRuns(nowMs = Date.now()): void {
  watchUntil = nowMs + WATCH_MS;
  for (const notify of watchers) {
    notify();
  }
}

function subscribeWatch(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => watchers.delete(onChange);
}

export function useCloudWatch(): number {
  return useSyncExternalStore(
    subscribeWatch,
    () => watchUntil,
    () => 0
  );
}

export function useCloudSources() {
  const queryClient = useQueryClient();
  const watch = useCloudWatch();
  const cached = queryClient.getQueryData<CloudSourceListResponse>(
    queryKeys.cloudSources
  );
  const live = hasLiveCloudWork(cached?.items, watch, Date.now());
  return usePollingQuery({
    queryKey: queryKeys.cloudSources,
    queryFn: () => api("GET /api/v1/cloud-sources", {}),
    policy: live
      ? POLL_POLICIES.cloudSourcesActive
      : POLL_POLICIES.cloudSources,
  });
}

/** One source with its ten newest runs; polls fast while a run is live. */
export function useCloudSource(id: string | null) {
  const watch = useCloudWatch();
  return useQuery({
    queryKey: queryKeys.cloudSource(id ?? "none"),
    enabled: id !== null,
    queryFn: () =>
      api("GET /api/v1/cloud-sources/{csr_id}", {
        params: { csr_id: id ?? "" },
      }),
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      const live =
        watch > Date.now() ||
        data?.source.status === "SCRAPING" ||
        (data?.runs ?? []).some(isLiveRun);
      return pollInterval(
        live ? POLL_POLICIES.cloudSourcesActive : POLL_POLICIES.cloudSources,
        {
          hidden: typeof document !== "undefined" && document.hidden,
          failures: query.state.fetchFailureCount,
        }
      );
    },
  });
}

/** Older runs, page by page (`GET …/runs` cursor). */
export function useCloudRunPages(id: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.cloudSourceRuns(id ?? "none"),
    enabled: id !== null && enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api("GET /api/v1/cloud-sources/{csr_id}/runs", {
        params: { csr_id: id ?? "" },
        query: {
          limit: RUNS_PAGE,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (last) => last.next_cursor ?? null,
    retry: false,
  });
}

/** Detail runs first, then any loaded pages, without duplicates. */
export function mergeRuns(
  first: readonly CloudRunView[],
  pages: readonly { items: readonly CloudRunView[] }[]
): CloudRunView[] {
  const seen = new Set<string>();
  const out: CloudRunView[] = [];
  for (const run of [...first, ...pages.flatMap((page) => page.items)]) {
    if (!seen.has(run.id)) {
      seen.add(run.id);
      out.push(run);
    }
  }
  return out.sort((a, b) => b.queued_at - a.queued_at);
}

function replaceInList(
  list: CloudSourceListResponse | undefined,
  source: CloudSourceView
): CloudSourceListResponse | undefined {
  if (!list) {
    return list;
  }
  const exists = list.items.some((item) => item.id === source.id);
  return {
    ...list,
    items: exists
      ? list.items.map((item) => (item.id === source.id ? source : item))
      : [...list.items, source],
  };
}

function errorText(
  t: (key: string, vars?: Record<string, string | number>) => string,
  error: unknown,
  fallback: string
): string {
  if (isApiError(error)) {
    if (error.code === "operator_required") {
      return t("cloudSources.errors.operatorOnly");
    }
    if (error.status === 409 && error.code === "duplicate") {
      return t("cloudSources.add.duplicate");
    }
    if (error.status === 422 || error.status === 400) {
      return t("cloudSources.refused", { message: error.message });
    }
  }
  return fallback;
}

export function useCloudActions() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const write = useConflictWrite();

  const commit = useCallback(
    (source: CloudSourceView) => {
      queryClient.setQueryData<CloudSourceListResponse>(
        queryKeys.cloudSources,
        (list) => replaceInList(list, source)
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudSources });
    },
    [queryClient]
  );

  /** Follow / unfollow, optimistic; the previous list comes back on failure. */
  const setFollowing = useCallback(
    async (source: CloudSourceView, follow: boolean): Promise<boolean> => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.cloudSources,
        exact: true,
      });
      const before = queryClient.getQueryData<CloudSourceListResponse>(
        queryKeys.cloudSources
      );
      let delta = 0;
      if (follow !== source.following) {
        delta = follow ? 1 : -1;
      }
      queryClient.setQueryData<CloudSourceListResponse>(
        queryKeys.cloudSources,
        (list) =>
          replaceInList(list, {
            ...source,
            following: follow,
            followers: Math.max(0, source.followers + delta),
          })
      );
      try {
        if (follow) {
          const answer = await api(
            "PUT /api/v1/cloud-sources/{csr_id}/follow",
            {
              params: { csr_id: source.id },
              idempotencyKey: newIdempotencyKey(),
            }
          );
          commit(answer.source);
          toast.success(
            answer.backfilled > 0
              ? t("cloudSources.follow.backfilled", {
                  count: answer.backfilled,
                  name: source.name,
                })
              : t("cloudSources.follow.followed", { name: source.name })
          );
          queryClient.invalidateQueries({ queryKey: queryKeys.inboxAll });
        } else {
          const answer = await api(
            "DELETE /api/v1/cloud-sources/{csr_id}/follow",
            {
              params: { csr_id: source.id },
              idempotencyKey: newIdempotencyKey(),
            }
          );
          commit(answer.source);
          toast.success(
            t("cloudSources.follow.unfollowed", { name: source.name })
          );
        }
        return true;
      } catch (error) {
        queryClient.setQueryData(queryKeys.cloudSources, before);
        toast.error(
          errorText(
            t,
            error,
            t("cloudSources.follow.failed", { name: source.name })
          )
        );
        return false;
      }
    },
    [commit, queryClient, t]
  );

  const update = useCallback(
    (source: CloudSourceView, changes: CloudSourceChanges) =>
      write<CloudSourceView>(
        {
          base: source,
          changes,
          fields: CLOUD_SOURCE_FIELDS,
          send: async (baseRevision, fields) =>
            (
              await api("PATCH /api/v1/cloud-sources/{csr_id}", {
                params: { csr_id: source.id },
                body: {
                  ...(fields as CloudSourceChanges),
                  base_revision: baseRevision,
                },
                idempotencyKey: newIdempotencyKey(),
              })
            ).source,
        },
        {
          what: t("cloudSources.what", { name: source.name }),
          onSaved: (record) => {
            commit(record);
            queryClient.invalidateQueries({
              queryKey: queryKeys.cloudSource(record.id),
            });
          },
        }
      ),
    [commit, queryClient, t, write]
  );

  /** Run now / retry / re-probe (operator). */
  const startRun = useCallback(
    async (
      source: CloudSourceView,
      options: { probe?: boolean; retry?: boolean } = {}
    ): Promise<CloudRunView | null> => {
      try {
        const { run } = await api("POST /api/v1/cloud-sources/{csr_id}/runs", {
          params: { csr_id: source.id },
          body: options,
          idempotencyKey: newIdempotencyKey(),
        });
        watchCloudRuns();
        let key = "cloudSources.run.queued";
        if (options.probe) {
          key = "cloudSources.run.probeQueued";
        } else if (options.retry) {
          key = "cloudSources.run.retryQueued";
        }
        toast.success(t(key, { name: source.name }));
        queryClient.invalidateQueries({ queryKey: queryKeys.cloudSources });
        return run;
      } catch (error) {
        toast.error(errorText(t, error, t("cloudSources.run.failed")));
        return null;
      }
    },
    [queryClient, t]
  );

  const create = useCallback(
    async (
      body: CreateCloudSourceRequest
    ): Promise<{ run: CloudRunView; source: CloudSourceView } | null> => {
      try {
        const answer = await api("POST /api/v1/cloud-sources", {
          body,
          idempotencyKey: newIdempotencyKey(),
        });
        watchCloudRuns();
        commit(answer.source);
        toast.success(
          t("cloudSources.add.added", { name: answer.source.name })
        );
        return answer;
      } catch (error) {
        toast.error(errorText(t, error, t("cloudSources.add.failed")));
        return null;
      }
    },
    [commit, t]
  );

  const refreshDirectory = useCallback(async (): Promise<boolean> => {
    try {
      await api("POST /api/v1/cloud-discovery/refresh", {
        idempotencyKey: newIdempotencyKey(),
      });
      watchCloudRuns();
      toast.success(t("cloudSources.directory.queued"));
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudSources });
      return true;
    } catch (error) {
      toast.error(errorText(t, error, t("cloudSources.directory.failed")));
      return false;
    }
  }, [queryClient, t]);

  return { setFollowing, update, startRun, create, refreshDirectory };
}
