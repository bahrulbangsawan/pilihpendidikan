// A React Query `useQuery` that polls by a 12 §10 policy: the visible or
// hidden interval, paused when hidden unless the policy says otherwise, and
// doubled per consecutive failure up to 60 s. `failures` and `stale` let a
// screen say "Offline — showing data from 14:02" after three failed polls.

import type { QueryKey } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useRef, useSyncExternalStore } from "react";
import type { PollPolicy } from "@/lib/polling";
import { isStale, pollInterval } from "@/lib/polling";

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** `document.hidden`, re-rendering when the tab is shown or hidden. */
export function useDocumentHidden(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.hidden,
    () => false
  );
}

export interface PollingQueryOptions<T> {
  enabled?: boolean;
  policy: PollPolicy;
  queryFn: () => Promise<T>;
  queryKey: QueryKey;
}

export function usePollingQuery<T>(options: PollingQueryOptions<T>) {
  const failures = useRef(0);
  const { policy } = options;
  useDocumentHidden();
  const query = useQuery({
    queryKey: options.queryKey,
    enabled: options.enabled ?? true,
    queryFn: async () => {
      try {
        const value = await options.queryFn();
        failures.current = 0;
        return value;
      } catch (error) {
        failures.current += 1;
        throw error;
      }
    },
    // The poll itself is the retry; backoff comes from pollInterval.
    retry: false,
    refetchInterval: () =>
      pollInterval(policy, {
        hidden: typeof document !== "undefined" && document.hidden,
        failures: failures.current,
      }),
    refetchIntervalInBackground: policy.hidden !== false,
  });
  return {
    ...query,
    failures: failures.current,
    stale: isStale(failures.current),
  };
}
