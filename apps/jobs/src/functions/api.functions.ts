// The one data server function: the browser names a contract route and its
// inputs; the BFF validates them, attaches the session bearer server-side and
// returns the API's answer (src/lib/bff.ts). A 401 — no session, or the api
// no longer accepts the bearer — clears the cookie.

import { createServerFn } from "@tanstack/react-start";
import type { BffRequest, BffResult } from "@/lib/bff";
import { proxyApiRequest } from "@/lib/bff";
import {
  clearSessionCookie,
  readCurrentSession,
  requestContext,
} from "@/server/runtime.server";

const SIGNED_OUT: BffResult = {
  ok: false,
  status: 401,
  error: {
    error: "invalid_token",
    message: "Signed out.",
    reason: "no_bearer",
  },
};

export const bffRequest = createServerFn({ method: "POST" })
  // Shape only; proxyApiRequest validates against the route's contract and
  // answers a 400 result instead of throwing.
  .validator((input: BffRequest) => input)
  .handler(async ({ data }): Promise<BffResult> => {
    const context = requestContext();
    const { session, stale } = await readCurrentSession(context);
    if (!session) {
      if (stale) {
        clearSessionCookie(context);
      }
      return SIGNED_OUT;
    }
    const result = await proxyApiRequest(data, session.bearer, context.deps);
    if (!result.ok && result.status === 401) {
      clearSessionCookie(context);
    }
    return result;
  });
