// /oauth/authorize — the client sends the user here; we ask for an email
// address and send a confirmation link (the same email flow as /connect).
// Invalid client_id / redirect_uri never redirect: they render an error page,
// so this endpoint cannot be used as an open redirector.

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
import type { PendingAuthorization } from "./shared";
import {
  findClient,
  isValidCodeChallenge,
  OAUTH_FLOW_COOKIE,
  parseRedirectUris,
} from "./shared";

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  responseType: string;
  scope: string;
  resource: string;
}

const PARAM_NAMES: ReadonlyArray<readonly [keyof AuthorizeParams, string]> = [
  ["clientId", "client_id"],
  ["redirectUri", "redirect_uri"],
  ["state", "state"],
  ["codeChallenge", "code_challenge"],
  ["codeChallengeMethod", "code_challenge_method"],
  ["responseType", "response_type"],
  ["scope", "scope"],
  ["resource", "resource"],
];

const MAX_STATE_LENGTH = 512;

function readParams(get: (name: string) => string): AuthorizeParams {
  const params = {} as AuthorizeParams;
  for (const [key, name] of PARAM_NAMES) {
    params[key] = get(name);
  }
  return params;
}

function errorPage(message: string, status = 400): Response {
  return htmlPage(
    {
      title: "Cannot connect",
      body: `<h1>This connection request is not valid</h1>
${messageBanner("error", message)}
<p>Start the connection again from your AI app.</p>`,
    },
    { status }
  );
}

async function validate(
  env: Env,
  params: AuthorizeParams
): Promise<{ clientName: string | null } | Response> {
  if (!(params.clientId && params.redirectUri)) {
    return errorPage("client_id and redirect_uri are required.");
  }
  const client = await findClient(env.DB, params.clientId);
  if (!client) {
    return errorPage("Unknown client. Register the client first.", 401);
  }
  if (!parseRedirectUris(client.redirect_uris).includes(params.redirectUri)) {
    return errorPage("redirect_uri is not registered for this client.");
  }
  if (params.responseType !== "code") {
    return errorPage("Only response_type=code is supported.");
  }
  if (params.codeChallengeMethod !== "S256") {
    return errorPage("PKCE with code_challenge_method=S256 is required.");
  }
  if (!isValidCodeChallenge(params.codeChallenge)) {
    return errorPage("code_challenge is missing or malformed.");
  }
  if (params.state.length > MAX_STATE_LENGTH) {
    return errorPage("state is too long.");
  }
  return { clientName: client.client_name };
}

function consentPage(
  params: AuthorizeParams,
  clientName: string | null,
  error?: string
): Response {
  const hidden = PARAM_NAMES.map(
    ([key, name]) =>
      `<input type="hidden" name="${name}" value="${escapeHtml(params[key])}" />`
  ).join("\n");
  const name = escapeHtml(clientName ?? "An AI app");
  return htmlPage(
    {
      title: "Connect to pilihpendidikan",
      body: `<h1>Connect ${name}</h1>
<p><strong>${name}</strong> wants to read and edit your CVs, invoices, portfolios and job tracker on pilihpendidikan. Enter your email address and we will send you a link to approve it.</p>
${error ? messageBanner("error", error) : ""}
<form method="post" action="/oauth/authorize">
${hidden}
<div class="field">
<label for="email">Email address</label>
<input id="email" type="email" name="email" required autocomplete="email" inputmode="email" />
</div>
<button type="submit">Send approval link</button>
</form>
<p class="meta">After approval you return to <code>${escapeHtml(new URL(params.redirectUri).host)}</code>. Open the emailed link in this browser. The connection lasts 90 days.</p>`,
    },
    { status: error ? 400 : 200 }
  );
}

export async function handleAuthorizeGet(
  env: Env,
  url: URL
): Promise<Response> {
  const params = readParams((name) => url.searchParams.get(name) ?? "");
  if (!params.responseType) {
    params.responseType = "code";
  }
  const checked = await validate(env, params);
  if (checked instanceof Response) {
    return checked;
  }
  return consentPage(params, checked.clientName);
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
  const params = readParams((name) => formString(form, name));
  const checked = await validate(env, params);
  if (checked instanceof Response) {
    return checked;
  }
  const email = normalizeEmail(formString(form, "email"));
  if (!isValidEmail(email)) {
    return consentPage(
      params,
      checked.clientName,
      "Enter a valid email address."
    );
  }
  const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
    [MAGIC_LINK_IP, clientIpFor(request)],
    [MAGIC_LINK_EMAIL, email],
  ]);
  if (!limit.ok) {
    return consentPage(
      params,
      checked.clientName,
      "Too many requests. Try again later."
    );
  }
  const token = randomSecret();
  const binding = randomSecret();
  const key = `auth:oauth-magic:${await hashToken(token)}`;
  const pending: PendingAuthorization = {
    email,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    state: params.state,
    browserBinding: await hashToken(binding),
  };
  await env.AUTH_KV.put(key, JSON.stringify(pending), {
    expirationTtl: MAGIC_TTL_SECONDS,
  });
  const link = `${publicOrigin(request)}/oauth/magic?token=${encodeURIComponent(token)}`;
  const appName = checked.clientName ?? "an AI app";
  sendSignInEmail(
    env,
    ctx,
    { to: email, link, purpose: `connect ${appName}` },
    () => env.AUTH_KV.delete(key)
  );
  return htmlPage(
    {
      title: "Check your email",
      body: `<h1>Check your email</h1>
<p role="status">We sent a link to <strong>${escapeHtml(email)}</strong>. Open it in this browser to finish connecting ${escapeHtml(appName)}.</p>
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
