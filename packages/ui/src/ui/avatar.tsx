import { Avatar as AvatarPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils";

// cursor.com avatar (the blog bylines): a circle on `pane-2` with a 2.5%
// hairline. Without a photo it shows weight-400 initials in muted ink.
// Groups overlap on a page-colour ring and end in a round count. Images
// appear without a fade.
function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg" | "xs";
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "group/avatar relative flex size-8 shrink-0 select-none rounded-full border border-hairline bg-pane-2 data-[size=lg]:size-10 data-[size=sm]:size-6 data-[size=xs]:size-5",
        className
      )}
      data-size={size}
      data-slot="avatar"
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      className={cn(
        "aspect-square size-full rounded-full object-cover",
        className
      )}
      data-slot="avatar-image"
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "type-caption group-data-[size=sm]/avatar:type-micro group-data-[size=xs]/avatar:type-micro-compact flex size-full items-center justify-center rounded-full bg-pane-2 text-muted-foreground",
        className
      )}
      data-slot="avatar-fallback"
      {...props}
    />
  );
}

// A status dot on the avatar's corner.
function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "absolute -right-0.5 -bottom-0.5 z-10 inline-flex select-none items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      data-slot="avatar-badge"
      {...props}
    />
  );
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "group/avatar-group flex -space-x-1.5 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      data-slot="avatar-group"
      {...props}
    />
  );
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "type-caption group-has-data-[size=sm]/avatar-group:type-micro group-has-data-[size=xs]/avatar-group:type-micro-compact relative flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-pane-2 text-muted-foreground tabular-nums ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 group-has-data-[size=xs]/avatar-group:size-5 [&>svg]:size-3.5 group-has-data-[size=lg]/avatar-group:[&>svg]:size-4 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      data-slot="avatar-group-count"
      {...props}
    />
  );
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
};
