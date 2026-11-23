import type * as React from "react";
import { cn } from "../lib/utils";

// The page frame of an app screen (reui's application blocks, cursor.com's
// docs column): a title block and content blocks that share one gutter and
// hold to a 1024px reading column unless `wide`.
// - `PageHeader`: title (18px, weight 500 like reui's app titles; + a
//   `CountBadge`, an 18px bordered square), a one-line description, actions
//   on the right, and an optional row under it (tabs, a toolbar).
// - `PageContent`: a block of content in the column.
// - `PageSection`: a label column + content column section, ruled on top.
// - `PageGutter`: a plain div on the gutter (and the column unless `wide`).

/** Horizontal padding of every block in the main column. */
const PAGE_GUTTER = "px-4 sm:px-6 lg:px-8";

/** The reading column's width. */
const PAGE_COLUMN = "max-w-5xl";

/** An 18px bordered square holding a count (page titles, kanban lanes). */
function CountBadge({
  count,
  label,
  className,
}: {
  count: number;
  /** Screen-reader text, e.g. "4 applications"; the digits are hidden then. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "type-micro inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-sm border border-border px-1 text-ink-sec tabular-nums",
        className
      )}
      data-slot="count-badge"
    >
      {label ? <span className="sr-only">{label}</span> : null}
      <span aria-hidden={label ? true : undefined}>{count}</span>
    </span>
  );
}

function PageHeader({
  title,
  description,
  count,
  actions,
  children,
  className,
  wide = false,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A number in a badge beside the title (e.g. applications). */
  count?: number;
  actions?: React.ReactNode;
  /** Tabs, a toolbar or a status line under the title. */
  children?: React.ReactNode;
  className?: string;
  /** Full-width screens keep the actions at the right edge. */
  wide?: boolean;
}) {
  return (
    <div className={className} data-slot="page-header">
      <div
        className={cn(
          "flex flex-col gap-4 pt-6",
          children ? "pb-0" : "pb-2",
          !wide && PAGE_COLUMN,
          PAGE_GUTTER
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="type-title-compact weight-semibold text-foreground">
                {title}
              </h1>
              {count === undefined ? null : <CountBadge count={count} />}
            </div>
            {description ? (
              <p className="type-body max-w-2xl text-pretty text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full sm:shrink-0">
              {actions}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function PageContent({
  children,
  className,
  wide = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Use the full width (tables, grids of cards). */
  wide?: boolean;
}) {
  return (
    <div className={cn("py-6", PAGE_GUTTER)} data-slot="page-content">
      <div
        className={cn("flex flex-col gap-6", !wide && PAGE_COLUMN, className)}
      >
        {children}
      </div>
    </div>
  );
}

function PageSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={PAGE_GUTTER}
      data-slot="page-section"
    >
      <div
        className={cn(
          "grid gap-4 border-border border-t py-8 md:grid-cols-[240px_1fr] md:gap-10",
          PAGE_COLUMN
        )}
      >
        <div className="flex flex-col gap-1">
          <h2 className="type-subtitle text-foreground" id={id}>
            {title}
          </h2>
          {description ? (
            <p className="type-body text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
      </div>
    </section>
  );
}

function PageGutter({
  className,
  wide = false,
  ...props
}: React.ComponentProps<"div"> & { wide?: boolean }) {
  return (
    <div
      className={cn(PAGE_GUTTER, !wide && PAGE_COLUMN, className)}
      data-slot="page-gutter"
      {...props}
    />
  );
}

export {
  CountBadge,
  PAGE_COLUMN,
  PAGE_GUTTER,
  PageContent,
  PageGutter,
  PageHeader,
  PageSection,
};
