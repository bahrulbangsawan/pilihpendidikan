import { TooltipProvider } from "@rulisme/ui/ui/tooltip";
import {
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { Toaster } from "sonner";
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

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
      <I18nProvider value={i18nValue}>
        <TooltipProvider>
          <Outlet />
          <Toaster
            closeButton
            toastOptions={{ duration: Number.POSITIVE_INFINITY }}
          />
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
