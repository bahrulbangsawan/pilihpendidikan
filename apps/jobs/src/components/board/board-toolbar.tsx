// The board's toolbar band (12 §3): title, Filter / Mode / Source menus, Show
// archived, the `/` search, and the stale-data caption after failed polls.

import type {
  ApplicationMode,
  SourceKind,
} from "@pilihpendidikan/jobs-contracts/enums";
import { APPLICATION_MODES } from "@pilihpendidikan/jobs-contracts/enums";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Label } from "@rulisme/ui/ui/label";
import { ChevronDown, CloudOff, Search } from "lucide-react";
import { useId, useRef } from "react";
import { useTranslation } from "@/i18n";
import type { BoardFilters } from "@/lib/board-model";
import { NO_RESPONSE_DEFAULT_DAYS } from "@/lib/board-model";
import { formatClock } from "@/lib/format";
import { modeLabel, sourceLabel } from "@/lib/labels";

export function BoardToolbar({
  filters,
  onFiltersChange,
  includeArchived,
  onIncludeArchivedChange,
  sources,
  staleSince,
}: {
  filters: BoardFilters;
  onFiltersChange: (patch: Partial<BoardFilters>) => void;
  includeArchived: boolean;
  onIncludeArchivedChange: (value: boolean) => void;
  sources: readonly SourceKind[];
  /** Set when polling failed 3×: the time of the data shown. */
  staleSince: number | null;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  useShortcut("/", () => searchRef.current?.focus());

  const activeFilters = [
    filters.followUpDue,
    filters.needsAttention,
    filters.priority,
    filters.noResponseDays !== null,
  ].filter(Boolean).length;

  return (
    <div className="band flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost">
            {t("board.filter")}
            {activeFilters > 0 ? (
              <span className="type-micro text-muted-foreground tabular-nums">
                ({activeFilters})
              </span>
            ) : null}
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem
            checked={filters.followUpDue}
            onCheckedChange={(value) =>
              onFiltersChange({ followUpDue: value === true })
            }
          >
            {t("board.filters.followUpDue")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={filters.needsAttention}
            onCheckedChange={(value) =>
              onFiltersChange({ needsAttention: value === true })
            }
          >
            {t("board.filters.needsAttention")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={filters.priority}
            onCheckedChange={(value) =>
              onFiltersChange({ priority: value === true })
            }
          >
            {t("board.filters.priority")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={filters.noResponseDays !== null}
            onCheckedChange={(value) =>
              onFiltersChange({
                noResponseDays:
                  value === true ? NO_RESPONSE_DEFAULT_DAYS : null,
              })
            }
          >
            {t("board.filters.noResponse", {
              days: filters.noResponseDays ?? NO_RESPONSE_DEFAULT_DAYS,
            })}
          </DropdownMenuCheckboxItem>
          {filters.noResponseDays !== null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("board.filters.noResponseDays")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onFiltersChange({ noResponseDays: Number(value) })
                }
                value={String(filters.noResponseDays)}
              >
                {[7, 14, 21, 30, 45].map((days) => (
                  <DropdownMenuRadioItem key={days} value={String(days)}>
                    {t("board.filters.days", { days })}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost">
            {filters.mode === "any"
              ? t("board.mode")
              : modeLabel(t, filters.mode)}
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            onValueChange={(value) =>
              onFiltersChange({ mode: value as ApplicationMode | "any" })
            }
            value={filters.mode}
          >
            <DropdownMenuRadioItem value="any">
              {t("board.anyMode")}
            </DropdownMenuRadioItem>
            {APPLICATION_MODES.map((mode) => (
              <DropdownMenuRadioItem key={mode} value={mode}>
                {modeLabel(t, mode)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost">
            {filters.source === "any"
              ? t("board.source")
              : sourceLabel(t, filters.source)}
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            onValueChange={(value) =>
              onFiltersChange({ source: value as SourceKind | "any" })
            }
            value={filters.source}
          >
            <DropdownMenuRadioItem value="any">
              {t("board.anySource")}
            </DropdownMenuRadioItem>
            {sources.map((source) => (
              <DropdownMenuRadioItem key={source} value={source}>
                {sourceLabel(t, source)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex items-center gap-2 px-1">
        <Checkbox
          checked={includeArchived}
          id={`${id}-archived`}
          onCheckedChange={(value) => onIncludeArchivedChange(value === true)}
        />
        <Label className="type-body-compact" htmlFor={`${id}-archived`}>
          {t("board.showArchived")}
        </Label>
      </div>
      {staleSince !== null ? (
        <p
          className="type-caption inline-flex items-center gap-1 text-muted-foreground"
          role="status"
        >
          <CloudOff aria-hidden="true" className="size-3.5" />
          {t("board.stale", { time: formatClock(staleSince, locale) })}
        </p>
      ) : null}
      <div className="relative ml-auto w-full sm:w-56">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-keyshortcuts="/"
          aria-label={t("board.search")}
          className="field-touch h-8 pr-8 pl-8"
          onChange={(event) => onFiltersChange({ q: event.target.value })}
          placeholder={t("board.search")}
          ref={searchRef}
          type="search"
          value={filters.q}
        />
        <Kbd
          aria-hidden="true"
          className="absolute top-1/2 right-2 -translate-y-1/2"
        >
          /
        </Kbd>
      </div>
    </div>
  );
}
