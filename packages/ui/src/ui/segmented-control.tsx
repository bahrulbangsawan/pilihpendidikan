import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

// Segmented control (reui's toggle group, cursor.com's pricing toggle): a
// `pane` pill track whose chosen segment is the lighter `pane-3` pill with a
// border ring (cursor.com's chosen segment reads raised, never recessed). The
// track is as tall as the pill buttons beside it: 36px, `sm` 28px. Single choice, and it can't be emptied: clicking the chosen segment
// keeps it. Segments may lead with a 14px icon or a flag. Use it for a
// switch between a few views or a language; for a toolbar of independent
// toggles use ToggleGroup. Arrow keys move between segments (roving focus).

function SegmentedControl({
  className,
  value,
  defaultValue,
  onValueChange,
  size = "default",
  ...props
}: Omit<
  React.ComponentProps<typeof ToggleGroupPrimitive.Root>,
  "type" | "value" | "defaultValue" | "onValueChange"
> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  size?: "sm" | "default";
}) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn(
        "group/segmented inline-flex w-fit shrink-0 items-center gap-0.5 rounded-full bg-pane p-0.5",
        className
      )}
      data-size={size}
      data-slot="segmented-control"
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (next) {
          onValueChange?.(next);
        }
      }}
      type="single"
      value={value}
      {...props}
    />
  );
}

function SegmentedControlItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "type-body group-data-[size=sm]/segmented:type-caption inline-flex h-8 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-3 text-muted-foreground outline-none transition-[background-color,box-shadow,color] duration-140 ease-standard hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-pane-3 data-[state=on]:text-foreground data-[state=on]:shadow-[0_0_0_1px_var(--border)] group-data-[size=sm]/segmented:h-6 group-data-[size=sm]/segmented:px-2.5 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-slot="segmented-control-item"
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedControlItem };
