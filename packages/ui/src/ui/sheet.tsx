import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

import { Button } from "./button";

// cursor.com side panel: square edges against the viewport, the popover
// fill with the soft drop and a 10% border on its inner edge, over the flat 75%
// `shot` scrim. It appears in place, without sliding. The title takes the
// title role at weight 400, the description muted body text. `floating`
// (reui's sheet) lifts a side panel 12px off the viewport edges: a 12px
// window with a full border and the window shadow. The close × is a bare
// ghost icon button in the corner.

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      className={cn("fixed inset-0 z-50 bg-shot/75", className)}
      data-slot="sheet-overlay"
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  floating = false,
  closeLabel = "Close",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
  /** Inset 12px from the viewport with 12px corners and a full border. */
  floating?: boolean;
  /** The close button's accessible name. */
  closeLabel?: string;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          "type-body fixed z-50 flex flex-col overflow-y-auto rounded-none border-border bg-popover text-ink shadow-lg outline-none data-[side=left]:data-[floating=true]:inset-y-3 data-[side=right]:data-[floating=true]:inset-y-3 data-[side=right]:data-[floating=true]:right-3 data-[side=left]:data-[floating=true]:left-3 data-[side=left]:data-[floating=true]:h-auto data-[side=right]:data-[floating=true]:h-auto data-[side=bottom]:inset-x-0 data-[side=top]:inset-x-0 data-[side=left]:inset-y-0 data-[side=right]:inset-y-0 data-[side=top]:top-0 data-[side=right]:right-0 data-[side=bottom]:bottom-0 data-[side=left]:left-0 data-[side=bottom]:h-auto data-[side=left]:h-full data-[side=right]:h-full data-[side=top]:h-auto data-[side=bottom]:max-h-[85dvh] data-[side=top]:max-h-[85dvh] data-[side=left]:w-3/4 data-[side=right]:w-3/4 data-[floating=true]:rounded-xl data-[floating=true]:border data-[side=bottom]:border-t data-[side=left]:border-r data-[side=top]:border-b data-[side=right]:border-l data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          className
        )}
        data-floating={floating}
        data-side={side}
        data-slot="sheet-content"
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close asChild data-slot="sheet-close">
            <Button
              aria-label={closeLabel}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              size="icon-sm"
              variant="ghost"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // Clear the corner close button when the sheet shows one.
        "flex flex-col gap-1 p-4 has-[~[data-slot=sheet-close]]:pr-12",
        className
      )}
      data-slot="sheet-header"
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      data-slot="sheet-footer"
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn("type-title text-foreground", className)}
      data-slot="sheet-title"
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      className={cn("type-body text-muted-foreground", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
