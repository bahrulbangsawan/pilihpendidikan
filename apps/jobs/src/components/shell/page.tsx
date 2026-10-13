// The one page frame of the dashboard (Zedative § Layout): every screen is a
// stack of full-bleed bands ruled by 1px hairlines, all sharing the same
// gutter (`PAGE_GUTTER`) so titles, toolbars and content start on one left
// edge next to the sidebar. Reading content is held to the 1120px column
// (`max-w-rail`), left-aligned on that edge; dense screens (board, inbox,
// tables) use the full width.

import { Band } from "@rulisme/ui/ui/rails";
import { cn } from "@rulisme/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

/** Horizontal padding of every band in the main column. */
export const PAGE_GUTTER = "px-4 sm:px-6";

/** The page title band: h1 + one-line description, actions on the right,
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
  /** Tabs or a status line under the title; tabs sit on the band rule. */
  children?: ReactNode;
  className?: string;
  /** Full-width screens (board, inbox, automation) keep actions at the
   * right edge; reading pages hold them to the column. */
  wide?: boolean;
}) {
  return (
    <Band className={className}>
      <div
        className={cn(
          "flex flex-col gap-3 pt-5",
          children ? "pb-0" : "pb-5",
          !wide && "max-w-rail",
          PAGE_GUTTER
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="type-title text-foreground">{title}</h1>
            {description ? (
              <p className="type-caption max-w-2xl text-pretty text-muted-foreground">
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
    </Band>
  );
}

/** A band of reading content held to the column width. */
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
    <Band>
      <div className={cn("py-6", PAGE_GUTTER)}>
        <div
          className={cn(
            "flex flex-col gap-6",
            !wide && "max-w-rail",
            className
          )}
        >
          {children}
        </div>
      </div>
    </Band>
  );
}

/** A titled settings-style section: label column on the left, fields on
 * the right, one band per section. */
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
    <Band asChild>
      <section aria-labelledby={id}>
        <div className={cn("py-6", PAGE_GUTTER)}>
          <div className="grid max-w-rail gap-4 md:grid-cols-[240px_1fr] md:gap-8">
            <div className="flex flex-col gap-1">
              <h2
                className="type-subtitle weight-semibold text-foreground"
                id={id}
              >
                {title}
              </h2>
              {description ? (
                <p className="type-caption text-pretty text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-5">{children}</div>
          </div>
        </div>
      </section>
    </Band>
  );
}

/** The left-aligned column inside a band: the shared gutter, held to the
 * 1120px column unless `wide`. */
export function PageGutter({
  className,
  wide = false,
  ...props
}: ComponentProps<"div"> & { wide?: boolean }) {
  return (
    <div
      className={cn(PAGE_GUTTER, !wide && "max-w-rail", className)}
      {...props}
    />
  );
}
