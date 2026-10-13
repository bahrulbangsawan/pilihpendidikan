// The inbox toolbar band (12 §4): title, the New · Seen · Dismissed tabs,
// Min score, Source, Workplace, Posted and Score menus (with "Hide
// blockers"), the `/` search and the offline caption. Typing is debounced
// before it reaches the URL (and the API).

import type { SourceKind } from "@pilihpendidikan/jobs-contracts/enums";
import { WORKPLACE_TYPES } from "@pilihpendidikan/jobs-contracts/enums";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
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
import type { ReactNode, RefObject } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { formatClock } from "@/lib/format";
import type { InboxSearch, InboxTab } from "@/lib/inbox-filters";
import {
  activeFilterCount,
  INBOX_TABS,
  POSTED_WITHIN_DAYS,
  tabOf,
} from "@/lib/inbox-filters";
import { SCORE_BANDS } from "@/lib/inbox-score";
import { inboxStateLabel, sourceLabel } from "@/lib/labels";

/** Debounce before typed text becomes a query (one request per pause). */
const TYPE_DEBOUNCE_MS = 300;
/** Source kinds a discovery run can produce, for the Source menu. */
const DISCOVERED_KINDS: readonly SourceKind[] = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "workday",
  "career_page",
  "generic_listing",
  "custom_url",
];
const ANY = "any";

export interface SourceOption {
  label: string;
  value: string;
}

/** Local text that follows the URL value and reports after a pause. */
function useDebouncedField(
  value: string,
  onCommit: (value: string) => void
): [string, (value: string) => void] {
  const [text, setText] = useState(value);
  const [dirty, setDirty] = useState(false);
  const commit = useRef(onCommit);
  useLayoutEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    if (!dirty) {
      setText(value);
    }
  }, [value, dirty]);
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDirty(false);
      commit.current(text);
    }, TYPE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, dirty]);
  return [
    text,
    (next) => {
      setText(next);
      setDirty(true);
    },
  ];
}

function FilterMenu({
  label,
  value,
  active,
  options,
  onChange,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(active && "weight-semibold text-foreground")}
          size="sm"
          variant="ghost"
        >
          {label}
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup onValueChange={onChange} value={value}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InboxToolbar({
  search,
  onSearchChange,
  newCount,
  sources,
  staleSince,
  searchRef,
}: {
  search: InboxSearch;
  onSearchChange: (patch: Partial<InboxSearch>) => void;
  /** Rows in New (`counts.inbox_new` of the board), when known. */
  newCount: number | null;
  sources: readonly SourceOption[];
  /** Set after three failed polls: the time of the data shown. */
  staleSince: number | null;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const tab = tabOf(search);
  useShortcut("/", () => searchRef.current?.focus());

  const [query, setQuery] = useDebouncedField(search.q ?? "", (value) =>
    onSearchChange({ q: value.trim() ? value : undefined })
  );
  const [minText, setMinText] = useDebouncedField(
    search.min === undefined ? "" : String(search.min),
    (value) => {
      const min = Number.parseInt(value, 10);
      onSearchChange({
        min: Number.isFinite(min) && min > 0 ? Math.min(100, min) : undefined,
      });
    }
  );

  const sourceLabelOf = (value: string | undefined): string | null => {
    if (!value) {
      return null;
    }
    const own = sources.find((option) => option.value === value);
    if (own) {
      return own.label;
    }
    return (DISCOVERED_KINDS as readonly string[]).includes(value)
      ? sourceLabel(t, value as SourceKind)
      : value;
  };
  const filters = activeFilterCount(search);

  return (
    <div className="band flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2 sm:px-6">
      <fieldset className="flex items-center gap-0.5">
        <legend className="sr-only">{t("inbox.tabsLabel")}</legend>
        {INBOX_TABS.map((value: InboxTab) => {
          const current = value === tab;
          return (
            <Button
              aria-pressed={current}
              className={cn(
                current && "weight-semibold bg-pane-2 text-foreground"
              )}
              key={value}
              onClick={() =>
                onSearchChange({ state: value === "new" ? undefined : value })
              }
              size="sm"
              variant="ghost"
            >
              {inboxStateLabel(t, value)}
              {value === "new" && newCount !== null ? (
                <span className="type-micro text-muted-foreground tabular-nums">
                  {newCount}
                </span>
              ) : null}
            </Button>
          );
        })}
      </fieldset>
      <span
        aria-hidden="true"
        className="mx-1 hidden h-5 w-px bg-line sm:block"
      />
      <div className="flex items-center gap-1.5">
        <Label
          className="type-body-compact text-muted-foreground"
          htmlFor={`${id}-min`}
        >
          {t("inbox.filters.minScore")}
        </Label>
        <Input
          className="field-touch h-8 w-16 tabular-nums"
          id={`${id}-min`}
          inputMode="numeric"
          max={100}
          min={0}
          onChange={(event) => setMinText(event.target.value)}
          placeholder="0"
          type="number"
          value={minText}
        />
      </div>
      <FilterMenu
        active={search.source !== undefined}
        label={sourceLabelOf(search.source) ?? t("inbox.filters.source")}
        onChange={(value) =>
          onSearchChange({ source: value === ANY ? undefined : value })
        }
        options={[
          { value: ANY, label: t("inbox.filters.anySource") },
          ...sources,
          ...DISCOVERED_KINDS.map((kind) => ({
            value: kind,
            label: sourceLabel(t, kind),
          })),
        ]}
        value={search.source ?? ANY}
      />
      <FilterMenu
        active={search.workplace !== undefined}
        label={
          search.workplace
            ? t(`workplace.${search.workplace}`)
            : t("inbox.filters.workplace")
        }
        onChange={(value) =>
          onSearchChange({
            workplace:
              value === ANY
                ? undefined
                : WORKPLACE_TYPES.find((type) => type === value),
          })
        }
        options={[
          { value: ANY, label: t("inbox.filters.anyWorkplace") },
          ...WORKPLACE_TYPES.map((type) => ({
            value: type,
            label: t(`workplace.${type}`),
          })),
        ]}
        value={search.workplace ?? ANY}
      />
      <FilterMenu
        active={search.posted !== undefined}
        label={
          search.posted === undefined
            ? t("inbox.filters.posted")
            : t("inbox.filters.postedWithin", { days: search.posted })
        }
        onChange={(value) =>
          onSearchChange({
            posted:
              value === ANY
                ? undefined
                : POSTED_WITHIN_DAYS.find((days) => String(days) === value),
          })
        }
        options={[
          { value: ANY, label: t("inbox.filters.anyTime") },
          ...POSTED_WITHIN_DAYS.map((days) => ({
            value: String(days),
            label: t("inbox.filters.postedWithin", { days }),
          })),
        ]}
        value={search.posted === undefined ? ANY : String(search.posted)}
      />
      <FilterMenu
        active={search.band !== undefined || search.blockers === 1}
        label={
          search.band
            ? t(`inbox.filters.bands.${search.band}`)
            : t("inbox.filters.score")
        }
        onChange={(value) =>
          onSearchChange({
            band:
              value === ANY
                ? undefined
                : SCORE_BANDS.find((band) => band === value),
          })
        }
        options={[
          { value: ANY, label: t("inbox.filters.anyScore") },
          ...SCORE_BANDS.map((band) => ({
            value: band,
            label: t(`inbox.filters.bands.${band}`),
          })),
        ]}
        value={search.band ?? ANY}
      >
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("inbox.filters.gates")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={search.blockers === 1}
          onCheckedChange={(value) =>
            onSearchChange({ blockers: value === true ? 1 : undefined })
          }
        >
          {t("inbox.filters.hideBlockers")}
        </DropdownMenuCheckboxItem>
      </FilterMenu>
      {filters > 0 ? (
        <Button
          onClick={() =>
            onSearchChange({
              min: undefined,
              source: undefined,
              workplace: undefined,
              posted: undefined,
              band: undefined,
              blockers: undefined,
            })
          }
          size="sm"
          variant="ghost"
        >
          {t("inbox.filters.clear", { count: filters })}
        </Button>
      ) : null}
      {staleSince !== null ? (
        <p
          className="type-caption inline-flex items-center gap-1 text-muted-foreground"
          role="status"
        >
          <CloudOff aria-hidden="true" className="size-3.5" />
          {t("inbox.stale", { time: formatClock(staleSince, locale) })}
        </p>
      ) : null}
      <div className="relative ml-auto w-full sm:w-56">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-keyshortcuts="/"
          aria-label={t("inbox.search")}
          className="field-touch h-8 pr-8 pl-8"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("inbox.search")}
          ref={searchRef}
          type="search"
          value={query}
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
