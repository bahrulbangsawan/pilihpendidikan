// Automation → Runs (12 §6.3): every task with its kind, application,
// device, state, attempt, start and duration, filterable by state (in the
// URL). Failed rows offer Retry; `outcome_unknown` rows ask "Did this
// application go through?" first; live rows can be cancelled. Polls 15 s.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { TaskState } from "@pilihpendidikan/jobs-contracts/enums";
import type { AutomationTaskRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CircleAlert, CloudOff } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useBoard } from "@/hooks/use-board";
import { useDevices } from "@/hooks/use-devices";
import { useTasks } from "@/hooks/use-tasks";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { formatClock, formatDateTime } from "@/lib/format";
import { taskErrorLabel, taskKindLabel, taskStateLabel } from "@/lib/labels";
import { POLL_POLICIES } from "@/lib/polling";
import type { RunsSearch } from "@/lib/runs-view";
import {
  formatDuration,
  RUN_FILTERS,
  runAction,
  runDurationMs,
} from "@/lib/runs-view";
import type { RunDialogKind } from "./run-dialogs";
import { RunDialog } from "./run-dialogs";
import { TaskStateBadge } from "./task-state-badge";

const TICK_MS = 15_000;

export function durationUnits(t: Translate) {
  return {
    s: t("runs.units.s"),
    min: t("runs.units.min"),
    h: t("runs.units.h"),
  };
}

function What({
  task,
  card,
}: {
  task: AutomationTaskRecord;
  card: BoardCard | undefined;
}) {
  const { t } = useTranslation();
  if (task.kind === "discover") {
    const count = task.payload.source_ids?.length ?? 0;
    return (
      <span className="text-muted-foreground">
        {count > 0
          ? t("runs.discoverSources", { count })
          : t("runs.discoverAll")}
      </span>
    );
  }
  if (!task.application_id) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <Link
      className="flex min-w-0 flex-col hover:underline"
      params={{ appId: task.application_id }}
      to="/applications/$appId"
    >
      <span className="truncate text-foreground">
        {card ? card.posting.company_name : t("runs.application")}
      </span>
      {card ? (
        <span className="type-caption truncate text-muted-foreground">
          {card.posting.title}
        </span>
      ) : null}
    </Link>
  );
}

function RunRow({
  task,
  card,
  deviceName,
  nowMs,
  onAction,
}: {
  task: AutomationTaskRecord;
  card: BoardCard | undefined;
  deviceName: string;
  nowMs: number;
  onAction: (kind: RunDialogKind) => void;
}) {
  const { locale, t } = useTranslation();
  const action = runAction(task);
  const duration = runDurationMs(task, nowMs);
  return (
    <TableRow>
      <TableCell>{taskKindLabel(t, task.kind)}</TableCell>
      <TableCell className="max-w-64">
        <What card={card} task={task} />
      </TableCell>
      <TableCell>{deviceName}</TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-0.5">
          <TaskStateBadge state={task.state} />
          {task.error_class ? (
            <span className="type-micro text-muted-foreground">
              {taskErrorLabel(t, task.error_class)}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="tabular-nums">
        {t("runs.attemptOf", {
          n: task.attempt_count,
          max: task.max_attempts,
        })}
      </TableCell>
      <TableCell className="tabular-nums">
        {formatDateTime(task.created_at, locale)}
      </TableCell>
      <TableCell className="tabular-nums">
        {duration === null ? "—" : formatDuration(duration, durationUnits(t))}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {action === "retry" || action === "settle" ? (
            <Button
              onClick={() => onAction(action)}
              size="xs"
              variant="outline"
            >
              {t("runs.retry")}
            </Button>
          ) : null}
          {action === "cancel" ? (
            <Button
              onClick={() => onAction("cancel")}
              size="xs"
              variant="ghost"
            >
              {t("runs.cancelRun")}
            </Button>
          ) : null}
          <Button asChild size="icon-xs" variant="ghost">
            <Link
              aria-label={t("runs.openMonitor", {
                state: taskStateLabel(t, task.state),
              })}
              params={{ tskId: task.id }}
              to="/automation/runs/$tskId"
            >
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function RunsPage({
  search = {},
  onSearchChange,
}: {
  search?: RunsSearch;
  onSearchChange?: (next: RunsSearch) => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const tasks = useTasks(search.state);
  const board = useBoard({ policy: POLL_POLICIES.shell });
  const { byId } = useDevices();
  const [dialog, setDialog] = useState<{
    kind: RunDialogKind;
    task: AutomationTaskRecord;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const cards = useMemo(
    () =>
      new Map(
        (board.data?.board.columns ?? []).flatMap((column) =>
          column.cards.map((card) => [card.id, card] as const)
        )
      ),
    [board.data]
  );
  const list = tasks.data ?? [];
  const deviceNameOf = (task: AutomationTaskRecord) => {
    const deviceId = task.lease_device_id ?? task.target_device_id;
    if (!deviceId) {
      return t("runs.anyDevice");
    }
    return byId.get(deviceId)?.name ?? t("runs.unknownDevice");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="band flex flex-wrap items-center gap-2 px-4 py-2 sm:px-5">
        <label
          className="type-body-compact text-muted-foreground"
          htmlFor={`${id}-state`}
        >
          {t("runs.filter")}
        </label>
        <Select
          onValueChange={(value) =>
            onSearchChange?.(
              value === "all" ? {} : { state: value as TaskState }
            )
          }
          value={search.state ?? "all"}
        >
          <SelectTrigger className="w-48" id={`${id}-state`} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RUN_FILTERS.map((value) => (
              <SelectItem key={value} value={value}>
                {value === "all"
                  ? t("runs.allStates")
                  : taskStateLabel(t, value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tasks.stale && tasks.dataUpdatedAt > 0 ? (
          <p
            className="type-caption inline-flex items-center gap-1 text-muted-foreground"
            role="status"
          >
            <CloudOff aria-hidden="true" className="size-3.5" />
            {t("runs.stale", {
              time: formatClock(tasks.dataUpdatedAt, locale),
            })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-5">
        {tasks.isError && !tasks.data ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{t("runs.loadErrorTitle")}</AlertTitle>
            <AlertDescription>{t("runs.loadError")}</AlertDescription>
            <AlertAction>
              <Button
                onClick={() => tasks.refetch()}
                size="sm"
                variant="outline"
              >
                {t("common.retry")}
              </Button>
            </AlertAction>
          </Alert>
        ) : null}
        {tasks.isPending ? (
          <div aria-hidden="true" className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : null}
        {tasks.isSuccess && list.length === 0 ? (
          <Empty className="border border-line">
            <EmptyHeader>
              <EmptyTitle>
                {search.state ? t("runs.emptyFiltered") : t("runs.empty")}
              </EmptyTitle>
              <EmptyDescription>{t("runs.emptyHelp")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {list.length > 0 ? (
          <div className="border border-line">
            <Table className="type-body-compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("runs.kind")}</TableHead>
                  <TableHead>{t("runs.what")}</TableHead>
                  <TableHead>{t("runs.device")}</TableHead>
                  <TableHead>{t("runs.state")}</TableHead>
                  <TableHead>{t("runs.attempt")}</TableHead>
                  <TableHead>{t("runs.started")}</TableHead>
                  <TableHead>{t("runs.duration")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((task) => (
                  <RunRow
                    card={
                      task.application_id
                        ? cards.get(task.application_id)
                        : undefined
                    }
                    deviceName={deviceNameOf(task)}
                    key={task.id}
                    nowMs={now}
                    onAction={(kind) => setDialog({ kind, task })}
                    task={task}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
      {dialog ? (
        <RunDialog
          kind={dialog.kind}
          onClose={() => setDialog(null)}
          task={dialog.task}
        />
      ) : null}
    </div>
  );
}
