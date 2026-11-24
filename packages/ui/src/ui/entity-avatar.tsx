import type * as React from "react";
import { initialsOf } from "../lib/initials";
import { cn } from "../lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

// A letter avatar for a company, a person or any named thing (reui's logo
// slot): up to two initials on `pane-2`, or the image when `src` loads.
// `shape="square"` is the tile of app chrome (list rows, the user menu):
// 8px corners at 32px and up, 4px below; the default is the round avatar. Decorative: the name sits beside it.
function EntityAvatar({
  name,
  fallback,
  src,
  size = "sm",
  shape = "circle",
  className,
}: {
  name: string | null | undefined;
  /** Used for the initial when `name` is empty (an email). */
  fallback?: string;
  src?: string;
  size?: React.ComponentProps<typeof Avatar>["size"];
  shape?: "circle" | "square";
  className?: string;
}) {
  return (
    <Avatar
      aria-hidden="true"
      className={cn(
        shape === "square" &&
          "rounded-lg border-border data-[size=sm]:rounded-md data-[size=xs]:rounded-md",
        className
      )}
      data-shape={shape}
      size={size}
    >
      {src ? (
        <AvatarImage
          alt=""
          className={cn(shape === "square" && "rounded-[inherit]")}
          src={src}
        />
      ) : null}
      <AvatarFallback
        className={cn(
          "text-foreground",
          shape === "square" && "rounded-[inherit]"
        )}
      >
        {initialsOf(name, fallback)}
      </AvatarFallback>
    </Avatar>
  );
}

export { EntityAvatar };
