import { HoverCard as HoverCardPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

// cursor.com flyout for previews on hover (a profile, a recruiter): 8px
// corners, a 10% border on the popover fill and two whisper shadows. It
// appears in place, without animation.

function HoverCard({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  );
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Content
        align={align}
        className={cn(
          "type-body z-50 w-64 origin-(--radix-hover-card-content-transform-origin) rounded-lg border border-border bg-popover p-4 text-ink shadow-md outline-none",
          className
        )}
        data-slot="hover-card-content"
        sideOffset={sideOffset}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
