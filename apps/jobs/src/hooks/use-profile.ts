// Profile and settings data (05 §10, §10a). Not polled: refetched on focus
// and after every write.

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

export function useFacts() {
  return useQuery({
    queryKey: queryKeys.facts,
    queryFn: () => api("GET /api/v1/profile/facts", {}),
  });
}

export function useAnswers() {
  return useQuery({
    queryKey: queryKeys.answers,
    queryFn: async () =>
      (await api("GET /api/v1/profile/answers", { query: { limit: 200 } }))
        .items,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => (await api("GET /api/v1/settings", {})).settings,
  });
}
