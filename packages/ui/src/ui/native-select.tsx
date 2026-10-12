import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default";
};

// Zedative native select: the browser's own menu behind the field shell
// (36px, 32px at `sm`) with a muted chevron. No JavaScript, so it suits long
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
        className="type-body field-touch h-9 w-full min-w-0 select-none appearance-none rounded-md border border-input bg-card/60 py-1 pr-8 pl-2.5 text-foreground outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-standard placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-pane/50 disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 data-[size=sm]:h-8"
        data-size={size}
        data-slot="native-select"
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 select-none text-muted-foreground group-has-[select:disabled]/native-select:opacity-60"
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
