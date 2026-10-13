// Device writes of the CLI & devices screen (05 §3): rename and the
// accepts_tasks switch (`PATCH` with base_revision under the 12 §11 conflict
// rules), and revocation (21 §10) with a summary of what it did to the
// device's tasks.

import type {
  DeviceView,
  RevokeDeviceResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { useConflictWrite } from "@/hooks/use-conflict-write";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

/** The writable device fields (conflicts compare only these). */
export const DEVICE_FIELDS = ["name", "accepts_tasks"] as const;

/** "1 marked for review · 2 back in the queue", or null when nothing moved. */
export function revokeSummary(
  t: Translate,
  tasks: RevokeDeviceResponse["tasks"]
): string | null {
  const parts: string[] = [];
  if (tasks.outcome_unknown > 0) {
    parts.push(
      t("devices.revoke.resultReview", { count: tasks.outcome_unknown })
    );
  }
  if (tasks.requeued > 0) {
    parts.push(t("devices.revoke.resultRequeued", { count: tasks.requeued }));
  }
  if (tasks.awaiting_approval > 0) {
    parts.push(
      t("devices.revoke.resultAwaiting", { count: tasks.awaiting_approval })
    );
  }
  if (tasks.cancelled > 0) {
    parts.push(t("devices.revoke.resultCancelled", { count: tasks.cancelled }));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Replaces one device in the cached list, keeping the API's extras. */
function replaceDevice(
  list: DeviceView[] | undefined,
  record: DeviceView
): DeviceView[] | undefined {
  return list?.map((device) =>
    device.id === record.id ? { ...device, ...record } : device
  );
}

export function useDeviceActions() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const write = useConflictWrite();

  const commit = useCallback(
    (record: DeviceView) => {
      queryClient.setQueryData<DeviceView[]>(queryKeys.devices, (list) =>
        replaceDevice(list, record)
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
    },
    [queryClient]
  );

  const update = useCallback(
    (device: DeviceView, changes: { name?: string; accepts_tasks?: boolean }) =>
      write<DeviceView>(
        {
          base: device,
          changes,
          fields: DEVICE_FIELDS,
          send: async (baseRevision, fields) =>
            (
              await api("PATCH /api/v1/devices/{dev_id}", {
                params: { dev_id: device.id },
                body: { ...fields, base_revision: baseRevision },
                idempotencyKey: newIdempotencyKey(),
              })
            ).device,
        },
        {
          what: t("devices.what", { name: device.name }),
          onSaved: commit,
        }
      ),
    [commit, t, write]
  );

  const revoke = useCallback(
    async (device: DeviceView): Promise<boolean> => {
      try {
        const result = await api("POST /api/v1/devices/{dev_id}/revoke", {
          params: { dev_id: device.id },
          idempotencyKey: newIdempotencyKey(),
        });
        const summary = revokeSummary(t, result.tasks);
        toast.success(
          t("devices.revoke.done", { name: device.name }),
          summary ? { description: summary } : undefined
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
          queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll }),
        ]);
        return true;
      } catch (error) {
        toast.error(
          isApiError(error) && error.status === 404
            ? t("devices.revoke.gone")
            : t("devices.revoke.failed")
        );
        return false;
      }
    },
    [queryClient, t]
  );

  return { update, revoke };
}
