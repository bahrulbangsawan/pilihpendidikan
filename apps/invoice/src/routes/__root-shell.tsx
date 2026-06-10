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

// ── Lazy dev toolbar ───────────────────────────────────────

const LazyAgentation = lazy(() =>
  import("agentation").then((mod) => ({ default: mod.PageFeedbackToolbarCSS }))
)

// ── Helpers ────────────────────────────────────────────────

const BASE_URL = "https://invoice.bahrul.me"

function localeFromPath(pathname: string): Locale {
  return pathname === "/id" || pathname.startsWith("/id/") ? "id" : "en"
}

// Blocking pre-paint script: resolves the saved/system theme and sets the
// `dark` class + color-scheme before the first paint so there is no flash.
// Mirrors next-themes' resolution for defaultTheme="system" and runs from
// <head> so it executes before any body content is painted.
const themeScript = `(function(){try{var d=document.documentElement,e=localStorage.getItem("theme"),m=window.matchMedia("(prefers-color-scheme: dark)").matches,k=e==="dark"||((e==="system"||!e)&&m);d.classList.toggle("dark",k);d.style.colorScheme=k?"dark":"light"}catch(_){}})()`

// ── JSON-LD ────────────────────────────────────────────────

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Invoice Generator — Bahrul Bangsawan",
  description:
    "Create, preview, and download professional invoices as PDF. Free online invoice generator with real-time preview and AI assistant.",
  url: BASE_URL,
  applicationCategory: "BusinessApplication",
  operatingSystem: "All",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: {
    "@type": "Person",
    name: "Bahrul Bangsawan",
    url: "https://linkedin.com/in/bahrulbangsawan",
  },
}

// ── Shell ──────────────────────────────────────────────────

export function RootDocument({ children }: { children: React.ReactNode }) {
  const jsonLdHtml = JSON.stringify(jsonLd)

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
          dangerouslySetInnerHTML={{ __html: jsonLdHtml }}
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

// ── Favicon visibility toggle ──────────────────────────────

const FAVICON_SELECTORS = [
  { selector: 'link[rel="icon"][sizes="32x32"]', file: "favicon-32x32.png" },
  { selector: 'link[rel="icon"][sizes="16x16"]', file: "favicon-16x16.png" },
  { selector: 'link[rel="icon"][type="image/x-icon"]', file: "favicon.ico" },
  { selector: 'link[rel="apple-touch-icon"]', file: "apple-touch-icon.png" },
]

function useFaviconVisibility() {
  useEffect(() => {
    function swapFavicons() {
      const folder = document.hidden ? "favicon-inactive" : "favicon-active"
      for (const { selector, file } of FAVICON_SELECTORS) {
        const link = document.querySelector<HTMLLinkElement>(selector)
        if (link) {
          link.href = `/${folder}/${file}`
        }
      }
    }

    document.addEventListener("visibilitychange", swapFavicons)
    return () => document.removeEventListener("visibilitychange", swapFavicons)
  }, [])
}

// ── Root Component ─────────────────────────────────────────

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
