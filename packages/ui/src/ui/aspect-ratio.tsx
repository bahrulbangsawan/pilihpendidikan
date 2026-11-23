import { AspectRatio as AspectRatioPrimitive } from "radix-ui";
import type * as React from "react";

// Unstyled: the frame belongs to the content (a screenshot usually sits on
// the dark `shot` placeholder inside a `rounded-sm` card).
function AspectRatio({
  ...props
}: React.ComponentProps<typeof AspectRatioPrimitive.Root>) {
  return <AspectRatioPrimitive.Root data-slot="aspect-ratio" {...props} />;
}

export { AspectRatio };
