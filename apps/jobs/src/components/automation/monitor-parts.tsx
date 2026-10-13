// Pieces of the live run monitor (12 §6.3): the stepper, the pause prompt,
// the step log with its throttled live region, and the outcome card. Device
// messages and page excerpts are untrusted text: plain text only.

import type {
  PauseReason,
  TaskState,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { SubmissionEvidenceRecord } from "@pilihpendidikan/jobs-contracts/records";
import { cn } from "@rulisme/ui/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@rulisme/ui/ui/alert";
import { Badge } from "@rulisme/ui/ui/badge";
import { Link } from "@tanstack/react-router";
import {
  Check,
  CircleAlert,
  CircleDot,
  CircleHelp,
  Circle,
  Minus,
  PauseCircle,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PlainText } from "@/components/rich-text";
import type { Translate } from "@/i18n";
import { intlLocale, useTranslation } from "@/i18n";
import type { Locale } from "@/i18n";
import { progressStageLabel, taskStateLabel } from "@/lib/labels";
import type {
  AnnounceState,
  LogEntry,
  StepStatus,
  StepView,
} from "@/lib/monitor-model";
import {
  INITIAL_ANNOUNCE_STATE,
  pausePromptKeys,
  planAnnouncement,
} from "@/lib/monitor-model";
import { displayUrl, safeHref } from "@/lib/safe-url";

/** "14:02:19". */
export function formatClockSeconds(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(ms);
}

const STEP_ICONS: Record<StepStatus, typeof Check> = {
  done: Check,
  current: CircleDot,
  paused: PauseCircle,
  failed: X,
  unknown: CircleHelp,
  skipped: Minus,
  pending: Circle,
};

export interface CvStatusView {
  sha: string | null;
  status: "ready" | "rendering" | "missing";
}

const ACTIVE_STATUSES: ReadonlySet<StepStatus> = new Set([
  "current",
  "paused",
  "failed",
  "unknown",
]);

function iconTone(status: StepStatus): string {
  if (status === "failed" || status === "paused") {
    return "text-destructive";
  }
  return status === "pending" || status === "skipped"
    ? "text-muted-foreground"
    : "text-foreground";
}

function stepLabel(t: Translate, step: StepView, cv: CvStatusView | null) {
  if (step.id !== "preparing_cv" || !cv) {
    return progressStageLabel(t, step.id);
  }
  return cv.status === "ready"
    ? t("monitor.cvReady", { sha: cv.sha ?? "" })
    : t(`monitor.cv.${cv.status}`);
}

function StepRow({ step, cv }: { step: StepView; cv: CvStatusView | null }) {
  const { locale, t } = useTranslation();
  const Icon = STEP_ICONS[step.status];
  const active = ACTIVE_STATUSES.has(step.status);
  return (
    <li
      aria-current={step.status === "current" ? "step" : undefined}
      className={cn(
        "type-body-compact flex items-center gap-2 border-line border-b px-4 py-2 sm:px-6",
        active && "bg-pane-2"
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-3.5 shrink-0", iconTone(step.status))}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          active && "weight-semibold text-foreground",
          step.status === "pending" && "text-muted-foreground"
        )}
      >
        {stepLabel(t, step, cv)}
        <span className="sr-only">
          {" "}
          {t(`monitor.stepStatus.${step.status}`)}
        </span>
      </span>
      <span className="type-micro shrink-0 text-muted-foreground tabular-nums">
        {step.at === null ? "—" : formatClockSeconds(step.at, locale)}
      </span>
    </li>
  );
}

export function Stepper({
  steps,
  cv,
}: {
  steps: readonly StepView[];
  cv: CvStatusView | null;
}) {
  const { t } = useTranslation();
  return (
    <ol aria-label={t("monitor.stepsLabel")} className="flex flex-col">
      {steps.map((step) => (
        <StepRow cv={cv} key={step.id} step={step} />
      ))}
    </ol>
  );
}

export function PausePrompt({
  reason,
  device,
  excerpt,
  answerApprovalId,
}: {
  reason: PauseReason | null;
  device: string;
  excerpt: string | null;
  answerApprovalId: string | null;
}) {
  const { t } = useTranslation();
  if (!reason) {
    return (
      <Alert role="alert" variant="destructive">
        <PauseCircle aria-hidden="true" />
        <AlertTitle>{t("monitor.pausedTitle")}</AlertTitle>
        <AlertDescription>{t("monitor.pausedUnknown")}</AlertDescription>
      </Alert>
    );
  }
  const keys = pausePromptKeys(reason);
  return (
    <Alert role="alert" variant="destructive">
      {keys.group === "injection" ? (
        <ShieldAlert aria-hidden="true" />
      ) : (
        <PauseCircle aria-hidden="true" />
      )}
      <AlertTitle>{t(keys.title)}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>{t(keys.detail)}</p>
        <p className="text-foreground">{t(keys.action, { device })}</p>
        {keys.group === "injection" && excerpt ? (
          <figure className="flex flex-col gap-1">
            <figcaption className="type-caption text-muted-foreground">
              {t("monitor.flaggedExcerpt")}
            </figcaption>
            <PlainText
              className="type-body-compact border border-line bg-card p-2 text-foreground"
              text={excerpt}
            />
          </figure>
        ) : null}
        {keys.group === "answer" && answerApprovalId ? (
          <Link
            className="w-fit text-primary underline-offset-4 hover:underline"
            search={{ approval: answerApprovalId }}
            to="/automation"
          >
            {t("monitor.openAnswer")}
          </Link>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** One step-log line, from what the device reported (by source, never raw). */
export function logText(t: Translate, entry: LogEntry, device: string): string {
  switch (entry.type) {
    case "automation_task_created":
      return t("monitor.log.created");
    case "automation_task_claimed":
      return t("monitor.log.claimed", { device });
    case "automation_task_paused":
      return entry.pauseReason
        ? t("monitor.log.paused", {
            reason: t(`monitor.pauseTitles.${entry.pauseReason}`),
          })
        : t("monitor.log.pausedUnknown");
    case "automation_task_finished":
      return entry.state
        ? t("monitor.log.finished", { state: taskStateLabel(t, entry.state) })
        : t("monitor.log.finishedUnknown");
    case "approval_requested":
      return t("monitor.log.approvalRequested");
    case "approval_decided":
      return t("monitor.log.approvalDecided");
    case "submit_intent":
      return t("monitor.log.submitIntent");
    default: {
      const stage = entry.stage ? progressStageLabel(t, entry.stage) : null;
      if (stage && entry.message) {
        return `${stage} · ${entry.message}`;
      }
      return entry.message ?? stage ?? t("monitor.log.progress");
    }
  }
}

const LOG_TAIL = 60;

export function StepLog({
  entries,
  device,
  heartbeat,
}: {
  entries: readonly LogEntry[];
  device: string;
  heartbeat: string | null;
}) {
  const { locale, t } = useTranslation();
  const [announcement, setAnnouncement] = useState("");
  const state = useRef<AnnounceState | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef({ entries, device, t });
  latest.current = { entries, device, t };

  useEffect(() => {
    const total = entries.length;
    // The log as first loaded is not news; only what happens next is.
    if (state.current === null) {
      state.current = { ...INITIAL_ANNOUNCE_STATE, announced: total };
      return;
    }
    const tick = () => {
      timer.current = null;
      const current = latest.current;
      const plan = planAnnouncement(
        state.current ?? INITIAL_ANNOUNCE_STATE,
        current.entries.length,
        Date.now()
      );
      state.current = plan.state;
      if (plan.kind === "announce") {
        const last = current.entries.at(-1);
        const text = last ? logText(current.t, last, current.device) : "";
        setAnnouncement(
          plan.newEntries > 1
            ? current.t("monitor.log.summary", {
                count: plan.newEntries,
                latest: text,
              })
            : text
        );
      } else if (plan.kind === "wait" && timer.current === null) {
        timer.current = window.setTimeout(tick, plan.delayMs);
      }
    };
    tick();
  }, [entries.length]);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    []
  );

  const tail = entries.slice(-LOG_TAIL);
  return (
    <section
      aria-labelledby="step-log-heading"
      className="flex flex-col border border-line"
    >
      <header className="flex items-center gap-2 border-line border-b bg-pane/50 px-3 py-1.5">
        <h2
          className="type-caption weight-semibold text-foreground"
          id="step-log-heading"
        >
          {t("monitor.stepLog")}
        </h2>
        {heartbeat ? (
          <span className="type-micro ml-auto text-muted-foreground tabular-nums">
            {heartbeat}
          </span>
        ) : null}
      </header>
      {tail.length === 0 ? (
        <p className="type-caption px-3 py-3 text-muted-foreground">
          {t("monitor.noLog")}
        </p>
      ) : (
        <ol className="flex max-h-80 flex-col overflow-y-auto py-1">
          {tail.map((entry) => (
            <li
              className="type-body-compact grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-0.5"
              key={entry.id}
            >
              <time
                className="text-muted-foreground tabular-nums"
                dateTime={new Date(entry.at).toISOString()}
              >
                {formatClockSeconds(entry.at, locale)}
              </time>
              <span className="break-words text-foreground">
                {logText(t, entry, device)}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div aria-live="polite" className="sr-only" role="status">
        {announcement}
      </div>
    </section>
  );
}

function Signal({ on, label }: { on: boolean | undefined; label: string }) {
  if (on === undefined) {
    return null;
  }
  return (
    <Badge variant="outline">
      {on ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
      {label}
    </Badge>
  );
}

export function EvidenceCard({
  evidence,
}: {
  evidence: SubmissionEvidenceRecord;
}) {
  const { locale, t } = useTranslation();
  const href = evidence.final_url ? safeHref(evidence.final_url) : null;
  const { signals } = evidence;
  return (
    <div className="flex flex-col gap-2 border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-1">
        <Badge
          variant={evidence.verdict === "verified" ? "secondary" : "outline"}
        >
          {evidence.verdict === "verified" ? (
            <Check aria-hidden="true" />
          ) : (
            <CircleAlert aria-hidden="true" />
          )}
          {t(`evidenceVerdicts.${evidence.verdict}`)}
        </Badge>
        <Badge variant="outline">{t(`evidenceKinds.${evidence.kind}`)}</Badge>
        <span className="type-micro ml-auto text-muted-foreground tabular-nums">
          {formatClockSeconds(evidence.captured_at, locale)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <Signal label={t("monitor.signals.urlMatch")} on={signals.url_match} />
        <Signal
          label={t("monitor.signals.domMarker")}
          on={signals.dom_marker}
        />
        <Signal label={t("monitor.signals.formGone")} on={signals.form_gone} />
        <Signal label={t("monitor.signals.xhr")} on={signals.xhr_2xx} />
        <Signal
          label={t("monitor.signals.negative")}
          on={signals.negative_marker}
        />
        {typeof signals.http_status === "number" ? (
          <Badge variant="outline">
            {t("monitor.signals.http", { status: signals.http_status })}
          </Badge>
        ) : null}
      </div>
      {evidence.page_title ? (
        <p className="type-body-compact text-foreground">
          {evidence.page_title}
        </p>
      ) : null}
      {evidence.final_url ? (
        <p className="type-caption break-all">
          {href ? (
            <a
              className="text-primary underline-offset-4 hover:underline"
              href={href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {displayUrl(href)}
            </a>
          ) : (
            evidence.final_url
          )}
        </p>
      ) : null}
      {evidence.text_excerpt ? (
        <PlainText
          className="type-caption text-muted-foreground"
          text={evidence.text_excerpt}
        />
      ) : null}
      {evidence.screenshot_file_id ? (
        <img
          alt={t("monitor.screenshotAlt")}
          className="h-auto w-full max-w-md border border-line object-contain"
          height={300}
          src={`/download/files/${encodeURIComponent(evidence.screenshot_file_id)}/content`}
          width={480}
        />
      ) : null}
    </div>
  );
}

export function OutcomeHeading({ state }: { state: TaskState }) {
  const { t } = useTranslation();
  return (
    <h2 className="type-subtitle">
      {t(`monitor.outcome.${state}`, { state: taskStateLabel(t, state) })}
    </h2>
  );
}
