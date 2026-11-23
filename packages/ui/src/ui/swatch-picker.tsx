import { PlusIcon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

// Swatch picker (reui's color picker swatches): 24px colour dots with a
// hairline ring, one choice at a time (a radio group: arrow keys move, the
// chosen dot gets a 2px ink ring). With `allowCustom` a last dot opens the
// browser's colour dialog and shows the custom colour once chosen. The
// colours are content (a document's brand accent), never chrome, so they are
// passed in as hex values. `value` / `onValueChange` take `#rrggbb`.

const SWATCH =
  "relative size-6 shrink-0 cursor-pointer rounded-full border border-hairline outline-none transition-[box-shadow] duration-140 ease-standard focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 data-[state=checked]:ring-2 data-[state=checked]:ring-foreground data-[state=checked]:ring-offset-2 data-[state=checked]:ring-offset-background";

function SwatchPicker({
  className,
  colors,
  value,
  onValueChange,
  allowCustom = false,
  customLabel = "Custom colour",
  getColorLabel = (color) => color,
  ...props
}: Omit<
  React.ComponentProps<typeof RadioGroupPrimitive.Root>,
  "value" | "onValueChange" | "defaultValue"
> & {
  colors: readonly string[];
  value: string;
  onValueChange: (color: string) => void;
  allowCustom?: boolean;
  customLabel?: string;
  /** Accessible name of each swatch; defaults to the hex value. */
  getColorLabel?: (color: string) => string;
}) {
  const normalized = value.toLowerCase();
  const isCustom =
    allowCustom && !colors.some((c) => c.toLowerCase() === normalized);

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2.5 py-1.5", className)}
      data-slot="swatch-picker"
    >
      <RadioGroupPrimitive.Root
        className="flex flex-wrap items-center gap-2.5"
        onValueChange={onValueChange}
        orientation="horizontal"
        value={isCustom ? "" : normalized}
        {...props}
      >
        {colors.map((color) => (
          <RadioGroupPrimitive.Item
            aria-label={getColorLabel(color)}
            className={SWATCH}
            data-slot="swatch-picker-item"
            key={color}
            style={{ backgroundColor: color }}
            value={color.toLowerCase()}
          />
        ))}
      </RadioGroupPrimitive.Root>
      {allowCustom ? (
        <label
          className={cn(
            SWATCH,
            "flex bg-pane has-focus-visible:outline-2 has-focus-visible:outline-ring has-focus-visible:outline-solid has-focus-visible:outline-offset-2"
          )}
          data-slot="swatch-picker-custom"
          data-state={isCustom ? "checked" : "unchecked"}
          style={isCustom ? { backgroundColor: value } : undefined}
        >
          {isCustom ? null : (
            <PlusIcon
              aria-hidden="true"
              className="m-auto size-3.5 text-muted-foreground"
            />
          )}
          <input
            aria-label={customLabel}
            className="sr-only"
            onChange={(event) => onValueChange(event.target.value)}
            type="color"
            value={value}
          />
        </label>
      ) : null}
    </div>
  );
}

export { SwatchPicker };
