import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";
import { Rail } from "./rails";

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
  /** Render the secondary outlined "go back" button. */
  showBack?: boolean;
  /**
   * Root element. `main` (default) when the 404 is the whole page; `div` when
   * it is previewed inside another page that already has a `<main>`.
   */
  as?: "main" | "div";
  className?: string;
}

const DEFAULT_DESCRIPTION =
  "The page you're looking for doesn't exist or may have moved.";

/**
 * Router-agnostic 404 screen shared by the hub and the cv / invoice /
 * portfolio apps. Each app passes its own `logo` node and a `homeAction`
 * link; everything else is fixed here so every app renders the same page:
 * a Zedative band on graph paper ruled by hairlines, the ruled column with
 * its diamond nodes, a display-size numeral, a title-role heading, one cobalt
 * action and an outlined way back. Nothing animates in.
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
  as: Root = "main",
  className,
}: NotFoundProps) {
  return (
    <Root
      className={cn(
        "flex min-h-dvh w-full flex-col justify-center bg-background",
        className
      )}
      data-slot="not-found"
    >
      <div className="band graph-paper border-line border-t">
        <Rail className="flex flex-col items-center gap-6 px-6 py-16 text-center sm:py-24">
          <span
            className="flex h-10 items-center justify-center"
            data-slot="not-found-logo"
          >
            {logo}
          </span>
          <div className="flex flex-col items-center gap-2">
            <p className="type-display text-foreground tabular-nums">{code}</p>
            <h1 className="type-title text-foreground">{title}</h1>
            <p className="type-body max-w-sm text-balance text-muted-foreground">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button asChild>
              {homeAction ?? <a href={homeHref}>{homeLabel}</a>}
            </Button>
            {showBack ? (
              <Button
                onClick={() => window.history.back()}
                type="button"
                variant="outline"
              >
                {backLabel}
              </Button>
            ) : null}
          </div>
        </Rail>
      </div>
    </Root>
  );
}
