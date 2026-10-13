// Hand-rolled JSON catalogues, the apps/home pattern (12 §1.2): one flat-ish
// tree per locale in ./locales, `t("board.title")`, `{name}` placeholders.
// The locale comes from the `jobs-lang` cookie or Accept-Language (D-27), not
// from the path.

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import { createContext, use } from "react";
import en from "./locales/en.json";
import id from "./locales/id.json";

export type { Locale } from "@pilihpendidikan/jobs-contracts/enums";

export type TranslationVars = Readonly<Record<string, string | number>>;
export type Translate = (key: string, vars?: TranslationVars) => string;

export const CATALOGUES: Readonly<Record<Locale, unknown>> = { en, id };

const PLACEHOLDER_RE = /\{(\w+)\}/g;

function lookup(tree: unknown, key: string): string | null {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return null;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : null;
}

function interpolate(text: string, vars: TranslationVars | undefined): string {
  if (!vars) {
    return text;
  }
  return text.replace(PLACEHOLDER_RE, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/** A translate function for `locale`, falling back to English, then the key. */
export function getT(locale: Locale): Translate {
  return (key, vars) =>
    interpolate(
      lookup(CATALOGUES[locale], key) ?? lookup(CATALOGUES.en, key) ?? key,
      vars
    );
}

/** BCP 47 tag for `Intl` formatting. */
export function intlLocale(locale: Locale): string {
  return locale === "id" ? "id-ID" : "en-GB";
}

interface I18nContextValue {
  locale: Locale;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  t: getT("en"),
});

export const I18nProvider = I18nContext.Provider;

export function useTranslation(): I18nContextValue {
  return use(I18nContext);
}
