// The caller's devices (05 §3) for the nav chip, actor names on the timeline
// and the Apply tab's device picker. Online / active come from the API.

import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import { useMemo } from "react";
import { api } from "@/lib/api-client";
import type { PollPolicy } from "@/lib/polling";
import { POLL_POLICIES } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { usePollingQuery } from "./use-polling-query";

export function useDevices(policy: PollPolicy = POLL_POLICIES.shell) {
  const query = usePollingQuery({
    queryKey: queryKeys.devices,
    queryFn: async () => (await api("GET /api/v1/devices", {})).items,
    policy,
  });
  const devices = useMemo(
    () => (query.data ?? []).filter((device) => device.revoked_at === null),
    [query.data]
  );
  const byId = useMemo(
    () =>
      new Map<string, DeviceView>(devices.map((device) => [device.id, device])),
    [devices]
  );
  return {
    ...query,
    devices,
    byId,
    online: devices.filter((device) => device.online).length,
  };
}
