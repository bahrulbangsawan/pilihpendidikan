// The desktop board (12 §3): one ruled band of columns with a diamond where
// each column rule meets the band rule, sortable cards (@dnd-kit) and the
// Closed lane, collapsed by default, that still offers Rejected and Withdrawn
// as separate drop targets (06 §1.1).

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { cn } from "@rulisme/ui/lib/utils";
import { Diamond } from "@rulisme/ui/ui/rails";
import { ToggleGroup, ToggleGroupItem } from "@rulisme/ui/ui/toggle-group";
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useTranslation } from "@/i18n";
import type { ClosedStage } from "@/lib/board-model";
import { stageLabel } from "@/lib/labels";
import { CardView } from "./card-view";

export const COLUMN_PREFIX = "column:";
export const columnId = (stage: Stage) => `${COLUMN_PREFIX}${stage}`;

export interface CardHandlers {
  onCardClick: (card: BoardCard, event: MouseEvent) => void;
  onCardFocus: (card: BoardCard) => void;
  onCardKeyDown: (
    card: BoardCard,
    event: KeyboardEvent<HTMLElement>
  ) => boolean;
  onMenuAction: (card: BoardCard, action: CardMenuAction) => void;
}

export type CardMenuAction =
  | "open"
  | "move"
  | "reject"
  | "withdraw"
  | "archive"
  | "unarchive"
  | "followUp"
  | "select"
  | "priorityHigh"
  | "priorityNormal"
  | "priorityLow";

function CardMenu({
  card,
  onAction,
}: {
  card: BoardCard;
  onAction: (action: CardMenuAction) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("card.menu", {
            company: card.posting.company_name,
            title: card.posting.title,
          })}
          className="absolute top-1.5 right-1.5 opacity-60 hover:opacity-100 focus-visible:opacity-100"
          size="icon-xs"
          variant="ghost"
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onAction("open")}>
          {t("card.actions.open")}
          <DropdownMenuShortcut>↵</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("move")}>
          {t("card.actions.move")}
          <DropdownMenuShortcut>M</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("select")}>
          {t("card.actions.select")}
          <DropdownMenuShortcut>X</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("followUp")}>
          {t("card.actions.followUp")}
          <DropdownMenuShortcut>F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAction("priorityHigh")}>
          {t("card.actions.priorityHigh")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("priorityNormal")}>
          {t("card.actions.priorityNormal")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("priorityLow")}>
          {t("card.actions.priorityLow")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onAction(card.archived ? "unarchive" : "archive")}
        >
          {card.archived
            ? t("card.actions.unarchive")
            : t("card.actions.archive")}
          {card.archived ? null : (
            <DropdownMenuShortcut>E</DropdownMenuShortcut>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onAction("reject")}
          variant="destructive"
        >
          {t("card.actions.reject")}
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onAction("withdraw")}
          variant="destructive"
        >
          {t("card.actions.withdraw")}
          <DropdownMenuShortcut>W</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SortableCard({
  card,
  handlers,
  nowMs,
  pending,
  selected,
  disabled,
}: {
  card: BoardCard;
  handlers: CardHandlers;
  nowMs: number;
  pending: boolean;
  selected: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const sortable = useSortable({
    id: card.id,
    data: { type: "card", stage: card.stage },
    disabled,
  });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };
  const listeners = sortable.listeners ?? {};
  return (
    <li className="relative" ref={sortable.setNodeRef} style={style}>
      {/* biome-ignore lint/a11y/useSemanticElements: the dnd-kit sortable handle wraps block content (a <button> may only hold phrasing content); it is a focusable role=button with Enter/Space handling. */}
      <div
        {...sortable.attributes}
        {...listeners}
        aria-busy={pending || undefined}
        aria-keyshortcuts="Enter M X F E R W"
        aria-label={t("card.label", {
          company: card.posting.company_name,
          title: card.posting.title,
          stage: stageLabel(t, card.stage),
        })}
        className={cn(
          "cursor-grab rounded-none outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 active:cursor-grabbing",
          sortable.isDragging && "opacity-40"
        )}
        data-card-id={card.id}
        data-stage={card.stage}
        onClick={(event) => handlers.onCardClick(card, event)}
        onFocus={() => handlers.onCardFocus(card)}
        onKeyDown={(event) => {
          if (!sortable.isDragging && handlers.onCardKeyDown(card, event)) {
            return;
          }
          listeners.onKeyDown?.(event);
        }}
        role="button"
        tabIndex={0}
      >
        <CardView
          card={card}
          className="pr-8"
          nowMs={nowMs}
          pending={pending}
          selected={selected}
        />
      </div>
      <CardMenu
        card={card}
        onAction={(action) => handlers.onMenuAction(card, action)}
      />
    </li>
  );
}

export interface ColumnState {
  /** Hovered while dragging a card that may not go here. */
  illegalFrom?: Stage;
  over?: boolean;
}

function ColumnBody({
  stage,
  cards,
  handlers,
  nowMs,
  pendingIds,
  selectedIds,
  state,
  dragDisabled,
  empty,
  className,
}: {
  stage: Stage;
  cards: BoardCard[];
  handlers: CardHandlers;
  nowMs: number;
  pendingIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  state: ColumnState;
  dragDisabled: boolean;
  empty?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const droppable = useDroppable({
    id: columnId(stage),
    data: { type: "column", stage },
  });
  return (
    <div
      className={cn(
        "flex min-h-32 flex-1 flex-col gap-2 p-2",
        state.over && !state.illegalFrom && "bg-wash",
        state.illegalFrom && "cursor-not-allowed bg-destructive/5",
        className
      )}
      ref={droppable.setNodeRef}
    >
      {state.illegalFrom ? (
        <p className="type-caption text-destructive" role="status">
          {t("move.illegal", {
            from: stageLabel(t, state.illegalFrom),
            to: stageLabel(t, stage),
          })}
        </p>
      ) : null}
      <SortableContext
        items={cards.map((card) => card.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul aria-label={stageLabel(t, stage)} className="flex flex-col gap-2">
          {cards.map((card) => (
            <SortableCard
              card={card}
              disabled={dragDisabled}
              handlers={handlers}
              key={card.id}
              nowMs={nowMs}
              pending={pendingIds.has(card.id)}
              selected={selectedIds.has(card.id)}
            />
          ))}
        </ul>
      </SortableContext>
      {cards.length === 0 ? empty : null}
    </div>
  );
}

export interface ColumnProps {
  cards: BoardCard[];
  dragDisabled: boolean;
  empty?: ReactNode;
  handlers: CardHandlers;
  nowMs: number;
  pendingIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  stage: Stage;
  state: ColumnState;
  total: number;
}

export function BoardColumn(props: ColumnProps) {
  const { t } = useTranslation();
  const { stage, total } = props;
  return (
    <section
      aria-labelledby={`column-${stage}`}
      className="relative flex w-60 shrink-0 flex-col border-line border-r"
    >
      <Diamond className="-top-1 -right-1" />
      <header className="band flex h-10 items-center justify-between gap-2 px-3">
        <h2 className="type-subtitle weight-semibold" id={`column-${stage}`}>
          {stageLabel(t, stage)}
        </h2>
        <span className="type-micro text-muted-foreground tabular-nums">
          <span className="sr-only">
            {t("board.countLabel", { count: total })}
          </span>
          <span aria-hidden="true">{total}</span>
        </span>
      </header>
      <ColumnBody {...props} />
    </section>
  );
}

export function ClosedLane({
  expanded,
  onExpandedChange,
  filter,
  onFilterChange,
  columns,
  totals,
  states,
  handlers,
  nowMs,
  pendingIds,
  selectedIds,
  dragDisabled,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  filter: ClosedStage | "both";
  onFilterChange: (filter: ClosedStage | "both") => void;
  columns: Record<ClosedStage, BoardCard[]>;
  totals: Record<ClosedStage, number>;
  states: Record<ClosedStage, ColumnState>;
  handlers: CardHandlers;
  nowMs: number;
  pendingIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  dragDisabled: boolean;
}) {
  const { t } = useTranslation();
  const stages: ClosedStage[] =
    filter === "both" ? ["rejected", "withdrawn"] : [filter];
  if (!expanded) {
    return (
      <section
        aria-label={t("board.closed")}
        className="relative flex w-28 shrink-0 flex-col border-line border-r"
      >
        <Diamond className="-top-1 -right-1" />
        <header className="band flex h-10 items-center px-1">
          <Button
            aria-expanded={false}
            className="w-full justify-between px-2"
            onClick={() => onExpandedChange(true)}
            size="sm"
            variant="ghost"
          >
            <span className="weight-semibold">{t("board.closed")}</span>
            <ChevronRight aria-hidden="true" />
          </Button>
        </header>
        {(["rejected", "withdrawn"] as const).map((stage) => (
          <CollapsedTarget
            key={stage}
            stage={stage}
            state={states[stage]}
            total={totals[stage]}
          />
        ))}
      </section>
    );
  }
  return (
    <section
      aria-label={t("board.closed")}
      className="relative flex w-60 shrink-0 flex-col border-line border-r"
    >
      <Diamond className="-top-1 -right-1" />
      <header className="band flex h-10 items-center justify-between gap-1 px-1">
        <Button
          aria-expanded
          className="px-2"
          onClick={() => onExpandedChange(false)}
          size="sm"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" />
          <span className="weight-semibold">{t("board.closed")}</span>
        </Button>
        <ToggleGroup
          aria-label={t("board.closedFilter")}
          onValueChange={(value) =>
            value && onFilterChange(value as ClosedStage | "both")
          }
          size="sm"
          type="single"
          value={filter}
        >
          <ToggleGroupItem value="both">
            {t("board.closedBoth")}
          </ToggleGroupItem>
          <ToggleGroupItem value="rejected">
            {stageLabel(t, "rejected")}
          </ToggleGroupItem>
          <ToggleGroupItem value="withdrawn">
            {stageLabel(t, "withdrawn")}
          </ToggleGroupItem>
        </ToggleGroup>
      </header>
      {stages.map((stage) => (
        <div
          className="flex flex-col border-line border-b last:border-b-0"
          key={stage}
        >
          <h3 className="type-caption flex items-center justify-between px-3 pt-2 text-muted-foreground">
            {stageLabel(t, stage)}
            <span className="type-micro tabular-nums">{totals[stage]}</span>
          </h3>
          <ColumnBody
            cards={columns[stage]}
            dragDisabled={dragDisabled}
            handlers={handlers}
            nowMs={nowMs}
            pendingIds={pendingIds}
            selectedIds={selectedIds}
            stage={stage}
            state={states[stage]}
          />
          {totals[stage] > columns[stage].length ? (
            <p className="type-micro px-3 pb-2 text-muted-foreground">
              {t("board.capped", {
                shown: columns[stage].length,
                total: totals[stage],
              })}
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function CollapsedTarget({
  stage,
  state,
  total,
}: {
  stage: ClosedStage;
  state: ColumnState;
  total: number;
}) {
  const { t } = useTranslation();
  const droppable = useDroppable({
    id: columnId(stage),
    data: { type: "column", stage },
  });
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-1 border-line border-b p-2 last:border-b-0",
        state.over && !state.illegalFrom && "bg-wash",
        state.illegalFrom && "cursor-not-allowed bg-destructive/5"
      )}
      ref={droppable.setNodeRef}
    >
      <span className="type-caption text-foreground">
        {stageLabel(t, stage)}
      </span>
      <span className="type-micro text-muted-foreground tabular-nums">
        {total}
      </span>
      {state.illegalFrom ? (
        <span className="type-micro text-destructive" role="status">
          {t("move.illegalShort")}
        </span>
      ) : null}
    </div>
  );
}
