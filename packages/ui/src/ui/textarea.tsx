import type * as React from "react";

import { cn } from "../lib/utils";

// Zedative multi-line field: the field shell of `Input` (4px radius, a `line`
// outline on half-transparent paper, body role, cobalt focus halo), growing
// with its content from two lines.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "type-body field-touch field-sizing-content flex min-h-16 w-full min-w-0 resize-none rounded-md border border-input bg-card/60 px-2.5 py-2 text-foreground outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-standard placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-pane/50 disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15",
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
