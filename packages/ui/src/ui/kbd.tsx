import type * as React from "react";

import { cn } from "../lib/utils";

// <kbd>, cursor.com's ⌘K chip: 20px tall, 4px radius, no border, caption
// role. One style on every surface: its ink is the surrounding text colour
// at 65% and its fill that ink at 10%, so it reads the same inside a light
// primary pill, an outline pill, a field, a menu row or a tooltip.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "type-caption pointer-events-none inline-flex pointer-coarse:hidden h-5 w-fit min-w-5 select-none items-center justify-center gap-0.5 rounded-sm bg-current/10 px-1 font-sans [color:color-mix(in_oklab,currentColor_65%,transparent)] [&_svg:not([class*='size-'])]:size-3",
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
      className={cn(
        "inline-flex pointer-coarse:hidden items-center gap-1",
        className
      )}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
