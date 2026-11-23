import type * as React from "react";
import { cn } from "../lib/utils";

// A meter (reui's progress with a label row): a 4px `pane-2` track with a
// filled bar in a tone, and an optional caption row (label left, value
// right). For a score or a quota, not for loading (that is Progress). Data
// stays neutral by default: an `ink-sec` bar, the number carries the value
// (orange is for links). `tone="auto"` colours by value (success from
// `high`, orange from `mid`) for the rare meter that must alarm. `inline`
// puts a 64px bar and the value on one line (list rows).

type MeterTone = "auto" | "success" | "link" | "neutral" | "destructive";

const FILL = {
  success: "bg-success",
  link: "bg-link",
  neutral: "bg-ink-sec",
  destructive: "bg-destructive",
} as const;

const MIN_FILL = 4;

function Meter({
  className,
  value,
  max = 100,
  tone = "neutral",
  high = 75,
  mid = 50,
  label,
  valueLabel,
  inline = false,
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
  /** One line: a 64px bar with the value to its right (list rows). */
  inline?: boolean;
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
  const bar = (
    <span
      aria-hidden="true"
      className={cn(
        "relative block h-1 overflow-hidden rounded-full bg-pane-2",
        inline ? "w-16 shrink-0" : "w-full"
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full", FILL[resolved])}
        style={{ width: `${Math.max(MIN_FILL, percent)}%` }}
      />
    </span>
  );
  const text = (
    <span className="text-foreground tabular-nums">
      {valueLabel ?? `${Math.round(percent)}%`}
    </span>
  );
  if (inline) {
    return (
      <div
        className={cn("type-caption flex items-center gap-2", className)}
        data-inline=""
        data-slot="meter"
        data-tone={resolved}
        {...props}
      >
        {label ? <span className="text-muted-foreground">{label}</span> : null}
        {bar}
        {text}
      </div>
    );
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
        <span className="ml-auto">{text}</span>
      </div>
      {bar}
    </div>
  );
}

export { Meter };
export type { MeterTone };
