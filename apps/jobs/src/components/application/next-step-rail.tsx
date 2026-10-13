// The right rail (12 §5.1): "Next step" — exactly one recommended action, the
// page's only blue button, behind `Y` — then the live task, the latest
// submission evidence and the follow-up.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { ArrowRight } from "lucide-react";
import { AppLink } from "@/components/app-link";
import type { ApplicationPatch } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import { formatDateTime, relativeTime } from "@/lib/format";
import { submissionLabel, taskStateLabel } from "@/lib/labels";
import type { NextStep } from "@/lib/next-step";
import { computeNextStep } from "@/lib/next-step";
import { isLivePollState } from "@/lib/polling";
import { displayUrl, safeHref } from "@/lib/safe-url";
import { FollowUpCard } from "./follow-up-card";

export type DetailTab =
  | "overview"
  | "cv"
  | "apply"
  | "timeline"
  | "interviews"
  | "offers"
  | "checklists";

function NextStepCard({
  step,
  onRun,
  shortcutEnabled,
}: {
  step: NextStep | null;
  onRun: (step: NextStep) => void;
  shortcutEnabled: boolean;
}) {
  const { t } = useTranslation();
  useShortcut("y", () => step && onRun(step), step !== null && shortcutEnabled);
  return (
    <section
      aria-labelledby="next-step-heading"
      className="flex flex-col gap-3 border-line border-b p-4"
    >
      <h2 className="type-caption text-muted-foreground" id="next-step-heading">
        {t("nextStep.heading")}
      </h2>
      {step ? (
        <>
          <p className="type-body text-pretty">
            {t(`nextStep.why.${step.kind}`)}
          </p>
          {step.kind === "approve_submission" ? (
            <Button asChild className="self-start">
              <AppLink
                aria-keyshortcuts="Y"
                href={`/automation?approval=${step.approvalId ?? ""}`}
              >
                {t(`nextStep.actions.${step.kind}`)}
                <Kbd aria-hidden="true">Y</Kbd>
              </AppLink>
            </Button>
          ) : (
            <Button
              aria-keyshortcuts="Y"
              className="self-start"
              onClick={() => onRun(step)}
            >
              {t(`nextStep.actions.${step.kind}`)}
              <Kbd aria-hidden="true">Y</Kbd>
            </Button>
          )}
        </>
      ) : (
        <p className="type-body text-muted-foreground">{t("nextStep.none")}</p>
      )}
    </section>
  );
}

function LiveTaskCard({
  detail,
  nowMs,
}: {
  detail: ApplicationDetail;
  nowMs: number;
}) {
  const { locale, t } = useTranslation();
  const task = detail.tasks.find((entry) =>
    ["queued", "claimed", "running", "paused", "awaiting_approval"].includes(
      entry.state
    )
  );
  if (!task) {
    return null;
  }
  const progress = "stage" in task.progress ? task.progress : null;
  return (
    <section
      aria-labelledby="live-task-heading"
      className="flex flex-col gap-2 border-line border-b p-4"
    >
      <h2 className="type-caption text-muted-foreground" id="live-task-heading">
        {t("detail.liveTask")}
      </h2>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          className={task.state === "paused" ? "text-destructive" : undefined}
          variant="outline"
        >
          {isLivePollState(task.state) ? (
            <span
              aria-hidden="true"
              className="pulse-dot size-1.5 rounded-full bg-current"
            />
          ) : null}
          {taskStateLabel(t, task.state)}
        </Badge>
        {task.pause_reason ? (
          <span className="type-caption text-destructive">
            {t(`pauseReasons.${task.pause_reason}`)}
          </span>
        ) : null}
      </div>
      {progress ? (
        <p className="type-caption text-muted-foreground">
          {t(`progressStages.${progress.stage}`)} · {progress.message}
        </p>
      ) : null}
      <p className="type-micro text-muted-foreground">
        {t("detail.updated", {
          when: relativeTime(task.updated_at, nowMs, locale),
        })}
      </p>
      <Button asChild className="self-start" size="xs" variant="link">
        <AppLink href={`/automation/runs/${task.id}`}>
          {t("detail.openRun")}
        </AppLink>
      </Button>
    </section>
  );
}

function EvidenceCard({ detail }: { detail: ApplicationDetail }) {
  const { locale, t } = useTranslation();
  const latest = [...detail.evidence].sort(
    (a, b) => b.captured_at - a.captured_at
  )[0];
  const status = detail.application.submission_status;
  if (!latest && status === "not_started") {
    return null;
  }
  const href = safeHref(latest?.final_url);
  return (
    <section
      aria-labelledby="evidence-heading"
      className="flex flex-col gap-2 border-line border-b p-4"
    >
      <h2 className="type-caption text-muted-foreground" id="evidence-heading">
        {t("detail.evidence")}
      </h2>
      <p className="type-body text-foreground">{submissionLabel(t, status)}</p>
      {latest ? (
        <dl className="type-caption grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
          <dt>{t("detail.evidenceKind")}</dt>
          <dd className="text-foreground">
            {t(`evidenceKinds.${latest.kind}`)}
          </dd>
          <dt>{t("detail.evidenceVerdict")}</dt>
          <dd className="text-foreground">
            {t(`evidenceVerdicts.${latest.verdict}`)}
          </dd>
          <dt>{t("detail.evidenceWhen")}</dt>
          <dd className="text-foreground">
            {formatDateTime(latest.captured_at, locale)}
          </dd>
          {href ? (
            <>
              <dt>{t("detail.finalUrl")}</dt>
              <dd className="min-w-0 truncate">
                <a
                  className="text-primary hover:underline"
                  href={href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {displayUrl(href)}
                </a>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

export function NextStepRail({
  detail,
  nowMs,
  onRun,
  onAcceptFollowUp,
  onEditFollowUp,
  shortcutEnabled = true,
}: {
  detail: ApplicationDetail;
  nowMs: number;
  onRun: (step: NextStep) => void;
  onAcceptFollowUp: (changes: ApplicationPatch) => Promise<unknown>;
  onEditFollowUp: () => void;
  /** False while the CV tab's own Approve owns `Y` (one handler per key). */
  shortcutEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const step = computeNextStep(detail);
  return (
    <aside
      aria-label={t("detail.rail")}
      className="order-first flex flex-col border-line border-b lg:order-none lg:border-b-0 lg:border-l"
    >
      <NextStepCard
        onRun={onRun}
        shortcutEnabled={shortcutEnabled}
        step={step}
      />
      <LiveTaskCard detail={detail} nowMs={nowMs} />
      <EvidenceCard detail={detail} />
      <FollowUpCard
        detail={detail}
        nowMs={nowMs}
        onAccept={onAcceptFollowUp}
        onEdit={onEditFollowUp}
      />
      <div className="hidden p-4 lg:block">
        <Button asChild size="xs" variant="link">
          <AppLink href="/board">
            {t("detail.backToBoard")}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </AppLink>
        </Button>
      </div>
    </aside>
  );
}
