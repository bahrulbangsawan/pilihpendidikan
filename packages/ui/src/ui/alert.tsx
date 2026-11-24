import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

// cursor.com callout: a card (one step off the page, 4px radius, 2.5%
// hairline) that stays in the page. The title is body role at weight 400 in
// the variant's ink, the description body role at 66%, links orange. The
// destructive variant is a 10% `destructive` tint with destructive text.
const alertVariants = cva(
  "group/alert type-body relative grid w-full gap-y-0.5 rounded-sm border px-4 py-3 text-left has-data-[slot=alert-action]:relative has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 has-data-[slot=alert-action]:pr-24 *:[svg:not([class*='size-'])]:size-3.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.75 *:[svg]:text-current",
  {
    variants: {
      variant: {
        default: "border-hairline bg-card text-card-foreground",
        destructive:
          "border-destructive/25 bg-destructive/10 text-destructive *:data-[slot=alert-description]:text-destructive/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      className={cn(alertVariants({ variant }), className)}
      data-slot="alert"
      role="alert"
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "group-has-[>svg]/alert:col-start-2 [&_a]:text-link",
        className
      )}
      data-slot="alert-title"
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "type-body text-balance text-muted-foreground md:text-pretty [&_a]:text-link [&_a]:hover:text-link/75 [&_p:not(:last-child)]:mb-2",
        className
      )}
      data-slot="alert-description"
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("absolute top-2.5 right-3", className)}
      data-slot="alert-action"
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
