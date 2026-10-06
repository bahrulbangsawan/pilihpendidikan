// /oauth/magic — the emailed approval link. GET renders a confirm page and
// changes nothing (inbox scanners prefetch links); POST consumes the link,
// stores a single-use authorization code and redirects back to the client.

import {
  hashToken,
  randomSecret,
  readHostCookie,
  timingSafeEqual,
} from "../auth";
import type { Env } from "../env";
import { escapeHtml, htmlPage, messageBanner } from "../html";
import { formString, isSameOriginPost, readForm } from "../http";
import { publicOrigin } from "../origins";
import { hostCookie } from "../session";
import type { PendingAuthorization, StoredCode } from "./shared";
import { CODE_TTL_SECONDS, OAUTH_FLOW_COOKIE } from "./shared";

function expiredPage(): Response {
  return htmlPage(
    {
      title: "Link expired",
      body: `<h1>This link no longer works</h1>
${messageBanner("error", "Approval links last 15 minutes and work once.")}
<p>Start the connection again from your AI app.</p>`,
    },
    { status: 410 }
  );
}

function wrongBrowserPage(): Response {
  return htmlPage(
    {
      title: "Open in the original browser",
      body: `<h1>Open this link where you started</h1>
${messageBanner("error", "For your safety, approval links only work in the browser that asked for them.")}
<p>Open the link in the browser where your AI app opened the connect page, or start the connection again from the app.</p>`,
    },
    { status: 403 }
  );
}

// True when this browser carries the cookie set when the authorization was
// requested. Someone who merely receives the email cannot approve it.
async function isInitiatingBrowser(
  request: Request,
  pending: PendingAuthorization
): Promise<boolean> {
  const cookie = readHostCookie(request, OAUTH_FLOW_COOKIE);
  if (!(cookie && pending.browserBinding)) {
    return false;
  }
  return timingSafeEqual(await hashToken(cookie), pending.browserBinding);
}

async function readPending(
  env: Env,
  token: string
): Promise<{ key: string; pending: PendingAuthorization } | null> {
  if (!token) {
    return null;
  }
  const key = `auth:oauth-magic:${await hashToken(token)}`;
  const pending = await env.AUTH_KV.get<PendingAuthorization>(key, "json");
  return pending ? { key, pending } : null;
}

export async function handleMagicGet(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";
  const found = await readPending(env, token);
  if (!found) {
    return expiredPage();
  }
  if (!(await isInitiatingBrowser(request, found.pending))) {
    return wrongBrowserPage();
  }
  const target = new URL(found.pending.redirectUri);
  return htmlPage({
    title: "Approve connection",
    body: `<h1>Approve connection</h1>
<p>Let the AI app at <code>${escapeHtml(target.host)}</code> read and edit your pilihpendidikan documents as <strong>${escapeHtml(found.pending.email)}</strong>?</p>
<p class="meta">Only approve if you started this from your AI app a moment ago.</p>
<form method="post" action="/oauth/magic">
<input type="hidden" name="token" value="${escapeHtml(token)}" />
<button type="submit">Approve</button>
</form>`,
    // The POST answers with a redirect to the client's redirect_uri, which
    // CSP form-action also governs.
    formActionOrigins: [target.origin],
  });
}

export async function handleMagicPost(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isSameOriginPost(request)) {
    return wrongBrowserPage();
  }
  const token = formString(await readForm(request), "token");
  const found = await readPending(env, token);
  if (!found) {
    return expiredPage();
  }
  if (!(await isInitiatingBrowser(request, found.pending))) {
    return wrongBrowserPage();
  }
  await env.AUTH_KV.delete(found.key);
  const { pending } = found;
  const code = randomSecret();
  const stored: StoredCode = {
    email: pending.email,
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
  };
  await env.AUTH_KV.put(
    `oauth:code:${await hashToken(code)}`,
    JSON.stringify(stored),
    { expirationTtl: CODE_TTL_SECONDS }
  );
  const target = new URL(pending.redirectUri);
  target.searchParams.set("code", code);
  if (pending.state) {
    target.searchParams.set("state", pending.state);
  }
  // RFC 9207: lets the client detect authorization-server mix-up.
  target.searchParams.set("iss", publicOrigin(request));
  const headers = new Headers({
    Location: target.toString(),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", hostCookie(request, OAUTH_FLOW_COOKIE, "", 0));
  return new Response(null, { status: 303, headers });
}
