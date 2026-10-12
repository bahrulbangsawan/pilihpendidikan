import type * as React from "react";

import { cn } from "../lib/utils";

// A static `pane` placeholder with 2px corners. It never pulses: nothing
// animates except the loading spinner (DESIGN.md § Motion).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-sm bg-pane", className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
