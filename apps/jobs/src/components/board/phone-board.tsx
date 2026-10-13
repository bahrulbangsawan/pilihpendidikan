// The board below 640px (12 §3): a scrollable stage switcher with counts and
// one vertical list. No drag and drop; each card has a Move button (`M`).

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { Button } from "@rulisme/ui/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@rulisme/ui/ui/tabs";
import { Link } from "@tanstack/react-router";
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
  empty,
}: {
  columns: BoardColumns;
  totals: Record<Stage, number>;
  nowMs: number;
  pendingIds: ReadonlySet<string>;
  onMove: (card: BoardCard) => void;
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
        <div className="band no-scrollbar overflow-x-auto px-4 py-2">
          <TabsList aria-label={t("board.stages")}>
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
            <Link
              aria-label={t("card.label", {
                company: card.posting.company_name,
                title: card.posting.title,
                stage: stageLabel(t, card.stage),
              })}
              className="block outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2"
              params={{ appId: card.id }}
              to="/applications/$appId"
            >
              <CardView
                card={card}
                className="pr-20"
                nowMs={nowMs}
                pending={pendingIds.has(card.id)}
              />
            </Link>
            <Button
              aria-keyshortcuts="M"
              aria-label={t("card.moveLabel", {
                company: card.posting.company_name,
              })}
              className="absolute top-2 right-2"
              onClick={() => onMove(card)}
              size="xs"
              variant="outline"
            >
              <ArrowRightLeft aria-hidden="true" data-icon="inline-start" />
              {t("card.actions.moveShort")}
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
