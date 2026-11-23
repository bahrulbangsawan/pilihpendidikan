import { cn } from "../lib/utils";

// A blank sheet in a document's own proportions (A4 portrait or landscape)
// that a preview pane shows before there is a document: one step lighter
// than the card pane, so the message sits on a page rather than in a void
// and the first keystroke swaps the real page in place.
function GhostPage({
  description,
  orientation = "portrait",
  title,
  className,
}: {
  description: string;
  orientation?: "portrait" | "landscape";
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center gap-1 rounded-sm border border-hairline bg-pane px-6 text-center",
        orientation === "portrait"
          ? "aspect-[210/297] max-w-2xl"
          : "aspect-[297/210] max-w-4xl",
        className
      )}
      data-orientation={orientation}
      data-slot="ghost-page"
    >
      {title ? <p className="type-subtitle text-foreground">{title}</p> : null}
      <p className="type-body max-w-xs text-pretty text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export { GhostPage };
