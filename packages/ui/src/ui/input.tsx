import type * as React from "react";

import { cn } from "../lib/utils";

// Zedative field: 36px like the buttons it sits beside, 4px radius, a `line`
// outline on half-transparent paper, body role (16px on touch screens). Focus
// turns the outline cobalt with a soft halo.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "type-body field-touch file:type-body h-9 w-full min-w-0 rounded-md border border-input bg-card/60 px-2.5 py-1 text-foreground outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-standard selection:bg-highlight file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-pane/50 disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15",
        className
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
