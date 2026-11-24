import type * as React from "react";
import { cn } from "../lib/utils";

// A button drawn as a field (reui's picker and search triggers): the
// cursor.com input (36px, 32px at `sm`, 8px corners, a 10% border on the page
// colour that deepens to 20% on hover and focus) holding a leading 16px icon
// in `ink-sec`, a truncating label and optional trailing content (a <Kbd>, a
// chevron). Use it where a control opens something rather than taking typed
// text: a date picker, a ⌘K search trigger, a picker dialog. `data-empty`
// greys the label as a placeholder.
function FieldButton({
  className,
  size = "default",
  empty = false,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & {
  size?: "sm" | "default";
  /** Shows the label in the placeholder grey. */
  empty?: boolean;
}) {
  return (
    <button
      className={cn(
        "type-body field-touch flex h-9 w-full min-w-0 select-none items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-foreground outline-none transition-[background-color,border-color,color] duration-140 ease-standard hover:border-input focus-visible:border-input focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-pane disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:outline-destructive data-[size=sm]:h-8 data-empty:text-muted-foreground [&>svg:first-child]:text-ink-sec [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-empty={empty || undefined}
      data-size={size}
      data-slot="field-button"
      type={type}
      {...props}
    />
  );
}

export { FieldButton };
