import { Separator as SeparatorPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// A 1px `line` hairline (DESIGN.md § Colors: line = rails, column rules,
// dividers), horizontal or vertical.
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      className={cn(
        "shrink-0 bg-line data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      {...props}
    />
  );
}

export { Separator };
