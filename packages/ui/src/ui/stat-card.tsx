import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

// Stat cards (reui's stats blocks): an 8px card with a muted label (and an
// optional `…` menu in its corner), the
// value in the display role with an optional delta chip, and a footer line
// under a hairline (the previous period, or a note). `StatGrid` is the
// <dl> that lays them out two, then four, across. Every StatCard renders a
// <dt> / <dd> pair, so keep them inside a StatGrid.

type DeltaDirection = "up" | "down" | "flat";

const DELTA_ICON = {
  up: ArrowUpIcon,
  down: ArrowDownIcon,
  flat: MinusIcon,
} as const;

/** A small rising / falling / flat chip: a 10% tint (green up, red down,
 * neutral flat) with an arrow, no border. */
function DeltaChip({
  className,
  direction,
  children,
  ...props
}: React.ComponentProps<"span"> & { direction: DeltaDirection }) {
  const Icon = DELTA_ICON[direction];
  return (
    <span
      className={cn(
        "type-caption inline-flex h-5 items-center gap-0.5 rounded-sm px-1.5 tabular-nums",
        direction === "up" && "bg-success/10 text-success",
        direction === "down" && "bg-destructive/10 text-destructive",
        direction === "flat" && "bg-offgray/10 text-muted-foreground",
        className
      )}
      data-direction={direction}
      data-slot="delta-chip"
      {...props}
    >
      <Icon aria-hidden="true" className="size-3" />
      {children}
    </span>
  );
}

function StatGrid({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4",
        className
      )}
      data-slot="stat-grid"
      {...props}
    />
  );
}

function StatCard({
  className,
  label,
  value,
  delta,
  footer,
  action,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  /** A control in the label row's corner: the card's `…` menu. */
  action?: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  /** A DeltaChip's direction and text, e.g. `{ direction: "up", label: "+12%" }`. */
  delta?: { direction: DeltaDirection; label: React.ReactNode };
  /** The line under the rule: "vs. 18 last period", or a note. */
  footer?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col rounded-lg border border-border bg-card p-1",
        className
      )}
      data-slot="stat-card"
      {...props}
    >
      {action ? (
        <div
          className="absolute top-2.5 right-2.5"
          data-slot="stat-card-action"
        >
          {action}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 px-3 pt-3 pb-3 sm:px-4">
        <dt
          className={cn(
            "type-body truncate text-muted-foreground",
            action && "pr-8"
          )}
        >
          {label}
        </dt>
        <dd className="flex flex-wrap items-center gap-2.5">
          <span className="type-display text-foreground tabular-nums">
            {value}
          </span>
          {delta ? (
            <DeltaChip direction={delta.direction}>{delta.label}</DeltaChip>
          ) : null}
        </dd>
      </div>
      {footer ? (
        <dd className="type-caption mx-3 border-border border-t pt-2.5 pb-2.5 text-muted-foreground sm:mx-4">
          {footer}
        </dd>
      ) : null}
    </div>
  );
}

export { DeltaChip, StatCard, StatGrid };
export type { DeltaDirection };
