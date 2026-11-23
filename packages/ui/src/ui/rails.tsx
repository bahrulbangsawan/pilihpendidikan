import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// Page layout, cursor.com style: a `Band` is a plain full-bleed section
// (sections are separated by space, not rules) and a `Rail` is Cursor's
// centred 1300px container, 20px clear of the viewport edge. `Diamond` is a
// retired ornament kept so older markup compiles; it renders nothing
// visible. The geometry lives in the `band` / `rail` utilities of
// `styles/theme.css`.

/** A full-bleed section with no border. Use `asChild` for landmarks. */
function Band({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return <Comp className={cn("band", className)} data-slot="band" {...props} />;
}

/**
 * The 1300px container. `nodes` is kept for compatibility and draws nothing.
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

/** Retired ornament: hidden (`display: none`), kept for compatibility. */
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
