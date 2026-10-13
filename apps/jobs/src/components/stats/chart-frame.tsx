// One chart on the Stats page with its data-table alternative (12 §12,
// 10 §8, T10-10): a titled card whose "Data table" toggle (a real button
// with aria-pressed, so Enter and Space work) swaps the chart for a <table>
// with a caption and scoped headers that holds the same numbers. The chart
// is an image to assistive technology, labelled with a written summary. The
// choice is remembered per chart in this browser.

import { cn } from "@rulisme/ui/lib/utils";
import { Card, CardContent } from "@rulisme/ui/ui/card";
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

/**
 * A card's title block with its controls; the controls wrap under the title
 * on narrow screens instead of squeezing it (375 px).
 */
export function FrameHeader({
  headingId,
  title,
  description,
  children,
}: {
  headingId: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-(--card-spacing)">
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <h2
          className="type-subtitle weight-semibold text-card-foreground"
          id={headingId}
        >
          {title}
        </h2>
        {description ? (
          <p className="type-caption text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
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
    <section
      aria-labelledby={headingId}
      className={cn("min-w-0", className)}
      data-chart-frame={id}
    >
      <Card className="h-full" size="sm">
        <FrameHeader
          description={description}
          headingId={headingId}
          title={title}
        >
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
        </FrameHeader>
        <CardContent className="min-w-0" id={bodyId}>
          {view === "table" ? (
            <DataTable model={table} />
          ) : (
            <div aria-label={summary} role="img">
              {children}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
