// React Query setup and the query keys every screen shares. Data is fetched
// in the browser through the BFF (src/lib/api-client.ts); the server renders
// skeletons, so no API data is serialized into the HTML.

import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "./api-client";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        // One quick retry for a transient failure; never for 4xx answers.
        retry: (failureCount, error) =>
          failureCount < 1 && (!isApiError(error) || error.isRetryable),
      },
      mutations: { retry: false },
    },
  });
}

export const queryKeys = {
  session: ["session"] as const,
  board: (includeArchived: boolean) => ["board", { includeArchived }] as const,
  boardAll: ["board"] as const,
  application: (appId: string) => ["application", appId] as const,
  applicationEvents: (appId: string) =>
    ["application", appId, "events"] as const,
  devices: ["devices"] as const,
  settings: ["settings"] as const,
  facts: ["profile", "facts"] as const,
  answers: ["profile", "answers"] as const,
  cvs: ["cvs"] as const,
  overview: (from: string, to: string) =>
    ["analytics", "summary", from, to] as const,
  meta: ["meta"] as const,
  inbox: (filters: Readonly<Record<string, unknown>>) =>
    ["inbox", filters] as const,
  inboxAll: ["inbox"] as const,
  userJob: (ujbId: string) => ["user-job", ujbId] as const,
  score: (postingId: string) => ["score", postingId] as const,
  approvals: (state: string) => ["approvals", state] as const,
  approvalsAll: ["approvals"] as const,
  rules: ["rules"] as const,
  tasks: (filters: Readonly<Record<string, unknown>>) =>
    ["tasks", filters] as const,
  tasksAll: ["tasks"] as const,
  task: (taskId: string) => ["task", taskId] as const,
  sources: ["sources"] as const,
  adapters: ["sources", "adapters"] as const,
  discoveryRuns: ["discovery-runs"] as const,
  cvVariant: (cvvId: string) => ["cv-variant", cvvId] as const,
  file: (fileId: string) => ["file", fileId] as const,
  analyticsSummary: (from: string, to: string, tz: string) =>
    ["analytics", "summary", from, to, tz] as const,
  analyticsTimeseries: (
    metric: string,
    interval: string,
    from: string,
    to: string,
    tz: string
  ) => ["analytics", "timeseries", metric, interval, from, to, tz] as const,
  analyticsBreakdown: (by: string, from: string, to: string, tz: string) =>
    ["analytics", "breakdown", by, from, to, tz] as const,
};
