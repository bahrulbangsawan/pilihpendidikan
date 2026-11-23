// The one page frame of the dashboard, laid out like a cursor.com/docs page:
// sections are separated by space, not rules; every block shares the same
// gutter (`PAGE_GUTTER`) so titles, toolbars and content start on one left
// edge next to the sidebar. Reading content is held to a 1024px column
// (`PAGE_COLUMN`), left-aligned on that edge; dense screens (board, inbox,
// tables) use the full width.

import { cn } from "@rulisme/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

/** Horizontal padding of every block in the main column. */
export const PAGE_GUTTER = "px-4 sm:px-6";

/** The reading column's width. */
export const PAGE_COLUMN = "max-w-5xl";

/** The page title block: h1 + one-line description, actions on the right,
 * and an optional row under it (tabs, status line). */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
  wide = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Tabs or a status line under the title. */
  children?: ReactNode;
  className?: string;
  /** Full-width screens (board, inbox, automation) keep actions at the
   * right edge; reading pages hold them to the column. */
  wide?: boolean;
}) {
  return (
    <div className={className}>
      <div
        className={cn(
          "flex flex-col gap-4 pt-8",
          children ? "pb-0" : "pb-4",
          !wide && PAGE_COLUMN,
          PAGE_GUTTER
        )}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="type-display text-foreground">{title}</h1>
            {description ? (
              <p className="type-body max-w-2xl text-pretty text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A block of reading content held to the column width. */
export function PageContent({
  children,
  className,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  /** Use the full width (tables, grids of cards). */
  wide?: boolean;
}) {
  return (
    <div className={cn("py-6", PAGE_GUTTER)}>
      <div
        className={cn("flex flex-col gap-6", !wide && PAGE_COLUMN, className)}
      >
        {children}
      </div>
    </div>
  );
}

/** A titled settings-style section: label column on the left, fields on
 * the right, sections divided by one 10% rule. */
export function PageSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={PAGE_GUTTER}>
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

/** The left-aligned column inside a block: the shared gutter, held to the
 * reading column unless `wide`. */
export function PageGutter({
  className,
  wide = false,
  ...props
}: ComponentProps<"div"> & { wide?: boolean }) {
  return (
    <div
      className={cn(PAGE_GUTTER, !wide && PAGE_COLUMN, className)}
      {...props}
    />
  );
}
