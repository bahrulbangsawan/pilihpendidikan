import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid w-full gap-2", className)}
      data-slot="radio-group"
      {...props}
    />
  );
}

// Radio, cursor.com style: a 16px circle with a 20% border on the page
// colour. Checked, it fills with the ink pill colour (`primary`) around a
// 6px `primary-foreground` dot.
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "group/radio-group-item peer relative flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background outline-none transition-[background-color,border-color] duration-140 ease-standard after:absolute after:-inset-x-3 after:-inset-y-2 hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 group-has-disabled/field:opacity-50 aria-invalid:border-destructive data-checked:border-primary data-checked:bg-primary",
        className
      )}
      data-slot="radio-group-item"
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        className="flex items-center justify-center"
        data-slot="radio-group-indicator"
      >
        <span className="size-1.5 rounded-full bg-primary-foreground" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
