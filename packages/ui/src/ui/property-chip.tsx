import type * as React from "react";
import { cn } from "../lib/utils";
import { badgeVariants } from "./badge-variants";

// A property chip (reui's property badges, Linear's issue properties): a
// 28px outlined pill with a leading 12px icon and an `ink-sec` value, for
// the facts under a record's title (location, source, match score, applied
// date). Pass `asChild` content through `children`; it is static text.
function PropertyChip({
  className,
  icon,
  children,
  ...props
}: React.ComponentProps<"span"> & { icon?: React.ReactNode }) {
  return (
    <span
      className={cn(
        badgeVariants({ variant: "outline" }),
        "h-7 max-w-full px-2.5 text-ink-sec [&>svg]:text-muted-foreground",
        className
      )}
      data-slot="property-chip"
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

export { PropertyChip };
