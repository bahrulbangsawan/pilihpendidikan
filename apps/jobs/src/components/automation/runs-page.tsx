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
import {
  BulkConfirmDialog,
  BulkRunResultsDialog,
  BulkToolbar,
  RowCheckbox,
  SelectAllCheckbox,
} from "@/components/bulk/bulk-toolbar";
import { useBoard } from "@/hooks/use-board";
import { useBulkRun } from "@/hooks/use-bulk-run";
import { useDevices } from "@/hooks/use-devices";
import type { Selection } from "@/hooks/use-selection";
import { useSelection } from "@/hooks/use-selection";
import { useTasks } from "@/hooks/use-tasks";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { BulkSkip } from "@/lib/bulk";
import { formatClock, formatDateTime } from "@/lib/format";
import { taskErrorLabel, taskKindLabel, taskStateLabel } from "@/lib/labels";
import { POLL_POLICIES } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import type {
  BulkCancelSkip,
  BulkRetrySkip,
  RunsSearch,
} from "@/lib/runs-view";
import {
  bulkCancelSkip,
  bulkRetrySkip,
  formatDuration,
  RUN_FILTERS,
  runAction,
  runDurationMs,
} from "@/lib/runs-view";
import type { RunDialogKind } from "./run-dialogs";
import { cancelTask, RunDialog, retryTask } from "./run-dialogs";
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

/** "Apply · Acme" for the row's checkbox and the bulk results. */
function runLabel(
  t: Translate,
  task: AutomationTaskRecord,
  card: BoardCard | undefined
): string {
  const kind = taskKindLabel(t, task.kind);
  return card ? `${kind} · ${card.posting.company_name}` : kind;
}

function RunRow({
  task,
  card,
  deviceName,
  nowMs,
  onAction,
  selection,
}: {
  task: AutomationTaskRecord;
  card: BoardCard | undefined;
  deviceName: string;
  nowMs: number;
  onAction: (kind: RunDialogKind) => void;
  selection: Selection;
}) {
  const { locale, t } = useTranslation();
  const action = runAction(task);
  const duration = runDurationMs(task, nowMs);
  return (
    <TableRow
      data-state={selection.isSelected(task.id) ? "selected" : undefined}
    >
      <TableCell>
        <RowCheckbox
          id={task.id}
          label={runLabel(t, task, card)}
          selection={selection}
        />
      </TableCell>
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

const BULK_INVALIDATE = [
  queryKeys.tasksAll,
  queryKeys.taskAll,
  queryKeys.boardAll,
  queryKeys.applicationAll,
] as const;

function cancelSkipMessage(t: Translate, reason: BulkCancelSkip): string {
  switch (reason) {
    case "already_cancelling":
      return t("runs.bulk.skip.alreadyCancelling");
    case "submitting":
      return t("runs.bulk.skip.submitting");
    default:
      return t("runs.bulk.skip.notCancellable");
  }
}

function retrySkipMessage(t: Translate, reason: BulkRetrySkip): string {
  return reason === "needs_answer"
    ? t("runs.bulk.skip.needsAnswer")
    : t("runs.bulk.skip.notRetryable");
}

interface BulkRunIntent {
  kind: "cancel" | "retry";
  tasks: AutomationTaskRecord[];
}

/**
 * Bulk Cancel (live runs the API can still stop) and bulk Retry (failed
 * runs only: an `outcome_unknown` run needs "Did this application go
 * through?" answered on its own, D-19). Both ask first with the counts; each
 * run is the single action's own request.
 */
function BulkRunActions({
  list,
  selection,
  cards,
}: {
  list: readonly AutomationTaskRecord[];
  selection: Selection;
  cards: ReadonlyMap<string, BoardCard>;
}) {
  const { t } = useTranslation();
  const bulk = useBulkRun({
    invalidate: BULK_INVALIDATE,
    onSucceeded: selection.clear,
  });
  const [intent, setIntent] = useState<BulkRunIntent | null>(null);
  const cancelling = intent?.kind === "cancel";
  const skipOf = (task: AutomationTaskRecord) =>
    cancelling ? bulkCancelSkip(task) : bulkRetrySkip(task);
  const send = intent ? intent.tasks.filter((task) => !skipOf(task)).length : 0;
  const counts = { send, skipped: (intent?.tasks.length ?? 0) - send };

  function open(kind: BulkRunIntent["kind"]) {
    const ids = new Set(selection.selectedIds);
    setIntent({ kind, tasks: list.filter((task) => ids.has(task.id)) });
  }

  async function confirm() {
    if (!intent) {
      return;
    }
    const { kind, tasks } = intent;
    const byId = new Map(tasks.map((task) => [task.id, task]));
    await bulk.run(
      kind === "cancel"
        ? t("runs.bulk.actionCancel")
        : t("runs.bulk.actionRetry"),
      tasks.map((task) => ({
        id: task.id,
        label: runLabel(
          t,
          task,
          task.application_id ? cards.get(task.application_id) : undefined
        ),
      })),
      async (id) => {
        const task = byId.get(id);
        if (!task) {
          return;
        }
        if (kind === "cancel") {
          const reason = bulkCancelSkip(task);
          if (reason) {
            throw new BulkSkip(reason, cancelSkipMessage(t, reason));
          }
          await cancelTask(task);
          return;
        }
        const reason = bulkRetrySkip(task);
        if (reason) {
          throw new BulkSkip(reason, retrySkipMessage(t, reason));
        }
        await retryTask(task, false);
      }
    );
    setIntent(null);
  }

  return (
    <>
      <BulkToolbar count={selection.size} onClear={selection.clear}>
        <Button
          disabled={bulk.busy}
          onClick={() => open("retry")}
          size="sm"
          variant="outline"
        >
          {t("runs.bulk.retry")}
        </Button>
        <Button
          disabled={bulk.busy}
          onClick={() => open("cancel")}
          size="sm"
          variant="outline"
        >
          {t("runs.bulk.cancel")}
        </Button>
      </BulkToolbar>
      <BulkConfirmDialog
        body={
          cancelling
            ? t("runs.bulk.cancelBody", counts)
            : t("runs.bulk.retryBody", counts)
        }
        busy={bulk.busy}
        cancelLabel={cancelling ? t("runs.keepRunning") : undefined}
        confirmDisabled={send === 0}
        confirmLabel={
          cancelling
            ? t("runs.bulk.cancelConfirm", { count: send })
            : t("runs.bulk.retryConfirm", { count: send })
        }
        confirmVariant={cancelling ? "destructive" : "default"}
        onConfirm={confirm}
        onOpenChange={(next) => {
          if (!next) {
            setIntent(null);
          }
        }}
        open={intent !== null}
        title={
          cancelling ? t("runs.bulk.cancelTitle") : t("runs.bulk.retryTitle")
        }
      />
      <BulkRunResultsDialog onClose={bulk.closeReport} report={bulk.report} />
    </>
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
  const list = useMemo(() => tasks.data ?? [], [tasks.data]);
  const taskIds = useMemo(() => list.map((task) => task.id), [list]);
  const selection = useSelection(taskIds);
  const deviceNameOf = (task: AutomationTaskRecord) => {
    const deviceId = task.lease_device_id ?? task.target_device_id;
    if (!deviceId) {
      return t("runs.anyDevice");
    }
    return byId.get(deviceId)?.name ?? t("runs.unknownDevice");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="band flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
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
      <BulkRunActions cards={cards} list={list} selection={selection} />
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
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
                  <TableHead className="w-10">
                    <SelectAllCheckbox selection={selection} />
                  </TableHead>
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
                    selection={selection}
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
