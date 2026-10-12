import { cn } from "@rulisme/ui/lib/utils";
import { Rail } from "@rulisme/ui/ui/rails";
import type { ReactNode } from "react";

/**
 * One page section: a full-bleed band ruled by a bottom hairline, holding the
 * 1120px ruled column with diamond nodes (DESIGN.md § Layout). `paper` lays
 * graph paper across the band.
 */
export function Section({
  id,
  title,
  lead,
  paper = false,
  className,
  children,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  paper?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("band", paper && "graph-paper", className)}
      id={id}
    >
      <Rail className="flex flex-col gap-10 px-5 py-12 sm:px-10">
        <header className="flex max-w-2xl flex-col gap-2">
          <h2 className="type-title" id={`${id}-title`}>
            {title}
          </h2>
          {lead ? <p className="type-subtitle">{lead}</p> : null}
        </header>
        {children}
      </Rail>
    </section>
  );
}

/** A grid of component blocks: one column on phones, two from `lg`. */
export function BlockGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-x-10 gap-y-14 lg:grid-cols-2", className)}>
      {children}
    </div>
  );
}

/**
 * One component: its name, one line on when to use it, then examples. `wide`
 * spans both grid columns (tables, menubars, sidebars, charts, threads).
 */
export function Block({
  title,
  description,
  wide = false,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-4",
        wide && "lg:col-span-2",
        className
      )}
      data-slot="showcase-block"
    >
      <div className="flex flex-col gap-1">
        <h3 className="type-subtitle weight-semibold">{title}</h3>
        {description ? (
          <p className="type-caption max-w-prose text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A hairline cell holding live components, with an optional caption row.
 * `paper` puts graph paper behind the specimens; `stack` lays them out in a
 * column instead of a wrapping row.
 */
export function Example({
  label,
  paper = false,
  stack = false,
  className,
  children,
}: {
  label?: ReactNode;
  paper?: boolean;
  stack?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col border border-line bg-background">
      {label ? (
        <figcaption className="type-caption border-line border-b px-3 py-1.5 text-muted-foreground">
          {label}
        </figcaption>
      ) : null}
      <div
        className={cn(
          "flex min-w-0 gap-3 p-5",
          stack ? "flex-col" : "flex-wrap items-center",
          paper && "graph-paper",
          className
        )}
      >
        {children}
      </div>
    </figure>
  );
}
