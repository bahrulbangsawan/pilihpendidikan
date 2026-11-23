// The Table view (`?view=table`, reui's deals table / data grid): sortable
// columns (company and role, stage, score, location, source, in stage since,
// updated), row actions, and checkbox selection shared with the board's
// selection and bulk bar. A row opens the details sheet.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { STAGES } from "@pilihpendidikan/jobs-contracts/enums";
import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { formatDate, relativeTime } from "@/lib/format";
import { sourceLabel, stageLabel } from "@/lib/labels";
import type { CardHandlers } from "./board-columns";
import { CardMenu } from "./board-columns";
import { StageBadge } from "./stage-meta";
import { ScoreMeter, useLocationLine } from "./card-view";
import { EntityAvatar } from "@rulisme/ui/ui/entity-avatar";

export type SortKey =
  | "company"
  | "stage"
  | "score"
  | "location"
  | "source"
  | "since"
  | "updated";
export interface Sort {
  dir: "asc" | "desc";
  key: SortKey;
}

const STAGE_ORDER = new Map<Stage, number>(
  STAGES.map((stage, index) => [stage, index])
);

function sortValue(card: BoardCard, key: SortKey, t: Translate) {
  switch (key) {
    case "company":
      return `${card.posting.company_name} ${card.posting.title}`.toLocaleLowerCase();
    case "stage":
      return STAGE_ORDER.get(card.stage) ?? 0;
    case "score":
      return card.score?.status === "ready" ? card.score.score : -1;
    case "location":
      return (card.posting.location ?? "").toLocaleLowerCase();
    case "source":
      return sourceLabel(t, card.posting.source_kind).toLocaleLowerCase();
    case "since":
      return card.stage_changed_at;
    default:
      return card.updated_at;
  }
}

/** Cards in `sort` order; ties keep their board order. */
export function sortCards(
  cards: readonly BoardCard[],
  sort: Sort,
  t: Translate
): BoardCard[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return cards
    .map((card, index) => ({
      card,
      index,
      value: sortValue(card, sort.key, t),
    }))
    .sort((a, b) => {
      if (a.value < b.value) {
        return -factor;
      }
      if (a.value > b.value) {
        return factor;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.card);
}

function SortHead({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (sort: Sort) => void;
  className?: string;
}) {
  const active = sort.key === column;
  let icon: ReactNode = (
    <ChevronsUpDown aria-hidden="true" className="size-3.5 opacity-60" />
  );
  if (active) {
    icon =
      sort.dir === "asc" ? (
        <ArrowUp aria-hidden="true" className="size-3.5" />
      ) : (
        <ArrowDown aria-hidden="true" className="size-3.5" />
      );
  }
  let ariaSort: "ascending" | "descending" | "none" = "none";
  if (active) {
    ariaSort = sort.dir === "asc" ? "ascending" : "descending";
  }
  return (
    <TableHead aria-sort={ariaSort} className={className}>
      <Button
        className={cn(
          "-ml-2 gap-1 px-2 text-muted-foreground hover:text-foreground",
          active && "text-foreground"
        )}
        size="xs"
        variant="ghost"
        onClick={() =>
          onSort({
            key: column,
            dir: active && sort.dir === "asc" ? "desc" : "asc",
          })
        }
      >
        {label}
        {icon}
      </Button>
    </TableHead>
  );
}

function Row({
  card,
  handlers,
  nowMs,
  pending,
  selected,
  onSelect,
}: {
  card: BoardCard;
  handlers: CardHandlers;
  nowMs: number;
  pending: boolean;
  selected: boolean;
  onSelect: (value: boolean) => void;
}) {
  const { locale, t } = useTranslation();
  const location = useLocationLine(card.posting);
  const name = `${card.posting.company_name}, ${card.posting.title}`;
  return (
    <TableRow
      aria-busy={pending || undefined}
      className={cn("cursor-pointer", pending && "opacity-70")}
      data-state={selected ? "selected" : undefined}
      onClick={(event) => handlers.onCardClick(card, event)}
    >
      <TableCell className="w-10" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          aria-label={t("bulk.selectRow", { name })}
          checked={selected}
          onCheckedChange={(value) => onSelect(value === true)}
        />
      </TableCell>
      <TableCell className="max-w-80">
        <div className="flex min-w-0 items-center gap-3">
          <EntityAvatar name={card.posting.company_name} shape="square" />
          <Button
            aria-keyshortcuts="Enter M X F E R W"
            aria-label={t("card.label", {
              company: card.posting.company_name,
              title: card.posting.title,
              stage: stageLabel(t, card.stage),
            })}
            className="h-auto min-w-0 flex-col items-start gap-0 whitespace-normal rounded-sm px-0 text-left hover:bg-transparent"
            data-card-id={card.id}
            data-stage={card.stage}
            onClick={(event) => {
              event.stopPropagation();
              handlers.onCardClick(card, event);
            }}
            onFocus={() => handlers.onCardFocus(card)}
            onKeyDown={(event) => handlers.onCardKeyDown(card, event)}
            variant="ghost"
          >
            <span className="type-body weight-semibold truncate text-foreground">
              {card.posting.title}
            </span>
            <span className="type-caption truncate text-muted-foreground">
              {card.posting.company_name}
            </span>
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <StageBadge stage={card.stage} />
      </TableCell>
      <TableCell className="w-32">
        <ScoreMeter label={false} score={card.score} />
      </TableCell>
      <TableCell className="type-caption max-w-48 truncate text-ink-sec">
        {location || "—"}
      </TableCell>
      <TableCell className="type-caption text-ink-sec">
        {sourceLabel(t, card.posting.source_kind)}
      </TableCell>
      <TableCell className="type-caption text-ink-sec tabular-nums">
        {formatDate(card.stage_changed_at, locale)}
      </TableCell>
      <TableCell className="type-caption text-ink-sec tabular-nums">
        {relativeTime(card.updated_at, nowMs, locale)}
      </TableCell>
      <TableCell
        className="w-12 text-right"
        onClick={(event) => event.stopPropagation()}
      >
        <CardMenu
          card={card}
          onAction={(action) => handlers.onMenuAction(card, action)}
        />
      </TableCell>
    </TableRow>
  );
}

export function BoardTable({
  cards,
  handlers,
  nowMs,
  pendingIds,
  selectedIds,
  onSelect,
  empty,
}: {
  /** Visible cards in board order. */
  cards: readonly BoardCard[];
  handlers: CardHandlers;
  nowMs: number;
  pendingIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  onSelect: (ids: readonly string[], value: boolean) => void;
  empty: ReactNode;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<Sort>({ key: "stage", dir: "asc" });
  const rows = useMemo(() => sortCards(cards, sort, t), [cards, sort, t]);
  const ids = rows.map((card) => card.id);
  const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
  let headerChecked: boolean | "indeterminate" = false;
  if (selectedCount > 0) {
    headerChecked = selectedCount === ids.length ? true : "indeterminate";
  }
  const head = { sort, onSort: setSort };
  return (
    <div className="px-4 pb-8 sm:px-6 lg:px-8">
      {empty}
      <div className="overflow-x-auto rounded-lg border border-border bg-card [scrollbar-width:thin]">
        <Table aria-label={t("board.view.table")}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  aria-label={t("bulk.selectAll")}
                  checked={headerChecked}
                  disabled={ids.length === 0}
                  onCheckedChange={(value) => onSelect(ids, value === true)}
                />
              </TableHead>
              <SortHead
                column="company"
                label={t("board.table.company")}
                {...head}
              />
              <SortHead
                column="stage"
                label={t("board.table.stage")}
                {...head}
              />
              <SortHead
                column="score"
                label={t("board.table.score")}
                {...head}
              />
              <SortHead
                column="location"
                label={t("board.table.location")}
                {...head}
              />
              <SortHead
                column="source"
                label={t("board.table.source")}
                {...head}
              />
              <SortHead
                column="since"
                label={t("board.table.since")}
                {...head}
              />
              <SortHead
                column="updated"
                label={t("board.table.updated")}
                {...head}
              />
              <TableHead className="w-12 text-right">
                <span className="sr-only">{t("board.table.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((card) => (
              <Row
                card={card}
                handlers={handlers}
                key={card.id}
                nowMs={nowMs}
                onSelect={(value) => onSelect([card.id], value)}
                pending={pendingIds.has(card.id)}
                selected={selectedIds.has(card.id)}
              />
            ))}
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  className="type-caption py-8 text-center text-muted-foreground"
                  colSpan={9}
                >
                  {t("board.noMatches")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
