// "Recent activity" on /cli (12 §7): the latest task runs with links to the
// monitor, failed operations worth a retry (failed tasks with a retryable
// error class; failed or partial discovery runs, re-run on a chosen device)
// and outbox warnings (changes a device could not sync for over an hour).

import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import type {
  AutomationTaskRecord,
  DiscoveryRunRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Band } from "@rulisme/ui/ui/rails";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { AppLink } from "@/components/app-link";
import { CopyCommand } from "@/components/copy-command";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { troubleshootingCommand } from "@/lib/devices-install";
import {
  deviceExtras,
  isRetryableFailure,
  isRetryableRun,
  outboxWarning,
  runSourceIds,
} from "@/lib/devices-model";
import { relativeTime } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import {
  runStatusLabel,
  taskErrorLabel,
  taskKindLabel,
  taskStateLabel,
} from "@/lib/labels";
import { queryKeys } from "@/lib/query";
import { ANY_DEVICE, runNowTask } from "@/lib/sources-model";
import { PageGutter } from "@/components/shell/page";

/** Recent activity lists at most this many runs (12 §7). */
export const RECENT_TASKS = 20;

const BAD_STATES = new Set(["failed", "outcome_unknown", "expired"]);

function TaskStateBadge({ task }: { task: AutomationTaskRecord }) {
  const { t } = useTranslation();
  let variant: "destructive" | "secondary" | "outline" = "outline";
  if (BAD_STATES.has(task.state)) {
    variant = "destructive";
  } else if (task.state === "running" || task.state === "claimed") {
    variant = "secondary";
  }
  return <Badge variant={variant}>{taskStateLabel(t, task.state)}</Badge>;
}

function deviceName(
  task: AutomationTaskRecord,
  byId: ReadonlyMap<string, DeviceView>,
  fallback: string
): string {
  const id = task.lease_device_id ?? task.target_device_id;
  return (id && byId.get(id)?.name) || fallback;
}

function ExecutionLog({
  tasks,
  byId,
  nowMs,
}: {
  byId: ReadonlyMap<string, DeviceView>;
  nowMs: number;
  tasks: readonly AutomationTaskRecord[];
}) {
  const { t, locale } = useTranslation();
  const recent = [...tasks]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, RECENT_TASKS);
  if (recent.length === 0) {
    return (
      <p className="type-caption text-muted-foreground">
        {t("cliPage.activity.noRuns")}
      </p>
    );
  }
  return (
    <div className="border border-line">
      <Table className="type-body-compact">
        <TableHeader>
          <TableRow>
            <TableHead>{t("cliPage.activity.task")}</TableHead>
            <TableHead>{t("cliPage.activity.state")}</TableHead>
            <TableHead>{t("cliPage.activity.device")}</TableHead>
            <TableHead>{t("cliPage.activity.attempts")}</TableHead>
            <TableHead>{t("cliPage.activity.started")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recent.map((task) => (
            <TableRow key={task.id}>
              <TableCell>
                <AppLink
                  className="text-primary underline-offset-4 hover:underline"
                  href={`/automation/runs/${task.id}`}
                >
                  {taskKindLabel(t, task.kind)}
                </AppLink>
                {task.error_class ? (
                  <span className="type-caption block text-muted-foreground">
                    {taskErrorLabel(t, task.error_class)}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <TaskStateBadge task={task} />
              </TableCell>
              <TableCell>
                {deviceName(task, byId, t("cliPage.activity.anyDevice"))}
              </TableCell>
              <TableCell className="tabular-nums">
                {task.attempt_count}/{task.max_attempts}
              </TableCell>
              <TableCell>
                {relativeTime(task.created_at, nowMs, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DevicePicker({
  devices,
  value,
  onChange,
  label,
}: {
  devices: readonly DeviceView[];
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const { t } = useTranslation();
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label} className="h-8 w-44" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_DEVICE}>
          {t("cliPage.activity.anyDevice")}
        </SelectItem>
        {devices.map((device) => (
          <SelectItem key={device.id} value={device.id}>
            {device.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RetryRun({
  run,
  devices,
  onDone,
}: {
  devices: readonly DeviceView[];
  onDone: () => void;
  run: DiscoveryRunRecord;
}) {
  const { t } = useTranslation();
  const id = useId();
  const capable = devices.filter(
    (device) =>
      device.capabilities.includes("discover") && device.revoked_at === null
  );
  const [device, setDevice] = useState(ANY_DEVICE);
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    const key = newIdempotencyKey();
    try {
      await api("POST /api/v1/tasks", {
        body: runNowTask(runSourceIds(run), device, key, capable.length > 0),
        idempotencyKey: key,
      });
      toast.success(t("cliPage.activity.retryQueued"));
      onDone();
    } catch (error) {
      toast.error(
        isApiError(error) && error.status === 422
          ? t("cliPage.activity.retryRefused", { message: error.message })
          : t("cliPage.activity.retryFailed")
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2" id={id}>
      <DevicePicker
        devices={capable}
        label={t("cliPage.activity.retryOn")}
        onChange={setDevice}
        value={device}
      />
      <Button disabled={busy} onClick={retry} size="sm" variant="outline">
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        {t("cliPage.activity.retry")}
      </Button>
    </div>
  );
}

function RetryTask({
  task,
  onDone,
}: {
  onDone: () => void;
  task: AutomationTaskRecord;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    const key = newIdempotencyKey();
    try {
      await api("POST /api/v1/tasks/{tsk_id}/retry", {
        params: { tsk_id: task.id },
        body: { idempotency_key: key },
        idempotencyKey: key,
      });
      toast.success(t("cliPage.activity.retryQueued"));
      onDone();
    } catch (error) {
      toast.error(
        isApiError(error) && error.status === 422
          ? t("cliPage.activity.retryRefused", { message: error.message })
          : t("cliPage.activity.retryFailed")
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button disabled={busy} onClick={retry} size="sm" variant="outline">
      <RotateCcw aria-hidden="true" data-icon="inline-start" />
      {t("cliPage.activity.retry")}
    </Button>
  );
}

function FailedOperations({
  tasks,
  runs,
  devices,
  byId,
  nowMs,
}: {
  byId: ReadonlyMap<string, DeviceView>;
  devices: readonly DeviceView[];
  nowMs: number;
  runs: readonly DiscoveryRunRecord[];
  tasks: readonly AutomationTaskRecord[];
}) {
  const { t, locale } = useTranslation();
  const queryClient = useQueryClient();
  const failedTasks = tasks.filter((task) => isRetryableFailure(task, tasks));
  const failedRuns = runs.filter(isRetryableRun);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.discoveryRuns });
  };
  if (failedTasks.length === 0 && failedRuns.length === 0) {
    return (
      <p className="type-caption text-muted-foreground">
        {t("cliPage.activity.noFailures")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col border border-line">
      {failedTasks.map((task) => (
        <li
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-line border-b px-3 py-2 last:border-b-0"
          key={task.id}
        >
          <div className="type-body-compact flex min-w-0 flex-1 flex-col">
            <AppLink
              className="text-primary underline-offset-4 hover:underline"
              href={`/automation/runs/${task.id}`}
            >
              {taskKindLabel(t, task.kind)}
            </AppLink>
            <span className="type-caption text-muted-foreground">
              {t("cliPage.activity.failedTask", {
                reason: taskErrorLabel(t, task.error_class ?? ""),
                device: deviceName(task, byId, t("cliPage.activity.anyDevice")),
                time: relativeTime(
                  task.finished_at ?? task.updated_at,
                  nowMs,
                  locale
                ),
              })}
            </span>
          </div>
          <RetryTask onDone={refresh} task={task} />
        </li>
      ))}
      {failedRuns.map((run) => (
        <li
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-line border-b px-3 py-2 last:border-b-0"
          key={run.id}
        >
          <div className="type-body-compact flex min-w-0 flex-1 flex-col">
            <span className="text-foreground">
              {t("cliPage.activity.failedRun", {
                sources: run.sources.map((source) => source.label).join(", "),
              })}
            </span>
            <span className="type-caption text-muted-foreground">
              {runStatusLabel(t, run.status)} ·{" "}
              {relativeTime(run.finished_at ?? run.started_at, nowMs, locale)}
            </span>
          </div>
          <RetryRun devices={devices} onDone={refresh} run={run} />
        </li>
      ))}
    </ul>
  );
}

function OutboxWarnings({
  devices,
  nowMs,
}: {
  devices: readonly DeviceView[];
  nowMs: number;
}) {
  const { t } = useTranslation();
  const warnings = devices
    .map((device) => ({
      device,
      warning: outboxWarning(deviceExtras(device), nowMs),
    }))
    .filter((entry) => entry.warning !== null);
  const command = troubleshootingCommand("sync_status");
  if (warnings.length === 0) {
    return (
      <p className="type-caption text-muted-foreground">
        {t("cliPage.activity.noOutbox")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {warnings.map(({ device, warning }) => (
        <li className="flex flex-col gap-1.5" key={device.id} role="status">
          <p className="type-body text-foreground">
            {warning?.changes === 1
              ? t("cliPage.activity.outboxOne", { name: device.name })
              : t("cliPage.activity.outboxMany", {
                  name: device.name,
                  count: warning?.changes ?? 0,
                })}
          </p>
          <p className="type-caption text-muted-foreground">
            {t("cliPage.activity.outboxFix")}
          </p>
          {command ? (
            <CopyCommand className="self-start" command={command} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export interface ActivityBandProps {
  byId: ReadonlyMap<string, DeviceView>;
  devices: readonly DeviceView[];
  nowMs: number;
  runs: readonly DiscoveryRunRecord[];
  tasks: readonly AutomationTaskRecord[];
}

export function ActivityBand({
  tasks,
  runs,
  devices,
  byId,
  nowMs,
}: ActivityBandProps) {
  const { t } = useTranslation();
  return (
    <Band>
      <PageGutter className="flex flex-col gap-6 py-6">
        <h2 className="type-subtitle weight-semibold">
          {t("cliPage.activity.title")}
        </h2>
        <section aria-labelledby="cli-log" className="flex flex-col gap-2">
          <h3
            className="type-body weight-semibold text-foreground"
            id="cli-log"
          >
            {t("cliPage.activity.log")}
          </h3>
          <ExecutionLog byId={byId} nowMs={nowMs} tasks={tasks} />
        </section>
        <section aria-labelledby="cli-failed" className="flex flex-col gap-2">
          <h3
            className="type-body weight-semibold text-foreground"
            id="cli-failed"
          >
            {t("cliPage.activity.failed")}
          </h3>
          <FailedOperations
            byId={byId}
            devices={devices}
            nowMs={nowMs}
            runs={runs}
            tasks={tasks}
          />
        </section>
        <section aria-labelledby="cli-outbox" className="flex flex-col gap-2">
          <h3
            className="type-body weight-semibold text-foreground"
            id="cli-outbox"
          >
            {t("cliPage.activity.outbox")}
          </h3>
          <OutboxWarnings devices={devices} nowMs={nowMs} />
        </section>
      </PageGutter>
    </Band>
  );
}
