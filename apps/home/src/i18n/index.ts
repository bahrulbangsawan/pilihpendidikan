import { createContext, use } from "react";
import { buildOgUrl } from "@/lib/og-url";
import en from "./locales/en.json";
import id from "./locales/id.json";

// ── Types ──────────────────────────────────────────────────

export type Locale = "en" | "id";

type TranslationValue = string | Record<string, unknown>;
type Translations = Record<string, TranslationValue>;

// ── Config ─────────────────────────────────────────────────

export const DEFAULT_LOCALE: Locale = "en";

export const BASE_URL = "https://pilihpendidikan.com";

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

/** Standalone translation function — works outside React (e.g. head()) */
export function getT(locale: Locale) {
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE];
  return (key: string) => getNestedValue(dict, key);
}

export function localeFromPath(pathname: string): Locale {
  return pathname === "/id" || pathname.startsWith("/id/") ? "id" : "en";
}

/** Path of the hub page for `locale` (`/` or `/id`). */
export function localePath(locale: Locale): string {
  return locale === "en" ? "/" : `/${locale}`;
}

export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "id" : "en";
}

/** Generate head meta/links for a given locale (used in route head() functions) */
export function headForLocale(locale: Locale) {
  const t = getT(locale);
  const canonicalUrl =
    locale === "en" ? BASE_URL : `${BASE_URL}${localePath(locale)}`;
  const ogImage = buildOgUrl({
    title: t("meta.title"),
    subtitle: t("meta.siteName"),
    theme: "light",
  });

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
  };
}

// ── React Context ──────────────────────────────────────────

interface I18nContextValue {
  locale: Locale;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: getT(DEFAULT_LOCALE),
});

export const I18nProvider = I18nContext.Provider;

export function useTranslation() {
  return use(I18nContext);
}
