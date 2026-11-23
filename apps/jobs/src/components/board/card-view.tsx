// One Kanban card (06 §1.3, reui's kanban / Deal Risk Board cards): the
// company avatar and name, the role, the location line, the match score as
// a meter, neutral chips, and a footer with the age, the follow-up and the
// CV. Status is never colour alone: every chip and meter carries text.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import { cn } from "@rulisme/ui/lib/utils";
import { KanbanCard } from "@rulisme/ui/blocks/kanban";
import { Badge } from "@rulisme/ui/ui/badge";
import { EntityAvatar } from "@rulisme/ui/ui/entity-avatar";
import { Meter } from "@rulisme/ui/ui/meter";
import {
  ArrowUp,
  CalendarClock,
  Check,
  Clock,
  FileText,
  MapPin,
} from "lucide-react";
import { useTranslation } from "@/i18n";
import { isFollowUpDue } from "@/lib/board-model";
import { compactAge, formatDate, relativeTime } from "@/lib/format";
import { sourceBadge, sourceLabel } from "@/lib/labels";

const HIGH_SCORE = 80;
const MID_SCORE = 60;

/** A 4px meter with the percentage: the score on cards, rows and the sheet. */
export function ScoreMeter({
  score,
  className,
  label = true,
}: {
  score: BoardCard["score"];
  className?: string;
  /** Show the "Match" caption on the left (cards); rows show only the %. */
  label?: boolean;
}) {
  const { t } = useTranslation();
  if (!score || score.status === "failed") {
    return null;
  }
  if (score.status === "queued") {
    return (
      <span className={cn("type-caption text-muted-foreground", className)}>
        {t("card.scoring")}
      </span>
    );
  }
  return (
    <Meter
      className={className}
      high={HIGH_SCORE}
      label={label ? t("board.match") : undefined}
      mid={MID_SCORE}
      title={score.deterministic_only ? t("card.aiOff") : undefined}
      value={score.score}
      valueLabel={
        <>
          <span className="sr-only">{t("card.score")} </span>
          {score.score}%
          {score.deterministic_only ? (
            <span className="ml-1 text-muted-foreground">
              {t("card.aiOffShort")}
            </span>
          ) : null}
        </>
      }
    />
  );
}

/** "Berlin · Remote": the posting's first location and workplace type. */
export function useLocationLine(posting: BoardCard["posting"]): string {
  const { t } = useTranslation();
  const workplace =
    posting.workplace_type && posting.workplace_type !== "unknown"
      ? t(`workplace.${posting.workplace_type}`)
      : null;
  return [posting.location, workplace].filter(Boolean).join(" · ");
}

function CardChips({ card }: { card: BoardCard }) {
  const { locale, t } = useTranslation();
  const { posting } = card;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge title={sourceLabel(t, posting.source_kind)} variant="outline">
        {sourceBadge(t, posting.source_kind)}
      </Badge>
      {card.next_interview_at === null ? null : (
        <Badge variant="secondary">
          <CalendarClock aria-hidden="true" />
          {t("card.interview", {
            when: formatDate(card.next_interview_at, locale),
          })}
        </Badge>
      )}
      {card.latest_offer_status === "open" ? (
        <Badge variant="secondary">{t("card.offerOpen")}</Badge>
      ) : null}
      {posting.status === "closed" ? (
        <Badge variant="ghost">{t("card.postingClosed")}</Badge>
      ) : null}
      {card.archived ? (
        <Badge variant="ghost">{t("card.archived")}</Badge>
      ) : null}
    </div>
  );
}

function CardFooter({
  card,
  nowMs,
  pending,
}: {
  card: BoardCard;
  nowMs: number;
  pending: boolean;
}) {
  const { locale, t } = useTranslation();
  const followUpAt = isFollowUpDue(card, nowMs) ? card.follow_up_at : null;
  return (
    <div className="type-micro flex items-center gap-3 border-border border-t pt-3 text-muted-foreground">
      <span
        className="inline-flex items-center gap-1 tabular-nums"
        title={t("card.updated", { age: compactAge(card.updated_at, nowMs) })}
      >
        <Clock aria-hidden="true" className="size-3" />
        {pending ? (
          t("card.saving")
        ) : (
          <>
            <span className="sr-only">
              {t("card.updated", { age: compactAge(card.updated_at, nowMs) })}
            </span>
            <span aria-hidden="true">{compactAge(card.updated_at, nowMs)}</span>
          </>
        )}
      </span>
      {followUpAt === null ? null : (
        <span className="inline-flex min-w-0 items-center gap-1 text-foreground">
          <CalendarClock aria-hidden="true" className="size-3 text-link" />
          <span className="truncate">
            {t("card.followUpDue", {
              when: relativeTime(followUpAt, nowMs, locale),
            })}
          </span>
        </span>
      )}
      {card.cv_variant_id ? (
        <span
          className="ml-auto inline-flex items-center gap-1"
          title={t("board.cvAttached")}
        >
          <FileText aria-hidden="true" className="size-3" />
          {t("card.cvReady")}
        </span>
      ) : null}
    </div>
  );
}

export function CardView({
  card,
  nowMs,
  pending = false,
  selected = false,
  wideAction = false,
  compact = false,
  className,
}: {
  card: BoardCard;
  nowMs: number;
  pending?: boolean;
  selected?: boolean;
  /** A labelled button (not the ⋯ icon) sits in the top-right corner. */
  wideAction?: boolean;
  /** Phones: the match meter and the chips share one row. */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const posting = card.posting;
  const location = useLocationLine(posting);
  return (
    <KanbanCard
      className={className}
      dashed={card.archived}
      muted={card.priority === -1}
      pending={pending}
      selected={selected}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2",
          wideAction ? "pr-20" : "pr-6"
        )}
      >
        <EntityAvatar name={posting.company_name} size="xs" />
        <span className="type-caption min-w-0 flex-1 truncate text-ink-sec">
          {posting.company_name}
        </span>
        {card.priority === 1 ? (
          <span
            className="inline-flex shrink-0 items-center text-link"
            title={t("card.highPriority")}
          >
            <ArrowUp aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t("card.highPriority")}</span>
          </span>
        ) : null}
        {selected ? (
          <Check
            aria-label={t("card.selected")}
            className="size-3.5 shrink-0 text-foreground"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="type-body weight-semibold line-clamp-2 text-foreground">
          {posting.title}
        </span>
        {location ? (
          <span className="type-caption inline-flex min-w-0 items-center gap-1 text-muted-foreground">
            <MapPin aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">{location}</span>
          </span>
        ) : null}
      </div>
      {compact ? (
        <div className="flex items-center gap-3">
          <ScoreMeter className="min-w-0 flex-1" score={card.score} />
          <CardChips card={card} />
        </div>
      ) : (
        <>
          <ScoreMeter score={card.score} />
          <CardChips card={card} />
        </>
      )}
      <CardFooter card={card} nowMs={nowMs} pending={pending} />
    </KanbanCard>
  );
}
