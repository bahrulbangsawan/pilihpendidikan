// The caller's base CVs from apps/cv (`GET /api/v1/cvs`, 05 §7).
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

export function useBaseCvs(enabled = true) {
  return useQuery({
    queryKey: queryKeys.cvs,
    queryFn: async () => (await api("GET /api/v1/cvs", {})).items,
    staleTime: 60_000,
    enabled,
  });
}

/** apps/cv origin for "open in the CV builder" links. */
export function cvBuilderOrigin(): string {
  if (
    typeof window !== "undefined" &&
    window.location.hostname === "localhost"
  ) {
    return "http://localhost:4003";
  }
  return "https://cv.pilihpendidikan.com";
}
