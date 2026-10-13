// The Stats queries (05 §12, 10 §6): summary, time series and breakdown for
// a date range in the browser's time zone. The api answers with
// `Cache-Control: private, max-age=60`; the client keeps each answer fresh
// for the same 60 s, so switching tabs or ranges back does not refetch.

import type {
  AnalyticsBreakdown,
  AnalyticsInterval,
  AnalyticsMetric,
} from "@pilihpendidikan/jobs-contracts/enums";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

export const ANALYTICS_STALE_MS = 60_000;

export interface AnalyticsRange {
  from: string;
  to: string;
  tz: string;
}

export function useAnalyticsSummary(range: AnalyticsRange) {
  return useQuery({
    queryKey: queryKeys.analyticsSummary(range.from, range.to, range.tz),
    queryFn: () =>
      api("GET /api/v1/analytics/summary", {
        query: { from: range.from, to: range.to, tz: range.tz },
      }),
    staleTime: ANALYTICS_STALE_MS,
  });
}

export function useAnalyticsTimeseries(
  metric: AnalyticsMetric,
  interval: AnalyticsInterval,
  range: AnalyticsRange
) {
  return useQuery({
    queryKey: queryKeys.analyticsTimeseries(
      metric,
      interval,
      range.from,
      range.to,
      range.tz
    ),
    queryFn: () =>
      api("GET /api/v1/analytics/timeseries", {
        query: {
          metric,
          interval,
          from: range.from,
          to: range.to,
          tz: range.tz,
        },
      }),
    staleTime: ANALYTICS_STALE_MS,
  });
}

export function useAnalyticsBreakdown(
  by: AnalyticsBreakdown,
  range: AnalyticsRange
) {
  return useQuery({
    queryKey: queryKeys.analyticsBreakdown(by, range.from, range.to, range.tz),
    queryFn: () =>
      api("GET /api/v1/analytics/breakdown", {
        query: { by, from: range.from, to: range.to, tz: range.tz },
      }),
    staleTime: ANALYTICS_STALE_MS,
  });
}
