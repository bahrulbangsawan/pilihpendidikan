import { GripVerticalIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

// A drag handle for sortable lists (reui's sortable): a grip icon on a
// button, so it is a tab stop and dnd-kit's keyboard sensor can lift it;
// spread dnd-kit's `attributes` and `listeners` onto it. `variant="icon"`
// is the 28px round ghost button for list rows; `variant="gutter"` is the
// slim 16 × 32px grip that sits in a section's left gutter. `label` names
// it (and becomes its tooltip title).
function DragHandle({
  className,
  label,
  variant = "icon",
  ...props
}: Omit<React.ComponentProps<"button">, "type" | "children"> & {
  label: string;
  variant?: "icon" | "gutter";
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 cursor-grab items-center justify-center text-muted-foreground outline-none transition-[background-color,color] duration-140 ease-standard hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 active:cursor-grabbing",
        variant === "icon" && "size-7 rounded-full hover:bg-pane",
        variant === "gutter" && "h-8 w-4 rounded-sm",
        className
      )}
      data-slot="drag-handle"
      data-variant={variant}
      title={label}
      type="button"
      {...props}
    >
      <GripVerticalIcon aria-hidden="true" className="size-3.5" />
    </button>
  );
}

export { DragHandle };
