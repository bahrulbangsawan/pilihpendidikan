import type * as React from "react";
import { cn } from "../lib/utils";
import { badgeVariants } from "./badge-variants";

// A property chip (reui's sheet properties, Linear's issue properties): a
// 32px outlined chip with 8px corners, 8px of side padding and a leading
// 14px icon, an optional `ink-sec` `label` ("Match", "Source") and a
// `foreground` value, for the facts under a
// record's title (location, source, match score, applied date). It is
// static text; `propertyChipClassName` gives a control (a select trigger)
// the same chip so a row of facts reads as one component; a chip that
// opens something ends in a chevron (the select trigger brings its own).

const PROPERTY_CHIP_CLASS =
  "type-body-compact h-8 max-w-full gap-1.5 rounded-lg px-2 text-foreground [&>svg]:size-3.5! [&>svg]:text-muted-foreground";

function propertyChipClassName(className?: string) {
  return cn(
    badgeVariants({ variant: "outline" }),
    PROPERTY_CHIP_CLASS,
    className
  );
}

function PropertyChip({
  className,
  icon,
  label,
  children,
  ...props
}: React.ComponentProps<"span"> & {
  icon?: React.ReactNode;
  /** What the value is, in `ink-sec` before the value ("Match", "Source"). */
  label?: React.ReactNode;
}) {
  return (
    <span
      className={propertyChipClassName(className)}
      data-slot="property-chip"
      {...props}
    >
      {icon}
      {label ? (
        <span className="text-ink-sec" data-slot="property-chip-label">
          {label}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export { PropertyChip, propertyChipClassName };
