// One chart on the Stats page with its data-table alternative (12 §12,
// 10 §8, T10-10): a titled card whose "Data table" toggle (a real button
// with aria-pressed, so Enter and Space work) swaps the chart for a <table>
// with a caption and scoped headers that holds the same numbers. The chart
// is an image to assistive technology, labelled with a written summary. The
// choice is remembered per chart in this browser. One border per card: the
// chart sits straight on the frame (no inner bordered panel).

import { cn } from "@rulisme/ui/lib/utils";
import { SectionCard } from "@rulisme/ui/blocks/settings";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { Toggle } from "@rulisme/ui/ui/toggle";
import { Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { useTranslation } from "@/i18n";
import type { TableModel } from "@/lib/stats-model";

export type ChartView = "chart" | "table";

const STORAGE_PREFIX = "jobs.stats.view.";

/** The remembered view of chart `id`; "chart" when unknown or unreadable. */
export function readChartView(id: string): ChartView {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${id}`) === "table"
      ? "table"
      : "chart";
  } catch {
    return "chart";
  }
}

export function writeChartView(id: string, view: ChartView): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, view);
  } catch {
    // Private windows and blocked storage: the toggle still works this visit.
  }
}

/** A TableModel as an accessible table (caption, scoped headers). */
export function DataTable({
  model,
  className,
}: {
  model: TableModel;
  className?: string;
}) {
  return (
    <Table className={className}>
      <TableCaption className="text-left">{model.caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {model.columns.map((column) => (
            <TableHead
              className={cn(column.numeric && "text-right")}
              key={column.key}
              scope="col"
            >
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {model.rows.map((row) => (
          <TableRow key={row.key}>
            <TableHead
              className="type-body h-auto py-2.5 text-foreground"
              scope="row"
            >
              {row.header}
            </TableHead>
            {row.cells.map((cell, index) => (
              <TableCell
                className={cn(
                  model.columns[index + 1]?.numeric !== false && "text-right"
                )}
                key={model.columns[index + 1]?.key ?? index}
              >
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ChartFrame({
  id,
  title,
  description,
  summary,
  table,
  controls,
  children,
  className,
}: {
  /** Stable id: the storage key of the remembered view. */
  id: string;
  title: string;
  description?: string;
  /** What the chart says, in words (the chart's accessible name). */
  summary: string;
  table: TableModel;
  /** Extra controls next to the toggle (a metric switcher). */
  controls?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const bodyId = useId();
  const [view, setView] = useState<ChartView>(() => readChartView(id));

  function change(pressed: boolean) {
    const next: ChartView = pressed ? "table" : "chart";
    setView(next);
    writeChartView(id, next);
  }

  return (
    <div className={cn("min-w-0", className)} data-chart-frame={id}>
      <SectionCard
        action={
          <div className="flex flex-wrap items-center gap-2">
            {controls}
            <Toggle
              aria-controls={bodyId}
              className="type-body-compact"
              onPressedChange={change}
              pressed={view === "table"}
              size="sm"
              variant="outline"
            >
              <Table2 aria-hidden="true" data-icon="inline-start" />
              {t("stats.dataTable")}
            </Toggle>
          </div>
        }
        className="min-w-0 border-transparent bg-transparent px-3 pt-2 pb-3"
        description={description}
        frameClassName="h-full"
        id={headingId}
        title={title}
      >
        <div className="min-w-0" id={bodyId}>
          {view === "table" ? (
            <DataTable model={table} />
          ) : (
            <div aria-label={summary} role="img">
              {children}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
