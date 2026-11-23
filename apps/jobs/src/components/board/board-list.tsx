// The List view (`?view=list`, reui's grouped lists): one collapsible group
// per stage, one row per application — company avatar, role and company,
// location, the score meter, the stage chip and the age. Rows answer the
// same clicks and keys as board cards (use-card-handlers.ts).

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { cn } from "@rulisme/ui/lib/utils";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "@/i18n";
import type { BoardColumns } from "@/lib/board-model";
import { BOARD_STAGES, CLOSED_STAGES } from "@/lib/board-model";
import { compactAge } from "@/lib/format";
import { stageLabel } from "@/lib/labels";
import type { CardHandlers } from "./board-columns";
import { CardMenu } from "./board-columns";
import { ScoreMeter, useLocationLine } from "./card-view";
import { EntityAvatar } from "@rulisme/ui/ui/entity-avatar";
import { StageDot, StageIcon } from "./stage-meta";

/** The stage as a neutral chip with its dot. */
export function StageBadge({ stage }: { stage: Stage }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline">
      <StageDot stage={stage} />
      {stageLabel(t, stage)}
    </Badge>
  );
}

function ListRow({
  card,
  handlers,
  nowMs,
  pending,
  selected,
}: {
  card: BoardCard;
  handlers: CardHandlers;
  nowMs: number;
  pending: boolean;
  selected: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocationLine(card.posting);
  return (
    <li className="relative">
      <Button
        aria-busy={pending || undefined}
        aria-keyshortcuts="Enter M X F E R W"
        aria-label={t("card.label", {
          company: card.posting.company_name,
          title: card.posting.title,
          stage: stageLabel(t, card.stage),
        })}
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center justify-stretch gap-3 rounded-none py-3 pr-12! pl-3! focus-visible:outline-offset-[-2px] md:grid-cols-[auto_minmax(0,1fr)_7rem_8rem_3rem]",
          selected && "bg-pane-2 hover:bg-pane-2",
          pending && "opacity-70"
        )}
        data-card-id={card.id}
        data-stage={card.stage}
        onClick={(event) => handlers.onCardClick(card, event)}
        onFocus={() => handlers.onCardFocus(card)}
        onKeyDown={(event) => handlers.onCardKeyDown(card, event)}
        variant="row"
      >
        <EntityAvatar name={card.posting.company_name} />
        <span className="flex min-w-0 flex-col">
          <span className="type-body weight-semibold truncate text-foreground">
            {card.posting.title}
          </span>
          <span className="type-caption truncate text-muted-foreground">
            {[card.posting.company_name, location].filter(Boolean).join(" · ")}
          </span>
        </span>
        <ScoreMeter
          className="hidden md:flex"
          label={false}
          score={card.score}
        />
        <span className="hidden md:flex">
          <StageBadge stage={card.stage} />
        </span>
        <span
          className="type-caption text-right text-muted-foreground tabular-nums"
          title={t("card.updated", { age: compactAge(card.updated_at, nowMs) })}
        >
          {compactAge(card.updated_at, nowMs)}
        </span>
      </Button>
      <CardMenu
        card={card}
        className="absolute top-1/2 right-3 -translate-y-1/2"
        onAction={(action) => handlers.onMenuAction(card, action)}
      />
    </li>
  );
}

function ListGroup({
  stage,
  count,
  expanded,
  onExpandedChange,
  children,
}: {
  stage: Stage;
  count: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const headingId = `list-${stage}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 className="type-body" id={headingId}>
        <Button
          aria-expanded={expanded}
          className="h-8 w-full justify-start gap-2 rounded-lg px-1"
          onClick={() => onExpandedChange(!expanded)}
          variant="row"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              expanded && "rotate-90"
            )}
          />
          <StageIcon stage={stage} />
          <span className="weight-semibold text-foreground">
            {stageLabel(t, stage)}
          </span>
          <Badge className="tabular-nums" variant="secondary">
            <span className="sr-only">{t("board.countLabel", { count })}</span>
            <span aria-hidden="true">{count}</span>
          </Badge>
        </Button>
      </h2>
      {expanded ? children : null}
    </section>
  );
}

export function BoardList({
  visible,
  totals,
  filtered,
  collapsed,
  onCollapsedChange,
  handlers,
  nowMs,
  pendingIds,
  selectedIds,
  empty,
}: {
  visible: BoardColumns;
  totals: Record<Stage, number>;
  filtered: boolean;
  collapsed: ReadonlySet<Stage>;
  onCollapsedChange: (stage: Stage, collapsed: boolean) => void;
  handlers: CardHandlers;
  nowMs: number;
  pendingIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  empty: ReactNode;
}) {
  const { t } = useTranslation();
  const stages: Stage[] = [...BOARD_STAGES, ...CLOSED_STAGES];
  const shown = stages.filter(
    (stage) => visible[stage].length > 0 || !filtered
  );
  return (
    <div className="flex flex-col gap-5 px-4 pb-8 sm:px-6 lg:px-8">
      {empty}
      {shown.map((stage) => {
        const cards = visible[stage];
        return (
          <ListGroup
            count={filtered ? cards.length : totals[stage]}
            expanded={!collapsed.has(stage)}
            key={stage}
            onExpandedChange={(open) => onCollapsedChange(stage, !open)}
            stage={stage}
          >
            {cards.length === 0 ? (
              <p className="type-caption rounded-lg border border-hairline border-dashed px-3 py-4 text-muted-foreground">
                {t("board.emptyColumn")}
              </p>
            ) : (
              <ul
                aria-label={stageLabel(t, stage)}
                className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
              >
                {cards.map((card) => (
                  <ListRow
                    card={card}
                    handlers={handlers}
                    key={card.id}
                    nowMs={nowMs}
                    pending={pendingIds.has(card.id)}
                    selected={selectedIds.has(card.id)}
                  />
                ))}
              </ul>
            )}
          </ListGroup>
        );
      })}
    </div>
  );
}
