import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";
import { useMemo } from "react";
import { cn } from "../lib/utils";

function thumbValues(
  value: number[] | undefined,
  defaultValue: number[] | undefined,
  min: number,
  max: number
): number[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(defaultValue)) {
    return defaultValue;
  }
  return [min, max];
}

// Radix names each thumb only from its own props, so the slider's label is
// forwarded to every thumb; the two ends of a range say which end they are.
function thumbLabel(
  label: string | undefined,
  index: number,
  count: number
): string | undefined {
  if (!label || count === 1) {
    return label;
  }
  if (count === 2) {
    return `${label}, ${index === 0 ? "minimum" : "maximum"}`;
  }
  return `${label}, ${index + 1} of ${count}`;
}

// Slider, cursor.com style: a thin round `pane-2` track with an ink
// (`primary`) range and a round 14px thumb on the page colour with an ink
// edge. The thumb follows the pointer directly; only its fill transitions.
// `aria-label` / `aria-labelledby` name the thumbs.
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const values = useMemo(
    () => thumbValues(value, defaultValue, min, max),
    [value, defaultValue, min, max]
  );

  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex w-full touch-none select-none items-center data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col data-disabled:opacity-50",
        className
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      max={max}
      min={min}
      value={value}
      {...props}
    >
      <SliderPrimitive.Track
        className="relative grow overflow-hidden rounded-full bg-pane-2 data-horizontal:h-1 data-vertical:h-full data-horizontal:w-full data-vertical:w-1"
        data-slot="slider-track"
      >
        <SliderPrimitive.Range
          className="absolute select-none bg-primary data-horizontal:h-full data-vertical:w-full"
          data-slot="slider-range"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          className="relative block size-3.5 shrink-0 cursor-grab select-none rounded-full border border-primary bg-background outline-none transition-[background-color,border-color] duration-140 ease-standard after:absolute after:-inset-2 hover:bg-pane focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 active:cursor-grabbing data-disabled:pointer-events-none"
          aria-label={thumbLabel(ariaLabel, index, values.length)}
          aria-labelledby={ariaLabelledBy}
          data-slot="slider-thumb"
          // biome-ignore lint/suspicious/noArrayIndexKey: thumbs are positional — the nth thumb always carries the nth value, and values can repeat
          key={index}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
