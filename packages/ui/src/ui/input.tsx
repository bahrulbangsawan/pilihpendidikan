import type * as React from "react";

import { cn } from "../lib/utils";

// Cursor field, cursor.com's docs search box: 36px like the buttons it sits
// beside, 8px radius, a 10% border on the page colour, body role (16px on
// touch screens). Hover deepens the fill; focus turns the border to 20% ink
// and draws the 2px ink outline.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "type-body field-touch file:type-body h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-1 text-foreground outline-none transition-[background-color,border-color,box-shadow] duration-140 ease-standard selection:bg-highlight file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground hover:border-input focus-visible:border-input focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-pane disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:outline-destructive",
        className
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
