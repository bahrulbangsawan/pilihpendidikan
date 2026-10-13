// Automation tasks (05 §8): the Runs list (15 s), one task for the live
// monitor (2 s visible / 10 s hidden, stopping at a terminal state, 12 §10)
// and that task's step events from its application's timeline.

import type { TaskState } from "@pilihpendidikan/jobs-contracts/enums";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "@/lib/api-client";
import { isTerminalTask, monitorPollInterval } from "@/lib/monitor-model";
import { isStale, POLL_POLICIES } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { useDocumentHidden, usePollingQuery } from "./use-polling-query";

const LIST_LIMIT = 100;
const EVENTS_LIMIT = 200;

export function useTasks(state: TaskState | undefined) {
  return usePollingQuery({
    queryKey: queryKeys.tasks({ state: state ?? "all" }),
    queryFn: async () =>
      (
        await api("GET /api/v1/tasks", {
          query: { limit: LIST_LIMIT, ...(state ? { state } : {}) },
        })
      ).items,
    policy: POLL_POLICIES.runs,
  });
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/** `GET /api/v1/tasks/{id}`, polled until the task is terminal. */
export function useTaskDetail(taskId: string) {
  const failures = useRef(0);
  useDocumentHidden();
  const query = useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: async () => {
      try {
        const detail = await api("GET /api/v1/tasks/{tsk_id}", {
          params: { tsk_id: taskId },
        });
        failures.current = 0;
        return detail;
      } catch (error) {
        failures.current += 1;
        throw error;
      }
    },
    retry: false,
    refetchInterval: (current) =>
      monitorPollInterval(
        current.state.data?.task.state,
        POLL_POLICIES.runMonitor,
        { hidden: isHidden(), failures: failures.current }
      ),
    refetchIntervalInBackground: true,
  });
  return { ...query, stale: isStale(failures.current) };
}

/**
 * The application's events (the step log reads this task's from them),
 * polled with the task while it runs, once more when it ends.
 */
export function useTaskEvents(
  applicationId: string | null,
  taskId: string,
  state: TaskState | undefined
) {
  return useQuery({
    queryKey: [...queryKeys.task(taskId), "events", applicationId],
    enabled: applicationId !== null,
    queryFn: async () =>
      (
        await api("GET /api/v1/applications/{app_id}/events", {
          params: { app_id: applicationId ?? "" },
          query: { limit: EVENTS_LIMIT },
        })
      ).items,
    retry: false,
    refetchInterval: () =>
      isTerminalTask(state)
        ? false
        : monitorPollInterval(state, POLL_POLICIES.runMonitor, {
            hidden: isHidden(),
            failures: 0,
          }),
    refetchIntervalInBackground: true,
  });
}
