import type { VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";
import { badgeVariants } from "./badge-variants";

// A status chip (reui's status badges): `tone` turns the pill into a 4px
// chip on a 12% tint of the tone with a matching 6px dot before the label,
// in the tone's own text colour (every tone is AA on its tint). `neutral`
// and `ink` keep foreground text; `link` stays for links only.
const BADGE_TONE = {
  neutral: {
    chip: "bg-offgray/12 text-ink-sec",
    dot: "bg-offgray",
  },
  ink: { chip: "bg-foreground/10 text-foreground", dot: "bg-foreground" },
  link: { chip: "bg-link/12 text-foreground", dot: "bg-link" },
  success: { chip: "bg-success/12 text-success", dot: "bg-success" },
  destructive: {
    chip: "bg-destructive/12 text-destructive",
    dot: "bg-destructive",
  },
  blue: { chip: "bg-tone-blue/12 text-tone-blue", dot: "bg-tone-blue" },
  violet: {
    chip: "bg-tone-violet/12 text-tone-violet",
    dot: "bg-tone-violet",
  },
  amber: { chip: "bg-tone-amber/12 text-tone-amber", dot: "bg-tone-amber" },
} as const;

type BadgeTone = keyof typeof BADGE_TONE;

function Badge({
  className,
  variant = "default",
  tone,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
    /** A tinted status chip with a dot (overrides `variant`'s colours). */
    tone?: BadgeTone;
  }) {
  const Comp = asChild ? Slot.Root : "span";

  if (tone) {
    return (
      <span
        className={cn(
          badgeVariants({ variant: "secondary" }),
          "rounded-sm border-transparent",
          BADGE_TONE[tone].chip,
          className
        )}
        data-slot="badge"
        data-tone={tone}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", BADGE_TONE[tone].dot)}
          data-slot="badge-dot"
        />
        {children}
      </span>
    );
  }

  return (
    <Comp
      className={cn(badgeVariants({ variant }), className)}
      data-slot="badge"
      data-variant={variant}
      {...props}
    >
      {children}
    </Comp>
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
export type { BadgeTone };
