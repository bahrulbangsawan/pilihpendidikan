import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default";
};

// Native select: the browser's own menu behind the `Input` shell (36px, 32px
// at `sm`, 8px radius, 10% border, 20% on hover/focus with the 2px ink
// outline) and a muted chevron. No JavaScript, so it suits long
// fixed lists (years, months) and forms that must work before hydration.
function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn("group/native-select relative w-fit min-w-0", className)}
      data-size={size}
      data-slot="native-select-wrapper"
    >
      <select
        className="type-body field-touch h-9 w-full min-w-0 select-none appearance-none rounded-lg border border-border bg-background py-1 pr-8 pl-3 text-foreground outline-none transition-[background-color,border-color] duration-140 ease-standard placeholder:text-muted-foreground hover:border-input focus-visible:border-input focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-pane disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:outline-destructive data-[size=sm]:h-8"
        data-size={size}
        data-slot="native-select"
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 select-none text-muted-foreground group-has-[select:disabled]/native-select:opacity-50"
        data-slot="native-select-icon"
      />
    </div>
  );
}

// Options render in the browser's menu; the tokens keep them legible in
// both schemes where the platform honours them.
function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      className={cn("bg-popover text-popover-foreground", className)}
      data-slot="native-select-option"
      {...props}
    />
  );
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      className={cn("bg-popover text-popover-foreground", className)}
      data-slot="native-select-optgroup"
      {...props}
    />
  );
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
