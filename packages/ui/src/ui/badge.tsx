import type { VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";
import { badgeVariants } from "./badge-variants";

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      className={cn(badgeVariants({ variant }), className)}
      data-slot="badge"
      data-variant={variant}
      {...props}
    />
  );
}

// A removable chip (reui's badge with a remove button): the whole pill is the
// button, its label followed by a 12px ×. `removeLabel` names the action for
// screen readers ("Remove TypeScript"); it hovers to `pane-3`.
function BadgeButton({
  className,
  variant = "secondary",
  children,
  removeLabel,
  ...props
}: Omit<React.ComponentProps<"button">, "type"> &
  VariantProps<typeof badgeVariants> & { removeLabel: string }) {
  return (
    <button
      aria-label={removeLabel}
      className={cn(
        badgeVariants({ variant }),
        "cursor-pointer hover:bg-pane-3 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2",
        className
      )}
      data-slot="badge-button"
      data-variant={variant}
      type="button"
      {...props}
    >
      {children}
      <XIcon aria-hidden="true" data-icon="inline-end" />
    </button>
  );
}

export { Badge, BadgeButton };
