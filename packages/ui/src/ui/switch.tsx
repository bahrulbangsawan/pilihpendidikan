import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// Switch, reui style: a 36x20 pill track. Off, the track is `pane-3` and
// the 16px knob is `ink-sec`, so it reads as a control on the page; on, the
// track turns light (`foreground`) and the knob dark (`background`). The
// knob moves instantly; only the colours transition. `sm` is 28x16.
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
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent bg-pane-3 p-px outline-none transition-[background-color,border-color] duration-140 ease-standard after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 aria-invalid:border-destructive data-[size=default]:h-5 data-[size=sm]:h-4 data-[size=default]:w-9 data-[size=sm]:w-7 data-disabled:cursor-not-allowed data-checked:bg-foreground data-disabled:opacity-50 data-[state=unchecked]:hover:border-input",
        className
      )}
      data-size={size}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block rounded-full bg-ink-sec transition-[background-color] duration-140 ease-standard data-checked:bg-background group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
