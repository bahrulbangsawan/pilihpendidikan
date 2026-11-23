import { cn } from "@rulisme/ui/lib/utils";
import type { ReactNode } from "react";
import { groupOf } from "./nav";

/**
 * One page section, set like a cursor.com/docs page: the nav group as a
 * muted label, the title in the display role, a 16px lead, then the blocks.
 * Sections are separated by space, not rules.
 */
export function Section({
  id,
  title,
  lead,
  className,
  children,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const group = groupOf(id);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("band", className)}
      id={id}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-5 py-16 sm:px-10 xl:px-16">
        <header className="flex max-w-2xl flex-col gap-3">
          {group ? (
            <p className="type-body text-muted-foreground">{group.label}</p>
          ) : null}
          <h2 className="type-display text-foreground" id={`${id}-title`}>
            {title}
          </h2>
          {lead ? <p className="type-subtitle text-ink">{lead}</p> : null}
        </header>
        {children}
      </div>
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
 * One component: its name in the compact title role, one line on when to
 * use it, then examples. `wide` spans both grid columns (tables, menubars,
 * sidebars, charts, threads).
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
        <h3 className="type-title-compact text-foreground">{title}</h3>
        {description ? (
          <p className="type-body max-w-prose text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A specimen frame: a 4px box with a 10% border whose caption strip sits on
 * the card colour and whose stage is the page colour, so components (cards
 * included) show on the surface they are built for. `stack` lays the
 * specimens out in a column instead of a wrapping row.
 */
export function Example({
  label,
  stack = false,
  className,
  children,
}: {
  label?: ReactNode;
  stack?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col rounded-sm border border-border bg-background">
      {label ? (
        <figcaption className="type-caption rounded-t-sm border-border border-b bg-card px-4 py-2 text-muted-foreground">
          {label}
        </figcaption>
      ) : null}
      <div
        className={cn(
          "flex min-w-0 gap-3 p-5",
          stack ? "flex-col" : "flex-wrap items-center",
          className
        )}
      >
        {children}
      </div>
    </figure>
  );
}
