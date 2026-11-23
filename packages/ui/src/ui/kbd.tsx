import type * as React from "react";

import { cn } from "../lib/utils";

// <kbd>, cursor.com's ⌘K chip: 20px tall, 4px radius, no border, a 10% tint
// of the muted ink, caption role in muted ink. On a `primary` surface (a
// default Button, `buttonVariants()` on a link) or inside a tooltip the tint
// follows that surface's text colour instead.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "type-caption pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-0.5 rounded-sm bg-muted-foreground/10 px-1 font-sans text-muted-foreground [&_svg:not([class*='size-'])]:size-3",
        "in-[.bg-primary]:bg-primary-foreground/15 in-[.bg-primary]:text-primary-foreground",
        "in-data-[slot=tooltip-content]:bg-tooltip-foreground/15 in-data-[slot=tooltip-content]:text-tooltip-foreground",
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
