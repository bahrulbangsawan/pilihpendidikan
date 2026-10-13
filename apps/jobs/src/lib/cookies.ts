// Cookie names and attributes of the BFF (12 §1, D-27). Pure helpers so the
// session, locale and CSRF logic can be tested without the TanStack runtime.

/** The session cookie on https: bound to this exact origin, path `/`. */
export const SESSION_COOKIE_SECURE = "__Host-jobs-session";
/** On http://localhost a Secure / `__Host-` cookie is refused. */
export const SESSION_COOKIE_LOCAL = "jobs-session";
/** UI locale (D-27). Readable by the server only; not a secret. */
export const LOCALE_COOKIE = "jobs-lang";

/** Browser-session TTL of the api (`apps/api/src/session.ts`): 7 days. */
export const SESSION_TTL_SECONDS = 604_800;
/** The locale preference outlives sessions: one year. */
export const LOCALE_COOKIE_MAX_AGE = 31_536_000;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when the request is served by a local dev server. */
export function isLocalUrl(url: URL): boolean {
  return LOCAL_HOSTNAMES.has(url.hostname);
}

/** Plain http (only ever local dev) cannot carry `Secure` cookies. */
export function isSecureUrl(url: URL): boolean {
  return url.protocol === "https:";
}

export function sessionCookieName(url: URL): string {
  return isSecureUrl(url) ? SESSION_COOKIE_SECURE : SESSION_COOKIE_LOCAL;
}

export interface CookieAttributes {
  httpOnly: boolean;
  maxAge: number;
  path: "/";
  sameSite: "lax";
  secure: boolean;
}

/** Attributes of the session cookie (HttpOnly, SameSite=Lax, Path=/). */
export function sessionCookieAttributes(
  url: URL,
  maxAgeSeconds: number
): CookieAttributes {
  return {
    httpOnly: true,
    secure: isSecureUrl(url),
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

/** Attributes of the `jobs-lang` cookie. */
export function localeCookieAttributes(url: URL): CookieAttributes {
  return {
    httpOnly: true,
    secure: isSecureUrl(url),
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
  };
}

/** A `Set-Cookie` header value. Names and values must be cookie-safe. */
export function serializeCookie(
  name: string,
  value: string,
  attributes: CookieAttributes
): string {
  const parts = [`${name}=${value}`, `Path=${attributes.path}`];
  parts.push(`Max-Age=${attributes.maxAge}`);
  if (attributes.httpOnly) {
    parts.push("HttpOnly");
  }
  if (attributes.secure) {
    parts.push("Secure");
  }
  parts.push("SameSite=Lax");
  return parts.join("; ");
}

/** Reads one cookie from a `Cookie` header (first match wins). */
export function readCookie(
  header: string | null | undefined,
  name: string
): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (trimmed.slice(0, separator) === name) {
      return trimmed.slice(separator + 1);
    }
  }
  return null;
}
