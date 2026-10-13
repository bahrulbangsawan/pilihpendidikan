// The Board (12 §3, 06): toolbar, overview strip, bulk bar and the columns —
// drag and drop with pointer, touch and keyboard (board-dnd.tsx), card
// shortcuts (use-card-handlers.ts), the `M` stage picker and follow-ups — or
// the stage switcher on phones. Data: `GET /api/v1/board` every 15 s (ETag).

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
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
import { CircleAlert, Inbox, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLink } from "@/components/app-link";
import { FollowUpDialog } from "@/components/follow-up-dialog";
import { useShellActions } from "@/components/shell/shell-context";
import { useAnnouncer } from "@/hooks/use-announcer";
import { useBoard } from "@/hooks/use-board";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useTranslation } from "@/i18n";
import type {
  BoardColumns,
  BoardFilters,
  ClosedStage,
} from "@/lib/board-model";
import {
  allCards,
  BOARD_STAGES,
  CLOSED_STAGES,
  columnTotals,
  filterColumns,
  isFiltered,
  presentSources,
  upcomingInterviews,
} from "@/lib/board-model";
import { otherOffers as countOtherOffers } from "@/lib/board-move";
import { DesktopBoard } from "./board-dnd";
import type { BoardSearch } from "./board-search";
import {
  filtersFromSearch,
  moveSubject,
  searchFromFilters,
} from "./board-search";
import { BoardToolbar } from "./board-toolbar";
import type { BulkReport } from "./bulk-bar";
import { BulkBar, BulkResultsDialog } from "./bulk-bar";
import { OverviewStrip } from "./overview-strip";
import { PhoneBoard } from "./phone-board";
import { StagePickerDialog } from "./stage-picker-dialog";
import { useCardHandlers } from "./use-card-handlers";
import { useMoveCard } from "./use-move-card";

const MINUTE_MS = 60_000;

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function BoardSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-h-0 flex-1 overflow-hidden">
      {BOARD_STAGES.slice(0, 5).map((stage) => (
        <div
          className="flex w-60 shrink-0 flex-col gap-2 border-line border-r p-2"
          key={stage}
        >
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
}

function BoardError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="p-4 sm:p-5">
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

/** "Track a job from your inbox or add one by URL" (12 §3 empty state). */
function EmptyBoard() {
  const { t } = useTranslation();
  const shell = useShellActions();
  return (
    <Empty className="graph-paper border border-dashed py-8">
      <EmptyHeader>
        <EmptyTitle>{t("board.emptyTitle")}</EmptyTitle>
        <EmptyDescription>{t("board.empty")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        <Button asChild size="sm" variant="outline">
          <AppLink aria-keyshortcuts="I" href="/inbox">
            <Inbox aria-hidden="true" data-icon="inline-start" />
            {t("nav.inbox")}
            <Kbd aria-hidden="true">I</Kbd>
          </AppLink>
        </Button>
        <Button
          aria-keyshortcuts="N"
          onClick={shell.openNewJob}
          size="sm"
          variant="outline"
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t("nav.new")}
          <Kbd aria-hidden="true">N</Kbd>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Visible cards in reading order: the open columns, then the closed lane. */
function readingOrder(
  visible: BoardColumns | null,
  closedExpanded: boolean,
  closedFilter: ClosedStage | "both"
): BoardCard[] {
  if (!visible) {
    return [];
  }
  const stages: Stage[] = [...BOARD_STAGES];
  if (closedExpanded) {
    stages.push(...(closedFilter === "both" ? CLOSED_STAGES : [closedFilter]));
  }
  return stages.flatMap((stage) => visible[stage]);
}

export function BoardPage({
  search,
  onSearchChange,
}: {
  search: BoardSearch;
  onSearchChange: (search: BoardSearch) => void;
}) {
  const { t } = useTranslation();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const now = useNow();
  const { message, announce } = useAnnouncer();
  const filters = useMemo(() => filtersFromSearch(search), [search]);
  const includeArchived = search.archived === 1;
  const board = useBoard({ includeArchived });
  const [report, setReport] = useState<BulkReport | null>(null);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [closedFilter, setClosedFilter] = useState<ClosedStage | "both">(
    "both"
  );
  const [dragging, setDragging] = useState(false);

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
    () => readingOrder(visible, closedExpanded, closedFilter),
    [visible, closedExpanded, closedFilter]
  );
  const otherOffers = useCallback(
    (cardId: string) =>
      columns ? countOtherOffers(allCards(columns), cardId) : 0,
    [columns]
  );
  const { requestMove, dialogs } = useMoveCard({ announce, otherOffers });
  const cards = useCardHandlers({
    announce,
    columns,
    order,
    requestMove,
    keysEnabled: !(isPhone || dragging),
  });

  const filtered = isFiltered(filters);
  const empty =
    columns && allCards(columns).length === 0 && !filtered ? (
      <EmptyBoard />
    ) : null;
  const selectedCards = columns
    ? allCards(columns).filter((card) => cards.selectedIds.has(card.id))
    : [];
  const staleSince = board.stale && board.data ? board.data.fetchedAt : null;

  let body: ReactNode;
  if (board.isPending) {
    body = <BoardSkeleton />;
  } else if (!(visible && totals)) {
    body = <BoardError onRetry={() => board.refetch()} />;
  } else if (isPhone) {
    body = (
      <PhoneBoard
        columns={visible}
        empty={empty}
        nowMs={now}
        onMove={cards.setPickerCard}
        pendingIds={board.pendingIds}
        totals={totals}
      />
    );
  } else {
    body = (
      <DesktopBoard
        announce={announce}
        closedExpanded={closedExpanded}
        closedFilter={closedFilter}
        empty={empty}
        filtered={filtered}
        handlers={cards.handlers}
        nowMs={now}
        onClosedExpandedChange={setClosedExpanded}
        onClosedFilterChange={setClosedFilter}
        onDraggingChange={setDragging}
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
      <BoardToolbar
        filters={filters}
        includeArchived={includeArchived}
        onFiltersChange={(patch: Partial<BoardFilters>) =>
          onSearchChange(
            searchFromFilters({ ...filters, ...patch }, includeArchived)
          )
        }
        onIncludeArchivedChange={(value) =>
          onSearchChange(searchFromFilters(filters, value))
        }
        sources={columns ? presentSources(columns) : []}
        staleSince={staleSince}
      />
      <OverviewStrip
        followUpsDue={board.data?.board.counts.follow_ups_due ?? null}
        interviewsUpcoming={columns ? upcomingInterviews(columns, now) : null}
        nowMs={now}
      />
      {filtered && visible && order.length === 0 ? (
        <div className="band flex items-center gap-3 px-4 py-2 sm:px-5">
          <p className="type-caption text-muted-foreground">
            {t("board.noMatches")}
          </p>
          <Button
            onClick={() =>
              onSearchChange(includeArchived ? { archived: 1 } : {})
            }
            size="xs"
            variant="ghost"
          >
            {t("board.clearFilters")}
          </Button>
        </div>
      ) : null}
      <BulkBar
        onClear={cards.clearSelection}
        onReport={setReport}
        selected={selectedCards}
      />
      {body}
      <div aria-atomic="true" aria-live="assertive" className="sr-only">
        {message}
      </div>
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
        onClose={cards.closeFollowUp}
        target={cards.followUpTarget}
      />
      <BulkResultsDialog onClose={() => setReport(null)} report={report} />
      {dialogs}
    </div>
  );
}
