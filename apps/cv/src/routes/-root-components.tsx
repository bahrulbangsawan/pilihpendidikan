// Sibling file extracted to satisfy only-export-components:
// RootDocument and RootComponent are components referenced by Route
// but must be exported for Fast Refresh to work correctly.

import { Toaster } from "@rulisme/ui/ui/sonner";
import { TooltipProvider } from "@rulisme/ui/ui/tooltip";
import {
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { lazy, Suspense, useEffect, useMemo } from "react";
import type { Locale } from "@/i18n";
import { getT, I18nProvider } from "@/i18n";

import { useFaviconVisibility } from "./-root-helpers";

// Development-only module selection; production never imports the toolbar.
const LazyAgentation = import.meta.env.DEV
  ? lazy(() =>
      import("agentation").then((mod) => ({
        default: mod.PageFeedbackToolbarCSS,
      }))
    )
  : null;

function localeFromPath(pathname: string): Locale {
  return pathname === "/id" || pathname.startsWith("/id/") ? "id" : "en";
}

export function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
        {LazyAgentation && (
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

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locale = localeFromPath(pathname);

  // Update <html lang> attribute on client
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const i18nValue = useMemo(() => ({ locale, t: getT(locale) }), [locale]);

  // Zedative is light-canonical (DESIGN.md: "Scheme: light"): the editor opens
  // light whatever the OS prefers, and the toolbar's toggle switches to the
  // derived Night Desk scheme (`.dark`), remembered in localStorage.
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      disableTransitionOnChange
      enableSystem={false}
    >
      <I18nProvider value={i18nValue}>
        <TooltipProvider>
          <Outlet />
          <Toaster closeButton />
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
