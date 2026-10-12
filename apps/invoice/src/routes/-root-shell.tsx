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

// ── Lazy dev toolbar ───────────────────────────────────────

// Development-only module selection; production never imports the toolbar.
const LazyAgentation = import.meta.env.DEV
  ? lazy(() =>
      import("agentation").then((mod) => ({
        default: mod.PageFeedbackToolbarCSS,
      }))
    )
  : null;

// ── Helpers ────────────────────────────────────────────────

function localeFromPath(pathname: string): Locale {
  return pathname === "/id" || pathname.startsWith("/id/") ? "id" : "en";
}

// ── Shell ──────────────────────────────────────────────────

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

// ── Root Component ─────────────────────────────────────────

export function RootComponent() {
  useFaviconVisibility();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locale = localeFromPath(pathname);

  // Update <html lang> attribute on client
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const i18nValue = useMemo(() => ({ locale, t: getT(locale) }), [locale]);

  // Light is canonical (DESIGN.md); Night Desk (`.dark`) is the derived
  // scheme the toolbar toggle switches to. The system theme is not followed,
  // and the head script in `__root.tsx` applies the same rule before paint.
  // Toasts are Zedative windows (`@rulisme/ui/ui/sonner`) and stay until
  // dismissed.
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
          <Toaster closeButton duration={Number.POSITIVE_INFINITY} />
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
