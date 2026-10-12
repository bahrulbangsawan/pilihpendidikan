import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

// Zedative thread markers in the caption role and muted ink: tool lines
// (`○ Read cv.json`), system notes and day dividers ruled by `line`
// hairlines. Links in a marker are cobalt.

const markerVariants = cva(
  "group/marker type-caption relative flex min-h-4 w-full items-center gap-2 text-start text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5 [a]:text-primary [a]:underline [a]:underline-offset-4",
  {
    variants: {
      variant: {
        default: "",
        separator:
          "before:me-1 before:h-px before:min-w-0 before:flex-1 before:bg-line after:ms-1 after:h-px after:min-w-0 after:flex-1 after:bg-line",
        border: "border-line border-b pb-2",
      },
    },
  }
);

function Marker({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof markerVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      className={cn(markerVariants({ variant, className }))}
      data-slot="marker"
      data-variant={variant}
      {...props}
    />
  );
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      data-slot="marker-icon"
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "wrap-break-word min-w-0 group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:text-primary *:[a]:underline *:[a]:underline-offset-4",
        className
      )}
      data-slot="marker-content"
      {...props}
    />
  );
}

export { Marker, MarkerIcon, MarkerContent, markerVariants };
