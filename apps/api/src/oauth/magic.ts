// /oauth/magic — the emailed approval link. GET renders a page and changes
// nothing (inbox scanners prefetch links); both methods require the browser
// that asked for the link (`__Host-oauth-flow`, pending.ts).
//
//   MCP (DCR) clients     GET → confirm page; POST consumes the link, stores
//                         a single-use code and redirects back (unchanged).
//   first-party clients   GET and POST → the approve page (17 §4.3: the same
//                         page as the session path); the decision endpoint
//                         consumes the link and issues the code.

import { hashToken, randomSecret } from "../auth";
import type { Env } from "../env";
import { escapeHtml, htmlPage } from "../html";
import { formString, isSameOriginPost, readForm } from "../http";
import { publicOrigin } from "../origins";
import { hostCookie } from "../session";
import { magicApprovePage } from "./consent";
import type { FoundPending } from "./pending";
import {
  expiredPage,
  isInitiatingBrowser,
  readPending,
  wrongBrowserPage,
} from "./pending";
import type { StoredCode } from "./shared";
import {
  CODE_TTL_SECONDS,
  findClient,
  isFirstParty,
  OAUTH_FLOW_COOKIE,
} from "./shared";

async function isFirstPartyPending(
  env: Env,
  found: FoundPending
): Promise<boolean> {
  const client = await findClient(env.DB, found.pending.clientId);
  return client !== null && isFirstParty(client);
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
  if (await isFirstPartyPending(env, found)) {
    return await magicApprovePage(env, found, token);
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
  if (await isFirstPartyPending(env, found)) {
    // Consent for first-party clients happens on the approve page only.
    return await magicApprovePage(env, found, token);
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
