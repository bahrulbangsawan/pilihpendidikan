// The live run monitor (12 §6.3, 21 §6): who runs what where, the stepper,
// the executor's status and budget, the heartbeat age ("Device not
// responding — the run will be released at 14:05" after 60 s), one prompt
// per PauseReason with Resume / Cancel, the redacted step log in a throttled
// live region, and the outcome with its evidence. Polls every 2 s (10 s
// hidden) and stops at a terminal state.

import type {
  ApplicationDetail,
  DeviceView,
  TaskDetail,
} from "@pilihpendidikan/jobs-contracts/api";
import type { SubmissionStatus } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationEventRecord,
  ApprovalRecord,
  AutomationAttemptRecord,
  AutomationTaskRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, CloudOff, Hourglass, Unplug } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { NotFoundPage } from "@/components/not-found";
import { commitApplicationToBoard, useBoard } from "@/hooks/use-board";
import { useDevices } from "@/hooks/use-devices";
import { useTaskDetail, useTaskEvents } from "@/hooks/use-tasks";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { formatClock } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import {
  modeLabel,
  submissionLabel,
  taskErrorLabel,
  taskKindLabel,
} from "@/lib/labels";
import type { ExecutorStatus, HeartbeatView } from "@/lib/monitor-model";
import {
  ATTEMPT_BUDGET,
  buildStepper,
  canResume,
  currentAttempt,
  executorStatus,
  flaggedExcerpt,
  heartbeatView,
  isCancellable,
  isTerminalTask,
  PAUSE_GROUP,
  progressStage,
  stepLog,
  taskEvents,
} from "@/lib/monitor-model";
import { POLL_POLICIES } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import type { CvStatusView } from "./monitor-parts";
import {
  EvidenceCard,
  OutcomeHeading,
  PausePrompt,
  StepLog,
  Stepper,
} from "./monitor-parts";
import type { RunDialogKind } from "./run-dialogs";
import { RunDialog } from "./run-dialogs";
import { TaskStateBadge } from "./task-state-badge";

const SECOND_MS = 1000;
const SHA_PREFIX = 8;
const ID_PREFIX = 12;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The API's additive device report (12 §7): the browser mode, if known. */
function browserModeOf(device: DeviceView | undefined): string | null {
  const report = (device as { report?: { browser?: { mode?: unknown } } })
    ?.report;
  const mode = report?.browser?.mode;
  return typeof mode === "string" ? mode : null;
}

function executorText(t: Translate, status: ExecutorStatus): string {
  switch (status.kind) {
    case "waiting":
      return t("monitor.executor.waiting");
    case "running":
      return t("monitor.executor.running");
    case "paused":
      return status.reason
        ? t("monitor.executor.pausedReason", {
            reason: t(`monitor.pauseTitles.${status.reason}`),
          })
        : t("monitor.executor.paused");
    case "awaiting_approval":
      return t("monitor.executor.awaitingApproval");
    case "sync_pending":
      return t("monitor.executor.syncPending");
    default:
      return t("monitor.executor.finished");
  }
}

/** Where the CV for this run stands (12 §6.3 "CV ready (sha ✓)"). */
function cvStatusOf(
  detail: TaskDetail,
  application: ApplicationDetail | undefined
): CvStatusView | null {
  const context = detail.context;
  if (context?.kind === "apply") {
    return context.cv
      ? {
          status: "ready",
          sha: context.cv.file.sha256.slice(0, SHA_PREFIX),
        }
      : { status: "missing", sha: null };
  }
  if (!application) {
    return null;
  }
  const attached = application.cv_variants.find(
    (variant) => variant.id === application.application.cv_variant_id
  );
  if (attached?.file_id) {
    return { status: "ready", sha: null };
  }
  const rendering = application.cv_variants.some(
    (variant) => variant.status === "generating"
  );
  return { status: rendering ? "rendering" : "missing", sha: null };
}

interface Primary {
  label: string;
  run: () => void;
}

interface MonitorData {
  application: ApplicationDetail | undefined;
  attempt: AutomationAttemptRecord | null;
  company: string | null;
  device: DeviceView | undefined;
  deviceName: string;
  events: ApplicationEventRecord[];
  pendingAnswer: ApprovalRecord | null;
  postingTitle: string | null;
  refetchApplication: () => Promise<unknown>;
}

/** Everything the monitor shows about the task, gathered in one place. */
function useMonitorData(detail: TaskDetail): MonitorData {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { task } = detail;
  const applicationId = task.application_id;
  const terminal = isTerminalTask(task.state);
  const events = useTaskEvents(applicationId, task.id, task.state);
  const { byId } = useDevices(POLL_POLICIES.devices);
  const board = useBoard({ policy: POLL_POLICIES.shell });
  const application = useQuery({
    queryKey: queryKeys.application(applicationId ?? "none"),
    queryFn: () =>
      api("GET /api/v1/applications/{app_id}", {
        params: { app_id: applicationId ?? "" },
      }),
    enabled: applicationId !== null,
    staleTime: 15_000,
  });

  // The run just ended: fetch the final events and the application again.
  useEffect(() => {
    if (!terminal || applicationId === null) {
      return;
    }
    queryClient.invalidateQueries({
      queryKey: [...queryKeys.task(task.id), "events"],
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.application(applicationId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.boardAll });
  }, [terminal, applicationId, queryClient, task.id]);

  const card = useMemo(
    () =>
      (board.data?.board.columns ?? [])
        .flatMap((column) => column.cards)
        .find((entry) => entry.id === applicationId),
    [board.data, applicationId]
  );
  const own = useMemo(
    () => taskEvents(events.data ?? [], task.id),
    [events.data, task.id]
  );
  const deviceId = task.lease_device_id ?? task.target_device_id;
  const device = deviceId ? byId.get(deviceId) : undefined;
  const context = detail.context?.kind === "apply" ? detail.context : null;
  return {
    application: application.data,
    attempt: currentAttempt(detail.attempts),
    company:
      context?.posting.company_name ??
      card?.posting.company_name ??
      application.data?.posting.company_name ??
      null,
    postingTitle:
      context?.posting.title ??
      card?.posting.title ??
      application.data?.posting.title ??
      null,
    device,
    deviceName: detail.device_name ?? device?.name ?? t("monitor.anyDevice"),
    events: own,
    pendingAnswer:
      detail.approvals.find(
        (approval) => approval.kind === "answer" && approval.state === "pending"
      ) ?? null,
    refetchApplication: application.refetch,
  };
}

/** Resume a paused run; settle an uncertain submission (03 §5.2). */
function useMonitorActions(
  task: AutomationTaskRecord,
  data: MonitorData,
  refetch: () => Promise<unknown>
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function resume() {
    setBusy(true);
    try {
      await api("POST /api/v1/tasks/{tsk_id}/resume", {
        params: { tsk_id: task.id },
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(t("monitor.resumeSent", { device: data.deviceName }));
      await refetch();
    } catch (error) {
      toast.error(
        isApiError(error) && error.status === 422
          ? t("monitor.resumeRefused")
          : t("runs.actionFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  async function settle(action: "confirm" | "deny") {
    const record = data.application?.application;
    if (!record) {
      return;
    }
    setBusy(true);
    try {
      const result = await api(
        "POST /api/v1/applications/{app_id}/submission",
        {
          params: { app_id: record.id },
          body: { base_revision: record.revision, action },
          idempotencyKey: newIdempotencyKey(),
        }
      );
      commitApplicationToBoard(queryClient, result.application);
      await Promise.all([
        data.refetchApplication(),
        refetch(),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll }),
      ]);
      toast.success(
        action === "confirm"
          ? t("submission.confirmed")
          : t("submission.denied")
      );
    } catch (error) {
      toast.error(
        isApiError(error) && error.isRevisionConflict
          ? t("submission.changed")
          : t("submission.failedToSave")
      );
    } finally {
      setBusy(false);
    }
  }

  return { busy, resume, settle };
}

function needsSettling(
  task: AutomationTaskRecord,
  status: SubmissionStatus | undefined
): boolean {
  return (
    isTerminalTask(task.state) &&
    (status === "submitted_unverified" || status === "outcome_unknown")
  );
}

/** The page's one primary action (Y): resume, answer, or confirm. */
function primaryAction(
  t: Translate,
  task: AutomationTaskRecord,
  options: {
    answerApprovalId: string | null;
    onAnswer: (approvalId: string) => void;
    onConfirm: () => void;
    onResume: () => void;
    settle: boolean;
  }
): Primary | null {
  if (task.state === "paused") {
    const group = task.pause_reason ? PAUSE_GROUP[task.pause_reason] : null;
    if (group && !canResume(group)) {
      const approvalId = options.answerApprovalId;
      return approvalId
        ? {
            label: t("monitor.openAnswer"),
            run: () => options.onAnswer(approvalId),
          }
        : null;
    }
    return {
      label: task.resume_requested
        ? t("monitor.resumeAgain")
        : t("monitor.resume"),
      run: options.onResume,
    };
  }
  if (options.settle) {
    return { label: t("monitor.confirmSubmitted"), run: options.onConfirm };
  }
  return null;
}

function Header({
  task,
  data,
}: {
  task: AutomationTaskRecord;
  data: MonitorData;
}) {
  const { t } = useTranslation();
  const heading =
    task.kind === "apply" && data.company
      ? t("monitor.applyingTo", { company: data.company })
      : taskKindLabel(t, task.kind);
  const mode = task.payload.mode;
  const online = data.device ? data.device.online : null;
  let deviceText = data.deviceName;
  if (online !== null) {
    deviceText = online
      ? t("monitor.deviceOnline", { device: data.deviceName })
      : t("monitor.deviceOffline", { device: data.deviceName });
  }
  return (
    <div className="band flex flex-col gap-1 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-compact">{heading}</h1>
        <TaskStateBadge state={task.state} />
      </div>
      {data.postingTitle ? (
        <p className="type-body-compact text-foreground">{data.postingTitle}</p>
      ) : null}
      <p className="type-caption flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground tabular-nums">
        <span title={task.id}>
          {t("monitor.taskId", { id: task.id.slice(0, ID_PREFIX) })}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {t("monitor.attempt", {
            n: task.attempt_count,
            max: task.max_attempts,
          })}
        </span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1">
          {online === null ? null : (
            <span
              aria-hidden="true"
              className={
                online
                  ? "pulse-dot size-1.5 rounded-full bg-foreground"
                  : "size-1.5 rounded-full border border-muted-foreground"
              }
            />
          )}
          {deviceText}
        </span>
        {mode ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{t("monitor.modeLabel", { mode: modeLabel(t, mode) })}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

function Alerts({
  task,
  data,
  heartbeat,
}: {
  task: AutomationTaskRecord;
  data: MonitorData;
  heartbeat: HeartbeatView | null;
}) {
  const { locale, t } = useTranslation();
  return (
    <>
      {task.state === "paused" ? (
        <PausePrompt
          answerApprovalId={data.pendingAnswer?.id ?? null}
          device={data.deviceName}
          excerpt={flaggedExcerpt(data.events)}
          reason={task.pause_reason}
        />
      ) : null}
      {task.state === "awaiting_approval" ? (
        <Alert>
          <Hourglass aria-hidden="true" />
          <AlertTitle>{t("monitor.awaitingTitle")}</AlertTitle>
          <AlertDescription>{t("monitor.awaitingBody")}</AlertDescription>
        </Alert>
      ) : null}
      {heartbeat?.stale ? (
        <Alert role="alert" variant="destructive">
          <Unplug aria-hidden="true" />
          <AlertTitle>{t("monitor.notResponding")}</AlertTitle>
          <AlertDescription>
            {heartbeat.releaseAt
              ? t("monitor.releasedAt", {
                  time: formatClock(heartbeat.releaseAt, locale),
                })
              : t("monitor.releasedSoon")}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

function Executor({
  task,
  data,
}: {
  task: AutomationTaskRecord;
  data: MonitorData;
}) {
  const { t } = useTranslation();
  const stage = progressStage(task);
  const message =
    "message" in task.progress && task.progress.message
      ? task.progress.message
      : null;
  const headed =
    task.payload.mode === "assisted" ||
    task.required_capabilities.includes("headed_browser");
  const parts = [
    executorText(t, executorStatus(task)),
    headed ? t("monitor.headed") : t("monitor.headless"),
  ];
  const mode = browserModeOf(data.device);
  if (mode) {
    parts.push(t(`monitor.browserModes.${mode}`));
  }
  if (data.attempt) {
    parts.push(
      t("monitor.actions", {
        n: data.attempt.steps_count,
        max: ATTEMPT_BUDGET.actions,
      }),
      t("monitor.aiCalls", {
        n: data.attempt.ai_calls,
        max: ATTEMPT_BUDGET.aiCalls,
      })
    );
  }
  let current = t("monitor.currentNone");
  if (stage) {
    current = t("monitor.current", {
      stage: message ?? t(`progressStages.${stage}`),
    });
  }
  return (
    <section aria-labelledby="executor-heading" className="flex flex-col gap-1">
      <h2 className="type-subtitle" id="executor-heading">
        {current}
      </h2>
      <p className="type-caption text-muted-foreground tabular-nums">
        {parts.join(" · ")}
      </p>
      {task.cancel_requested ? (
        <p className="type-caption text-destructive">
          {t("monitor.cancelling")}
        </p>
      ) : null}
    </section>
  );
}

function Outcome({
  detail,
  status,
  settle,
}: {
  detail: TaskDetail;
  status: SubmissionStatus | undefined;
  settle: boolean;
}) {
  const { t } = useTranslation();
  const { task } = detail;
  return (
    <section
      aria-labelledby="outcome-heading"
      className="flex flex-col gap-3 border border-line p-4"
    >
      <div id="outcome-heading">
        <OutcomeHeading state={task.state} />
      </div>
      {status ? (
        <p className="type-body-compact">
          {t("monitor.submissionNow", {
            status: submissionLabel(t, status),
          })}
        </p>
      ) : null}
      {task.error_class ? (
        <p className="type-body-compact text-destructive">
          {taskErrorLabel(t, task.error_class)}
          {task.error_message ? ` · ${task.error_message}` : ""}
        </p>
      ) : null}
      {detail.evidence.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="type-caption weight-semibold text-foreground">
            {t("monitor.evidence")}
          </h3>
          {detail.evidence.map((evidence) => (
            <EvidenceCard evidence={evidence} key={evidence.id} />
          ))}
        </div>
      ) : (
        <p className="type-caption text-muted-foreground">
          {t("monitor.noEvidence")}
        </p>
      )}
      {settle ? (
        <p className="type-caption text-muted-foreground">
          {t("monitor.settleHelp")}
        </p>
      ) : null}
    </section>
  );
}

function Actions({
  task,
  primary,
  settle,
  busy,
  onDeny,
  onDialog,
}: {
  task: AutomationTaskRecord;
  primary: Primary | null;
  settle: boolean;
  busy: boolean;
  onDeny: () => void;
  onDialog: (kind: RunDialogKind) => void;
}) {
  const { t } = useTranslation();
  const retryable = task.state === "failed" || task.state === "outcome_unknown";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary ? (
        <Button aria-keyshortcuts="Y" disabled={busy} onClick={primary.run}>
          {primary.label}
          <Kbd aria-hidden="true">Y</Kbd>
        </Button>
      ) : null}
      {settle ? (
        <Button disabled={busy} onClick={onDeny} variant="outline">
          {t("submission.notSubmitted")}
        </Button>
      ) : null}
      {retryable ? (
        <Button
          disabled={busy}
          onClick={() => onDialog(task.state === "failed" ? "retry" : "settle")}
          variant="outline"
        >
          {t("runs.retry")}
        </Button>
      ) : null}
      {isCancellable(task.state) && !task.cancel_requested ? (
        <Button
          disabled={busy}
          onClick={() => onDialog("cancel")}
          variant="outline"
        >
          {t("runs.cancelRun")}
        </Button>
      ) : null}
      {task.state === "paused" && task.resume_requested ? (
        <Badge variant="outline">{t("monitor.resumeQueued")}</Badge>
      ) : null}
    </div>
  );
}

function Monitor({
  detail,
  stale,
  updatedAt,
  refetch,
}: {
  detail: TaskDetail;
  stale: boolean;
  updatedAt: number;
  refetch: () => Promise<unknown>;
}) {
  const { locale, t } = useTranslation();
  const navigate = useNavigate();
  const { task } = detail;
  const data = useMonitorData(detail);
  const actions = useMonitorActions(task, data, refetch);
  const now = useNow(SECOND_MS);
  const [dialog, setDialog] = useState<RunDialogKind | null>(null);
  const terminal = isTerminalTask(task.state);
  const status = data.application?.application.submission_status;
  const settle = needsSettling(task, status);
  const heartbeat = heartbeatView(task, data.attempt, now);
  const primary = primaryAction(t, task, {
    answerApprovalId: data.pendingAnswer?.id ?? null,
    onAnswer: (approvalId) =>
      navigate({ to: "/automation", search: { approval: approvalId } }),
    onConfirm: () => actions.settle("confirm"),
    onResume: actions.resume,
    settle,
  });

  useShortcut(
    "y",
    () => {
      if (!actions.busy) {
        primary?.run();
      }
    },
    primary !== null
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header data={data} task={task} />
      {stale ? (
        <p
          className="type-caption band inline-flex items-center gap-1 px-4 py-1.5 text-muted-foreground sm:px-6"
          role="status"
        >
          <CloudOff aria-hidden="true" className="size-3.5" />
          {t("monitor.stale", { time: formatClock(updatedAt, locale) })}
        </p>
      ) : null}
      <div className="grid flex-1 md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-line border-b md:border-r md:border-b-0">
          <Stepper
            cv={
              task.kind === "apply"
                ? cvStatusOf(detail, data.application)
                : null
            }
            steps={buildStepper(
              task,
              data.events,
              data.attempt?.started_at ?? null
            )}
          />
        </aside>
        <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-6">
          <Alerts data={data} heartbeat={heartbeat} task={task} />
          {terminal ? (
            <Outcome detail={detail} settle={settle} status={status} />
          ) : (
            <Executor data={data} task={task} />
          )}
          <Actions
            busy={actions.busy}
            onDeny={() => actions.settle("deny")}
            onDialog={setDialog}
            primary={primary}
            settle={settle}
            task={task}
          />
          <StepLog
            device={data.deviceName}
            entries={stepLog(data.events)}
            heartbeat={
              heartbeat
                ? t("monitor.heartbeat", { seconds: heartbeat.ageSeconds })
                : null
            }
          />
        </div>
      </div>
      {dialog ? (
        <RunDialog
          kind={dialog}
          onClose={() => setDialog(null)}
          onRetried={(next) =>
            navigate({
              to: "/automation/runs/$tskId",
              params: { tskId: next.id },
            })
          }
          task={task}
        />
      ) : null}
    </div>
  );
}

export function RunMonitorPage({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const query = useTaskDetail(taskId);
  if (query.isError && isApiError(query.error) && query.error.status === 404) {
    return <NotFoundPage />;
  }
  if (query.data) {
    return (
      <Monitor
        detail={query.data}
        refetch={query.refetch}
        stale={query.stale}
        updatedAt={query.dataUpdatedAt}
      />
    );
  }
  if (query.isPending) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-4 p-5">
        <Skeleton className="h-6 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <div className="p-4 sm:p-5">
      <Alert role="alert" variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{t("monitor.loadErrorTitle")}</AlertTitle>
        <AlertDescription>{t("monitor.loadError")}</AlertDescription>
        <AlertAction>
          <Button onClick={() => query.refetch()} size="sm" variant="outline">
            {t("common.retry")}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
