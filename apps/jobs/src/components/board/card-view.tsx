// One Kanban card (06 §1.3, 12 §3): company, title, location, then the
// badges — score, source, mode, CV, submission, live task, posting closed —
// and the follow-up / interview / offer markers and the age of the last
// change. Status is never colour alone: every badge carries text.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import { Badge } from "@rulisme/ui/ui/badge";
import { cn } from "@rulisme/ui/lib/utils";
import {
  ArrowUp,
  CalendarClock,
  Check,
  Clock,
  FileCheck2,
  Hand,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "@/i18n";
import { isFollowUpDue } from "@/lib/board-model";
import { compactAge, formatDateTime, relativeTime } from "@/lib/format";
import {
  modeLabel,
  sourceBadge,
  sourceLabel,
  taskStateLabel,
} from "@/lib/labels";

const HIGH_SCORE = 80;
const MID_SCORE = 60;

function ScoreBadge({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  const score = card.score;
  if (!score || score.status === "failed") {
    return null;
  }
  if (score.status === "queued") {
    return (
      <Badge variant="ghost">
        <span aria-hidden="true">◌</span>
        {t("card.scoring")}
      </Badge>
    );
  }
  let tone = "border-border text-muted-foreground";
  if (score.score >= HIGH_SCORE) {
    tone = "border-primary/60 text-primary";
  } else if (score.score >= MID_SCORE) {
    tone = "border-border text-foreground";
  }
  return (
    <Badge
      className={cn("tabular-nums", tone)}
      title={score.deterministic_only ? t("card.aiOff") : undefined}
      variant="outline"
    >
      <span className="sr-only">{t("card.score")} </span>
      {score.score}
      <span aria-hidden="true" className="relative h-1 w-3 bg-pane">
        <span
          className="absolute inset-y-0 left-0 bg-current"
          style={{ width: `${Math.max(8, score.score)}%` }}
        />
      </span>
      {score.deterministic_only ? (
        <span className="text-muted-foreground">{t("card.aiOffShort")}</span>
      ) : null}
    </Badge>
  );
}

function ModeGlyph({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  const icons: Record<string, ReactNode> = {
    assisted: <Hand aria-hidden="true" />,
    approval: <ShieldCheck aria-hidden="true" />,
    auto: <Zap aria-hidden="true" />,
  };
  const icon = icons[card.mode];
  if (!icon) {
    return null;
  }
  return (
    <Badge title={modeLabel(t, card.mode)} variant="outline">
      {icon}
      <span>{modeLabel(t, card.mode)}</span>
    </Badge>
  );
}

function SubmissionBadge({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  switch (card.submission_status) {
    case "in_progress":
      return (
        <Badge variant="outline">{t("card.submission.in_progress")}</Badge>
      );
    case "submitted_verified":
      return (
        <Badge variant="secondary">
          <Check aria-hidden="true" />
          {t("card.submission.submitted_verified")}
        </Badge>
      );
    case "submitted_unverified":
      return (
        <Badge variant="default">
          {t("card.submission.submitted_unverified")}
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">{t("card.submission.failed")}</Badge>;
    case "outcome_unknown":
      return (
        <Badge className="text-destructive" variant="outline">
          {t("card.submission.outcome_unknown")}
        </Badge>
      );
    default:
      return null;
  }
}

function LiveTaskBadge({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  const task = card.live_task;
  if (!task) {
    return null;
  }
  const device = task.device_name ?? t("card.anyDevice");
  let text: string;
  if (task.state === "running" || task.state === "claimed") {
    text = task.progress_stage
      ? t("card.liveRunningStage", {
          device,
          stage: t(`progressStages.${task.progress_stage}`),
        })
      : t("card.liveRunning", { device });
  } else if (task.state === "paused") {
    text = t("card.livePaused");
  } else if (task.state === "awaiting_approval") {
    text = t("card.liveAwaitingApproval");
  } else {
    text = taskStateLabel(t, task.state);
  }
  const active = task.state === "running" || task.state === "claimed";
  return (
    <Badge
      className={task.state === "paused" ? "text-destructive" : undefined}
      variant="outline"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full bg-current",
          active ? "pulse-dot" : "opacity-60"
        )}
      />
      {text}
    </Badge>
  );
}

function CardBadges({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  const { posting } = card;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ScoreBadge card={card} />
      <Badge title={sourceLabel(t, posting.source_kind)} variant="outline">
        {sourceBadge(t, posting.source_kind)}
      </Badge>
      <ModeGlyph card={card} />
      {card.cv_variant_id ? (
        <Badge variant="outline">
          <FileCheck2 aria-hidden="true" />
          {t("card.cvReady")}
        </Badge>
      ) : null}
      <SubmissionBadge card={card} />
      <LiveTaskBadge card={card} />
      {posting.status === "closed" ? (
        <Badge variant="ghost">{t("card.postingClosed")}</Badge>
      ) : null}
      {card.archived ? (
        <Badge variant="ghost">{t("card.archived")}</Badge>
      ) : null}
      {card.latest_offer_status === "open" ? (
        <Badge variant="secondary">{t("card.offerOpen")}</Badge>
      ) : null}
    </div>
  );
}

/** Follow-up due and the next interview (06 §1.3), in the user's timezone. */
function CardMarkers({ card, nowMs }: { card: BoardCard; nowMs: number }) {
  const { locale, t } = useTranslation();
  const followUpAt = isFollowUpDue(card, nowMs) ? card.follow_up_at : null;
  if (followUpAt === null && card.next_interview_at === null) {
    return null;
  }
  return (
    <div className="type-micro flex flex-col gap-0.5">
      {followUpAt === null ? null : (
        <span className="inline-flex items-center gap-1 text-foreground">
          <Clock aria-hidden="true" className="size-3" />
          {t("card.followUpDue", {
            when: relativeTime(followUpAt, nowMs, locale),
          })}
        </span>
      )}
      {card.next_interview_at === null ? null : (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CalendarClock aria-hidden="true" className="size-3" />
          {t("card.interview", {
            when: formatDateTime(card.next_interview_at, locale),
          })}
        </span>
      )}
    </div>
  );
}

export function CardView({
  card,
  nowMs,
  pending = false,
  selected = false,
  className,
}: {
  card: BoardCard;
  nowMs: number;
  pending?: boolean;
  selected?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const posting = card.posting;
  const workplace =
    posting.workplace_type && posting.workplace_type !== "unknown"
      ? t(`workplace.${posting.workplace_type}`)
      : null;
  const location = [posting.location, workplace].filter(Boolean).join(" · ");
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border border-border bg-card p-2.5 text-left",
        selected && "bg-pane-2",
        card.priority === -1 && "opacity-75",
        card.archived && "border-dashed",
        pending && "opacity-70",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="type-caption truncate text-muted-foreground">
          {posting.company_name}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {card.priority === 1 ? (
            <span className="type-micro inline-flex items-center gap-0.5 text-foreground">
              <ArrowUp aria-hidden="true" className="size-3" />
              {t("card.highPriority")}
            </span>
          ) : null}
          {selected ? (
            <Check
              aria-label={t("card.selected")}
              className="size-3.5 text-foreground"
            />
          ) : null}
        </span>
      </div>
      <span className="type-body weight-semibold line-clamp-2 text-foreground">
        {posting.title}
      </span>
      {location ? (
        <span className="type-caption truncate text-muted-foreground">
          {location}
        </span>
      ) : null}
      <CardBadges card={card} />
      <CardMarkers card={card} nowMs={nowMs} />
      <span className="type-micro text-muted-foreground">
        {pending
          ? t("card.saving")
          : t("card.updated", { age: compactAge(card.updated_at, nowMs) })}
      </span>
    </div>
  );
}
