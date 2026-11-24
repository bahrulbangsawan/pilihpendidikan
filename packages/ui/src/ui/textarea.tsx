import type * as React from "react";

import { cn } from "../lib/utils";

// Multi-line field: the shell of `Input` (cursor.com's search box): 8px
// radius, a 10% border on the page colour, 20% on hover and focus plus the
// 2px ink outline, body role. It grows with its content from two lines.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "type-body field-touch field-sizing-content flex min-h-16 w-full min-w-0 resize-none rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none transition-[background-color,border-color] duration-140 ease-standard selection:bg-highlight placeholder:text-muted-foreground hover:border-input focus-visible:border-input focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-pane disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:outline-destructive",
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
