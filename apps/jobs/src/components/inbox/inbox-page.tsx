// Inbox — discovery results (12 §4): review discovered postings, check their
// scores and provenance, track or dismiss them in bulk. The toolbar filters
// live in the URL; the list is cursor-paged with "Load more" (no auto-scroll,
// so J / K stay predictable) and sorted by score, then freshness (07 §12).
// It polls every 30 s only while a discovery run is going (12 §10).
//
// Keys (12 §2.2): / filter, J / K next / previous row, Enter open, X select
// the focused row, S track and D dismiss the selection (or the focused row).

import type { InboxItem } from "@pilihpendidikan/jobs-contracts/api";
import type { InboxBulkAction } from "@pilihpendidikan/jobs-contracts/enums";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { CircleAlert } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useBoard } from "@/hooks/use-board";
import { useDevices } from "@/hooks/use-devices";
import {
  useFollowedCloudSources,
  useInboxBulk,
  useInboxItems,
  useInboxRuns,
  useInboxSources,
} from "@/hooks/use-inbox";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { PageHeader } from "@/components/shell/page";
import { useTranslation } from "@/i18n";
import { bulkFailedOutright, bulkToastText } from "@/lib/inbox-bulk";
import type { InboxSearch } from "@/lib/inbox-filters";
import {
  applyClientFilters,
  clearedSearch,
  isFiltered,
  tabOf,
} from "@/lib/inbox-filters";
import { scoreSortValue } from "@/lib/inbox-score";
import {
  anyRunActive,
  importStripRun,
  inboxEmptyKind,
  lastRunAt,
} from "@/lib/inbox-state";
import { POLL_POLICIES } from "@/lib/polling";
import { ImportStrip } from "./import-strip";
import { InboxEmpty } from "./inbox-empty";
import { InboxList } from "./inbox-list";
import { InboxTable } from "./inbox-table";
import type { SourceOption } from "./inbox-toolbar";
import { InboxToolbar } from "./inbox-toolbar";
import { SelectionBar } from "./selection-bar";

const MINUTE_MS = 60_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Highest score first, then the most recently found (07 §12). */
export function sortInboxItems(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort(
    (a, b) =>
      scoreSortValue(b.score) - scoreSortValue(a.score) ||
      b.user_job.created_at - a.user_job.created_at
  );
}

/** A plain left click navigates in-app; modified clicks keep the browser's. */
function isPlainClick(event: MouseEvent | undefined): boolean {
  return (
    !event ||
    (event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey)
  );
}

function InboxSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 px-4 py-4 sm:px-6">
      {["a", "b", "c", "d", "e", "f"].map((key) => (
        <Skeleton className="h-9 w-full" key={key} />
      ))}
    </div>
  );
}

export interface InboxPageProps {
  /** In-app navigation (the route passes the router's). */
  onNavigate: (href: string) => void;
  onSearchChange: (search: InboxSearch) => void;
  search: InboxSearch;
}

export function InboxPage({
  search,
  onSearchChange,
  onNavigate,
}: InboxPageProps) {
  const { t } = useTranslation();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const nowMs = useNow();
  const tab = tabOf(search);
  const runs = useInboxRuns();
  const runActive = anyRunActive(runs.data);
  const inbox = useInboxItems(search, runActive);
  const sources = useInboxSources();
  const cloudSources = useFollowedCloudSources();
  const { byId } = useDevices();
  const board = useBoard({ policy: POLL_POLICIES.shell });
  const bulk = useInboxBulk();
  const searchRef = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState<InboxBulkAction | null>(null);

  const visible = useMemo(
    () => sortInboxItems(applyClientFilters(inbox.items, search, nowMs)),
    [inbox.items, search, nowMs]
  );
  const visibleIds = useMemo(
    () => visible.map((item) => item.user_job.id),
    [visible]
  );

  // A new tab or filter is a new list: forget selection, focus, expansion.
  const searchKey = JSON.stringify(search);
  useEffect(() => {
    if (searchKey) {
      setSelected(new Set());
      setExpanded(new Set());
      setFocusedId(null);
      setSelecting(false);
    }
  }, [searchKey]);

  // Rows that left the list (tracked, dismissed, filtered) leave the
  // selection; an empty selection ends the phone's selection mode.
  useEffect(() => {
    const present = new Set(visibleIds);
    setSelected((current) => {
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
    setFocusedId((current) =>
      current !== null && !present.has(current) ? null : current
    );
  }, [visibleIds]);
  useEffect(() => {
    if (selecting && selected.size === 0) {
      setSelecting(false);
    }
  }, [selecting, selected]);

  const navigate = useCallback(
    (href: string, event?: MouseEvent) => {
      if (!isPlainClick(event)) {
        return;
      }
      event?.preventDefault();
      onNavigate(href);
    },
    [onNavigate]
  );
  const openItem = useCallback(
    (item: InboxItem, event?: MouseEvent) =>
      navigate(`/jobs/${encodeURIComponent(item.user_job.id)}`, event),
    [navigate]
  );

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    const element = rows.current.get(id);
    if (element && document.activeElement !== element) {
      element.focus({ preventScroll: true });
      element.scrollIntoView?.({ block: "nearest" });
    }
  }, []);

  const moveFocus = useCallback(
    (direction: 1 | -1) => {
      if (visibleIds.length === 0) {
        return;
      }
      const at = focusedId === null ? -1 : visibleIds.indexOf(focusedId);
      let next = Math.min(visibleIds.length - 1, Math.max(0, at + direction));
      if (at === -1) {
        next = direction === 1 ? 0 : visibleIds.length - 1;
      }
      const id = visibleIds[next];
      if (id) {
        focusRow(id);
      }
    },
    [focusRow, focusedId, visibleIds]
  );

  const toggleSelect = useCallback((id: string, value: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  /** The selection in list order, or the focused row when none. */
  const targets = useCallback((): string[] => {
    if (selected.size > 0) {
      return visibleIds.filter((id) => selected.has(id));
    }
    return focusedId ? [focusedId] : [];
  }, [focusedId, selected, visibleIds]);

  const runAction = useCallback(
    async (action: InboxBulkAction) => {
      const ids = targets();
      if (busy !== null || ids.length === 0) {
        return;
      }
      if (action === "dismiss" && tab === "dismissed") {
        return;
      }
      if (action === "restore" && tab !== "dismissed") {
        return;
      }
      const previous = new Map(
        inbox.items.map((item) => [item.user_job.id, item.user_job.inbox_state])
      );
      setBusy(action);
      try {
        const { summary } = await bulk(action, ids, previous);
        const text = bulkToastText(t, summary);
        if (bulkFailedOutright(summary)) {
          toast.error(text);
        } else {
          const [only] = summary.applicationIds;
          toast.success(
            text,
            action === "track" && summary.applicationIds.length === 1 && only
              ? {
                  action: {
                    label: t("inbox.bulk.open"),
                    onClick: () =>
                      onNavigate(`/applications/${encodeURIComponent(only)}`),
                  },
                }
              : undefined
          );
          setSelected(new Set());
          setSelecting(false);
        }
      } catch {
        toast.error(t("inbox.bulk.error"));
      } finally {
        setBusy(null);
      }
    },
    [bulk, busy, inbox.items, onNavigate, t, tab, targets]
  );

  useShortcut("j", () => moveFocus(1));
  useShortcut("k", () => moveFocus(-1));
  useShortcut("x", () => {
    if (focusedId) {
      toggleSelect(focusedId, !selected.has(focusedId));
    }
  });
  useShortcut("s", () => {
    runAction("track");
  });
  useShortcut("d", () => {
    runAction("dismiss");
  });

  const sourceOptions = useMemo<SourceOption[]>(
    () => [
      ...(sources.data ?? []).map((source) => ({
        value: source.id,
        label: source.label,
      })),
      ...(cloudSources.data ?? []).map((source) => ({
        value: source.id,
        label: source.name,
      })),
    ],
    [sources.data, cloudSources.data]
  );
  const stripRun = importStripRun(runs.data, nowMs);
  const activeRun =
    (runs.data ?? []).find((run) => run.status === "running") ?? null;
  const newCount = board.data?.board.counts.inbox_new ?? null;
  const rowRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      rows.current.set(id, element);
    } else {
      rows.current.delete(id);
    }
  }, []);
  const rowProps = {
    items: visible,
    selected,
    focusedId,
    nowMs,
    onFocusRow: setFocusedId,
    onOpen: openItem,
    onToggleSelect: toggleSelect,
    rowRef,
  };

  let content: ReactNode;
  if (inbox.isPending) {
    content = <InboxSkeleton />;
  } else if (inbox.isError && inbox.items.length === 0) {
    content = (
      <div className="p-4 sm:p-5">
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("inbox.errorTitle")}</AlertTitle>
          <AlertDescription>{t("inbox.error")}</AlertDescription>
          <AlertAction>
            <Button onClick={() => inbox.refetch()} size="sm" variant="outline">
              {t("common.retry")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  } else if (visible.length === 0) {
    content = (
      <InboxEmpty
        kind={inboxEmptyKind({
          filtered: isFiltered(search),
          tab,
          sources: sources.data?.length ?? 1,
          runs: runs.data?.length ?? 1,
        })}
        lastRunAt={lastRunAt(runs.data)}
        nowMs={nowMs}
        onClearFilters={() => onSearchChange(clearedSearch(search))}
        onNavigate={navigate}
        tab={tab}
      />
    );
  } else if (isPhone) {
    content = (
      <>
        {selecting ? null : (
          <p className="type-caption px-4 pt-3 pb-1 text-muted-foreground">
            {t("inbox.longPressHint")}
          </p>
        )}
        <InboxList
          {...rowProps}
          onStartSelecting={(id) => {
            setSelecting(true);
            toggleSelect(id, true);
          }}
          selecting={selecting}
        />
      </>
    );
  } else {
    content = (
      <InboxTable
        {...rowProps}
        expanded={expanded}
        onMoveFocus={moveFocus}
        onToggleAll={(value) =>
          setSelected(value ? new Set(visibleIds) : new Set())
        }
        onToggleExpand={(id, open) =>
          setExpanded((current) => {
            const next = new Set(current);
            if (open) {
              next.add(id);
            } else {
              next.delete(id);
            }
            return next;
          })
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        description={t("inbox.intro")}
        title={t("pages.inbox")}
        wide
      />
      <InboxToolbar
        newCount={newCount}
        onSearchChange={(patch) => onSearchChange({ ...search, ...patch })}
        search={search}
        searchRef={searchRef}
        sources={sourceOptions}
        staleSince={inbox.stale ? inbox.dataUpdatedAt : null}
      />
      <ImportStrip
        activeRun={activeRun}
        deviceName={(deviceId) => byId.get(deviceId)?.name ?? null}
        onNavigate={navigate}
        run={stripRun}
      />
      <div className="flex-1">
        {content}
        {inbox.hasNextPage ? (
          <div className="flex justify-center px-4 py-4">
            <Button
              disabled={inbox.isFetchingNextPage}
              onClick={() => inbox.fetchNextPage()}
              size="sm"
              variant="outline"
            >
              {inbox.isFetchingNextPage
                ? t("common.loading")
                : t("inbox.loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
      <SelectionBar
        busy={busy}
        count={selected.size}
        onAction={(action) => {
          runAction(action);
        }}
        onClear={() => {
          setSelected(new Set());
          setSelecting(false);
        }}
        tab={tab}
      />
    </div>
  );
}
