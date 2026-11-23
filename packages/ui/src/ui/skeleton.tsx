import type * as React from "react";

import { cn } from "../lib/utils";

// A static `pane` placeholder with 4px corners, the cursor.com image-slot
// grey. It never pulses: nothing animates except the loading spinner.
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
