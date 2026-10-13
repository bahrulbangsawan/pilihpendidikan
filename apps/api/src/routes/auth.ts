// `/auth/*` — email sign-in, the code exchange, sign-out and `/auth/me`.
// Personal-token CRUD under `/auth/tokens` lives in ./tokens.ts.
//
//   POST /auth/request   {email, returnTo?} → emails a sign-in link
//   GET  /auth/verify?t= → confirm page (no side effects; scanners are safe)
//   POST /auth/verify    → consumes the link, sets the session cookie and
//                          redirects to /connect, or to `returnTo` with a
//                          one-time `?code=`
//   POST /auth/exchange  {code} → {email, token, expiresAt} + cookie
//   POST /auth/logout    → ends the browser session, clears the cookie
//   GET  /auth/me        → {email, isAdmin, scope}

import { readBearer, resolveCaller } from "../auth";
import type { Env } from "../env";
import { escapeHtml, htmlPage, messageBanner } from "../html";
import {
  formString,
  isSameOriginPost,
  jsonError,
  logAuthFailure,
  readForm,
  tooManyRequests,
  unauthorized,
} from "../http";
import { readJsonBody } from "../json-body";
import { publicOrigin } from "../origins";
import { checkRateLimits, clientIpFor, EXCHANGE_IP } from "../rate-limit";
import {
  clearSessionCookie,
  createBrowserSession,
  endBrowserSession,
  SESSION_TTL_SECONDS,
  sessionCookie,
} from "../session";
import {
  consumeAuthCode,
  consumeMagicRecord,
  readMagicRecord,
  requestSignInLink,
  resolveReturnTo,
  storeAuthCode,
} from "../sign-in";

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  let body: { email?: unknown; returnTo?: unknown } | null;
  try {
    body = (await readJsonBody(request, { maxBytes: 4096 })) as typeof body;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const email = typeof body?.email === "string" ? body.email : "";
  const result = await requestSignInLink(
    request,
    env,
    ctx,
    email,
    resolveReturnTo(request, body?.returnTo)
  );
  if (result.ok) {
    return Response.json({ ok: true });
  }
  if (result.status === 429) {
    return tooManyRequests(result.retryAfter ?? 60, result.error);
  }
  return jsonError(result.status, result.error);
}

function expiredPage(message: string, status: number): Response {
  return htmlPage(
    {
      title: "Sign-in link expired",
      body: `<h1>This sign-in link no longer works</h1>
${messageBanner("error", message)}
<p><a href="/connect">Request a new link</a></p>`,
    },
    { status }
  );
}

// The confirm page's POST answers `303` to the record's `returnTo` app, and
// CSP `form-action` also governs that redirect (Chromium blocks it), so the
// page allows exactly that origin. It is re-checked against the same app
// allow-list the record was created with (`resolveReturnTo`): a stored value
// that is not an app origin of this Worker never widens the policy.
function confirmFormActionOrigins(
  request: Request,
  returnTo: string | null
): string[] {
  const allowed = resolveReturnTo(request, returnTo);
  return allowed ? [allowed] : [];
}

async function handleVerifyGet(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const token = url.searchParams.get("t") ?? "";
  const record = token ? await readMagicRecord(env, token) : null;
  if (!record) {
    return expiredPage(
      "The link has expired or was already used. Links last 15 minutes and work once.",
      token ? 410 : 400
    );
  }
  return htmlPage({
    title: "Confirm sign-in",
    body: `<h1>Confirm sign-in</h1>
<p>Sign in to pilihpendidikan as <strong>${escapeHtml(record.email)}</strong>.</p>
<form method="post" action="/auth/verify">
<input type="hidden" name="t" value="${escapeHtml(token)}" />
<button type="submit">Continue</button>
</form>`,
    formActionOrigins: confirmFormActionOrigins(request, record.returnTo),
  });
}

async function handleVerifyPost(request: Request, env: Env): Promise<Response> {
  // Only the confirm page on this origin may redeem a link (blocks a
  // cross-site form from signing a visitor into someone else's account).
  if (!isSameOriginPost(request)) {
    return expiredPage(
      "Open the link from your email and press Continue.",
      403
    );
  }
  const token = formString(await readForm(request), "t");
  const record = token ? await consumeMagicRecord(env, token) : null;
  if (!record) {
    return expiredPage(
      "The link has expired or was already used. Links last 15 minutes and work once.",
      410
    );
  }
  const session = await createBrowserSession(env, record.email);
  const headers = new Headers({
    "Set-Cookie": sessionCookie(request, session),
    "Cache-Control": "no-store",
  });
  if (record.returnTo) {
    const code = await storeAuthCode(env, {
      token: session,
      email: record.email,
    });
    headers.set(
      "Location",
      `${record.returnTo}/?code=${encodeURIComponent(code)}`
    );
  } else {
    headers.set("Location", `${publicOrigin(request)}/connect`);
  }
  return new Response(null, { status: 303, headers });
}

async function handleExchange(request: Request, env: Env): Promise<Response> {
  const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
    [EXCHANGE_IP, clientIpFor(request)],
  ]);
  if (!limit.ok) {
    return tooManyRequests(limit.retryAfterSeconds, "Too many attempts.");
  }
  let body: { code?: unknown } | null;
  try {
    body = (await readJsonBody(request, { maxBytes: 4096 })) as typeof body;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) {
    return jsonError(400, "Missing code.");
  }
  const record = await consumeAuthCode(env, code);
  if (!record) {
    return jsonError(410, "Code expired or unknown.");
  }
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000
  ).toISOString();
  return Response.json(
    { email: record.email, token: record.token, expiresAt },
    {
      headers: {
        "Set-Cookie": sessionCookie(request, record.token),
        "Cache-Control": "no-store",
      },
    }
  );
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = readBearer(request);
  if (token) {
    await endBrowserSession(env, token);
  }
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": clearSessionCookie(request),
        "Cache-Control": "no-store",
      },
    }
  );
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const result = await resolveCaller(request, env);
  if (!result.caller) {
    await logAuthFailure(request, result.reason);
    return unauthorized(result.reason);
  }
  const { email, isAdmin, scope } = result.caller;
  return Response.json(
    { email, isAdmin, scope },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export function routeAuth(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> | null {
  const { pathname } = url;
  const { method } = request;
  if (pathname === "/auth/request" && method === "POST") {
    return handleRequest(request, env, ctx);
  }
  if (pathname === "/auth/verify" && method === "GET") {
    return handleVerifyGet(request, env, url);
  }
  if (pathname === "/auth/verify" && method === "POST") {
    return handleVerifyPost(request, env);
  }
  if (pathname === "/auth/exchange" && method === "POST") {
    return handleExchange(request, env);
  }
  if (pathname === "/auth/logout" && method === "POST") {
    return handleLogout(request, env);
  }
  if (pathname === "/auth/me" && method === "GET") {
    return handleMe(request, env);
  }
  return null;
}
