import type * as React from "react";
import { cn } from "../lib/utils";

// A meter (reui's progress with a label row): a 4px `pane-2` track with a
// filled bar in a tone, and an optional caption row (label left, value
// right). For a score or a quota, not for loading (that is Progress). The
// tone follows the value by default: success from `high`, orange from
// `mid`, grey below.

type MeterTone = "auto" | "success" | "link" | "neutral" | "destructive";

const FILL = {
  success: "bg-success",
  link: "bg-link",
  neutral: "bg-offgray",
  destructive: "bg-destructive",
} as const;

const MIN_FILL = 4;

function Meter({
  className,
  value,
  max = 100,
  tone = "auto",
  high = 75,
  mid = 50,
  label,
  valueLabel,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  value: number;
  max?: number;
  tone?: MeterTone;
  /** With `tone="auto"`: the value from which the bar turns green. */
  high?: number;
  /** With `tone="auto"`: the value from which the bar turns orange. */
  mid?: number;
  label?: React.ReactNode;
  /** The value as text (defaults to `value%`). */
  valueLabel?: React.ReactNode;
}) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  let resolved: Exclude<MeterTone, "auto">;
  if (tone !== "auto") {
    resolved = tone;
  } else if (value >= high) {
    resolved = "success";
  } else if (value >= mid) {
    resolved = "link";
  } else {
    resolved = "neutral";
  }
  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      data-slot="meter"
      data-tone={resolved}
      {...props}
    >
      <div className="type-caption flex items-center justify-between gap-2">
        {label ? <span className="text-muted-foreground">{label}</span> : null}
        <span className="ml-auto text-foreground tabular-nums">
          {valueLabel ?? `${Math.round(percent)}%`}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="relative block h-1 w-full overflow-hidden rounded-full bg-pane-2"
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            FILL[resolved]
          )}
          style={{ width: `${Math.max(MIN_FILL, percent)}%` }}
        />
      </span>
    </div>
  );
}

export { Meter };
export type { MeterTone };
