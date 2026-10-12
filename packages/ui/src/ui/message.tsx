import type * as React from "react";
import { cn } from "../lib/utils";

// One row of a Zedative thread: an optional framed 2px avatar, a caption-role
// header with the sender's name in the semibold weight, the bubbles, and a
// muted caption-role footer for meta.
// `align="end"` is the current user's side. Rows appear without animation.

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      data-slot="message-group"
      {...props}
    />
  );
}

function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      className={cn(
        "group/message type-body relative flex w-full min-w-0 gap-2 data-[align=end]:flex-row-reverse",
        className
      )}
      data-align={align}
      data-slot="message"
      {...props}
    />
  );
}

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // Sits level with the last bubble, above a footer when there is one.
        "flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-sm group-has-data-[slot=message-footer]/message:-translate-y-6",
        className
      )}
      data-slot="message-avatar"
      {...props}
    />
  );
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "wrap-break-word flex w-full min-w-0 flex-col gap-2 group-data-[align=end]/message:*:data-slot:self-end",
        className
      )}
      data-slot="message-content"
      {...props}
    />
  );
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "type-caption weight-semibold flex min-w-0 max-w-full items-center gap-1.5 px-3 text-foreground group-has-data-[variant=ghost]/message:px-0",
        className
      )}
      data-slot="message-header"
      {...props}
    />
  );
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "type-caption flex min-w-0 max-w-full items-center gap-1.5 px-3 text-muted-foreground group-has-data-[variant=ghost]/message:px-0 group-data-[align=end]/message:justify-end",
        className
      )}
      data-slot="message-footer"
      {...props}
    />
  );
}

export {
  MessageGroup,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
};
