import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// Switch, cursor.com style: a pill track (`pane-2` with the 20% `input`
// border, so it reads as a control on the page) holding a round thumb in
// ink at 60%. Checked, the track fills with the ink pill
// colour (`primary`) and the thumb turns `primary-foreground`. The thumb
// moves instantly; only the colours transition.
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-input bg-pane-2 p-px outline-none transition-[background-color,border-color] duration-140 ease-standard after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 aria-invalid:border-destructive data-[size=default]:h-4.5 data-[size=sm]:h-3.5 data-[size=default]:w-8 data-[size=sm]:w-6 data-disabled:cursor-not-allowed data-checked:border-primary data-checked:bg-primary data-disabled:opacity-50 data-[state=unchecked]:hover:border-offgray data-[state=unchecked]:hover:bg-pane-3",
        className
      )}
      data-size={size}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block rounded-full bg-ink-sec transition-[background-color] duration-140 ease-standard data-checked:bg-primary-foreground group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 group-data-[size=default]/switch:data-checked:translate-x-3.5 group-data-[size=sm]/switch:data-checked:translate-x-2.5"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
