import { createContext, useContext } from "react";
import en from "./locales/en.json";
import id from "./locales/id.json";

// ── Types ──────────────────────────────────────────────────

export type Locale = "en" | "id";

type TranslationValue = string | Record<string, unknown>;
type Translations = Record<string, TranslationValue>;

// ── Config ─────────────────────────────────────────────────

export const DEFAULT_LOCALE: Locale = "en";

export const SUPPORTED_LOCALES = [
  { code: "en" as const, name: "English", nativeName: "English" },
  { code: "id" as const, name: "Indonesian", nativeName: "Bahasa Indonesia" },
];

const translations: Record<Locale, Translations> = { en, id };

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
    );
  return typeof result === "string" ? result : path;
}

/** Standalone translation function — works outside React (e.g. PDF renderer) */
export function getT(locale: Locale) {
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE];
  return (key: string, params?: Record<string, string | number>) => {
    let value = getNestedValue(dict, key);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(`{${k}}`, String(v));
      }
    }
    return value;
  };
}

/** Date format locale mapping */
export function getDateLocale(locale: Locale): string {
  return locale === "id" ? "id-ID" : "en-US";
}

export function isValidLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.some((l) => l.code === value);
}

/** Generate head meta/links for a given locale (used in route head() functions) */
export function headForLocale(locale: Locale, baseUrl: string) {
  const t = getT(locale);
  const canonicalPath = locale === "en" ? "" : `/${locale}`;

  return {
    meta: [
      { title: t("meta.title") },
      { name: "description", content: t("meta.description") },
      { property: "og:title", content: t("meta.title") },
      { property: "og:description", content: t("meta.ogDescription") },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${baseUrl}${canonicalPath}` },
      { property: "og:image", content: `${baseUrl}/og-image.webp` },
      { property: "og:locale", content: locale === "id" ? "id_ID" : "en_US" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: t("meta.title") },
      { name: "twitter:description", content: t("meta.ogDescription") },
      { name: "twitter:image", content: `${baseUrl}/og-image.webp` },
    ],
    links: [{ rel: "canonical", href: `${baseUrl}${canonicalPath}` }],
  };
}

// ── React Context ──────────────────────────────────────────

interface I18nContextValue {
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: getT(DEFAULT_LOCALE),
});

export const I18nProvider = I18nContext.Provider;

export function useTranslation() {
  return useContext(I18nContext);
}
