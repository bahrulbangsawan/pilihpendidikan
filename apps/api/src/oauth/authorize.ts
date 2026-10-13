// /oauth/authorize — where a client sends the user (17 §4).
//
//   GET   first-party client (`pilih-jobs-cli`) + a valid browser session on
//         this origin → the approve page (consent.ts), no email is sent;
//         otherwise (no session, or a DCR/MCP client) → the consent form that
//         asks for an email address (unchanged for MCP clients).
//   POST  the email form: emails a confirmation link (`/oauth/magic`) bound
//         to this browser by the `__Host-oauth-flow` cookie.
//
// Invalid client_id / redirect_uri never redirect: they render an error
// page, so this endpoint cannot be used as an open redirector.

import { hashToken, normalizeEmail, randomSecret } from "../auth";
import { sendSignInEmail } from "../email";
import type { Env } from "../env";
import { escapeHtml, htmlPage, messageBanner } from "../html";
import { formString, isSameOriginPost, readForm } from "../http";
import { publicOrigin } from "../origins";
import {
  checkRateLimits,
  clientIpFor,
  MAGIC_LINK_EMAIL,
  MAGIC_LINK_IP,
} from "../rate-limit";
import { hostCookie } from "../session";
import { isValidEmail, MAGIC_TTL_SECONDS } from "../sign-in";
import { browserSessionOf, sessionApprovePage } from "./consent";
import type { ValidatedAuthorize } from "./params";
import {
  errorPage,
  hiddenParamInputs,
  readParams,
  validateAuthorize,
} from "./params";
import { pendingKey } from "./pending";
import type { PendingAuthorization } from "./shared";
import { OAUTH_FLOW_COOKIE } from "./shared";

function emailFormIntro(checked: ValidatedAuthorize, name: string): string {
  if (checked.firstParty) {
    const device = checked.params.deviceName
      ? ` on <strong>${escapeHtml(checked.params.deviceName)}</strong>`
      : "";
    return `<h1>Sign in to ${name}</h1>
<p><strong>${name}</strong>${device} wants to use your job tracker on pilihpendidikan. Enter your email address and we will send you a link; you approve what it may do after opening it.</p>`;
  }
  return `<h1>Connect ${name}</h1>
<p><strong>${name}</strong> wants to read and edit your CVs, invoices, portfolios and job tracker on pilihpendidikan. Enter your email address and we will send you a link to approve it.</p>`;
}

function consentPage(checked: ValidatedAuthorize, error?: string): Response {
  const name = escapeHtml(
    checked.client.client_name ??
      (checked.firstParty ? "pilih-jobs CLI" : "An AI app")
  );
  const host = escapeHtml(new URL(checked.params.redirectUri).host);
  const lasts = checked.firstParty
    ? "You can sign it out any time from the dashboard."
    : "The connection lasts 90 days.";
  return htmlPage(
    {
      title: checked.firstParty
        ? "Sign in to pilihpendidikan"
        : "Connect to pilihpendidikan",
      body: `${emailFormIntro(checked, name)}
${error ? messageBanner("error", error) : ""}
<form method="post" action="/oauth/authorize">
${hiddenParamInputs(checked.params)}
<div class="field">
<label for="email">Email address</label>
<input id="email" type="email" name="email" required autocomplete="email" inputmode="email" />
</div>
<button type="submit">Send approval link</button>
</form>
<p class="meta">After approval you return to <code>${host}</code>. Open the emailed link in this browser. ${lasts}</p>`,
    },
    { status: error ? 400 : 200 }
  );
}

export async function handleAuthorizeGet(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const params = readParams((name) => url.searchParams.get(name) ?? "");
  if (!params.responseType) {
    params.responseType = "code";
  }
  const checked = await validateAuthorize(env, params);
  if (checked instanceof Response) {
    return checked;
  }
  if (checked.firstParty) {
    const session = await browserSessionOf(request, env);
    if (session) {
      return await sessionApprovePage(env, checked, session);
    }
  }
  return consentPage(checked);
}

export async function handleAuthorizePost(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!isSameOriginPost(request)) {
    return errorPage("This form must be sent from the connect page.", 403);
  }
  const form = await readForm(request);
  const checked = await validateAuthorize(
    env,
    readParams((name) => formString(form, name))
  );
  if (checked instanceof Response) {
    return checked;
  }
  const email = normalizeEmail(formString(form, "email"));
  if (!isValidEmail(email)) {
    return consentPage(checked, "Enter a valid email address.");
  }
  const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
    [MAGIC_LINK_IP, clientIpFor(request)],
    [MAGIC_LINK_EMAIL, email],
  ]);
  if (!limit.ok) {
    return consentPage(checked, "Too many requests. Try again later.");
  }
  const { params } = checked;
  const token = randomSecret();
  const binding = randomSecret();
  const key = pendingKey(await hashToken(token));
  const pending: PendingAuthorization = {
    email,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    state: params.state,
    browserBinding: await hashToken(binding),
  };
  if (checked.firstParty) {
    pending.scope = params.scope;
    pending.deviceName = params.deviceName;
    pending.deviceHint = params.deviceHint;
  }
  await env.AUTH_KV.put(key, JSON.stringify(pending), {
    expirationTtl: MAGIC_TTL_SECONDS,
  });
  const link = `${publicOrigin(request)}/oauth/magic?token=${encodeURIComponent(token)}`;
  const appName =
    checked.client.client_name ??
    (checked.firstParty ? "pilih-jobs CLI" : "an AI app");
  sendSignInEmail(
    env,
    ctx,
    {
      to: email,
      link,
      purpose: checked.firstParty
        ? `sign in to ${appName}`
        : `connect ${appName}`,
    },
    () => env.AUTH_KV.delete(key)
  );
  return htmlPage(
    {
      title: "Check your email",
      body: `<h1>Check your email</h1>
<p role="status">We sent a link to <strong>${escapeHtml(email)}</strong>. Open it in this browser to finish ${checked.firstParty ? "signing in to" : "connecting"} ${escapeHtml(appName)}.</p>
<p class="meta">The link expires in 15 minutes and works once.</p>`,
    },
    {
      headers: {
        "Set-Cookie": hostCookie(
          request,
          OAUTH_FLOW_COOKIE,
          binding,
          MAGIC_TTL_SECONDS
        ),
      },
    }
  );
}
