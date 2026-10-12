import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

// Zedative toggle: a 4px pressable in the body role. `default` is ghost (a
// pane fill on hover); `outline` is the segmented pressable — paper at 60%,
// a 60% border and the grey lip, which drops on hover. On, either variant
// fills `pane-2` and its label goes semibold (opsz keeps the width).
const toggleVariants = cva(
  "group/toggle press type-body data-[state=on]:weight-semibold inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-foreground outline-none transition-[background-color,border-color,box-shadow,color] duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive data-[state=on]:bg-pane-2 data-[state=off]:hover:bg-pane/70 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "inset-shadow-lip border border-border/60 bg-card/60 hover:inset-shadow-none data-[state=on]:inset-shadow-none",
      },
      size: {
        default:
          "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-8 min-w-8 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-10 min-w-10 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      className={cn(toggleVariants({ variant, size, className }))}
      data-size={size}
      data-slot="toggle"
      data-variant={variant}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
