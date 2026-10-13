// The emailed approval link of the OAuth email flow (`auth:oauth-magic:<sha256>`
// in AUTH_KV, 15 min). The link only works in the browser that asked for it:
// the `__Host-oauth-flow` cookie set by POST /oauth/authorize must hash to the
// stored `browserBinding` (17 §14 T6).

import { hashToken, readHostCookie, timingSafeEqual } from "../auth";
import type { Env } from "../env";
import { htmlPage, messageBanner } from "../html";
import type { AuthorizeParams } from "./params";
import type { PendingAuthorization } from "./shared";
import { OAUTH_FLOW_COOKIE } from "./shared";

export function pendingKey(tokenHash: string): string {
  return `auth:oauth-magic:${tokenHash}`;
}

export function expiredPage(): Response {
  return htmlPage(
    {
      title: "Link expired",
      body: `<h1>This link no longer works</h1>
${messageBanner("error", "Approval links last 15 minutes and work once.")}
<p>Start again from the app that asked for access.</p>`,
    },
    { status: 410 }
  );
}

export function wrongBrowserPage(): Response {
  return htmlPage(
    {
      title: "Open in the original browser",
      body: `<h1>Open this link where you started</h1>
${messageBanner("error", "For your safety, approval links only work in the browser that asked for them.")}
<p>Open the link in the browser where the sign-in page opened, or start again from the app.</p>`,
    },
    { status: 403 }
  );
}

// True when this browser carries the cookie set when the authorization was
// requested. Someone who merely receives the email cannot approve it.
export async function isInitiatingBrowser(
  request: Request,
  pending: PendingAuthorization
): Promise<boolean> {
  const cookie = readHostCookie(request, OAUTH_FLOW_COOKIE);
  if (!(cookie && pending.browserBinding)) {
    return false;
  }
  return timingSafeEqual(await hashToken(cookie), pending.browserBinding);
}

export interface FoundPending {
  key: string;
  pending: PendingAuthorization;
  tokenHash: string;
}

export async function readPending(
  env: Env,
  token: string
): Promise<FoundPending | null> {
  if (!token) {
    return null;
  }
  const tokenHash = await hashToken(token);
  const key = pendingKey(tokenHash);
  const pending = await env.AUTH_KV.get<PendingAuthorization>(key, "json");
  return pending ? { key, pending, tokenHash } : null;
}

/** The authorize parameters a pending link was created for. */
export function paramsOfPending(
  pending: PendingAuthorization
): AuthorizeParams {
  return {
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    state: pending.state,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: "S256",
    responseType: "code",
    scope: pending.scope ?? "",
    resource: "",
    deviceName: pending.deviceName ?? "",
    deviceHint: pending.deviceHint ?? "",
  };
}
