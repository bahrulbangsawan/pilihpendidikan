import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller as useMessageScrollerPrimitive,
  useMessageScrollerScrollable as useMessageScrollerScrollablePrimitive,
  useMessageScrollerVisibility as useMessageScrollerVisibilityPrimitive,
} from "@shadcn/react/message-scroller";
import { ArrowDownIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

import { Button } from "./button";

// The scrolling Zedative thread. The primitive follows new messages, holds
// the turn you asked and restores position; the styling only frames it. New
// messages do not animate in, the jump-to-latest button appears and leaves
// without moving, and the jump itself is instant (pass `behavior="smooth"`
// to opt back in).

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className
      )}
      data-slot="message-scroller"
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      className={cn(
        "scroll-fade-b scrollbar-thin scrollbar-gutter-stable data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain outline-none contain-content focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:-outline-offset-2 data-pending-scroll:invisible",
        className
      )}
      data-slot="message-scroller-viewport"
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      className={cn("flex h-max min-h-full flex-col gap-5", className)}
      data-slot="message-scroller-content"
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      className={cn(
        "min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]",
        className
      )}
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      {...props}
    />
  );
}

function MessageScrollerButton({
  direction = "end",
  behavior = "auto",
  className,
  children,
  render,
  variant = "outline",
  size = "icon-sm",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <MessageScrollerPrimitive.Button
      behavior={behavior}
      className={cn(
        "absolute inset-s-1/2 -translate-x-1/2 bg-card data-[active=false]:pointer-events-none data-[active=false]:invisible data-[direction=start]:top-3 data-[direction=end]:bottom-3 rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180",
        className
      )}
      data-direction={direction}
      data-size={size}
      data-slot="message-scroller-button"
      data-variant={variant}
      direction={direction}
      render={render ?? <Button size={size} variant={variant} />}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">
            {direction === "end" ? "Scroll to end" : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  );
}

// The primitive's hooks, for behaviour the parts don't expose (rules/chat.md).
const useMessageScroller = useMessageScrollerPrimitive;
const useMessageScrollerScrollable = useMessageScrollerScrollablePrimitive;
const useMessageScrollerVisibility = useMessageScrollerVisibilityPrimitive;

export {
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
};
