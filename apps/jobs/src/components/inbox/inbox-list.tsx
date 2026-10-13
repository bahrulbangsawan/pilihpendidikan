// The inbox on phones (12 §4): stacked rows — title, company, score badge —
// that open the job on tap. Pressing and holding a row (500 ms) enters the
// selection mode: rows show checkboxes and a tap toggles them, until "Done".

import type { InboxItem } from "@pilihpendidikan/jobs-contracts/api";
import { cn } from "@rulisme/ui/lib/utils";
import { Check } from "lucide-react";
import type { MouseEvent, PointerEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "@/i18n";
import { compactAge } from "@/lib/format";
import { listingCount } from "@/lib/inbox-state";
import type { InboxRowsProps } from "./inbox-table";
import { ScoreCellView } from "./score-cell";

/** How long a press must be held to start selecting (12 §4 long-press). */
export const LONG_PRESS_MS = 500;
/** Moving the finger further than this cancels the press (a scroll). */
const MOVE_TOLERANCE_PX = 10;

interface PressState {
  fired: boolean;
  timer: number | null;
  x: number;
  y: number;
}

/**
 * Pointer handlers that call `onLongPress` after LONG_PRESS_MS without
 * movement, and swallow the click that follows a long press.
 */
export function useLongPress(onLongPress: () => void) {
  const press = useRef<PressState>({ fired: false, timer: null, x: 0, y: 0 });
  const callback = useRef(onLongPress);
  useLayoutEffect(() => {
    callback.current = onLongPress;
  });

  const cancel = useCallback(() => {
    if (press.current.timer !== null) {
      window.clearTimeout(press.current.timer);
      press.current.timer = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      cancel();
      press.current = {
        fired: false,
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
          press.current.fired = true;
          press.current.timer = null;
          callback.current();
        }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (event: PointerEvent) => {
      const moved =
        Math.abs(event.clientX - press.current.x) > MOVE_TOLERANCE_PX ||
        Math.abs(event.clientY - press.current.y) > MOVE_TOLERANCE_PX;
      if (moved) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    /** True once for the click that ends a long press. */
    consumeLongPress: () => {
      const fired = press.current.fired;
      press.current.fired = false;
      return fired;
    },
  };
}

function PhoneRow({
  item,
  isSelected,
  isFocused,
  selecting,
  nowMs,
  onActivate,
  onLongPress,
  rowRef,
  onFocusRow,
}: {
  item: InboxItem;
  isFocused: boolean;
  isSelected: boolean;
  nowMs: number;
  onActivate: (event: MouseEvent) => void;
  onFocusRow: () => void;
  onLongPress: () => void;
  rowRef: (element: HTMLElement | null) => void;
  selecting: boolean;
}) {
  const { t } = useTranslation();
  const press = useLongPress(onLongPress);
  const id = item.user_job.id;
  const listings = listingCount(item);
  return (
    <li className="border-line border-b">
      <a
        aria-current={isFocused ? "true" : undefined}
        className={cn(
          "flex min-h-14 items-start gap-3 px-4 py-2.5 outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
          isSelected && "bg-pane-2",
          isFocused && !isSelected && "bg-pane/40"
        )}
        data-row-id={id}
        data-state={isSelected ? "selected" : undefined}
        href={`/jobs/${encodeURIComponent(id)}`}
        onClick={(event) => {
          if (press.consumeLongPress()) {
            event.preventDefault();
            return;
          }
          onActivate(event);
        }}
        onContextMenu={(event) => event.preventDefault()}
        onFocus={onFocusRow}
        onPointerCancel={press.onPointerCancel}
        onPointerDown={press.onPointerDown}
        onPointerLeave={press.onPointerLeave}
        onPointerMove={press.onPointerMove}
        onPointerUp={press.onPointerUp}
        ref={rowRef}
        tabIndex={isFocused ? 0 : -1}
      >
        {selecting ? (
          // A picture of a checkbox: the whole row is the control (a real
          // checkbox inside a link would nest two interactive elements).
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border",
              isSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-card"
            )}
          >
            {isSelected ? <Check className="size-3" /> : null}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "type-body-compact line-clamp-2 text-foreground",
              isSelected && "weight-semibold"
            )}
          >
            {item.posting.title}
          </span>
          <span className="type-caption truncate text-muted-foreground">
            {item.posting.company_name}
            {item.posting.locations[0]
              ? ` · ${item.posting.locations[0].raw}`
              : ""}
          </span>
          <span className="type-micro text-muted-foreground">
            {compactAge(item.user_job.created_at, nowMs)}
            {listings > 1
              ? ` · ${t("inbox.listings", { count: listings })}`
              : ""}
          </span>
        </span>
        <span className="type-caption shrink-0 pt-0.5">
          <ScoreCellView compact item={item} />
        </span>
        {selecting ? (
          <span className="sr-only">
            {isSelected ? t("inbox.selected") : t("inbox.notSelected")}
          </span>
        ) : null}
      </a>
    </li>
  );
}

export function InboxList({
  items,
  selected,
  focusedId,
  nowMs,
  selecting,
  onStartSelecting,
  onToggleSelect,
  onFocusRow,
  onOpen,
  rowRef,
}: Omit<InboxRowsProps, "expanded" | "onToggleExpand" | "onMoveFocus"> & {
  onStartSelecting: (id: string) => void;
  selecting: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul aria-label={t("inbox.listLabel")} className="flex flex-col">
      {items.map((item) => {
        const id = item.user_job.id;
        return (
          <PhoneRow
            isFocused={focusedId === id}
            isSelected={selected.has(id)}
            item={item}
            key={id}
            nowMs={nowMs}
            onActivate={(event) => {
              if (selecting) {
                event.preventDefault();
                onToggleSelect(id, !selected.has(id));
                return;
              }
              onOpen(item, event);
            }}
            onFocusRow={() => onFocusRow(id)}
            onLongPress={() => onStartSelecting(id)}
            rowRef={(element) => rowRef(id, element)}
            selecting={selecting}
          />
        );
      })}
    </ul>
  );
}
