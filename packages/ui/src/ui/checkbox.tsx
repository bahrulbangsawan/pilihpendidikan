import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

// Checkbox, cursor.com style: a 16px square with a 4px radius, a 20% border
// on the page colour. Checked (or indeterminate) it fills with the ink pill
// colour (`primary`) and shows a 14px tick (or dash) in `primary-foreground`.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer group/checkbox relative flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background text-primary-foreground outline-none transition-[background-color,border-color] duration-140 ease-standard after:absolute after:-inset-x-3 after:-inset-y-2 hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 group-has-disabled/field:opacity-50 aria-invalid:border-destructive data-[state=indeterminate]:border-primary data-checked:border-primary data-[state=indeterminate]:bg-primary data-checked:bg-primary data-[state=indeterminate]:text-primary-foreground data-checked:text-primary-foreground",
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
