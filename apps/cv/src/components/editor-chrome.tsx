// Screen chrome shared by the editor's two panes: the brand at the left of
// the form toolbar (cursor.com's app chrome always shows it) and the ghost
// page the preview pane shows before there is a document. Neither is part of
// the print artifact.

// The app mark ships in public/ as the favicon set; the 192px cut stays sharp
// at 20px on any display density.
const APP_MARK_SRC = "/favicon-active/android-chrome-192x192.png";

export function AppBrand({ name }: { name: string }) {
  return (
    <div className="mr-1 flex min-w-0 items-center gap-2">
      <img
        alt=""
        aria-hidden="true"
        className="size-5 shrink-0 rounded-sm"
        height={20}
        src={APP_MARK_SRC}
        width={20}
      />
      <span className="type-subtitle truncate text-foreground max-sm:sr-only">
        {name}
      </span>
    </div>
  );
}

// A blank sheet in the document's own proportions (A4 portrait or landscape),
// at the width the real sheet takes, one step lighter than the card pane (a
// card-on-card page would vanish), so the message sits on a page rather than
// in a void and the first keystroke swaps it in place.
export function GhostPage({
  description,
  orientation = "portrait",
  title,
}: {
  description: string;
  orientation?: "portrait" | "landscape";
  title?: string;
}) {
  return (
    <div
      className={
        orientation === "portrait"
          ? "mx-auto flex aspect-[210/297] w-full max-w-2xl flex-col items-center justify-center gap-1 rounded-sm border border-hairline bg-pane px-6 text-center"
          : "mx-auto flex aspect-[297/210] w-full max-w-4xl flex-col items-center justify-center gap-1 rounded-sm border border-hairline bg-pane px-6 text-center"
      }
    >
      {title ? <p className="type-subtitle text-foreground">{title}</p> : null}
      <p className="type-body max-w-xs text-pretty text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
