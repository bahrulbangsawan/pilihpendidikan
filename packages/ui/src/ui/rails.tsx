import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// The Zedative drafting frame (DESIGN.md § Layout / Elevation): every section
// is a full-bleed band ruled by a 1px bottom hairline, holding a centred
// 1120px column with its own side rules and a 7px diamond node wherever
// those rules cross the rule above. The geometry lives in the `band`,
// `rail`, `rail-nodes` and `diamond` utilities of `styles/theme.css`.

/** A full-bleed band with a 1px bottom rule. Use `asChild` for landmarks. */
function Band({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return <Comp className={cn("band", className)} data-slot="band" {...props} />;
}

/**
 * The ruled column. `nodes` (default) pins a diamond at each top corner,
 * where its side rules meet the band rule above.
 */
function Rail({
  className,
  nodes = true,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { nodes?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      className={cn("rail", nodes && "rail-nodes", className)}
      data-slot="rail"
      {...props}
    />
  );
}

/** One diamond node. Position it with inset utilities. */
function Diamond({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn("diamond", className)}
      data-slot="diamond"
      {...props}
    />
  );
}

export { Band, Diamond, Rail };
