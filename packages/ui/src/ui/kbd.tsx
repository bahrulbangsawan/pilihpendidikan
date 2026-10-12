import type * as React from "react";

import { cn } from "../lib/utils";

// Zedative <kbd> (DESIGN.md § Components): 20px tall, 2px radius, a faint
// offgray edge on half-transparent paper, micro role in muted ink. On any
// cobalt surface (a primary Button, `buttonVariants()` on a link, a Radix
// trigger rendered as one) it turns into a translucent white cap.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "type-micro pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-0.5 rounded-sm border border-offgray/22 bg-card/50 px-1.5 font-sans text-muted-foreground [&_svg:not([class*='size-'])]:size-3",
        "in-[.bg-primary]:border-primary-foreground/30 in-[.bg-primary]:bg-primary-foreground/15 in-[.bg-primary]:text-primary-foreground",
        "in-data-[slot=tooltip-content]:border-tooltip-foreground/25 in-data-[slot=tooltip-content]:bg-tooltip-foreground/10 in-data-[slot=tooltip-content]:text-tooltip-foreground",
        className
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
