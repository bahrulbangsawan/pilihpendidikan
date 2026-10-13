// `GET /api/v1/meta` (05 §1.7): the CLI versions the devices table compares
// against. Public and slow-changing, so it is cached for five minutes.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

const META_STALE_MS = 300_000;

export function useMeta() {
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: () => api("GET /api/v1/meta", {}),
    staleTime: META_STALE_MS,
  });
}
