// The inbox score cell (12 §4): a neutral chip with the number and a 40px
// grey bar (orange text only for a high score), ◌ while
// queued, — when there is no score (AI off, failed or not requested). The
// tooltip holds the explanation and, once opened, the component breakdown;
// the row's expanded details repeat it for touch screens.

import type { InboxItem } from "@pilihpendidikan/jobs-contracts/api";
import { cn } from "@rulisme/ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import { scoreCell } from "@/lib/inbox-score";
import { ScoreBreakdown } from "./score-breakdown";

export function ScoreCellView({
  item,
  compact = false,
}: {
  item: InboxItem;
  /** Phone rows: a static badge-sized number, no bar, no tooltip. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const cell = scoreCell(item.score);

  if (cell.kind === "none") {
    return (
      <span
        className="inline-flex items-center text-muted-foreground"
        data-score="none"
        title={t("inbox.score.none")}
      >
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t("inbox.score.none")}</span>
      </span>
    );
  }
  if (cell.kind === "queued") {
    return (
      <span
        className="inline-flex items-center gap-1 text-muted-foreground"
        data-score="queued"
        title={t("card.scoring")}
      >
        <span aria-hidden="true">◌</span>
        <span className={compact ? "sr-only" : "type-micro"}>
          {t("card.scoring")}
        </span>
      </span>
    );
  }
  const score = item.score;
  if (!score) {
    return null;
  }
  if (compact) {
    // Phone rows are links themselves: a static badge, no nested button.
    // The job page shows the explanation.
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-pane-2 px-2 tabular-nums",
          cell.band === "high" ? "text-link" : "text-ink-sec"
        )}
        data-score={cell.band}
      >
        <span className="sr-only">{t("card.score")} </span>
        {cell.value}
        {cell.aiOff ? (
          <span className="type-micro">{t("card.aiOffShort")}</span>
        ) : null}
      </span>
    );
  }
  return (
    <Tooltip onOpenChange={setOpen} open={open}>
      <TooltipTrigger asChild>
        <button
          aria-label={t("inbox.score.label", { score: cell.value })}
          className={cn(
            "inline-flex h-5 items-center gap-2 rounded-full bg-pane-2 px-2 tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
            cell.band === "high" ? "text-link" : "text-ink-sec"
          )}
          data-score={cell.band}
          type="button"
        >
          <span className="min-w-5 text-right">{cell.value}</span>
          <span aria-hidden="true" className="relative h-1 w-10 bg-pane-3">
            <span
              className="absolute inset-y-0 left-0 bg-offgray"
              style={{ width: `${Math.max(4, cell.value)}%` }}
            />
          </span>
          {cell.aiOff ? (
            <span className="type-micro text-muted-foreground">
              {t("card.aiOffShort")}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent
        className="w-72 max-w-[calc(100vw-2rem)] flex-col items-stretch py-2"
        side="right"
      >
        <ScoreBreakdown
          load={open}
          postingId={item.posting.id}
          score={score}
          tone="inverse"
        />
      </TooltipContent>
    </Tooltip>
  );
}
