// Automation rules (12 §6.2, 05 §8) and the job sources they can narrow to.

import type { JobSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

const LIST_LIMIT = 200;

export function useRules() {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: async () =>
      (await api("GET /api/v1/rules", { query: { limit: LIST_LIMIT } })).items,
    staleTime: 15_000,
  });
}

/** The user's job sources, for the rule editor's source filter. */
export function useRuleSources() {
  const query = useQuery({
    queryKey: [...queryKeys.sources, "for-rules"],
    queryFn: async () =>
      (await api("GET /api/v1/sources", { query: { limit: LIST_LIMIT } }))
        .items,
    staleTime: 60_000,
  });
  const byId = useMemo(
    () =>
      new Map<string, JobSourceRecord>(
        (query.data ?? []).map((source) => [source.id, source])
      ),
    [query.data]
  );
  return { ...query, sources: query.data ?? [], byId };
}
