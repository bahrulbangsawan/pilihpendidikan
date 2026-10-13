// Session-aware consent for first-party clients (17 §4.3).
//
//   GET /oauth/authorize with a valid browser session  ─┐
//   GET|POST /oauth/magic after the email confirmation ─┴→ approve page
//   POST /oauth/authorize/decision                       → approve | deny | switch
//
// The approve page names the client, the device, the human-readable scopes
// and the signed-in email, and posts to the decision endpoint with a consent
// CSRF token:
//
//   csrf = "<issued_at>.<base64url(HMAC-SHA256(key, "pilih-consent:v1|"
//                                              + issued_at + "|" + params_hash))>"
//
// where `key` is the SHA-256 of the browser-session bearer (session mode) or
// the browser binding of the emailed link plus the link's hash (email mode),
// and `params_hash` the SHA-256 of the normalized authorize parameters. It is
// valid for 10 minutes. The decision also requires a same-origin POST and
// re-validates every parameter. Approve creates the `oauth_grants` row
// (device_id NULL; scopes = requested ∩ allowed) and a 300 s code; deny
// answers the client with `error=access_denied`.
//
// Pages go through `htmlPage()` (CSP nonce, frame-ancestors 'none',
// X-Frame-Options DENY); every interpolated value is escaped.

import type { OAuthScope } from "@pilihpendidikan/jobs-contracts/enums";
import type { ResolvedCaller } from "../auth";
import {
  hashToken,
  normalizeEmail,
  randomSecret,
  readSessionCookie,
  resolveBearer,
  timingSafeEqual,
  toBase64Url,
} from "../auth";
import type { Env } from "../env";
import { escapeHtml, htmlPage } from "../html";
import { formString, isSameOriginPost, readForm } from "../http";
import { scopeFromCaller } from "../jobs/core/scope";
import { findLiveUserDevice } from "../jobs/repo/devices/identity";
import { ensureUser, findUserByEmail } from "../jobs/repo/core/users";
import { publicOrigin } from "../origins";
import { clearSessionCookie, endBrowserSession, hostCookie } from "../session";
import { createGrant } from "./grants";
import type { AuthorizeParams, ValidatedAuthorize } from "./params";
import {
  errorPage,
  hiddenParamInputs,
  paramsHash,
  paramsQuery,
  readParams,
  validateAuthorize,
} from "./params";
import type { FoundPending } from "./pending";
import {
  expiredPage,
  isInitiatingBrowser,
  paramsOfPending,
  readPending,
  wrongBrowserPage,
} from "./pending";
import type { StoredCode } from "./shared";
import {
  CODE_TTL_SECONDS,
  CONSENT_CSRF_TTL_MS,
  formatScopes,
  OAUTH_FLOW_COOKIE,
} from "./shared";

export const DECISION_PATH = "/oauth/authorize/decision";

/** Human-readable scopes on the approve page (05 §1.2). */
export const SCOPE_DESCRIPTIONS: Readonly<Record<OAuthScope, string>> = {
  "jobs:read": "See your tracked jobs, applications, scores and statistics",
  "jobs:write":
    "Add and update tracked jobs, applications, notes, interviews and offers",
  "discovery:write": "Send job search results from this computer",
  "automation:execute":
    "Run application tasks you created, on this device only",
  "automation:manage":
    "Create and cancel automation tasks, decide submit approvals and turn on rules",
  "cv:read": "Read your CVs",
  "cv:write": "Create tailored versions of your CVs",
  "files:read": "Download your files (CV PDFs, evidence)",
  "files:write": "Upload files (CV PDFs, evidence, run logs)",
  "ai:invoke": "Use AI features within your monthly AI budget",
  "devices:manage": "List, rename and sign out your devices",
  offline_access:
    "Stay signed in on this device until you sign out or revoke it",
};

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

const CSRF_LABEL = "pilih-consent:v1";
const INTEGER_RE = /^\d{1,15}$/;
/** Tolerated clock difference between two isolates issuing / checking. */
const CSRF_FUTURE_SKEW_MS = 60_000;

async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message)
  );
  return toBase64Url(new Uint8Array(signature));
}

/** A consent CSRF token for `key` and the parameters hash. */
export async function issueCsrf(
  key: string,
  hash: string,
  issuedAt: number
): Promise<string> {
  return `${issuedAt}.${await hmac(key, `${CSRF_LABEL}|${issuedAt}|${hash}`)}`;
}

/** True when `token` was issued for `key` + `hash` less than 10 min ago. */
export async function verifyCsrf(
  key: string,
  hash: string,
  token: string,
  now: number
): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot <= 0) {
    return false;
  }
  const issuedText = token.slice(0, dot);
  if (!INTEGER_RE.test(issuedText)) {
    return false;
  }
  const issuedAt = Number(issuedText);
  if (
    now - issuedAt > CONSENT_CSRF_TTL_MS ||
    issuedAt - now > CSRF_FUTURE_SKEW_MS
  ) {
    return false;
  }
  const expected = await issueCsrf(key, hash, issuedAt);
  return timingSafeEqual(token, expected);
}

function magicCsrfKey(found: FoundPending): string {
  return `${found.pending.browserBinding}:${found.tokenHash}`;
}

// ---------------------------------------------------------------------------
// The approve page
// ---------------------------------------------------------------------------

export type ConsentMode =
  | { kind: "session"; sessionHash: string }
  | { kind: "magic"; found: FoundPending; token: string };

export interface ApprovePageInput {
  checked: ValidatedAuthorize;
  email: string;
  mode: ConsentMode;
  /** Name of the existing device a `device_hint` re-login signs in again. */
  rebindDeviceName: string | null;
}

function scopeList(scopes: readonly OAuthScope[]): string {
  return scopes
    .map(
      (scope) =>
        `<li>${escapeHtml(SCOPE_DESCRIPTIONS[scope])} <span class="meta"><code>${escapeHtml(scope)}</code></span></li>`
    )
    .join("\n");
}

function rebindNote(name: string | null): string {
  if (!name) {
    return "";
  }
  return `<p class="meta">This signs in your existing device <strong>${escapeHtml(name)}</strong> again; its previous sign-in ends.</p>`;
}

function stepUpNote(scopes: readonly OAuthScope[]): string {
  if (!scopes.includes("automation:manage")) {
    return "";
  }
  return `<p class="msg">This includes <strong>managing automation</strong>: the CLI can approve submissions and turn on rules without the dashboard.</p>`;
}

/** The approve page (17 §4.3). Its CSRF token binds it to `mode`. */
export async function approvePage(
  input: ApprovePageInput,
  now: number
): Promise<Response> {
  const { checked, mode } = input;
  const { params } = checked;
  const key =
    mode.kind === "session" ? mode.sessionHash : magicCsrfKey(mode.found);
  const csrf = await issueCsrf(key, await paramsHash(params), now);
  const clientName = escapeHtml(checked.client.client_name ?? "pilih-jobs CLI");
  const device = escapeHtml(params.deviceName || "this computer");
  const target = new URL(params.redirectUri);
  const magicField =
    mode.kind === "magic"
      ? `<input type="hidden" name="magic" value="${escapeHtml(mode.token)}" />`
      : "";
  const hidden = `${hiddenParamInputs(params)}
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
${magicField}`;
  const signOut =
    mode.kind === "session"
      ? `<form method="post" action="${DECISION_PATH}">
${hidden}
<p class="meta">Not you? <button type="submit" name="decision" value="switch" class="link">Sign out</button> and use another account.</p>
</form>`
      : "";
  return htmlPage({
    title: "Approve sign-in",
    body: `<h1>Allow ${clientName}</h1>
<p>Allow <strong>${clientName}</strong> on <strong>${device}</strong> to:</p>
<ul class="scopes">
${scopeList(checked.scopes)}
</ul>
${stepUpNote(checked.scopes)}${rebindNote(input.rebindDeviceName)}
<p>Signed in as <strong>${escapeHtml(input.email)}</strong>.</p>
<p class="meta">Only approve if you just ran <code>pilih-jobs login</code> on a computer you control. You return to <code>${escapeHtml(target.host)}</code>.</p>
<form method="post" action="${DECISION_PATH}">
${hidden}
<div class="row">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</div>
</form>
${signOut}`,
    // The decision answers with a 303 to the loopback redirect URI, which
    // CSP form-action also governs.
    formActionOrigins: [target.origin],
  });
}

/** The name of the device a valid `device_hint` points at, or null. */
async function rebindDeviceName(
  env: Env,
  userId: string,
  hint: string
): Promise<string | null> {
  if (!hint) {
    return null;
  }
  const device = await findLiveUserDevice(
    env.DB,
    scopeFromCaller({ userId }),
    hint
  );
  return device?.name ?? null;
}

/** A live browser session of this request (KV `auth:session:*`), or null. */
export async function browserSessionOf(
  request: Request,
  env: Env
): Promise<{ bearer: string; caller: ResolvedCaller } | null> {
  const bearer = readSessionCookie(request);
  if (!bearer) {
    return null;
  }
  const result = await resolveBearer(bearer, env);
  const caller = result.caller;
  if (
    !caller ||
    caller.credentialKind !== "browser_session" ||
    caller.userDeletedAt !== null
  ) {
    return null;
  }
  return { bearer, caller };
}

/** GET /oauth/authorize for a first-party client with a browser session. */
export async function sessionApprovePage(
  env: Env,
  checked: ValidatedAuthorize,
  session: { bearer: string; caller: ResolvedCaller }
): Promise<Response> {
  return await approvePage(
    {
      checked,
      email: session.caller.email,
      mode: { kind: "session", sessionHash: await hashToken(session.bearer) },
      rebindDeviceName: await rebindDeviceName(
        env,
        session.caller.userId,
        checked.params.deviceHint
      ),
    },
    Date.now()
  );
}

/** GET|POST /oauth/magic for a first-party client: the approve page. */
export async function magicApprovePage(
  env: Env,
  found: FoundPending,
  token: string
): Promise<Response> {
  const checked = await validateAuthorize(env, paramsOfPending(found.pending));
  if (checked instanceof Response) {
    return checked;
  }
  // Read-only (GET must have no side effects): a first sign-in has no user
  // row yet, and then no device to sign in again either.
  const user = await findUserByEmail(
    env.DB,
    normalizeEmail(found.pending.email)
  );
  return await approvePage(
    {
      checked,
      email: found.pending.email,
      mode: { kind: "magic", found, token },
      rebindDeviceName: user
        ? await rebindDeviceName(env, user.id, checked.params.deviceHint)
        : null,
    },
    Date.now()
  );
}

// ---------------------------------------------------------------------------
// POST /oauth/authorize/decision
// ---------------------------------------------------------------------------

function redirectTo(target: URL, extra: Headers = new Headers()): Response {
  extra.set("Location", target.toString());
  extra.set("Cache-Control", "no-store");
  return new Response(null, { status: 303, headers: extra });
}

function clientRedirect(
  request: Request,
  params: AuthorizeParams,
  values: Record<string, string>
): URL {
  const target = new URL(params.redirectUri);
  for (const [key, value] of Object.entries(values)) {
    target.searchParams.set(key, value);
  }
  if (params.state) {
    target.searchParams.set("state", params.state);
  }
  // RFC 9207: lets the client detect authorization-server mix-up.
  target.searchParams.set("iss", publicOrigin(request));
  return target;
}

/**
 * Approve (17 §4.3 step 5): the grant row (no device yet), then the code in
 * KV `oauth:code:<sha256>` for 300 s, then 303 back to the client.
 */
async function approve(
  request: Request,
  env: Env,
  checked: ValidatedAuthorize,
  email: string,
  headers: Headers
): Promise<Response> {
  const now = Date.now();
  const user = await ensureUser(env.DB, normalizeEmail(email), now);
  if (user.deleted_at !== null) {
    return errorPage("This account is being deleted.", 403, true);
  }
  const { params } = checked;
  const scopes = formatScopes(checked.scopes);
  const grantId = await createGrant(env.DB, {
    userId: user.id,
    clientId: checked.client.client_id,
    scopes,
    now,
  });
  let deviceHint: string | null = null;
  if (params.deviceHint) {
    const device = await findLiveUserDevice(
      env.DB,
      scopeFromCaller({ userId: user.id }),
      params.deviceHint
    );
    deviceHint = device?.id ?? null;
  }
  const code = randomSecret();
  const stored: StoredCode = {
    email: user.email,
    userId: user.id,
    clientId: checked.client.client_id,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    grantId,
    scopes,
    deviceHint,
  };
  await env.AUTH_KV.put(
    `oauth:code:${await hashToken(code)}`,
    JSON.stringify(stored),
    { expirationTtl: CODE_TTL_SECONDS }
  );
  return redirectTo(clientRedirect(request, params, { code }), headers);
}

function deny(
  request: Request,
  params: AuthorizeParams,
  headers: Headers
): Response {
  return redirectTo(
    clientRedirect(request, params, { error: "access_denied" }),
    headers
  );
}

function forbidden(message: string): Response {
  return errorPage(message, 403, true);
}

async function decideWithSession(
  request: Request,
  env: Env,
  form: FormData | null,
  decision: string
): Promise<Response> {
  const session = await browserSessionOf(request, env);
  if (!session) {
    return errorPage(
      "Your sign-in on this site ended before you decided.",
      401,
      true
    );
  }
  const checked = await validateAuthorize(
    env,
    readParams((name) => formString(form, name))
  );
  if (checked instanceof Response) {
    return checked;
  }
  if (!checked.firstParty) {
    return errorPage("This client does not use this approval page.");
  }
  const valid = await verifyCsrf(
    await hashToken(session.bearer),
    await paramsHash(checked.params),
    formString(form, "csrf"),
    Date.now()
  );
  if (!valid) {
    return forbidden("This approval form expired or was not issued to you.");
  }
  if (decision === "switch") {
    await endBrowserSession(env, session.bearer);
    const back = new URL(
      `/oauth/authorize?${paramsQuery(checked.params)}`,
      publicOrigin(request)
    );
    return redirectTo(
      back,
      new Headers({ "Set-Cookie": clearSessionCookie(request) })
    );
  }
  if (decision === "deny") {
    return deny(request, checked.params, new Headers());
  }
  return await approve(
    request,
    env,
    checked,
    session.caller.email,
    new Headers()
  );
}

async function decideWithMagic(
  request: Request,
  env: Env,
  form: FormData | null,
  decision: string,
  token: string
): Promise<Response> {
  const found = await readPending(env, token);
  if (!found) {
    return expiredPage();
  }
  if (!(await isInitiatingBrowser(request, found.pending))) {
    return wrongBrowserPage();
  }
  const checked = await validateAuthorize(env, paramsOfPending(found.pending));
  if (checked instanceof Response) {
    return checked;
  }
  if (!checked.firstParty || decision === "switch") {
    return errorPage("This client does not use this approval page.");
  }
  const valid = await verifyCsrf(
    magicCsrfKey(found),
    await paramsHash(checked.params),
    formString(form, "csrf"),
    Date.now()
  );
  if (!valid) {
    return forbidden("This approval form expired or was not issued to you.");
  }
  // The link works once, whatever the decision.
  await env.AUTH_KV.delete(found.key);
  const headers = new Headers({
    "Set-Cookie": hostCookie(request, OAUTH_FLOW_COOKIE, "", 0),
  });
  if (decision === "deny") {
    return deny(request, checked.params, headers);
  }
  return await approve(request, env, checked, found.pending.email, headers);
}

const DECISIONS = new Set(["approve", "deny", "switch"]);

export async function handleAuthorizeDecision(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isSameOriginPost(request)) {
    return forbidden("This form must be sent from the approval page.");
  }
  const form = await readForm(request);
  const decision = formString(form, "decision");
  if (!DECISIONS.has(decision)) {
    return errorPage("Choose Approve or Deny.", 400, true);
  }
  const token = formString(form, "magic");
  if (token) {
    return await decideWithMagic(request, env, form, decision, token);
  }
  return await decideWithSession(request, env, form, decision);
}
