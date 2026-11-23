import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

// Toggle, cursor.com style: a pill in the body role, weight 400 throughout.
// `default` is ghost (a `pane` fill on hover); `outline` adds the 20% border
// of the outline button. On, either variant fills `pane-2` and its text
// turns `foreground`.
const toggleVariants = cva(
  "group/toggle type-body inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-muted-foreground outline-none transition-[background-color,border-color,color] duration-140 ease-standard focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive data-[state=on]:bg-pane-2 data-[state=on]:text-foreground data-[state=off]:hover:bg-pane data-[state=off]:hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent",
      },
      size: {
        default:
          "h-9 min-w-9 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        sm: "h-7 min-w-7 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "type-subtitle h-[43px] min-w-[43px] px-4 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-4",
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
