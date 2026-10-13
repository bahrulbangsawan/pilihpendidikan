// The task list /cli shows beside the devices: the latest 50 tasks (live
// work per device, revoke consequences, recent activity, failed
// operations), polled with the devices.

import type { PollPolicy } from "@/lib/polling";
import { usePollingQuery } from "@/hooks/use-polling-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

export const CLI_TASKS_PAGE = 50;

export function useCliTasks(policy: PollPolicy) {
  return usePollingQuery({
    queryKey: queryKeys.tasks({ view: "cli", limit: CLI_TASKS_PAGE }),
    queryFn: async () =>
      (await api("GET /api/v1/tasks", { query: { limit: CLI_TASKS_PAGE } }))
        .items,
    policy,
  });
}
