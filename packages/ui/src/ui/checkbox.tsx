import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

// Zedative checkbox: a 16px square with a 2px radius, outlined in `line` on
// half-transparent paper. Checked (or indeterminate) it fills cobalt with a
// 14px tick (or dash) in `primary-foreground`.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer group/checkbox relative flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-card/60 text-primary-foreground outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-standard after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 group-has-disabled/field:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 data-[state=indeterminate]:border-primary data-checked:border-primary data-[state=indeterminate]:bg-primary data-checked:bg-primary data-[state=indeterminate]:text-primary-foreground data-checked:text-primary-foreground data-[state=unchecked]:hover:bg-pane/70",
        className
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="grid place-content-center text-current [&>svg]:size-3.5"
        data-slot="checkbox-indicator"
      >
        <CheckIcon className="group-data-[state=indeterminate]/checkbox:hidden" />
        <MinusIcon className="hidden group-data-[state=indeterminate]/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
