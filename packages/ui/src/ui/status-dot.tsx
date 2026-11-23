import type * as React from "react";
import { cn } from "../lib/utils";

// A status dot (reui's status badges and select options): an 8px circle in a
// tone, placed before a label in a select option, menu row, badge or table
// cell. Zedative has no amber, so `warning` uses the orange `link` tone.
// `pulse` adds the slow status pulse (motion.css) for something live.
// Decorative: the label beside it carries the meaning.

const TONE_CLASS = {
  neutral: "bg-offgray",
  link: "bg-link",
  warning: "bg-link",
  success: "bg-success",
  destructive: "bg-destructive",
  ink: "bg-foreground",
} as const;

type StatusTone = keyof typeof TONE_CLASS;

function StatusDot({
  className,
  tone = "neutral",
  pulse = false,
  ...props
}: React.ComponentProps<"span"> & {
  tone?: StatusTone;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        TONE_CLASS[tone],
        pulse && "pulse-dot",
        className
      )}
      data-slot="status-dot"
      data-tone={tone}
      {...props}
    />
  );
}

export { StatusDot };
export type { StatusTone };
