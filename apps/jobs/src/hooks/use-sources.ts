// Job sources, the adapter registry and discovery runs (05 §4, 12 §8).
// Runs poll (POLL_POLICIES.runs) only while one is running on some device;
// sources and the registry refetch on focus.

import type { DiscoveryRunRecord } from "@pilihpendidikan/jobs-contracts/records";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { POLL_POLICIES, pollInterval } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { hasRunningRun } from "@/lib/sources-model";

const REGISTRY_STALE_MS = 3_600_000;
const RUNS_PAGE = 50;

export function useSources() {
  return useQuery({
    queryKey: queryKeys.sources,
    queryFn: async () => (await api("GET /api/v1/sources", {})).items,
  });
}

export function useAdapters() {
  return useQuery({
    queryKey: queryKeys.adapters,
    queryFn: () => api("GET /api/v1/sources/adapters", {}),
    staleTime: REGISTRY_STALE_MS,
  });
}

/** The runs table's poll delay: 15 s while a run is running, else none. */
export function runsRefetchInterval(
  runs: readonly DiscoveryRunRecord[] | undefined,
  failures: number,
  hidden: boolean
): number | false {
  if (!hasRunningRun(runs ?? [])) {
    return false;
  }
  return pollInterval(POLL_POLICIES.runs, { hidden, failures });
}

/** Discovery runs, newest first. */
export function useDiscoveryRuns() {
  return useQuery({
    queryKey: queryKeys.discoveryRuns,
    queryFn: async () =>
      (
        await api("GET /api/v1/discovery/runs", {
          query: { limit: RUNS_PAGE },
        })
      ).items,
    retry: false,
    refetchInterval: (query) =>
      runsRefetchInterval(
        query.state.data,
        query.state.fetchFailureCount,
        typeof document !== "undefined" && document.hidden
      ),
    refetchIntervalInBackground: false,
  });
}
