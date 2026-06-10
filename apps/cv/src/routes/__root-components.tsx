// Sibling file extracted to satisfy only-export-components:
// RootDocument and RootComponent are components referenced by Route
// but must be exported for Fast Refresh to work correctly.

import { TooltipProvider } from "@rulisme/ui/ui/tooltip"
import {
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router"
import { ThemeProvider } from "next-themes"
import { lazy, Suspense, useEffect, useMemo } from "react"
import type { Locale } from "@/i18n"
import { getT, I18nProvider } from "@/i18n"

import { jsonLd, useFaviconVisibility } from "./__root-helpers"

const LazyAgentation = lazy(() =>
  import("agentation").then((mod) => ({ default: mod.PageFeedbackToolbarCSS }))
)

function localeFromPath(pathname: string): Locale {
  return pathname === "/id" || pathname.startsWith("/id/") ? "id" : "en"
}

// Blocking pre-paint script: resolves the saved/system theme and sets the
// `dark` class + color-scheme before the first paint so there is no flash.
// Mirrors next-themes' resolution for defaultTheme="system" and runs from
// <head> so it executes before any body content is painted.
const themeScript = `(function(){try{var d=document.documentElement,e=localStorage.getItem("theme"),m=window.matchMedia("(prefers-color-scheme: dark)").matches,k=e==="dark"||((e==="system"||!e)&&m);d.classList.toggle("dark",k);d.style.colorScheme=k?"dark":"light"}catch(_){}})()`

export function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: blocking no-flash theme script — static string */}
        <script
          dangerouslySetInnerHTML={{ __html: themeScript }}
          suppressHydrationWarning
        />
        <HeadContent />
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD payload
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
  )
}

export function RootComponent() {
  useFaviconVisibility()

  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const locale = localeFromPath(pathname)

  // Update <html lang> attribute on client
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const i18nValue = useMemo(() => ({ locale, t: getT(locale) }), [locale])

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <I18nProvider value={i18nValue}>
        <TooltipProvider>
          <Outlet />
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
