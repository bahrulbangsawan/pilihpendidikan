// Sibling file extracted to satisfy only-export-components:
// RootDocument and RootComponent are components referenced by Route
// but must be exported for Fast Refresh to work correctly.

import { TooltipProvider } from "@rulisme/ui/ui/tooltip";
import { HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { jsonLd, useFaviconVisibility } from "./__root.helpers";

const LazyAgentation = lazy(() =>
  import("agentation").then((mod) => ({ default: mod.PageFeedbackToolbarCSS }))
);

export function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html className="light" lang="en" style={{ colorScheme: "light" }}>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          type="application/ld+json"
        />
      </head>
      <body>
        {children}
        <Scripts />
        {import.meta.env.DEV && (
          <Suspense>
            <LazyAgentation />
          </Suspense>
        )}
      </body>
    </html>
  );
}

export function RootComponent() {
  useFaviconVisibility();
  return (
    <TooltipProvider>
      <Outlet />
    </TooltipProvider>
  );
}
