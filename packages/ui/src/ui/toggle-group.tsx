import type { VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { createContext, use, useMemo } from "react";
import { cn } from "../lib/utils";

import { toggleVariants } from "./toggle";

type ToggleGroupContextValue = VariantProps<typeof toggleVariants> & {
  spacing?: number;
  orientation?: "horizontal" | "vertical";
};

const ToggleGroupContext = createContext<ToggleGroupContextValue>({
  size: "default",
  variant: "outline",
  spacing: 0,
  orientation: "horizontal",
});

// Zedative toggle group: a segmented control. By default its items are
// outlined pressables joined edge to edge (`spacing` 0) — neighbours share
// one hairline and only the outer corners take the 4px radius. Pass
// `spacing` for separate chips, or `variant="default"` for a ghost toolbar.
function ToggleGroup({
  className,
  variant = "outline",
  size,
  spacing = 0,
  orientation = "horizontal",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }) {
  const context = useMemo(
    () => ({ variant, size, spacing, orientation }),
    [variant, size, spacing, orientation]
  );

  return (
    <ToggleGroupPrimitive.Root
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-md data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      data-orientation={orientation}
      data-size={size}
      data-slot="toggle-group"
      data-spacing={spacing}
      data-variant={variant}
      orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      {...props}
    >
      <ToggleGroupContext value={context}>{children}</ToggleGroupContext>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = use(ToggleGroupContext);
  const itemVariant = context.variant || variant;
  const itemSize = context.size || size;

  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        toggleVariants({ variant: itemVariant, size: itemSize }),
        "focus:z-10 focus-visible:z-10",
        "group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:not-last:rounded-r-none group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:not-first:rounded-l-none group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:not-first:border-l-0",
        "group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:not-first:rounded-t-none group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:not-last:rounded-b-none group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:not-first:border-t-0",
        className
      )}
      data-size={itemSize}
      data-slot="toggle-group-item"
      data-spacing={context.spacing}
      data-variant={itemVariant}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
