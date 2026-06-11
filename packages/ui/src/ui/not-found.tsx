import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

interface NotFoundProps {
  /** App brand mark, rendered in a fixed-height slot above the numeral. */
  logo: ReactNode;
  /** Large numeral. */
  code?: string;
  /** Heading under the numeral. */
  title?: string;
  /** Muted one-line description. */
  description?: string;
  /** Label for the primary home action. */
  homeLabel?: string;
  /**
   * Primary home action. Pass a router `<Link to="/">` (or any single element)
   * and it inherits Button styling via `asChild`. When omitted, falls back to a
   * plain `<a href={homeHref}>` so the component still works without a router.
   */
  homeAction?: ReactNode;
  /** Anchor target for the fallback home action. */
  homeHref?: string;
  /** Label for the secondary "go back" action. */
  backLabel?: string;
  /** Render the secondary ghost "go back" button. */
  showBack?: boolean;
  className?: string;
}

const DEFAULT_DESCRIPTION =
  "The page you're looking for doesn't exist or may have moved.";

/**
 * Router-agnostic 404 screen shared by the cv / invoice / portfolio apps.
 * Each app passes its own `logo` node and a `homeAction` link; everything else
 * (layout, type scale, spacing, button size) is fixed here so the apps render
 * an identical not-found page. Warp tokens only — no shadows, no `font-bold`.
 */
export function NotFound({
  logo,
  code = "404",
  title = "Page not found",
  description = DEFAULT_DESCRIPTION,
  homeLabel = "Back to home",
  homeAction,
  homeHref = "/",
  backLabel = "Go back",
  showBack = true,
  className,
}: NotFoundProps) {
  return (
    <main
      className={cn(
        "flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-background px-6 py-16 text-center",
        className
      )}
    >
      <div className="flex flex-col items-center gap-5">
        <span
          className="flex h-10 items-center justify-center"
          data-slot="not-found-logo"
        >
          {logo}
        </span>
        <div className="flex flex-col items-center gap-2">
          <p className="font-medium text-heading-lg text-muted-foreground tabular-nums">
            {code}
          </p>
          <h1 className="font-medium text-foreground text-heading">{title}</h1>
          <p className="max-w-sm text-balance text-body-sm text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button asChild size="lg">
          {homeAction ?? <a href={homeHref}>{homeLabel}</a>}
        </Button>
        {showBack ? (
          <Button
            onClick={() => window.history.back()}
            size="lg"
            type="button"
            variant="ghost"
          >
            {backLabel}
          </Button>
        ) : null}
      </div>
    </main>
  );
}
