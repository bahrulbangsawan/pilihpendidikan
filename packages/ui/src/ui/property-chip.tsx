import type * as React from "react";
import { cn } from "../lib/utils";
import { badgeVariants } from "./badge-variants";

// A property chip (reui's property badges, Linear's issue properties): a
// 28px outlined pill with a leading 12px icon, an optional muted `label`
// ("Match", "Source") and an `ink-sec` value, for the facts under a
// record's title (location, source, match score, applied date). It is
// static text; `propertyChipClassName` gives a control (a select trigger)
// the same pill so a row of facts reads as one component.

const PROPERTY_CHIP_CLASS =
  "h-7 max-w-full px-2.5 text-ink-sec [&>svg]:text-muted-foreground";

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
  /** What the value is, in muted ink before it ("Match", "Source"). */
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
        <span className="text-muted-foreground" data-slot="property-chip-label">
          {label}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export { PropertyChip, propertyChipClassName };
