import { createContext, use } from "react"
import { buildOgUrl } from "@/lib/og-url"
import en from "./locales/en.json"
import id from "./locales/id.json"

// ── Types ──────────────────────────────────────────────────

export type Locale = "en" | "id"

type TranslationValue = string | Record<string, unknown>
type Translations = Record<string, TranslationValue>

// ── Config ─────────────────────────────────────────────────

export const DEFAULT_LOCALE: Locale = "en"

export const SUPPORTED_LOCALES = [
  { code: "en" as const, name: "English", nativeName: "English" },
  { code: "id" as const, name: "Indonesian", nativeName: "Bahasa Indonesia" },
]

const translations: Record<Locale, Translations> = { en, id }

// ── Helpers ────────────────────────────────────────────────

function getNestedValue(obj: unknown, path: string): string {
  const result = path
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      obj
    )
  return typeof result === "string" ? result : path
}

/** Standalone translation function — works outside React (e.g. PDF renderer) */
export function getT(locale: Locale) {
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE]
  return (key: string, params?: Record<string, string | number>) => {
    let value = getNestedValue(dict, key)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(`{${k}}`, String(v))
      }
    }
    return value
  }
}

/** Date format locale mapping */
export function getDateLocale(locale: Locale): string {
  return locale === "id" ? "id-ID" : "en-US"
}

export function isValidLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.some((l) => l.code === value)
}

/** Generate head meta/links for a given locale (used in route head() functions) */
export function headForLocale(locale: Locale, baseUrl: string) {
  const t = getT(locale)
  const canonicalPath = locale === "en" ? "" : `/${locale}`

  const canonicalUrl = `${baseUrl}${canonicalPath}`
  const ogImage = buildOgUrl({
    title: t("meta.title"),
    subtitle: t("meta.siteName"),
    theme: "dark",
  })

  return {
    meta: [
      { title: t("meta.title") },
      { name: "description", content: t("meta.description") },
      { name: "author", content: "Bahrul Bangsawan" },
      { name: "application-name", content: t("meta.siteName") },
      {
        name: "robots",
        content:
          "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      },
      // Open Graph
      { property: "og:title", content: t("meta.title") },
      { property: "og:description", content: t("meta.ogDescription") },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: t("meta.siteName") },
      { property: "og:url", content: canonicalUrl },
      { property: "og:locale", content: locale === "id" ? "id_ID" : "en_US" },
      {
        property: "og:locale:alternate",
        content: locale === "id" ? "en_US" : "id_ID",
      },
      { property: "og:image", content: ogImage },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: t("meta.ogImageAlt") },
      // Twitter
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@bahrulbangsawan" },
      { name: "twitter:creator", content: "@bahrulbangsawan" },
      { name: "twitter:title", content: t("meta.title") },
      { name: "twitter:description", content: t("meta.ogDescription") },
      { name: "twitter:image", content: ogImage },
    ],
    links: [{ rel: "canonical", href: canonicalUrl }],
  }
}

// ── React Context ──────────────────────────────────────────

interface I18nContextValue {
  locale: Locale
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: getT(DEFAULT_LOCALE),
})

export const I18nProvider = I18nContext.Provider

export function useTranslation() {
  return use(I18nContext)
}
