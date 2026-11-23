// The board's controls (12 §3, reui's page header actions): the Filters
// menu (follow-up due, needs attention, priority, no response, source, show
// archived), the Board / List / Table view switcher, the compact `/` search
// of the header row, and the status line under it (clear filters, the
// stale-data caption).

import type { SourceKind } from "@pilihpendidikan/jobs-contracts/enums";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { cn } from "@rulisme/ui/lib/utils";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@rulisme/ui/ui/input-group";
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@rulisme/ui/ui/segmented-control";
import {
  Archive,
  ArrowUp,
  CalendarClock,
  CircleAlert,
  CloudOff,
  Globe,
  Hourglass,
  LayoutGrid,
  List,
  ListFilter,
  Search,
  Table,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { useTranslation } from "@/i18n";
import type { BoardFilters } from "@/lib/board-model";
import { NO_RESPONSE_DEFAULT_DAYS } from "@/lib/board-model";
import { formatClock } from "@/lib/format";
import { sourceLabel } from "@/lib/labels";
import type { BoardView } from "./board-search";

const NO_RESPONSE_OPTIONS = [7, 14, 21, 30, 45] as const;

/** How many filters are on (search excluded: it has its own field). */
export function activeFilterCount(
  filters: BoardFilters,
  includeArchived: boolean
): number {
  return [
    filters.followUpDue,
    filters.needsAttention,
    filters.priority,
    filters.noResponseDays !== null,
    filters.source !== "any",
    includeArchived,
  ].filter(Boolean).length;
}

export function BoardFiltersMenu({
  filters,
  onFiltersChange,
  includeArchived,
  onIncludeArchivedChange,
  sources,
}: {
  filters: BoardFilters;
  onFiltersChange: (patch: Partial<BoardFilters>) => void;
  includeArchived: boolean;
  onIncludeArchivedChange: (value: boolean) => void;
  sources: readonly SourceKind[];
}) {
  const { t } = useTranslation();
  const active = activeFilterCount(filters, includeArchived);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="max-sm:h-8" size="sm" variant="outline">
          <ListFilter aria-hidden="true" data-icon="inline-start" />
          {t("board.filterButton")}
          {active > 0 ? (
            <Badge className="tabular-nums" variant="secondary">
              <span className="sr-only">
                {t("board.filtersActive", { count: active })}
              </span>
              <span aria-hidden="true">{active}</span>
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{t("board.filter")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={filters.followUpDue}
          onCheckedChange={(value) =>
            onFiltersChange({ followUpDue: value === true })
          }
        >
          <CalendarClock aria-hidden="true" />
          {t("board.filters.followUpDue")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={filters.needsAttention}
          onCheckedChange={(value) =>
            onFiltersChange({ needsAttention: value === true })
          }
        >
          <CircleAlert aria-hidden="true" />
          {t("board.filters.needsAttention")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={filters.priority}
          onCheckedChange={(value) =>
            onFiltersChange({ priority: value === true })
          }
        >
          <ArrowUp aria-hidden="true" />
          {t("board.filters.priority")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={filters.noResponseDays !== null}
          onCheckedChange={(value) =>
            onFiltersChange({
              noResponseDays: value === true ? NO_RESPONSE_DEFAULT_DAYS : null,
            })
          }
        >
          <Hourglass aria-hidden="true" />
          {t("board.filters.noResponse", {
            days: filters.noResponseDays ?? NO_RESPONSE_DEFAULT_DAYS,
          })}
        </DropdownMenuCheckboxItem>
        {filters.noResponseDays === null ? null : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Hourglass aria-hidden="true" />
              {t("board.filters.noResponseDays")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onFiltersChange({ noResponseDays: Number(value) })
                }
                value={String(filters.noResponseDays)}
              >
                {NO_RESPONSE_OPTIONS.map((days) => (
                  <DropdownMenuRadioItem key={days} value={String(days)}>
                    <Hourglass aria-hidden="true" />
                    {t("board.filters.days", { days })}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Globe aria-hidden="true" />
            {filters.source === "any"
              ? t("board.source")
              : sourceLabel(t, filters.source)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              onValueChange={(value) =>
                onFiltersChange({ source: value as SourceKind | "any" })
              }
              value={filters.source}
            >
              <DropdownMenuRadioItem value="any">
                <Globe aria-hidden="true" />
                {t("board.anySource")}
              </DropdownMenuRadioItem>
              {sources.map((source) => (
                <DropdownMenuRadioItem key={source} value={source}>
                  <Globe aria-hidden="true" />
                  {sourceLabel(t, source)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem
          checked={includeArchived}
          onCheckedChange={(value) => onIncludeArchivedChange(value === true)}
        >
          <Archive aria-hidden="true" />
          {t("board.showArchived")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const VIEW_ICONS: Record<BoardView, ReactNode> = {
  board: <LayoutGrid aria-hidden="true" />,
  list: <List aria-hidden="true" />,
  table: <Table aria-hidden="true" />,
};

/** The segmented Board / List / Table switch (`?view=`). */
export function ViewSwitcher({
  value,
  onChange,
  views,
}: {
  value: BoardView;
  onChange: (view: BoardView) => void;
  /** The views offered (phones drop the table). */
  views: readonly BoardView[];
}) {
  const { t } = useTranslation();
  const labels: Record<BoardView, string> = {
    board: t("board.view.board"),
    list: t("board.view.list"),
    table: t("board.view.table"),
  };
  return (
    <SegmentedControl
      aria-label={t("board.view.label")}
      className="max-sm:h-8"
      onValueChange={(next) => onChange(next as BoardView)}
      size="sm"
      value={value}
    >
      {views.map((view) => (
        <SegmentedControlItem aria-label={labels[view]} key={view} value={view}>
          {VIEW_ICONS[view]}
          <span className="hidden md:inline">{labels[view]}</span>
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/** The compact `/` search field of the header's action row. */
export function BoardSearchField({
  query,
  onQueryChange,
  className,
  autoFocus = false,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  className?: string;
  /** Focus on mount (the phone's search button opens it). */
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  useShortcut("/", () => searchRef.current?.focus());
  return (
    <InputGroup className={cn("h-7 w-full sm:w-64", className)}>
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        aria-keyshortcuts="/"
        aria-label={t("board.search")}
        autoFocus={autoFocus}
        className="field-touch"
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t("board.searchPlaceholder")}
        ref={searchRef}
        type="search"
        value={query}
      />
      <InputGroupAddon align="inline-end">
        <Kbd aria-hidden="true">/</Kbd>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** The status line under the header: clear filters, stale caption, notes. */
export function BoardStatusRow({
  query,
  activeFilters,
  onClearFilters,
  staleSince,
  children,
}: {
  query: string;
  activeFilters: number;
  onClearFilters: () => void;
  /** Set when polling failed 3 times: the time of the data shown. */
  staleSince: number | null;
  children?: ReactNode;
}) {
  const { locale, t } = useTranslation();
  const filtering = activeFilters > 0 || query !== "";
  if (!(filtering || staleSince !== null || children)) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filtering ? (
        <Button onClick={onClearFilters} size="sm" variant="ghost">
          <X aria-hidden="true" data-icon="inline-start" />
          {t("board.clearFilters")}
        </Button>
      ) : null}
      {staleSince === null ? null : (
        <p
          className="type-caption inline-flex items-center gap-1 text-muted-foreground"
          role="status"
        >
          <CloudOff aria-hidden="true" className="size-3.5" />
          {t("board.stale", { time: formatClock(staleSince, locale) })}
        </p>
      )}
      {children}
    </div>
  );
}
