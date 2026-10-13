// The devices band of /cli (12 §7): name, status (active / online /
// offline / signed out), last sync, version against meta, active work,
// the accepts_tasks switch, rename and revoke. A table from 640 px; stacked
// rows on phones.

import type {
  DeviceView,
  GetMetaResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  AutomationTaskRecord,
  DiscoveryRunRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { cn } from "@rulisme/ui/lib/utils";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Band, Rail } from "@rulisme/ui/ui/rails";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Switch } from "@rulisme/ui/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { MoreHorizontal, OctagonAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { AppLink } from "@/components/app-link";
import { CopyCommand } from "@/components/copy-command";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { CLI_COMMANDS } from "@/lib/devices-install";
import type { DeviceStatus, VersionStatus } from "@/lib/devices-model";
import {
  deviceExtras,
  deviceStatus,
  deviceVersion,
  liveTasksOf,
  revokeConsequences,
  runningRunsOf,
  versionStatus,
} from "@/lib/devices-model";
import { formatDateTime, relativeTime } from "@/lib/format";
import { platformLabel, taskKindLabel, taskStateLabel } from "@/lib/labels";
import { translateOr } from "@/lib/sources-model";
import { useDeviceActions } from "./device-actions";
import { RenameDialog, RevokeDialog } from "./device-dialogs";

/** "Device signed out — suspicious token reuse" (17 §7.2). */
export function signedOutText(t: Translate, reason: string | null): string {
  if (!reason) {
    return t("devices.status.signedOut");
  }
  return translateOr(
    t,
    `devices.signedOutReasons.${reason}`,
    t("devices.status.signedOut")
  );
}

function StatusDot({ status }: { status: DeviceStatus }) {
  if (status.kind === "signed_out") {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        status.kind === "active" && "pulse-dot bg-foreground",
        status.kind === "online" && "bg-foreground",
        status.kind === "offline" && "border border-muted-foreground"
      )}
    />
  );
}

export function StatusLabel({
  status,
  nowMs,
}: {
  status: DeviceStatus;
  nowMs: number;
}) {
  const { t, locale } = useTranslation();
  let label: string;
  switch (status.kind) {
    case "active":
      label = t("devices.status.active");
      break;
    case "online":
      label = t("devices.status.online");
      break;
    case "offline":
      label =
        status.lastSeenAt === null
          ? t("devices.status.offlineNever")
          : t("devices.status.offlineSince", {
              time: relativeTime(status.lastSeenAt, nowMs, locale),
            });
      break;
    default:
      label = signedOutText(t, status.reason);
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        status.kind === "signed_out" ? "text-destructive" : "text-foreground",
        status.kind === "active" && "weight-semibold"
      )}
      data-status={status.kind}
    >
      <StatusDot status={status} />
      {label}
    </span>
  );
}

export function VersionBadge({ status }: { status: VersionStatus }) {
  const { t } = useTranslation();
  if (status === "too_old") {
    return (
      <Badge data-version={status} variant="destructive">
        <OctagonAlert aria-hidden="true" data-icon="inline-start" />
        {t("devices.version.tooOld")}
      </Badge>
    );
  }
  if (status === "update") {
    return (
      <Badge data-version={status} variant="outline">
        <TriangleAlert aria-hidden="true" data-icon="inline-start" />
        {t("devices.version.update")}
      </Badge>
    );
  }
  return null;
}

function ActiveWork({
  tasks,
  runs,
}: {
  runs: readonly DiscoveryRunRecord[];
  tasks: readonly AutomationTaskRecord[];
}) {
  const { t } = useTranslation();
  if (tasks.length === 0 && runs.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {tasks.map((task) => (
        <li key={task.id}>
          <AppLink
            className="text-primary underline-offset-4 hover:underline"
            href={`/automation/runs/${task.id}`}
          >
            {t("devices.work.task", {
              kind: taskKindLabel(t, task.kind),
              state: taskStateLabel(t, task.state),
            })}
          </AppLink>
        </li>
      ))}
      {runs.map((run) => (
        <li key={run.id}>
          <AppLink
            className="text-primary underline-offset-4 hover:underline"
            href="/sources"
          >
            {run.sources.length === 1
              ? t("devices.work.discoveryOne")
              : t("devices.work.discoveryMany", { count: run.sources.length })}
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

interface RowModel {
  device: DeviceView;
  lastSync: number | null;
  runs: DiscoveryRunRecord[];
  status: DeviceStatus;
  tasks: AutomationTaskRecord[];
  version: string;
  versionStatus: VersionStatus;
}

function rowModels(
  devices: readonly DeviceView[],
  tasks: readonly AutomationTaskRecord[],
  runs: readonly DiscoveryRunRecord[],
  meta: GetMetaResponse | null
): RowModel[] {
  return devices.map((device) => {
    const extras = deviceExtras(device);
    const version = deviceVersion(device, extras);
    return {
      device,
      status: deviceStatus(device, extras),
      lastSync: extras.report?.last_sync_at ?? null,
      version,
      versionStatus: versionStatus(version, meta),
      tasks: liveTasksOf(device.id, tasks),
      runs: runningRunsOf(device.id, runs),
    };
  });
}

function LastSync({ at, nowMs }: { at: number | null; nowMs: number }) {
  const { locale } = useTranslation();
  if (at === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={formatDateTime(at, locale)}
    >
      {relativeTime(at, nowMs, locale)}
    </time>
  );
}

function RowActions({
  row,
  onRename,
  onRevoke,
}: {
  onRename: () => void;
  onRevoke: () => void;
  row: RowModel;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("devices.actionsFor", { name: row.device.name })}
          size="icon-sm"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={row.status.kind === "signed_out"}
          onSelect={onRename}
        >
          {t("devices.rename.action")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRevoke} variant="destructive">
          {t("devices.revoke.action")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TasksSwitch({
  row,
  onToggle,
}: {
  onToggle: (value: boolean) => Promise<unknown>;
  row: RowModel;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Switch
      aria-label={t("devices.acceptsTasksFor", { name: row.device.name })}
      checked={row.device.accepts_tasks}
      disabled={busy || row.status.kind === "signed_out"}
      onCheckedChange={async (value) => {
        setBusy(true);
        await onToggle(value);
        setBusy(false);
      }}
    />
  );
}

export interface DevicesBandProps {
  devices: readonly DeviceView[];
  loading: boolean;
  meta: GetMetaResponse | null;
  nowMs: number;
  runs: readonly DiscoveryRunRecord[];
  tasks: readonly AutomationTaskRecord[];
}

export function DevicesBand({
  devices,
  loading,
  meta,
  nowMs,
  runs,
  tasks,
}: DevicesBandProps) {
  const { t } = useTranslation();
  const phone = useMediaQuery(PHONE_QUERY);
  const { update, revoke } = useDeviceActions();
  const [renaming, setRenaming] = useState<DeviceView | null>(null);
  const [revoking, setRevoking] = useState<DeviceView | null>(null);
  const rows = rowModels(devices, tasks, runs, meta);
  const outdated = rows.some(
    (row) => row.versionStatus !== "current" && row.versionStatus !== "unknown"
  );
  const toggle = (row: RowModel) => (value: boolean) =>
    update(row.device, { accepts_tasks: value });

  return (
    <Band>
      <Rail className="flex flex-col gap-3 px-4 py-6 sm:px-8" nodes={false}>
        <div className="flex items-baseline gap-2">
          <h2 className="type-subtitle weight-semibold" id="cli-devices">
            {t("devices.title")}
          </h2>
          <span className="type-micro text-muted-foreground tabular-nums">
            {devices.length}
          </span>
        </div>
        {loading ? (
          <div aria-hidden="true" className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : null}
        {!loading && phone ? (
          <ul
            aria-labelledby="cli-devices"
            className="flex flex-col border border-line"
          >
            {rows.map((row) => (
              <li
                className="flex flex-col gap-2 border-line border-b p-3 last:border-b-0"
                key={row.device.id}
              >
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="type-body weight-semibold truncate text-foreground">
                      {row.device.name}
                    </span>
                    <span className="type-caption text-muted-foreground">
                      {platformLabel(t, row.device.platform)} ·{" "}
                      {row.device.arch}
                    </span>
                  </div>
                  <RowActions
                    onRename={() => setRenaming(row.device)}
                    onRevoke={() => setRevoking(row.device)}
                    row={row}
                  />
                </div>
                <div className="type-body-compact">
                  <StatusLabel nowMs={nowMs} status={row.status} />
                </div>
                <dl className="type-caption grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">
                    {t("devices.columns.lastSync")}
                  </dt>
                  <dd>
                    <LastSync at={row.lastSync} nowMs={nowMs} />
                  </dd>
                  <dt className="text-muted-foreground">
                    {t("devices.columns.version")}
                  </dt>
                  <dd className="flex flex-wrap items-center gap-1.5">
                    <span className="tabular-nums">{row.version}</span>
                    <VersionBadge status={row.versionStatus} />
                  </dd>
                  <dt className="text-muted-foreground">
                    {t("devices.columns.work")}
                  </dt>
                  <dd>
                    <ActiveWork runs={row.runs} tasks={row.tasks} />
                  </dd>
                </dl>
                <div className="type-body-compact flex items-center gap-2">
                  <TasksSwitch onToggle={toggle(row)} row={row} />
                  <span>{t("devices.columns.tasks")}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {!(loading || phone) ? (
          <div className="border border-line">
            <Table aria-labelledby="cli-devices" className="type-body-compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("devices.columns.name")}</TableHead>
                  <TableHead>{t("devices.columns.status")}</TableHead>
                  <TableHead>{t("devices.columns.lastSync")}</TableHead>
                  <TableHead>{t("devices.columns.version")}</TableHead>
                  <TableHead>{t("devices.columns.work")}</TableHead>
                  <TableHead>{t("devices.columns.tasks")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow data-device={row.device.id} key={row.device.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="weight-semibold text-foreground">
                          {row.device.name}
                        </span>
                        <span className="type-caption text-muted-foreground">
                          {platformLabel(t, row.device.platform)} ·{" "}
                          {row.device.arch}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusLabel nowMs={nowMs} status={row.status} />
                    </TableCell>
                    <TableCell>
                      <LastSync at={row.lastSync} nowMs={nowMs} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="tabular-nums">{row.version}</span>
                        <VersionBadge status={row.versionStatus} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <ActiveWork runs={row.runs} tasks={row.tasks} />
                    </TableCell>
                    <TableCell>
                      <TasksSwitch onToggle={toggle(row)} row={row} />
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        onRename={() => setRenaming(row.device)}
                        onRevoke={() => setRevoking(row.device)}
                        row={row}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {outdated && meta && CLI_COMMANDS.upgrade.uv ? (
          <div className="flex flex-col gap-1.5">
            <p className="type-caption text-muted-foreground">
              {t("devices.version.howTo", {
                recommended: meta.recommended_cli_version,
              })}
            </p>
            <CopyCommand
              className="self-start"
              command={CLI_COMMANDS.upgrade.uv}
            />
          </div>
        ) : null}
      </Rail>
      <RenameDialog
        device={renaming}
        onClose={() => setRenaming(null)}
        onSave={(device, name) => update(device, { name })}
      />
      <RevokeDialog
        consequences={
          revoking
            ? revokeConsequences(revoking.id, tasks)
            : { running: 0, submitting: 0, pinned: 0 }
        }
        device={revoking}
        onCancel={() => setRevoking(null)}
        onConfirm={revoke}
      />
    </Band>
  );
}
