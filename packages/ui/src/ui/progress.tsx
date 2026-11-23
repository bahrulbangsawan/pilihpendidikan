import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// cursor.com progress: a 4px pill track on `pane-2` with an ink (`primary`)
// fill. The fill jumps to each value; it never animates.
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      className={cn(
        "relative flex h-1 w-full items-center overflow-hidden rounded-full bg-pane-2",
        className
      )}
      data-slot="progress"
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="size-full flex-1 bg-primary"
        data-slot="progress-indicator"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
