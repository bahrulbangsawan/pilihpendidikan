// The inbox table (12 §4) for tablets and desktops: compact rows with a
// checkbox, the score cell, title, company, location, source, when it was
// seen and how many sources list it. Each row expands (Collapsible) into
// its details. Rows are focusable: J / K move the focus (the page owns the
// keys), Enter or a click on the title opens the job, arrows move too.

import type { InboxItem } from "@pilihpendidikan/jobs-contracts/api";
import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rulisme/ui/ui/collapsible";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "@/i18n";
import { compactAge } from "@/lib/format";
import { listingCount } from "@/lib/inbox-state";
import { sourceLabel } from "@/lib/labels";
import { InboxRowDetails } from "./inbox-row-details";
import { ScoreCellView } from "./score-cell";

const COLUMN_COUNT = 9;

export interface InboxRowsProps {
  expanded: ReadonlySet<string>;
  focusedId: string | null;
  items: readonly InboxItem[];
  nowMs: number;
  onFocusRow: (id: string) => void;
  onMoveFocus: (direction: 1 | -1) => void;
  onOpen: (item: InboxItem, event?: MouseEvent) => void;
  onToggleExpand: (id: string, open: boolean) => void;
  onToggleSelect: (id: string, value: boolean) => void;
  rowRef: (id: string, element: HTMLElement | null) => void;
  selected: ReadonlySet<string>;
}

function InboxRow({
  item,
  isSelected,
  isFocused,
  isOpen,
  nowMs,
  onFocusRow,
  onKeyDown,
  onOpen,
  onToggleExpand,
  onToggleSelect,
  rowRef,
}: {
  isFocused: boolean;
  isOpen: boolean;
  isSelected: boolean;
  item: InboxItem;
  nowMs: number;
  onFocusRow: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, item: InboxItem) => void;
  onOpen: (item: InboxItem, event?: MouseEvent) => void;
  onToggleExpand: (id: string, open: boolean) => void;
  onToggleSelect: (id: string, value: boolean) => void;
  rowRef: (id: string, element: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const id = item.user_job.id;
  const listings = listingCount(item);
  const location = item.posting.locations[0]?.raw ?? null;
  const showRemote =
    item.posting.workplace_type === "remote" &&
    !location?.toLowerCase().includes("remote");
  return (
    <Collapsible
      asChild
      key={id}
      onOpenChange={(open) => onToggleExpand(id, open)}
      open={isOpen}
    >
      <tbody className="border-line border-b last:border-b-0">
        <TableRow
          aria-label={t("inbox.rowLabel", {
            title: item.posting.title,
            company: item.posting.company_name,
          })}
          className={cn(
            "cursor-default border-b-0 outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
            isFocused && "bg-pane/40"
          )}
          data-focused={isFocused ? "true" : undefined}
          data-row-id={id}
          data-state={isSelected ? "selected" : undefined}
          onFocus={(event) => {
            if (event.target === event.currentTarget) {
              onFocusRow(id);
            }
          }}
          onKeyDown={(event) => onKeyDown(event, item)}
          onMouseDown={() => onFocusRow(id)}
          ref={(element) => rowRef(id, element)}
          tabIndex={isFocused ? 0 : -1}
        >
          <TableCell className="py-1.5">
            <Checkbox
              aria-label={t("inbox.selectRow", {
                title: item.posting.title,
                company: item.posting.company_name,
              })}
              checked={isSelected}
              onCheckedChange={(value) => onToggleSelect(id, value === true)}
            />
          </TableCell>
          <TableCell className="px-1 py-1.5">
            <CollapsibleTrigger asChild>
              <Button
                aria-label={
                  isOpen
                    ? t("inbox.collapse")
                    : t("inbox.expand", { title: item.posting.title })
                }
                size="icon-xs"
                variant="ghost"
              >
                {isOpen ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </Button>
            </CollapsibleTrigger>
          </TableCell>
          <TableCell className="py-1.5">
            <ScoreCellView item={item} />
          </TableCell>
          <TableCell className="max-w-80 py-1.5">
            <a
              className={cn(
                "block truncate text-foreground underline-offset-4 hover:underline",
                isSelected && "weight-semibold"
              )}
              href={`/jobs/${encodeURIComponent(id)}`}
              onClick={(event) => onOpen(item, event)}
              tabIndex={-1}
            >
              {item.posting.title}
            </a>
          </TableCell>
          <TableCell className="max-w-48 truncate py-1.5">
            {item.posting.company_name}
          </TableCell>
          <TableCell className="max-w-48 truncate py-1.5 text-muted-foreground">
            {location ?? "—"}
            {showRemote ? ` · ${t("workplace.remote")}` : null}
          </TableCell>
          <TableCell className="max-w-40 truncate py-1.5">
            {item.provenance.source_label ??
              sourceLabel(t, item.provenance.source_kind)}
          </TableCell>
          <TableCell className="py-1.5 text-muted-foreground">
            {compactAge(item.user_job.created_at, nowMs)}
            {item.provenance.run_id ? (
              <span title={item.provenance.run_id}>
                {" · "}
                {t("inbox.fromRun")}
              </span>
            ) : null}
          </TableCell>
          <TableCell className="py-1.5 text-muted-foreground">
            {listings > 1 ? t("inbox.listings", { count: listings }) : null}
          </TableCell>
        </TableRow>
        <CollapsibleContent asChild>
          <tr className="bg-pane/20">
            <td className="px-3" colSpan={COLUMN_COUNT}>
              <InboxRowDetails item={item} onOpen={onOpen} />
            </td>
          </tr>
        </CollapsibleContent>
      </tbody>
    </Collapsible>
  );
}

export function InboxTable({
  items,
  selected,
  focusedId,
  expanded,
  nowMs,
  onToggleSelect,
  onToggleAll,
  onToggleExpand,
  onFocusRow,
  onMoveFocus,
  onOpen,
  rowRef,
}: InboxRowsProps & { onToggleAll: (value: boolean) => void }) {
  const { t } = useTranslation();
  const allSelected =
    items.length > 0 && items.every((item) => selected.has(item.user_job.id));
  const someSelected =
    !allSelected && items.some((item) => selected.has(item.user_job.id));

  function onRowKeyDown(event: KeyboardEvent<HTMLElement>, item: InboxItem) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(item);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onMoveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onMoveFocus(-1);
    }
  }

  return (
    <Table aria-label={t("inbox.listLabel")} className="type-body-compact">
      <TableHeader>
        <TableRow>
          <TableHead className="w-9">
            <Checkbox
              aria-label={t("inbox.selectAll")}
              checked={someSelected ? "indeterminate" : allSelected}
              onCheckedChange={(value) => onToggleAll(value === true)}
            />
          </TableHead>
          <TableHead className="w-8">
            <span className="sr-only">{t("inbox.columns.details")}</span>
          </TableHead>
          <TableHead className="w-24">{t("inbox.columns.score")}</TableHead>
          <TableHead>{t("inbox.columns.title")}</TableHead>
          <TableHead>{t("inbox.columns.company")}</TableHead>
          <TableHead>{t("inbox.columns.location")}</TableHead>
          <TableHead>{t("inbox.columns.source")}</TableHead>
          <TableHead>{t("inbox.columns.seen")}</TableHead>
          <TableHead>{t("inbox.columns.duplicates")}</TableHead>
        </TableRow>
      </TableHeader>
      {items.map((item) => (
        <InboxRow
          isFocused={focusedId === item.user_job.id}
          isOpen={expanded.has(item.user_job.id)}
          isSelected={selected.has(item.user_job.id)}
          item={item}
          key={item.user_job.id}
          nowMs={nowMs}
          onFocusRow={onFocusRow}
          onKeyDown={onRowKeyDown}
          onOpen={onOpen}
          onToggleExpand={onToggleExpand}
          onToggleSelect={onToggleSelect}
          rowRef={rowRef}
        />
      ))}
    </Table>
  );
}
