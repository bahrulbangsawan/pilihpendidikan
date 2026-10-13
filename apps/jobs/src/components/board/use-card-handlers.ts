// Everything a card responds to (06 §10, 12 §2.2): click and Shift/⌘-click,
// the focused card's keys (arrows, Enter, M, 1–7, R, W, E, X, F), its ⋯ menu,
// and the board-wide J / K / M shortcuts. Moves go through useMoveCard.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { useNavigate } from "@tanstack/react-router";
import type { KeyboardEvent, MouseEvent } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { FollowUpTarget } from "@/components/follow-up-dialog";
import { useApplicationPatch } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import type { BoardColumns } from "@/lib/board-model";
import { findCard } from "@/lib/board-model";
import type { CardKeyAction } from "@/lib/shortcuts";
import { CARD_KEYS, cardKeyAction } from "@/lib/shortcuts";
import type { CardHandlers, CardMenuAction } from "./board-columns";
import { moveSubject } from "./board-search";
import type { MoveRequest } from "./use-move-card";

function focusCard(cardId: string | undefined) {
  if (cardId) {
    document
      .querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`)
      ?.focus();
  }
}

export interface CardHandlerOptions {
  announce: (message: string) => void;
  /** Every card (for the picker and M). */
  columns: BoardColumns | null;
  /** Shortcuts pause while a card is lifted or on phones. */
  keysEnabled: boolean;
  /** Visible cards in reading order (column by column). */
  order: readonly BoardCard[];
  requestMove: (request: MoveRequest) => void;
}

export function useCardHandlers({
  announce,
  columns,
  keysEnabled,
  order,
  requestMove,
}: CardHandlerOptions) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const patch = useApplicationPatch();
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [pickerCard, setPickerCard] = useState<BoardCard | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<FollowUpTarget | null>(
    null
  );
  const focusedId = useRef<string | null>(null);

  const toggleSelected = useCallback((cardId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, []);

  const openCard = useCallback(
    (card: BoardCard) =>
      navigate({ to: "/applications/$appId", params: { appId: card.id } }),
    [navigate]
  );

  /** `1`–`7`, R, W and the menu: to the bottom of the target column. */
  const moveTo = useCallback(
    (card: BoardCard, target: Stage) => {
      const others = (columns?.[target] ?? []).filter(
        (entry) => entry.id !== card.id
      );
      requestMove({
        card: moveSubject(card),
        target,
        beforeId: others.at(-1)?.id ?? null,
        afterId: null,
        position: { index: others.length + 1, total: others.length + 1 },
      });
    },
    [columns, requestMove]
  );

  const archive = useCallback(
    async (card: BoardCard, archived: boolean) => {
      const outcome = await patch(card, { archived }, t("card.what"));
      if (outcome?.kind !== "saved") {
        return;
      }
      const message = archived
        ? t("card.archivedToast")
        : t("card.unarchivedToast");
      announce(message);
      toast.success(message, {
        action: archived
          ? {
              label: t("common.undo"),
              onClick: () => patch(outcome.record, { archived: false }),
            }
          : undefined,
      });
    },
    [announce, patch, t]
  );

  const openFollowUp = useCallback((card: BoardCard) => {
    setFollowUpTarget({
      company: card.posting.company_name,
      title: card.posting.title,
      record: card,
    });
  }, []);

  const stepFocus = useCallback(
    (delta: number) => {
      const index = order.findIndex((card) => card.id === focusedId.current);
      const next =
        index === -1
          ? 0
          : Math.max(0, Math.min(order.length - 1, index + delta));
      focusCard(order[next]?.id);
    },
    [order]
  );

  const focusAcross = useCallback(
    (card: BoardCard, direction: 1 | -1) => {
      const stages = [...new Set(order.map((entry) => entry.stage))];
      const inColumn = order.filter((entry) => entry.stage === card.stage);
      const position = inColumn.findIndex((entry) => entry.id === card.id);
      for (
        let at = stages.indexOf(card.stage) + direction;
        at >= 0 && at < stages.length;
        at += direction
      ) {
        const list = order.filter((entry) => entry.stage === stages[at]);
        if (list.length > 0) {
          focusCard(list[Math.min(position, list.length - 1)]?.id);
          return;
        }
      }
    },
    [order]
  );

  useShortcut("j", () => stepFocus(1), keysEnabled);
  useShortcut("k", () => stepFocus(-1), keysEnabled);
  useShortcut(
    CARD_KEYS.move,
    () => {
      const card =
        focusedId.current && columns
          ? findCard(columns, focusedId.current)
          : null;
      if (card) {
        setPickerCard(card);
      }
    },
    keysEnabled
  );

  const runCardKey = useCallback(
    (card: BoardCard, action: CardKeyAction) => {
      switch (action.kind) {
        case "open":
          openCard(card);
          return;
        case "focus":
          if (action.direction === "up" || action.direction === "down") {
            stepFocus(action.direction === "down" ? 1 : -1);
          } else {
            focusAcross(card, action.direction === "right" ? 1 : -1);
          }
          return;
        case "move":
          setPickerCard(card);
          return;
        case "archive":
          archive(card, !card.archived);
          return;
        case "select":
          toggleSelected(card.id);
          return;
        case "followUp":
          openFollowUp(card);
          return;
        default:
          moveTo(card, action.stage);
      }
    },
    [
      archive,
      focusAcross,
      moveTo,
      openCard,
      openFollowUp,
      stepFocus,
      toggleSelected,
    ]
  );

  const handlers: CardHandlers = useMemo(
    () => ({
      onCardFocus: (card) => {
        focusedId.current = card.id;
      },
      onCardClick: (card: BoardCard, event: MouseEvent) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          event.preventDefault();
          toggleSelected(card.id);
          return;
        }
        openCard(card);
      },
      onCardKeyDown: (card: BoardCard, event: KeyboardEvent<HTMLElement>) => {
        const action = cardKeyAction(event);
        if (!action) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        runCardKey(card, action);
        return true;
      },
      onMenuAction: (card: BoardCard, action: CardMenuAction) => {
        const actions: Record<CardMenuAction, () => void> = {
          open: () => openCard(card),
          move: () => setPickerCard(card),
          reject: () => moveTo(card, "rejected"),
          withdraw: () => moveTo(card, "withdrawn"),
          archive: () => archive(card, true),
          unarchive: () => archive(card, false),
          followUp: () => openFollowUp(card),
          select: () => toggleSelected(card.id),
          priorityHigh: () => patch(card, { priority: 1 }, t("card.what")),
          priorityNormal: () => patch(card, { priority: 0 }, t("card.what")),
          priorityLow: () => patch(card, { priority: -1 }, t("card.what")),
        };
        actions[action]();
      },
    }),
    [
      archive,
      moveTo,
      openCard,
      openFollowUp,
      patch,
      runCardKey,
      t,
      toggleSelected,
    ]
  );

  return {
    handlers,
    selectedIds,
    clearSelection: () => setSelectedIds(new Set()),
    pickerCard,
    setPickerCard,
    followUpTarget,
    closeFollowUp: () => setFollowUpTarget(null),
  };
}
