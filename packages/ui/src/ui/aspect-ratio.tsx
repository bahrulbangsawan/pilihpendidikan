import { AspectRatio as AspectRatioPrimitive } from "radix-ui";
import type * as React from "react";

// Unstyled: the frame belongs to the content. Portfolio screenshots sit on a
// dark `shot` placeholder inside a 1px dashed outline 6px out (DESIGN.md §
// Shapes › Screenshot frames).
function AspectRatio({
  ...props
}: React.ComponentProps<typeof AspectRatioPrimitive.Root>) {
  return <AspectRatioPrimitive.Root data-slot="aspect-ratio" {...props} />;
}

export { AspectRatio };
