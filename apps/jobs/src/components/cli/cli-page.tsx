// CLI & devices (`/cli`, 12 §7, 22 §12): connect a computer (install, sign
// in, verify), the devices with their status, versions and work, and recent
// activity (runs, failed operations, outbox warnings). With no device yet
// the connect band is the hero and the page polls every 3 s until one
// appears.

import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useDevices } from "@/hooks/use-devices";
import { useMeta } from "@/hooks/use-meta";
import { useDiscoveryRuns } from "@/hooks/use-sources";
import { useTranslation } from "@/i18n";
import {
  awaitingFirstContact,
  CONNECT_WATCH_MS,
  devicesPollPolicy,
  justConnected,
} from "@/lib/devices-model";
import { POLL_POLICIES } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { ActivityBand } from "./activity-band";
import { ConnectBand } from "./connect-band";
import { DevicesBand } from "./devices-band";
import { useCliTasks } from "./use-cli-data";
import { PageHeader } from "@/components/shell/page";

const TICK_MS = 5000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function CliPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nowMs = useNow(TICK_MS);
  const [watchUntil, setWatchUntil] = useState(0);

  // The policy depends on what is cached: no device yet → watch every 3 s.
  const cached = queryClient.getQueryData<DeviceView[]>(queryKeys.devices);
  const empty =
    cached !== undefined &&
    cached.every((device) => device.revoked_at !== null);
  const connecting =
    cached !== undefined && awaitingFirstContact(cached, nowMs);
  const policy = devicesPollPolicy({ empty, connecting, nowMs, watchUntil });
  const devicesQuery = useDevices(policy);
  const { devices, byId } = devicesQuery;
  const meta = useMeta();
  const tasks = useCliTasks(policy);
  const runs = useDiscoveryRuns();

  const watchForDevice = useCallback(
    () => setWatchUntil(Date.now() + CONNECT_WATCH_MS),
    []
  );

  const hero = devicesQuery.isSuccess && devices.length === 0;
  const waiting = policy === POLL_POLICIES.devicesConnecting;
  const connected = justConnected(devices, nowMs);

  if (devicesQuery.isError && !devicesQuery.data) {
    return (
      <div className="p-4 sm:p-8">
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("cliPage.errorTitle")}</AlertTitle>
          <AlertDescription>{t("cliPage.error")}</AlertDescription>
          <AlertAction>
            <Button
              onClick={() => devicesQuery.refetch()}
              size="sm"
              variant="outline"
            >
              {t("common.retry")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {hero ? null : (
        <PageHeader description={t("cliPage.intro")} title={t("cliPage.title")}>
          {devicesQuery.stale ? (
            <p
              className="type-caption pb-5 text-muted-foreground"
              role="status"
            >
              {t("cliPage.stale")}
            </p>
          ) : null}
        </PageHeader>
      )}
      <ConnectBand
        connected={connected}
        devices={devices}
        hero={hero}
        onLoginCopied={watchForDevice}
        waiting={waiting}
      />
      {hero ? null : (
        <>
          <DevicesBand
            devices={devices}
            loading={devicesQuery.isPending}
            meta={meta.data ?? null}
            nowMs={nowMs}
            runs={runs.data ?? []}
            tasks={tasks.data ?? []}
          />
          <ActivityBand
            byId={byId}
            devices={devices}
            nowMs={nowMs}
            runs={runs.data ?? []}
            tasks={tasks.data ?? []}
          />
        </>
      )}
    </div>
  );
}
