// Session server functions (12 §1.1, D-15, D-27). Each returns only what the
// browser may know — signed in or not, the email, the locale — never the
// bearer. POSTs pass the Origin gate in src/server.ts first.

import { UpdateSettingsRequestSchema } from "@pilihpendidikan/jobs-contracts/api";
import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import { LocaleSchema } from "@pilihpendidikan/jobs-contracts/enums";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  exchangeSignInCode,
  proxyApiRequest,
  requestSignInLink,
  revokeApiSession,
} from "@/lib/bff";
import { resolveLocale } from "@/lib/locale";
import type { PublicSession } from "@/lib/session-crypto";
import { publicSession } from "@/lib/session-crypto";
import {
  appOrigin,
  clearSessionCookie,
  readCurrentSession,
  requestContext,
  writeLocaleCookie,
  writeSessionCookie,
} from "@/server/runtime.server";

export interface SessionState extends PublicSession {
  locale: Locale;
}

/** Who is signed in, and the UI locale (cookie, else Accept-Language). */
export const getSessionState = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionState> => {
    const context = requestContext();
    const { session, stale } = await readCurrentSession(context);
    if (stale) {
      clearSessionCookie(context);
    }
    const locale = resolveLocale(
      context.request.headers.get("cookie"),
      context.request.headers.get("accept-language")
    );
    return { ...publicSession(session), locale };
  }
);

const EmailInputSchema = z.object({ email: z.string().trim().min(3).max(254) });

export type SignInLinkResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_email" | "rate_limited" | "unavailable";
      retryAfter?: number;
    };

/** Emails a sign-in link that returns to this app with `?code=`. */
export const requestSignIn = createServerFn({ method: "POST" })
  .validator((input: unknown) => EmailInputSchema.parse(input))
  .handler(async ({ data }): Promise<SignInLinkResult> => {
    const context = requestContext();
    const result = await requestSignInLink(
      data.email,
      appOrigin(context),
      context.deps
    );
    if (result.ok) {
      return { ok: true };
    }
    if (result.status === 400) {
      return { ok: false, reason: "invalid_email" };
    }
    if (result.status === 429) {
      return {
        ok: false,
        reason: "rate_limited",
        ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
      };
    }
    return { ok: false, reason: "unavailable" };
  });

const CodeInputSchema = z.object({ code: z.string().trim().min(8).max(256) });

export type CompleteSignInResult =
  | { ok: true; locale: Locale }
  | { ok: false; reason: "expired" | "unavailable" };

const SettingsLocaleSchema = z.object({
  settings: z.object({ locale: LocaleSchema }),
});

/**
 * `/?code=` → `/auth/exchange` → the sealed session cookie. The user's saved
 * locale (user_settings) then wins over the browser's, so a new device opens
 * in the language they chose.
 */
export const completeSignIn = createServerFn({ method: "POST" })
  .validator((input: unknown) => CodeInputSchema.parse(input))
  .handler(async ({ data }): Promise<CompleteSignInResult> => {
    const context = requestContext();
    const exchanged = await exchangeSignInCode(
      data.code,
      context.deps,
      Date.now()
    );
    if (!exchanged.ok) {
      return {
        ok: false,
        reason:
          exchanged.status === 410 || exchanged.status === 400
            ? "expired"
            : "unavailable",
      };
    }
    await writeSessionCookie(context, exchanged.session);
    let locale = resolveLocale(
      context.request.headers.get("cookie"),
      context.request.headers.get("accept-language")
    );
    const settings = await proxyApiRequest(
      { route: "GET /api/v1/settings" },
      exchanged.session.bearer,
      context.deps
    );
    if (settings.ok) {
      const parsed = SettingsLocaleSchema.safeParse(settings.data);
      if (parsed.success) {
        locale = parsed.data.settings.locale;
        writeLocaleCookie(context, locale);
      }
    }
    return { ok: true, locale };
  });

/** Ends the api session (`/auth/logout`) and clears the cookie. */
export const signOut = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const context = requestContext();
    const { session } = await readCurrentSession(context);
    if (session) {
      await revokeApiSession(session.bearer, context.deps);
    }
    clearSessionCookie(context);
    return { ok: true };
  }
);

const LocaleInputSchema = z.object({
  locale: LocaleSchema,
  /** Also save it to user_settings with this base_revision (D-27). */
  base_revision: UpdateSettingsRequestSchema.shape.base_revision.optional(),
});

export interface SetLocaleResult {
  locale: Locale;
  savedRevision: number | null;
}

/** Stores the UI locale in `jobs-lang` and, when given a revision, settings. */
export const setLocale = createServerFn({ method: "POST" })
  .validator((input: unknown) => LocaleInputSchema.parse(input))
  .handler(async ({ data }): Promise<SetLocaleResult> => {
    const context = requestContext();
    writeLocaleCookie(context, data.locale);
    if (data.base_revision === undefined) {
      return { locale: data.locale, savedRevision: null };
    }
    const { session } = await readCurrentSession(context);
    if (!session) {
      return { locale: data.locale, savedRevision: null };
    }
    const saved = await proxyApiRequest(
      {
        route: "PATCH /api/v1/settings",
        body: { base_revision: data.base_revision, locale: data.locale },
      },
      session.bearer,
      context.deps
    );
    const revision =
      saved.ok &&
      typeof saved.data === "object" &&
      saved.data !== null &&
      "settings" in saved.data
        ? z.object({ revision: z.number() }).safeParse(saved.data.settings)
        : null;
    return {
      locale: data.locale,
      savedRevision: revision?.success ? revision.data.revision : null,
    };
  });
