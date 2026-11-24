import type * as React from "react";
import { cn } from "../lib/utils";

// A desktop window (cursor.com's product windows): an 8px card with the one
// soft drop shadow, a 28px title bar with three muted traffic lights and a
// centred caption-role title, then the content. For product shots and mock
// screens on a marketing page. It is a <figure> whose <figcaption> is the
// title bar; wrap it in `aria-hidden` when it is decoration.
function WindowFrame({
  className,
  title,
  children,
  ...props
}: Omit<React.ComponentProps<"figure">, "title"> & {
  title: React.ReactNode;
}) {
  return (
    <figure
      className={cn(
        "m-0 flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg",
        className
      )}
      data-slot="window-frame"
      {...props}
    >
      <figcaption className="grid h-7 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-border border-b px-3">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-pane-3" />
          <span className="size-2.5 rounded-full bg-pane-3" />
          <span className="size-2.5 rounded-full bg-pane-3" />
        </span>
        <span className="type-caption truncate text-ink-sec">{title}</span>
      </figcaption>
      {children}
    </figure>
  );
}

export { WindowFrame };
