import { Label as LabelPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// Zedative label (TYPOGRAPHY.md § Per-Component Guide): the body role in
// `foreground`, like the control it names. It dims with a disabled peer or a
// disabled `Field`.
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "type-body flex select-none items-center gap-2 text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        className
      )}
      data-slot="label"
      {...props}
    />
  );
}

export { Label };
