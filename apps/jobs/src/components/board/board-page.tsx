// The Board (12 §3, 06, reui's kanban board): the page header (title with
// the count, Filters, the Board / List / Table switch, New application),
// the search row, the bulk bar, then the view — lanes with drag and drop
// (pointer, touch and keyboard, board-dnd.tsx), the grouped list or the
// sortable table. A card, row or table row opens the details sheet, kept in
// the URL (`?app=`). Phones get the stage switcher or the list. Data:
// `GET /api/v1/board` every 15 s (ETag).

import type {
  ApplicationDetail,
  BoardCard,
} from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApplicationSheet,
  sheetStepTab,
} from "@/components/application/application-sheet";
import { moveSubjectOf } from "@/components/application/move-subject";
import type { FollowUpTarget } from "@/components/follow-up-dialog";
import { FollowUpDialog } from "@/components/follow-up-dialog";
import { PageHeader } from "@rulisme/ui/blocks/page";
import { useShellActions } from "@/components/shell/shell-context";
import { useAnnouncer } from "@/hooks/use-announcer";
import { useBoard } from "@/hooks/use-board";
import { useApplicationPatch } from "@/hooks/use-conflict-write";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useTranslation } from "@/i18n";
import type { BoardColumns, BoardFilters } from "@/lib/board-model";
import {
  allCards,
  BOARD_STAGES,
  CLOSED_STAGES,
  columnTotals,
  filterColumns,
  isFiltered,
  presentSources,
} from "@/lib/board-model";
import { otherOffers as countOtherOffers } from "@/lib/board-move";
import type { NextStep } from "@/lib/next-step";
import { DesktopBoard } from "./board-dnd";
import { BoardList } from "./board-list";
import type { BoardSearch, BoardView } from "./board-search";
import {
  filtersFromSearch,
  moveSubject,
  searchFromFilters,
  viewState,
} from "./board-search";
import { BoardTable } from "./board-table";
import {
  activeFilterCount,
  BoardFiltersMenu,
  BoardSearchField,
  BoardStatusRow,
  ViewSwitcher,
} from "./board-toolbar";
import type { BulkReport } from "./bulk-bar";
import { BulkBar, BulkResultsDialog } from "./bulk-bar";
import { PhoneBoard } from "./phone-board";
import { StagePickerDialog } from "./stage-picker-dialog";
import { useCardHandlers } from "./use-card-handlers";
import { useMoveCard } from "./use-move-card";

const MINUTE_MS = 60_000;
const ALL_STAGES: readonly Stage[] = [...BOARD_STAGES, ...CLOSED_STAGES];
const DESKTOP_VIEWS: readonly BoardView[] = ["board", "list", "table"];
const PHONE_VIEWS: readonly BoardView[] = ["board", "list"];

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function BoardSkeleton({ view }: { view: BoardView }) {
  if (view !== "board") {
    return (
      <div
        aria-hidden="true"
        className="flex flex-col gap-2 px-4 pb-4 sm:px-6 lg:px-8"
      >
        {BOARD_STAGES.slice(0, 6).map((stage) => (
          <Skeleton className="h-14 w-full rounded-lg" key={stage} />
        ))}
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex min-h-0 flex-1 gap-3 overflow-hidden px-4 pb-4 sm:px-6 lg:px-8"
    >
      {BOARD_STAGES.slice(0, 5).map((stage) => (
        <div
          className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-hairline bg-card/50 p-2"
          key={stage}
        >
          <Skeleton className="m-1 h-5 w-24" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function BoardError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 pb-4 sm:px-6 lg:px-8">
      <Alert role="alert" variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{t("board.errorTitle")}</AlertTitle>
        <AlertDescription>{t("board.error")}</AlertDescription>
        <AlertAction>
          <Button onClick={onRetry} size="sm" variant="outline">
            {t("common.retry")}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}

/** The empty board (12 §3): add the first application by URL. */
function EmptyBoard() {
  const { t } = useTranslation();
  const shell = useShellActions();
  return (
    <Empty className="rounded-lg border border-border border-dashed py-8">
      <EmptyHeader>
        <EmptyTitle>{t("board.emptyTitle")}</EmptyTitle>
        <EmptyDescription>{t("board.emptyManual")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        <Button onClick={shell.openNewJob} size="sm" variant="outline">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t("board.newApplication")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** The view shown: phones have no table, so it falls back to the list. */
function effectiveView(
  requested: BoardSearch["view"],
  isPhone: boolean
): BoardView {
  if (isPhone && requested === "table") {
    return "list";
  }
  return requested ?? "board";
}

function sumTotals(totals: Record<Stage, number> | null): number | undefined {
  return totals
    ? ALL_STAGES.reduce((sum, stage) => sum + totals[stage], 0)
    : undefined;
}

/** Visible cards in reading order: the lanes that are open, left to right. */
function readingOrder(
  visible: BoardColumns | null,
  collapsed: ReadonlySet<Stage>
): BoardCard[] {
  if (!visible) {
    return [];
  }
  return ALL_STAGES.filter((stage) => !collapsed.has(stage)).flatMap(
    (stage) => visible[stage]
  );
}

export function BoardPage({
  search,
  onSearchChange,
}: {
  search: BoardSearch;
  onSearchChange: (search: BoardSearch) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const shell = useShellActions();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const now = useNow();
  const { message, announce } = useAnnouncer();
  const patch = useApplicationPatch();
  const filters = useMemo(() => filtersFromSearch(search), [search]);
  const includeArchived = search.archived === 1;
  const board = useBoard({ includeArchived });
  const [report, setReport] = useState<BulkReport | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<Stage>>(
    () => new Set<Stage>(CLOSED_STAGES)
  );
  const [dragging, setDragging] = useState(false);
  const [sheetFollowUp, setSheetFollowUp] = useState<FollowUpTarget | null>(
    null
  );

  const view = effectiveView(search.view, isPhone);
  const sheetOpen = search.app !== undefined;

  const columns = board.columns;
  const visible = useMemo(
    () => (columns ? filterColumns(columns, filters, now) : null),
    [columns, filters, now]
  );
  const totals = useMemo(
    () => (board.data ? columnTotals(board.data.board) : null),
    [board.data]
  );
  const order = useMemo(
    () =>
      view === "table"
        ? readingOrder(visible, new Set())
        : readingOrder(visible, collapsed),
    [visible, collapsed, view]
  );
  const otherOffers = useCallback(
    (cardId: string) =>
      columns ? countOtherOffers(allCards(columns), cardId) : 0,
    [columns]
  );
  const { requestMove, dialogs } = useMoveCard({ announce, otherOffers });

  const setSearch = useCallback(
    (patchSearch: Partial<BoardSearch>) => {
      const merged: BoardSearch = { ...search, ...patchSearch };
      onSearchChange(
        Object.fromEntries(
          Object.entries(merged).filter(([, value]) => value !== undefined)
        ) as BoardSearch
      );
    },
    [onSearchChange, search]
  );
  const openCard = useCallback(
    (card: BoardCard) => setSearch({ app: card.id }),
    [setSearch]
  );
  const cards = useCardHandlers({
    announce,
    columns,
    order,
    requestMove,
    onOpen: openCard,
    keysEnabled: !(isPhone || dragging || sheetOpen),
  });

  const setLaneCollapsed = useCallback((stage: Stage, value: boolean) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (value) {
        next.add(stage);
      } else {
        next.delete(stage);
      }
      return next;
    });
  }, []);

  const changeFilters = (patchFilters: Partial<BoardFilters>) =>
    onSearchChange({
      ...searchFromFilters({ ...filters, ...patchFilters }, includeArchived),
      ...viewState(search),
    });
  const clearFilters = () =>
    onSearchChange({
      ...(includeArchived ? { archived: 1 } : {}),
      ...viewState(search),
    });

  const runSheetStep = (detail: ApplicationDetail, step: NextStep) => {
    const tab = sheetStepTab(step);
    if (tab) {
      navigate({
        to: "/applications/$appId",
        params: { appId: detail.application.id },
        search: { tab },
      });
      return;
    }
    requestMove({ card: moveSubjectOf(detail), target: "applied" });
  };

  const filtered = isFiltered(filters);
  const empty =
    columns && allCards(columns).length === 0 && !filtered ? (
      <EmptyBoard />
    ) : null;
  const selectedCards = columns
    ? allCards(columns).filter((card) => cards.selectedIds.has(card.id))
    : [];
  const staleSince = board.stale && board.data ? board.data.fetchedAt : null;
  const totalCount = sumTotals(totals);

  let body: ReactNode;
  if (board.isPending) {
    body = <BoardSkeleton view={view} />;
  } else if (!(visible && totals)) {
    body = <BoardError onRetry={() => board.refetch()} />;
  } else if (view === "list") {
    body = (
      <BoardList
        collapsed={collapsed}
        empty={empty}
        filtered={filtered}
        handlers={cards.handlers}
        nowMs={now}
        onCollapsedChange={setLaneCollapsed}
        pendingIds={board.pendingIds}
        selectedIds={cards.selectedIds}
        totals={totals}
        visible={visible}
      />
    );
  } else if (view === "table") {
    body = (
      <BoardTable
        cards={order}
        empty={empty}
        handlers={cards.handlers}
        nowMs={now}
        onSelect={cards.setSelected}
        pendingIds={board.pendingIds}
        selectedIds={cards.selectedIds}
      />
    );
  } else if (isPhone) {
    body = (
      <PhoneBoard
        columns={visible}
        empty={empty}
        nowMs={now}
        onMove={cards.setPickerCard}
        onOpen={openCard}
        pendingIds={board.pendingIds}
        totals={totals}
      />
    );
  } else {
    body = (
      <DesktopBoard
        announce={announce}
        collapsed={collapsed}
        empty={empty}
        filtered={filtered}
        handlers={cards.handlers}
        nowMs={now}
        onCollapsedChange={setLaneCollapsed}
        onDraggingChange={setDragging}
        onSelectAll={(stage) =>
          cards.setSelected(
            visible[stage].map((card) => card.id),
            true
          )
        }
        pendingIds={board.pendingIds}
        requestMove={requestMove}
        selectedIds={cards.selectedIds}
        totals={totals}
        visible={visible}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        actions={
          <>
            <BoardSearchField
              className={isPhone ? "order-last" : undefined}
              onQueryChange={(q) => changeFilters({ q })}
              query={filters.q}
            />
            <BoardFiltersMenu
              filters={filters}
              includeArchived={includeArchived}
              onFiltersChange={changeFilters}
              onIncludeArchivedChange={(value) =>
                onSearchChange({
                  ...searchFromFilters(filters, value),
                  ...viewState(search),
                })
              }
              sources={columns ? presentSources(columns) : []}
            />
            <ViewSwitcher
              onChange={(next) =>
                setSearch({ view: next === "board" ? undefined : next })
              }
              value={view}
              views={isPhone ? PHONE_VIEWS : DESKTOP_VIEWS}
            />
            <Button aria-keyshortcuts="N" onClick={shell.openNewJob} size="sm">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t("board.newApplication")}
              <Kbd aria-hidden="true">N</Kbd>
            </Button>
          </>
        }
        className="pb-4"
        count={totalCount}
        title={t("board.title")}
        wide
      >
        <BoardStatusRow
          activeFilters={activeFilterCount(filters, includeArchived)}
          onClearFilters={clearFilters}
          query={filters.q}
          staleSince={staleSince}
        >
          {filtered && visible && order.length === 0 && view !== "list" ? (
            <p className="type-caption text-muted-foreground">
              {t("board.noMatches")}
            </p>
          ) : null}
        </BoardStatusRow>
      </PageHeader>
      <BulkBar
        onClear={cards.clearSelection}
        onReport={setReport}
        selected={selectedCards}
      />
      {body}
      <div aria-atomic="true" aria-live="assertive" className="sr-only">
        {message}
      </div>
      <ApplicationSheet
        appId={search.app ?? null}
        nowMs={now}
        onAcceptFollowUp={(detail, changes) =>
          patch(detail.application, changes, t("followUp.what"))
        }
        onClose={() => setSearch({ app: undefined })}
        onFollowUp={(detail) =>
          setSheetFollowUp({
            company: detail.posting.company_name,
            title: detail.posting.title,
            record: detail.application,
          })
        }
        onMove={(detail, target) =>
          requestMove({ card: moveSubjectOf(detail), target })
        }
        onRunStep={runSheetStep}
      />
      <StagePickerDialog
        card={cards.pickerCard}
        columns={columns}
        onOpenChange={(open) => !open && cards.setPickerCard(null)}
        onPick={(pick) => {
          const card = cards.pickerCard;
          cards.setPickerCard(null);
          if (card) {
            requestMove({
              card: moveSubject(card),
              target: pick.stage,
              beforeId: pick.beforeId,
              afterId: pick.afterId,
              position: { index: pick.index, total: pick.total },
            });
          }
        }}
      />
      <FollowUpDialog
        onClose={() => {
          cards.closeFollowUp();
          setSheetFollowUp(null);
        }}
        target={cards.followUpTarget ?? sheetFollowUp}
      />
      <BulkResultsDialog onClose={() => setReport(null)} report={report} />
      {dialogs}
    </div>
  );
}
