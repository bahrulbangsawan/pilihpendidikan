// Server-only glue between the TanStack Start request context and the pure
// BFF modules: the Worker env, the API fetcher (service binding, or the dev
// fallback URL), and the session / locale cookies. Imported only by the
// `src/functions/*.functions.ts` server functions and server routes; never by
// client code (the bearer and the cookie key stay in the Worker).

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import {
  deleteCookie,
  getRequest,
  setCookie,
} from "@tanstack/react-start/server";
import { env as workerEnv } from "cloudflare:workers";
import type { BffDeps } from "@/lib/bff";
import { BFF_CACHE_TTL_MS, createTtlCache } from "@/lib/bff";
import {
  isLocalUrl,
  LOCALE_COOKIE,
  localeCookieAttributes,
  sessionCookieAttributes,
  sessionCookieName,
} from "@/lib/cookies";
import type { BffSession, CookieSession } from "@/lib/session-crypto";
import { sealSession, sessionFromCookieHeader } from "@/lib/session-crypto";

/** The bindings and vars of `wrangler.jsonc` plus the secret and dev vars. */
export interface JobsEnv {
  API?: Fetcher;
  API_PUBLIC_ORIGIN?: string;
  BFF_COOKIE_KEY?: string;
  JOBS_API_FALLBACK_URL?: string;
  JOBS_APP_ORIGIN?: string;
  JOBS_STRICT_CONTRACTS?: string;
}

const DEFAULT_API_ORIGIN = "https://api.pilihpendidikan.com";
/** Analytics answers per user and query, for 60 s (10 §6), per isolate. */
const RESPONSE_CACHE = createTtlCache(BFF_CACHE_TTL_MS, 500);
// Only ever used on http://localhost when .dev.vars has no BFF_COOKIE_KEY;
// a deployed Worker without the secret refuses to sign anyone in.
const LOCAL_DEV_COOKIE_SECRET = "pilih-jobs-local-development-cookie-secret";

export function jobsEnv(): JobsEnv {
  const env: JobsEnv = workerEnv;
  return env;
}

export function cookieSecret(env: JobsEnv, url: URL): string {
  if (env.BFF_COOKIE_KEY) {
    return env.BFF_COOKIE_KEY;
  }
  if (isLocalUrl(url)) {
    return LOCAL_DEV_COOKIE_SECRET;
  }
  throw new Error("BFF_COOKIE_KEY is not configured.");
}

/**
 * Calls the api Worker. Production uses the `API` service binding with the
 * api's public origin in the URL (it builds emailed links from it); a local
 * dev server may point `JOBS_API_FALLBACK_URL` at `wrangler dev` or the mock
 * api instead. The fallback is ignored anywhere but localhost.
 */
export function apiFetcher(env: JobsEnv, url: URL): BffDeps["fetchApi"] {
  const fallback = env.JOBS_API_FALLBACK_URL;
  if (fallback && isLocalUrl(url)) {
    return (path, init) => fetch(new URL(path, fallback), init);
  }
  const binding = env.API;
  if (!binding) {
    return () => Promise.reject(new Error("API service binding missing."));
  }
  const origin = env.API_PUBLIC_ORIGIN ?? DEFAULT_API_ORIGIN;
  return (path, init) =>
    binding.fetch(new Request(new URL(path, origin), init));
}

export interface RequestContext {
  cookieName: string;
  deps: BffDeps;
  env: JobsEnv;
  request: Request;
  secret: string;
  url: URL;
}

export function requestContext(): RequestContext {
  const request = getRequest();
  const url = new URL(request.url);
  const env = jobsEnv();
  return {
    request,
    url,
    env,
    cookieName: sessionCookieName(url),
    secret: cookieSecret(env, url),
    deps: {
      cache: RESPONSE_CACHE,
      fetchApi: apiFetcher(env, url),
      clientIp: request.headers.get("cf-connecting-ip"),
      validateResponses: env.JOBS_STRICT_CONTRACTS === "1" && isLocalUrl(url),
      onContractMismatch: (route, issues) => {
        console.warn(
          `[jobs] ${route} response does not match its contract`,
          issues
        );
      },
    },
  };
}

/** The origin sign-in links return to (`/?code=` lands here). */
export function appOrigin(context: RequestContext): string {
  return isLocalUrl(context.url)
    ? context.url.origin
    : (context.env.JOBS_APP_ORIGIN ?? context.url.origin);
}

export function readCurrentSession(
  context: RequestContext
): Promise<CookieSession> {
  return sessionFromCookieHeader(
    context.request.headers.get("cookie"),
    context.secret,
    context.cookieName,
    Date.now()
  );
}

export async function writeSessionCookie(
  context: RequestContext,
  session: BffSession
): Promise<void> {
  const sealed = await sealSession(session, context.secret, context.cookieName);
  setCookie(
    context.cookieName,
    sealed,
    sessionCookieAttributes(context.url, (session.exp - Date.now()) / 1000)
  );
}

export function clearSessionCookie(context: RequestContext): void {
  deleteCookie(context.cookieName, sessionCookieAttributes(context.url, 0));
}

export function writeLocaleCookie(
  context: RequestContext,
  locale: Locale
): void {
  setCookie(LOCALE_COOKIE, locale, localeCookieAttributes(context.url));
}
