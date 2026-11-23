import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

// Stat cards (reui's stats blocks): the nested frame (an outer 12px frame
// with 4px padding around an inner 8px panel one step darker), a 13px muted
// label with an optional `…` menu in its corner, the 22px value with an
// optional delta chip, and a 12px footer line under a hairline (the previous
// period, or a note). `StatGrid` is the
// <dl> that lays them out two, then four, across. Every StatCard renders a
// <dt> / <dd> pair, so keep them inside a StatGrid.

type DeltaDirection = "up" | "down" | "flat";

const DELTA_ICON = {
  up: ArrowUpIcon,
  down: ArrowDownIcon,
  flat: MinusIcon,
} as const;

/** A small rising / falling / flat chip: a 12% tint with a matching border
 * and an arrow (green up, red down); flat is a neutral bordered chip. */
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
        "type-caption inline-flex h-5 items-center gap-0.5 rounded-sm border px-1.5 tabular-nums",
        direction === "up" && "border-success/25 bg-success/12 text-success",
        direction === "down" &&
          "border-destructive/25 bg-destructive/12 text-destructive",
        direction === "flat" && "border-border text-muted-foreground",
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
        "flex min-w-0 flex-col rounded-xl border border-border bg-card p-1",
        className
      )}
      data-slot="stat-card"
      {...props}
    >
      <div className="relative flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-background px-4 pt-3.5 pb-3">
        {action ? (
          <div
            className="absolute top-2.5 right-2.5 text-foreground"
            data-slot="stat-card-action"
          >
            {action}
          </div>
        ) : null}
        <dt
          className={cn(
            "type-body-compact truncate text-muted-foreground",
            action && "pr-8"
          )}
        >
          {label}
        </dt>
        <dd className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="type-title text-foreground tabular-nums">
            {value}
          </span>
          {delta ? (
            <DeltaChip direction={delta.direction}>{delta.label}</DeltaChip>
          ) : null}
        </dd>
        {footer ? (
          <dd className="type-caption mt-3 border-border border-t pt-2.5 text-muted-foreground">
            {footer}
          </dd>
        ) : null}
      </div>
    </div>
  );
}

export { DeltaChip, StatCard, StatGrid };
export type { DeltaDirection };
