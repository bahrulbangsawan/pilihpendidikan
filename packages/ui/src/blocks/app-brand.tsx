import { cn } from "../lib/utils";

// The app's mark and name at the left of a toolbar (cursor.com's app chrome
// always shows it): a 20px mark with 4px corners and the name in the
// subtitle role, which hides on phones (kept for screen readers). Pass the
// mark's image (a 192px cut stays sharp at 20px).
function AppBrand({
  name,
  src,
  className,
}: {
  name: string;
  src: string;
  className?: string;
}) {
  return (
    <div
      className={cn("mr-1 flex min-w-0 items-center gap-2", className)}
      data-slot="app-brand"
    >
      <img
        alt=""
        aria-hidden="true"
        className="size-5 shrink-0 rounded-sm"
        height={20}
        src={src}
        width={20}
      />
      <span className="type-subtitle truncate text-foreground max-sm:sr-only">
        {name}
      </span>
    </div>
  );
}

export { AppBrand };
