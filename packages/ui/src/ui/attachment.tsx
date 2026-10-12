import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

import { Button } from "./button";

// Zedative file tile: a 2px tile on `bg-2` paper with a hairline. An idle
// slot is framed with a dashed outline (like the screenshot frames); an
// error turns the frame and the media tile destructive. While a file is
// uploading or processing its title drops to muted ink: put the Blocks
// `Spinner` in the media tile for motion, nothing else animates. A tile with
// an `AttachmentTrigger` becomes a pressable: lip, pane hover, press.

const attachmentVariants = cva(
  "group/attachment has-[>[data-slot=attachment-trigger]]:press relative flex w-fit min-w-0 max-w-full shrink-0 flex-wrap rounded-sm border border-border bg-card text-card-foreground transition-[background-color,border-color,box-shadow] duration-150 ease-standard has-[>[data-slot=attachment-trigger]]:inset-shadow-lip has-[>[data-slot=attachment-trigger]:focus-visible]:outline-2 has-[>[data-slot=attachment-trigger]:focus-visible]:outline-ring has-[>[data-slot=attachment-trigger]:focus-visible]:outline-solid has-[>[data-slot=attachment-trigger]:focus-visible]:outline-offset-2 has-[>[data-slot=attachment-trigger]]:hover:inset-shadow-none has-[>[data-slot=attachment-trigger]]:hover:bg-pane/70 data-[state=error]:border-destructive/40 data-[state=idle]:border-line data-[state=idle]:border-dashed",
  {
    variants: {
      size: {
        default:
          "type-body gap-2 has-data-[slot=attachment-media]:p-1.5 has-data-[slot=attachment-content]:px-2 has-data-[slot=attachment-content]:py-1.5",
        sm: "type-body gap-2 has-data-[slot=attachment-media]:p-1 has-data-[slot=attachment-content]:px-1.5 has-data-[slot=attachment-content]:py-1",
        xs: "type-caption gap-1.5 has-data-[slot=attachment-media]:p-1 has-data-[slot=attachment-content]:px-1.5 has-data-[slot=attachment-content]:py-1",
      },
      orientation: {
        horizontal: "min-w-40 items-center",
        vertical: "w-24 flex-col has-data-[slot=attachment-content]:w-30",
      },
    },
  }
);

function Attachment({
  className,
  state = "done",
  size = "default",
  orientation = "horizontal",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof attachmentVariants> & {
    state?: "idle" | "uploading" | "processing" | "error" | "done";
  }) {
  return (
    <div
      className={cn(attachmentVariants({ size, orientation }), className)}
      data-orientation={orientation}
      data-size={size}
      data-slot="attachment"
      data-state={state}
      {...props}
    />
  );
}

const attachmentMediaVariants = cva(
  "relative flex aspect-square w-10 shrink-0 items-center justify-center overflow-hidden rounded-xs bg-pane text-foreground group-data-[orientation=vertical]/attachment:w-full group-data-[size=sm]/attachment:w-8 group-data-[size=xs]/attachment:w-7 group-data-[state=error]/attachment:bg-destructive/10 group-data-[state=error]/attachment:text-destructive group-data-[orientation=vertical]/attachment:*:data-[slot=spinner]:[--spinner-size:20px] [&_svg:not([class*='size-'])]:size-4 group-data-[orientation=vertical]/attachment:[&_svg:not([class*='size-'])]:size-5 group-data-[size=xs]/attachment:[&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        icon: "",
        // A screenshot placeholder until the image arrives: the dark `shot`.
        image:
          "bg-shot text-offgray opacity-60 group-data-[state=done]/attachment:opacity-100 group-data-[state=idle]/attachment:opacity-100 *:[img]:aspect-square *:[img]:w-full *:[img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "icon",
    },
  }
);

function AttachmentMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof attachmentMediaVariants>) {
  return (
    <div
      className={cn(attachmentMediaVariants({ variant }), className)}
      data-slot="attachment-media"
      data-variant={variant}
      {...props}
    />
  );
}

function AttachmentContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full flex-1 group-data-[orientation=vertical]/attachment:px-1",
        className
      )}
      data-slot="attachment-content"
      {...props}
    />
  );
}

function AttachmentTitle({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "block min-w-0 max-w-full truncate text-foreground group-data-[state=processing]/attachment:text-muted-foreground group-data-[state=uploading]/attachment:text-muted-foreground",
        className
      )}
      data-slot="attachment-title"
      {...props}
    />
  );
}

function AttachmentDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "type-caption block min-w-0 max-w-full truncate text-muted-foreground tabular-nums group-data-[state=error]/attachment:text-destructive",
        className
      )}
      data-slot="attachment-description"
      {...props}
    />
  );
}

function AttachmentActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative z-20 flex shrink-0 items-center group-data-[orientation=vertical]/attachment:absolute group-data-[orientation=vertical]/attachment:end-2 group-data-[orientation=vertical]/attachment:top-2 group-data-[orientation=vertical]/attachment:gap-1",
        className
      )}
      data-slot="attachment-actions"
      {...props}
    />
  );
}

function AttachmentAction({
  className,
  variant,
  size = "icon-xs",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(className)}
      data-slot="attachment-action"
      size={size}
      variant={variant ?? "ghost"}
      {...props}
    />
  );
}

function AttachmentTrigger({
  className,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      className={cn("absolute inset-0 z-10 outline-none", className)}
      data-slot="attachment-trigger"
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
}

function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "scroll-fade-x scrollbar-none flex min-w-0 snap-x snap-mandatory scroll-px-1 gap-2 overflow-x-auto overscroll-x-contain py-1 *:data-[slot=attachment]:flex-none *:data-[slot=attachment]:snap-start",
        className
      )}
      data-slot="attachment-group"
      {...props}
    />
  );
}

export {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
};
