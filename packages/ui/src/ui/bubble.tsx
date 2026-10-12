import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

// Zedative message surface (DESIGN.md § Typography: "subtitle … chat
// bubbles"): a 2px tile in the subtitle role, never a pill. The default is
// the bordered prompt — what you sent, on `bg-2` paper with a hairline — so
// it reads on the `pane` agent thread. The cobalt stays out of the thread;
// `tinted` uses the 7% wash for a suggestion you can apply. Bubbles appear
// without animation.

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2", className)}
      data-slot="bubble-group"
      {...props}
    />
  );
}

const bubbleVariants = cva(
  "group/bubble relative flex w-fit min-w-0 max-w-[80%] flex-col gap-1 data-[variant=ghost]:max-w-full data-[align=end]:self-end group-data-[align=end]/message:self-end",
  {
    variants: {
      variant: {
        // The bordered prompt: paper with a hairline.
        default:
          "*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-card *:data-[slot=bubble-content]:text-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-pane/70",
        // A neutral fill that still reads on the pane thread.
        secondary:
          "*:data-[slot=bubble-content]:bg-pane-2 *:data-[slot=bubble-content]:text-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-pane-2/70",
        // The pane fill, for bubbles that sit on paper.
        muted:
          "*:data-[slot=bubble-content]:bg-pane *:data-[slot=bubble-content]:text-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-pane-2",
        // The 7% cobalt wash: a suggestion you can apply.
        tinted:
          "*:data-[slot=bubble-content]:bg-wash *:data-[slot=bubble-content]:text-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-highlight",
        outline:
          "*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:text-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-pane/70",
        // No surface: the agent's answer as running text in ink.
        ghost:
          "*:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:p-0 *:data-[slot=bubble-content]:text-ink [&>[data-slot=bubble-content]:is(button,a):hover]:bg-pane/70",
        destructive:
          "*:data-[slot=bubble-content]:border-destructive/25 *:data-[slot=bubble-content]:bg-destructive/10 *:data-[slot=bubble-content]:text-destructive [&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    align?: "start" | "end";
  }) {
  return (
    <div
      className={cn(bubbleVariants({ variant }), className)}
      data-align={align}
      data-slot="bubble"
      data-variant={variant}
      {...props}
    />
  );
}

function BubbleContent({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      className={cn(
        "type-subtitle wrap-break-word w-fit min-w-0 max-w-full overflow-hidden rounded-sm border border-transparent px-3 py-2 group-data-[align=end]/bubble:self-end [button,a]:transition-[background-color,border-color,color] [button,a]:duration-150 [button,a]:ease-standard [button,a]:focus-visible:outline-2 [button,a]:focus-visible:outline-ring [button,a]:focus-visible:outline-solid [button,a]:focus-visible:outline-offset-2 [button]:cursor-pointer [button]:text-left",
        className
      )}
      data-slot="bubble-content"
      {...props}
    />
  );
}

const bubbleReactionsVariants = cva(
  "type-micro absolute z-10 flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-sm border border-border bg-card px-1.5 text-foreground has-[button]:p-0 [&_svg:not([class*='size-'])]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      side: {
        top: "top-0 -translate-y-3/4",
        bottom: "bottom-0 translate-y-3/4",
      },
      align: {
        start: "start-3",
        end: "end-3",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  }
);

function BubbleReactions({
  side = "bottom",
  align = "end",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end";
  side?: "top" | "bottom";
}) {
  return (
    <div
      className={cn(bubbleReactionsVariants({ side, align }), className)}
      data-align={align}
      data-side={side}
      data-slot="bubble-reactions"
      {...props}
    />
  );
}

export { BubbleGroup, Bubble, BubbleContent, BubbleReactions };
