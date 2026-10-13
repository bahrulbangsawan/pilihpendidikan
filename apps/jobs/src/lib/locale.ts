// Locale resolution (D-27, job-tracker-spec 12 §1.2): no `/id/*` route tree.
// The `jobs-lang` cookie wins; without it the browser's Accept-Language
// decides; `/id` only sets the cookie and redirects to the board.

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import { LOCALES } from "@pilihpendidikan/jobs-contracts/enums";
import {
  LOCALE_COOKIE,
  localeCookieAttributes,
  readCookie,
  serializeCookie,
} from "./cookies";

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/**
 * The best supported locale for an `Accept-Language` header: entries are
 * ranked by `q`, ties keep header order, and `id`, `id-ID` and `in` (the
 * legacy Indonesian tag) all mean Indonesian.
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) {
    return DEFAULT_LOCALE;
  }
  const ranked = header
    .split(",")
    .map((entry, index) => {
      const [tag = "", ...params] = entry.trim().split(";");
      const qParam = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return {
        index,
        q: Number.isFinite(q) ? q : 0,
        primary: tag.toLowerCase().split("-")[0] ?? "",
      };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const entry of ranked) {
    if (entry.primary === "id" || entry.primary === "in") {
      return "id";
    }
    if (entry.primary === "en") {
      return "en";
    }
  }
  return DEFAULT_LOCALE;
}

/** The locale of a request: the `jobs-lang` cookie, else Accept-Language. */
export function resolveLocale(
  cookieHeader: string | null | undefined,
  acceptLanguage: string | null | undefined
): Locale {
  const fromCookie = readCookie(cookieHeader, LOCALE_COOKIE);
  return isLocale(fromCookie) ? fromCookie : negotiateLocale(acceptLanguage);
}

/** The `Set-Cookie` value that stores `locale` for this origin. */
export function localeCookieHeader(url: URL, locale: Locale): string {
  return serializeCookie(LOCALE_COOKIE, locale, localeCookieAttributes(url));
}

/**
 * `GET /id` (12 §2): remember Indonesian and go to the board, so links from
 * the Indonesian hub land in Indonesian. The board sends a signed-out visitor
 * on to the sign-in band.
 */
export function localeRedirectResponse(
  request: Request,
  locale: Locale
): Response {
  const url = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/board",
      "Set-Cookie": localeCookieHeader(url, locale),
      "Cache-Control": "no-store",
    },
  });
}
