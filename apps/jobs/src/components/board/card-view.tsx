// One Kanban card (06 §1.3, reui's kanban / Deal Risk Board cards): the
// company avatar and name, the role, the location line, the match score as
// a meter, neutral chips, and a footer with the age, the follow-up and the
// CV. Status is never colour alone: every chip and meter carries text.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import { cn } from "@rulisme/ui/lib/utils";
import { KanbanCard } from "@rulisme/ui/blocks/kanban";
import { Badge } from "@rulisme/ui/ui/badge";
import { Meter } from "@rulisme/ui/ui/meter";
import {
  ArrowUp,
  Building2,
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
  inline = false,
}: {
  score: BoardCard["score"];
  className?: string;
  /** Show the "Match" caption on the left (cards); rows show only the %. */
  label?: boolean;
  /** One line: a 64px bar with the % on its right (list rows). */
  inline?: boolean;
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
      inline={inline}
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

/** The source chip that sits at the end of the match row. */
function SourceChip({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  return (
    <Badge
      className="shrink-0"
      title={sourceLabel(t, card.posting.source_kind)}
      variant="outline"
    >
      {sourceBadge(t, card.posting.source_kind)}
    </Badge>
  );
}

/** Interview, open offer, closed posting, archived: only when one applies. */
function CardChips({ card }: { card: BoardCard }) {
  const { locale, t } = useTranslation();
  const { posting } = card;
  const chips = [
    card.next_interview_at === null ? null : (
      <Badge key="interview" variant="secondary">
        <CalendarClock aria-hidden="true" />
        {t("card.interview", {
          when: formatDate(card.next_interview_at, locale),
        })}
      </Badge>
    ),
    card.latest_offer_status === "open" ? (
      <Badge key="offer" variant="secondary">
        {t("card.offerOpen")}
      </Badge>
    ) : null,
    posting.status === "closed" ? (
      <Badge key="closed" variant="outline">
        {t("card.postingClosed")}
      </Badge>
    ) : null,
    card.archived ? (
      <Badge key="archived" variant="outline">
        {t("card.archived")}
      </Badge>
    ) : null,
  ].filter(Boolean);
  if (chips.length === 0) {
    return null;
  }
  return <div className="flex flex-wrap items-center gap-1">{chips}</div>;
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
    <div
      className="type-micro flex min-h-4 items-center gap-3 text-muted-foreground"
      data-slot="card-meta"
    >
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
          className="ml-auto inline-flex shrink-0 items-center gap-1"
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
  /** Phones: 14px padding and 10px gaps, so two cards fit the fold. */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const posting = card.posting;
  const location = useLocationLine(posting);
  return (
    <KanbanCard
      className={cn(compact ? "gap-2.5 p-3.5 pb-3" : "pb-3", className)}
      dashed={card.archived}
      muted={card.priority === -1}
      pending={pending}
      selected={selected}
    >
      <div
        className={cn(
          "flex min-w-0 items-start gap-1.5",
          wideAction ? "pr-20" : "pr-7"
        )}
      >
        <span className="type-body weight-semibold line-clamp-2 min-w-0 flex-1 text-foreground">
          {posting.title}
        </span>
        {card.priority === 1 ? (
          <span
            className="inline-flex h-5 shrink-0 items-center text-link"
            title={t("card.highPriority")}
          >
            <ArrowUp aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t("card.highPriority")}</span>
          </span>
        ) : null}
        {selected ? (
          <Check
            aria-label={t("card.selected")}
            className="mt-0.5 size-3.5 shrink-0 text-foreground"
          />
        ) : null}
      </div>
      <div className="type-body-compact flex flex-col gap-1.5 text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Building2 aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{posting.company_name}</span>
        </span>
        {location ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{location}</span>
          </span>
        ) : null}
      </div>
      <div className="flex items-end gap-3">
        <ScoreMeter className="min-w-0 flex-1" score={card.score} />
        <SourceChip card={card} />
      </div>
      <CardChips card={card} />
      <CardFooter card={card} nowMs={nowMs} pending={pending} />
    </KanbanCard>
  );
}
