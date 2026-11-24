// The desktop board's lanes (12 §3, reui's kanban board): rounded lanes on
// `card/50` with a hairline, a header row (stage glyph, name, count, the
// lane menu), sortable cards (@dnd-kit) and collapsible lanes. A collapsed
// lane is a narrow vertical strip (reui's "Blocked / Reviewing") that is
// still a drop target; Rejected and Withdrawn start collapsed (06 §1.1).

import type { DropState } from "@rulisme/ui/blocks/kanban";
import {
  KanbanCollapsedColumn,
  KanbanColumn,
  KanbanColumnContent,
  KanbanColumnEmpty,
  KanbanColumnHeader,
} from "@rulisme/ui/blocks/kanban";
import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CalendarClock,
  CircleSlash,
  CircleX,
  Ellipsis,
  FoldHorizontal,
  ListChecks,
  Maximize2,
  Minus,
  PanelRight,
  SquareCheck,
} from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useTranslation } from "@/i18n";
import { stageLabel } from "@/lib/labels";
import { CardView } from "./card-view";
import { StageIcon } from "./stage-meta";

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
  | "openPage"
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

export function CardMenu({
  card,
  onAction,
  className,
  bordered = false,
}: {
  card: BoardCard;
  onAction: (action: CardMenuAction) => void;
  className?: string;
  /** A 28px ghost icon button for list and table rows whose outline shows
   * only while its row (`group/row`) is hovered or holds focus, or while
   * the menu is open; the default is the 24px ghost of the cards. */
  bordered?: boolean;
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
          className={cn(
            "text-muted-foreground hover:text-foreground",
            bordered &&
              "border-transparent focus-visible:border-input group-focus-within/row:border-border group-hover/row:border-border aria-expanded:border-input",
            className
          )}
          size={bordered ? "icon-sm" : "icon-xs"}
          variant="ghost"
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onAction("open")}>
          <PanelRight aria-hidden="true" />
          {t("card.actions.open")}
          <DropdownMenuShortcut>↵</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("openPage")}>
          <Maximize2 aria-hidden="true" />
          {t("board.openFullPage")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("move")}>
          <ArrowRightLeft aria-hidden="true" />
          {t("card.actions.move")}
          <DropdownMenuShortcut>M</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("select")}>
          <SquareCheck aria-hidden="true" />
          {t("card.actions.select")}
          <DropdownMenuShortcut>X</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("followUp")}>
          <CalendarClock aria-hidden="true" />
          {t("card.actions.followUp")}
          <DropdownMenuShortcut>F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAction("priorityHigh")}>
          <ArrowUp aria-hidden="true" />
          {t("card.actions.priorityHigh")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("priorityNormal")}>
          <Minus aria-hidden="true" />
          {t("card.actions.priorityNormal")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("priorityLow")}>
          <ArrowDown aria-hidden="true" />
          {t("card.actions.priorityLow")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onAction(card.archived ? "unarchive" : "archive")}
        >
          {card.archived ? (
            <ArchiveRestore aria-hidden="true" />
          ) : (
            <Archive aria-hidden="true" />
          )}
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
          <CircleX aria-hidden="true" />
          {t("card.actions.reject")}
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onAction("withdraw")}
          variant="destructive"
        >
          <CircleSlash aria-hidden="true" />
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
          "cursor-grab rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 active:cursor-grabbing",
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
          nowMs={nowMs}
          pending={pending}
          selected={selected}
        />
      </div>
      <CardMenu
        card={card}
        className="absolute top-3 right-3"
        onAction={(action) => handlers.onMenuAction(card, action)}
      />
    </li>
  );
}

/** The drop highlight a lane shows for its state. */
function dropState(state: ColumnState): DropState {
  if (state.illegalFrom) {
    return "blocked";
  }
  return state.over ? "over" : "idle";
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
  footer,
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
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const droppable = useDroppable({
    id: columnId(stage),
    data: { type: "column", stage },
  });
  return (
    <KanbanColumnContent ref={droppable.setNodeRef} state={dropState(state)}>
      {state.illegalFrom ? (
        <p className="type-caption px-1 text-destructive" role="status">
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
        <ul aria-label={stageLabel(t, stage)} className="flex flex-col gap-3">
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
      {cards.length === 0
        ? (empty ?? (
            <KanbanColumnEmpty>{t("board.emptyColumn")}</KanbanColumnEmpty>
          ))
        : null}
      {footer}
    </KanbanColumnContent>
  );
}

function LaneMenu({
  stage,
  count,
  onSelectAll,
  onCollapse,
}: {
  stage: Stage;
  count: number;
  onSelectAll: () => void;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("board.lane.menu", { stage: stageLabel(t, stage) })}
          className="text-muted-foreground hover:text-foreground"
          size="icon-xs"
          variant="ghost"
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={count === 0} onSelect={onSelectAll}>
          <ListChecks aria-hidden="true" />
          {t("board.lane.selectAll")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCollapse}>
          <FoldHorizontal aria-hidden="true" />
          {t("board.lane.collapse")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ColumnProps {
  cards: BoardCard[];
  dragDisabled: boolean;
  empty?: ReactNode;
  handlers: CardHandlers;
  nowMs: number;
  onCollapse: () => void;
  onSelectAll: () => void;
  pendingIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  stage: Stage;
  state: ColumnState;
  /** The server's total; more than `cards` when a closed lane is capped. */
  total: number;
  /** Filters are on: the count is the visible cards. */
  filtered: boolean;
}

export function BoardColumn(props: ColumnProps) {
  const { t } = useTranslation();
  const { stage, total, cards, filtered } = props;
  const count = filtered ? cards.length : total;
  const capped = !filtered && total > cards.length;
  return (
    <KanbanColumn aria-labelledby={`column-${stage}`}>
      <KanbanColumnHeader
        actions={
          <LaneMenu
            count={cards.length}
            onCollapse={props.onCollapse}
            onSelectAll={props.onSelectAll}
            stage={stage}
          />
        }
        count={count}
        countLabel={t("board.countLabel", { count })}
        icon={<StageIcon stage={stage} />}
        title={stageLabel(t, stage)}
        titleId={`column-${stage}`}
      />
      <ColumnBody
        {...props}
        footer={
          capped ? (
            <p className="type-caption px-1 pt-1 text-muted-foreground">
              {t("board.capped", { shown: cards.length, total })}
            </p>
          ) : null
        }
      />
    </KanbanColumn>
  );
}

/** A collapsed lane: a narrow vertical strip that expands on click and still
 * takes drops (dropping on Rejected keeps it collapsed). */
export function CollapsedLane({
  stage,
  count,
  state,
  onExpand,
}: {
  stage: Stage;
  count: number;
  state: ColumnState;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const droppable = useDroppable({
    id: columnId(stage),
    data: { type: "column", stage },
  });
  return (
    <KanbanCollapsedColumn
      aria-label={stageLabel(t, stage)}
      count={count}
      expandLabel={t("board.lane.expand", {
        stage: stageLabel(t, stage),
        count,
      })}
      icon={<StageIcon stage={stage} />}
      onExpand={onExpand}
      ref={droppable.setNodeRef}
      state={dropState(state)}
      title={stageLabel(t, stage)}
    >
      {state.illegalFrom ? (
        <span className="sr-only" role="status">
          {t("move.illegalShort")}
        </span>
      ) : null}
    </KanbanCollapsedColumn>
  );
}
