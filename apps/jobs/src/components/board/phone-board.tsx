// The board below 640px (12 §3): a scrollable stage switcher with counts and
// one vertical list. The switcher scrolls under a right-edge fade with 16px
// of scroll padding at both ends; cards put the match and source on one row. No drag
// and drop; each card has a ghost Move icon button (`M`) and opens the
// details sheet.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { Button } from "@rulisme/ui/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@rulisme/ui/ui/tabs";
import { ArrowRightLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import type { BoardColumns } from "@/lib/board-model";
import { BOARD_STAGES, CLOSED_STAGES } from "@/lib/board-model";
import { stageLabel } from "@/lib/labels";
import { CardView } from "./card-view";

type Tab = (typeof BOARD_STAGES)[number] | "closed";

export function PhoneBoard({
  columns,
  totals,
  nowMs,
  pendingIds,
  onMove,
  onOpen,
  empty,
}: {
  columns: BoardColumns;
  totals: Record<Stage, number>;
  nowMs: number;
  pendingIds: ReadonlySet<string>;
  onMove: (card: BoardCard) => void;
  onOpen: (card: BoardCard) => void;
  empty: ReactNode;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("saved");
  const cards =
    tab === "closed"
      ? CLOSED_STAGES.flatMap((stage) => columns[stage])
      : columns[tab];
  const closedTotal = totals.rejected + totals.withdrawn;
  return (
    <div className="flex flex-col">
      <Tabs onValueChange={(value) => setTab(value as Tab)} value={tab}>
        <div className="no-scrollbar mask-r-from-85% scroll-px-4 overflow-x-auto px-4 pb-2">
          <TabsList aria-label={t("board.stages")} className="mr-4">
            {BOARD_STAGES.map((stage) => (
              <TabsTrigger key={stage} value={stage}>
                {stageLabel(t, stage)}
                <span className="type-micro text-muted-foreground tabular-nums">
                  {totals[stage]}
                </span>
              </TabsTrigger>
            ))}
            <TabsTrigger value="closed">
              {t("board.closed")}
              <span className="type-micro text-muted-foreground tabular-nums">
                {closedTotal}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>
      <ul
        aria-label={tab === "closed" ? t("board.closed") : stageLabel(t, tab)}
        className="flex flex-col gap-2 p-4"
      >
        {cards.map((card) => (
          <li className="relative" key={card.id}>
            <Button
              aria-label={t("card.label", {
                company: card.posting.company_name,
                title: card.posting.title,
                stage: stageLabel(t, card.stage),
              })}
              className="block rounded-lg p-0! hover:bg-transparent"
              onClick={() => onOpen(card)}
              variant="row"
            >
              <CardView
                card={card}
                compact
                nowMs={nowMs}
                pending={pendingIds.has(card.id)}
              />
            </Button>
            <Button
              aria-keyshortcuts="M"
              aria-label={t("card.moveLabel", {
                company: card.posting.company_name,
              })}
              className="absolute top-1.5 right-1.5 text-muted-foreground"
              onClick={() => onMove(card)}
              size="icon-sm"
              title={t("card.actions.moveShort")}
              variant="ghost"
            >
              <ArrowRightLeft aria-hidden="true" />
            </Button>
          </li>
        ))}
        {cards.length === 0 ? (
          <li>
            {tab === "saved" ? (
              empty
            ) : (
              <p className="type-caption text-muted-foreground">
                {t("board.emptyColumn")}
              </p>
            )}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
