// The desktop board's drag and drop (12 §3, 06 §2): pointer (mouse, pen),
// touch (after a press, so scrolling stays free) and keyboard sensors (Space
// lifts and drops, arrows move — ←/→ across columns — Escape cancels), with
// screen-reader announcements. While a card is lifted a working copy of the
// columns follows it; a column it may not enter shows `not-allowed` and the
// "Can't move from … to …" caption, and dropping there snaps back. The
// column under the pointer decides where the card is (`board-collision.ts`),
// so a drop anywhere in a neighbouring column, its top included, moves it.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  Announcements,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { PointerEvent, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import type { BoardColumns, ClosedStage } from "@/lib/board-model";
import { BOARD_STAGES, findCard, moveCard } from "@/lib/board-model";
import { canMoveTo } from "@/lib/board-move";
import { stageLabel } from "@/lib/labels";
import { boardCollisionDetection } from "./board-collision";
import type { CardHandlers, ColumnState } from "./board-columns";
import { BoardColumn, COLUMN_PREFIX, ClosedLane } from "./board-columns";
import { moveSubject } from "./board-search";
import { CardView } from "./card-view";
import type { MoveRequest } from "./use-move-card";

/** Mouse and pen drag at once; touch is left to the TouchSensor. */
class MousePenSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: PointerEvent) =>
        nativeEvent.pointerType !== "touch" &&
        nativeEvent.isPrimary &&
        nativeEvent.button === 0,
    },
  ];
}

/**
 * Arrow keys while a card is lifted: ←/→ jump to the neighbouring column,
 * ↑/↓ move within the column (the sortable default).
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const horizontal =
    event.code === KeyboardCode.Left || event.code === KeyboardCode.Right;
  const { droppableRects, droppableContainers, collisionRect } = args.context;
  if (!(horizontal && collisionRect)) {
    return sortableKeyboardCoordinates(event, args);
  }
  const columns = droppableContainers
    .getEnabled()
    .filter((container) => String(container.id).startsWith(COLUMN_PREFIX))
    .map((container) => droppableRects.get(container.id))
    .filter((rect): rect is NonNullable<typeof rect> => rect !== undefined)
    .sort((a, b) => a.left - b.left);
  const centre = collisionRect.left + collisionRect.width / 2;
  const current = columns.findIndex(
    (rect) => centre >= rect.left && centre <= rect.left + rect.width
  );
  const next = columns[current + (event.code === KeyboardCode.Right ? 1 : -1)];
  if (!next) {
    return args.currentCoordinates;
  }
  event.preventDefault();
  return {
    x: next.left + (next.width - collisionRect.width) / 2,
    y: next.top + 8,
  };
};

function stageOfId(id: string, columns: BoardColumns): Stage | null {
  if (id.startsWith(COLUMN_PREFIX)) {
    return id.slice(COLUMN_PREFIX.length) as Stage;
  }
  return findCard(columns, id)?.stage ?? null;
}

interface DragState {
  /** The working copy of the columns while a card is lifted. */
  draft: BoardColumns | null;
  hover: { stage: Stage; legal: boolean } | null;
}

function announcementsFor(
  t: Translate,
  visible: BoardColumns,
  draft: BoardColumns | null,
  origin: BoardCard | null
): Announcements {
  const describe = (card: BoardCard) =>
    t("move.cardLabel", {
      company: card.posting.company_name,
      title: card.posting.title,
    });
  const originStage = stageLabel(t, origin?.stage ?? "saved");
  return {
    onDragStart: ({ active }) => {
      const card = findCard(visible, String(active.id));
      if (!card) {
        return;
      }
      const list = visible[card.stage];
      return t("dnd.pickedUp", {
        card: describe(card),
        stage: stageLabel(t, card.stage),
        index: list.findIndex((entry) => entry.id === card.id) + 1,
        total: list.length,
      });
    },
    onDragOver: ({ over }) => {
      const stage = over && draft ? stageOfId(String(over.id), draft) : null;
      if (!(stage && origin)) {
        return t("dnd.notOver");
      }
      return canMoveTo(origin.stage, stage)
        ? t("dnd.over", { stage: stageLabel(t, stage) })
        : t("move.illegal", {
            from: stageLabel(t, origin.stage),
            to: stageLabel(t, stage),
          });
    },
    onDragEnd: ({ over }) =>
      over ? t("dnd.dropped") : t("dnd.cancelled", { stage: originStage }),
    onDragCancel: () => t("dnd.cancelled", { stage: originStage }),
  };
}

/** Where a dropped card lands: its column after reordering, and neighbours. */
function dropPosition(working: BoardColumns, activeId: string, overId: string) {
  const moved = findCard(working, activeId);
  if (!moved) {
    return null;
  }
  let list = working[moved.stage];
  const from = list.findIndex((entry) => entry.id === moved.id);
  const to = list.findIndex((entry) => entry.id === overId);
  if (to !== -1 && to !== from) {
    list = arrayMove(list, from, to);
  }
  const index = list.findIndex((entry) => entry.id === moved.id);
  return { stage: moved.stage, list, index };
}

export interface DesktopBoardProps {
  announce: (message: string) => void;
  closedExpanded: boolean;
  closedFilter: ClosedStage | "both";
  empty: ReactNode;
  /** Filters are on: counts are the visible ones. */
  filtered: boolean;
  handlers: CardHandlers;
  nowMs: number;
  onClosedExpandedChange: (expanded: boolean) => void;
  onClosedFilterChange: (filter: ClosedStage | "both") => void;
  onDraggingChange: (dragging: boolean) => void;
  pendingIds: ReadonlySet<string>;
  requestMove: (request: MoveRequest) => void;
  selectedIds: ReadonlySet<string>;
  totals: Record<Stage, number>;
  visible: BoardColumns;
}

export function DesktopBoard(props: DesktopBoardProps) {
  const { t } = useTranslation();
  const { visible, announce, requestMove, totals } = props;
  const [drag, setDrag] = useState<DragState>({ draft: null, hover: null });
  const [activeId, setActiveId] = useState<string | null>(null);
  const origin = useRef<BoardCard | null>(null);
  const shown = drag.draft ?? visible;

  const sensors = useSensors(
    useSensor(MousePenSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space],
      },
    })
  );

  const announcements = useMemo(
    () => announcementsFor(t, visible, drag.draft, origin.current),
    [t, visible, drag.draft]
  );

  function onDragStart({ active }: DragStartEvent) {
    origin.current = findCard(visible, String(active.id));
    setActiveId(String(active.id));
    setDrag({ draft: visible, hover: null });
    props.onDraggingChange(true);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    const draft = drag.draft;
    const stage = over && draft ? stageOfId(String(over.id), draft) : null;
    const card = draft ? findCard(draft, String(active.id)) : null;
    if (!(draft && stage && card && origin.current && over)) {
      setDrag((current) => ({ ...current, hover: null }));
      return;
    }
    const legal = canMoveTo(origin.current.stage, stage);
    if (!legal || card.stage === stage) {
      setDrag({ draft, hover: { stage, legal } });
      return;
    }
    const overIndex = draft[stage].findIndex((entry) => entry.id === over.id);
    setDrag({
      draft: moveCard(
        draft,
        card.id,
        stage,
        overIndex === -1 ? draft[stage].length : overIndex
      ),
      hover: { stage, legal },
    });
  }

  function endDrag() {
    setActiveId(null);
    setDrag({ draft: null, hover: null });
    props.onDraggingChange(false);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const { draft, hover } = drag;
    const original = origin.current;
    endDrag();
    if (!(over && draft && original)) {
      return;
    }
    if (hover && !hover.legal) {
      const text = t("move.illegal", {
        from: stageLabel(t, original.stage),
        to: stageLabel(t, hover.stage),
      });
      announce(text);
      toast.error(text);
      return;
    }
    const drop = dropPosition(draft, String(active.id), String(over.id));
    if (!drop) {
      return;
    }
    const ids = drop.list.map((entry) => entry.id).join();
    if (
      drop.stage === original.stage &&
      visible[original.stage].map((entry) => entry.id).join() === ids
    ) {
      return;
    }
    requestMove({
      card: moveSubject(original),
      target: drop.stage,
      beforeId: drop.list[drop.index - 1]?.id ?? null,
      afterId: drop.list[drop.index + 1]?.id ?? null,
      position: { index: drop.index + 1, total: drop.list.length },
    });
  }

  const stateFor = (stage: Stage): ColumnState => {
    const hover = drag.hover;
    if (!(hover && hover.stage === stage && origin.current)) {
      return {};
    }
    return hover.legal
      ? { over: true }
      : { over: true, illegalFrom: origin.current.stage };
  };
  const activeCard = activeId ? findCard(shown, activeId) : null;
  const common = {
    dragDisabled: false,
    handlers: props.handlers,
    nowMs: props.nowMs,
    pendingIds: props.pendingIds,
    selectedIds: props.selectedIds,
  };

  return (
    <DndContext
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("dnd.instructions") },
      }}
      collisionDetection={boardCollisionDetection}
      onDragCancel={endDrag}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      sensors={sensors}
    >
      <div
        className="flex min-h-0 flex-1 overflow-x-auto"
        data-testid="board-columns"
      >
        {BOARD_STAGES.map((stage) => (
          <BoardColumn
            {...common}
            cards={shown[stage]}
            empty={stage === "saved" ? props.empty : null}
            key={stage}
            stage={stage}
            state={stateFor(stage)}
            total={props.filtered ? shown[stage].length : totals[stage]}
          />
        ))}
        <ClosedLane
          {...common}
          columns={{ rejected: shown.rejected, withdrawn: shown.withdrawn }}
          expanded={props.closedExpanded}
          filter={props.closedFilter}
          onExpandedChange={props.onClosedExpandedChange}
          onFilterChange={props.onClosedFilterChange}
          states={{
            rejected: stateFor("rejected"),
            withdrawn: stateFor("withdrawn"),
          }}
          totals={{ rejected: totals.rejected, withdrawn: totals.withdrawn }}
        />
      </div>
      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <CardView
            card={activeCard}
            className="w-56 shadow-float"
            nowMs={props.nowMs}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
