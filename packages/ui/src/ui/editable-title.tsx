import type * as React from "react";
import { cn } from "../lib/utils";

// An inline-editable heading (reui's inline edit): it reads as a section
// title until hovered, then shows the 10% field border; focused, it becomes
// the field (page fill, 20% border, ink outline). `-ml-2` keeps the text on
// the column edge. Read-only titles never show the border. The size is the
// subtitle role; pass a `type-*` class to change it.
function EditableTitle({
  className,
  type = "text",
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "type-subtitle field-touch -ml-2 h-8 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-foreground outline-none transition-[background-color,border-color] duration-140 ease-standard placeholder:text-muted-foreground hover:border-border read-only:hover:border-transparent focus-visible:border-input focus-visible:bg-background focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-0",
        className
      )}
      data-slot="editable-title"
      type={type}
      {...props}
    />
  );
}

export { EditableTitle };
