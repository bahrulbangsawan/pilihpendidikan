// Shared drivers for the OAuth / device tests (no tests of its own): a real
// `createApp(...)` over fake bindings, the browser half of the first-party
// login (session-aware approve page or the emailed link) and the CLI half
// (PKCE code exchange, refresh, revoke, device registration).

import { expect } from "bun:test";
import type { TestEnv, TestEnvOptions } from "../../test/fakes";
import { createCtx, createTestEnv } from "../../test/fakes";
import { createApp } from "../app";
import type { McpHandler } from "../routes/mcp";
import { createBrowserSession } from "../session";
import { CLI_BASE_SCOPES, formatScopeList } from "../jobs/core/scopes";

export const PROD = "https://api.pilihpendidikan.com";
export const LOOPBACK = "http://127.0.0.1:53127/callback";
export const STATE = "s".repeat(43);
// 64 chars of the RFC 7636 unreserved set (what `token_urlsafe(48)` yields).
export const VERIFIER =
  "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk0123456789-._~abcdefg";
export const BASE_SCOPE = formatScopeList(CLI_BASE_SCOPES);

const noMcp: McpHandler = {
  fetch: () => new Response("mcp-ok"),
};

const BASE64_PAD_RE = /=+$/;
const HIDDEN_INPUT_RE =
  /<input type="hidden" name="([^"]+)" value="([^"]*)" \/>/g;
const LINK_RE = /https?:\/\/[^\s"<]+\/oauth\/magic\?token=[\w%-]+/;

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PAD_RE, "");
}

export function unescapeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Hidden fields of the FIRST form on a page. */
export function hiddenFields(html: string): URLSearchParams {
  const start = html.indexOf("<form");
  const end = html.indexOf("</form>", start);
  const form = html.slice(start, end);
  const fields = new URLSearchParams();
  for (const match of form.matchAll(HIDDEN_INPUT_RE)) {
    fields.set(match[1], unescapeHtml(match[2]));
  }
  return fields;
}

export interface CallInit extends RequestInit {
  base?: string;
  cookie?: string;
  /** Do not add the same-origin `Origin` header to form posts. */
  noOrigin?: boolean;
  origin?: string;
}

export interface TokenSet {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export interface Harness {
  app: ReturnType<typeof createApp>;
  call(path: string, init?: CallInit): Promise<Response>;
  /** Form POST (Origin of this API unless told otherwise). */
  form(
    path: string,
    fields: Record<string, string> | URLSearchParams,
    init?: CallInit
  ): Promise<Response>;
  t: TestEnv;
}

/** A Worker with the CLI login flag on (and JOBS_V1 on, as every test env). */
export function createHarness(options: TestEnvOptions = {}): Harness {
  const t = createTestEnv(
    {},
    { flags: { JOBS_CLI_LOGIN_ENABLED: true, ...options.flags } }
  );
  const app = createApp({ sse: noMcp, streamable: noMcp });
  async function call(path: string, init: CallInit = {}): Promise<Response> {
    const ctx = createCtx();
    const headers = new Headers(init.headers);
    if (init.cookie) {
      headers.set("Cookie", init.cookie);
    }
    const response = await app.fetch(
      new Request(`${init.base ?? PROD}${path}`, { ...init, headers }),
      t.env,
      ctx
    );
    await ctx.drain();
    return response;
  }
  return {
    t,
    app,
    call,
    form(path, fields, init = {}) {
      const headers = new Headers(init.headers);
      if (!(init.noOrigin || headers.has("Origin"))) {
        headers.set("Origin", init.origin ?? PROD);
      }
      return call(path, {
        ...init,
        method: "POST",
        headers,
        body: new URLSearchParams(fields),
      });
    },
  };
}

export interface AuthorizeOptions {
  challenge?: string;
  clientId?: string;
  deviceHint?: string;
  deviceName?: string;
  redirectUri?: string;
  scope?: string;
  state?: string | null;
}

export async function authorizeQuery(
  options: AuthorizeOptions = {}
): Promise<URLSearchParams> {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId ?? "pilih-jobs-cli",
    redirect_uri: options.redirectUri ?? LOOPBACK,
    code_challenge: options.challenge ?? (await challengeFor(VERIFIER)),
    code_challenge_method: "S256",
    scope: options.scope ?? BASE_SCOPE,
    device_name: options.deviceName ?? "alice-mbp (macOS)",
  });
  if (options.state !== null) {
    params.set("state", options.state ?? STATE);
  }
  if (options.deviceHint) {
    params.set("device_hint", options.deviceHint);
  }
  return params;
}

/** A browser signed in at api.pilihpendidikan.com: `__Host-session=…`. */
export async function signedInCookie(
  h: Harness,
  email: string
): Promise<{ bearer: string; cookie: string }> {
  const bearer = await createBrowserSession(h.t.env, email);
  return { bearer, cookie: `__Host-session=${bearer}` };
}

/** GET /oauth/authorize with a session → the approve page (asserted). */
export async function approvePage(
  h: Harness,
  cookie: string,
  options: AuthorizeOptions = {}
): Promise<{ fields: URLSearchParams; html: string; response: Response }> {
  const query = await authorizeQuery(options);
  const response = await h.call(`/oauth/authorize?${query}`, { cookie });
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain('action="/oauth/authorize/decision"');
  return { response, html, fields: hiddenFields(html) };
}

/** Submits the approve page; returns the redirect back to the client. */
export async function decide(
  h: Harness,
  cookie: string,
  fields: URLSearchParams,
  decision: "approve" | "deny" | "switch" = "approve"
): Promise<Response> {
  const body = new URLSearchParams(fields);
  body.set("decision", decision);
  return await h.form("/oauth/authorize/decision", body, { cookie });
}

/** Session path: approve page → Approve → the code from the redirect. */
export async function approveWithSession(
  h: Harness,
  cookie: string,
  options: AuthorizeOptions = {}
): Promise<URL> {
  const { fields } = await approvePage(h, cookie, options);
  const res = await decide(h, cookie, fields);
  expect(res.status).toBe(303);
  return new URL(res.headers.get("Location") ?? "");
}

/** The last emailed `/oauth/magic` link. */
export function lastMagicLink(h: Harness): URL {
  const mail = h.t.sent.at(-1);
  const match = LINK_RE.exec(mail?.text ?? "");
  if (!match) {
    throw new Error("no magic link was emailed");
  }
  return new URL(match[0]);
}

/** Email path: form → link → approve page; returns the page and the cookie. */
export async function magicApprovePage(
  h: Harness,
  email: string,
  options: AuthorizeOptions = {}
): Promise<{ fields: URLSearchParams; flowCookie: string; html: string }> {
  const query = await authorizeQuery(options);
  const form = await h.call(`/oauth/authorize?${query}`);
  expect(form.status).toBe(200);
  const fields = hiddenFields(await form.text());
  fields.set("email", email);
  const sent = await h.form("/oauth/authorize", fields);
  expect(sent.status).toBe(200);
  const flowCookie = (sent.headers.get("Set-Cookie") ?? "").split(";")[0];
  const link = lastMagicLink(h);
  const page = await h.call(`${link.pathname}${link.search}`, {
    cookie: flowCookie,
  });
  const html = await page.text();
  expect(page.status).toBe(200);
  return { html, flowCookie, fields: hiddenFields(html) };
}

export async function exchange(
  h: Harness,
  code: string,
  options: {
    clientId?: string;
    redirectUri?: string | null;
    verifier?: string;
  } = {}
): Promise<Response> {
  const fields: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    code_verifier: options.verifier ?? VERIFIER,
    client_id: options.clientId ?? "pilih-jobs-cli",
  };
  if (options.redirectUri !== null) {
    fields.redirect_uri = options.redirectUri ?? LOOPBACK;
  }
  return await h.form("/oauth/token", fields, { noOrigin: true });
}

export async function refresh(
  h: Harness,
  refreshToken: string,
  extra: Record<string, string> = {}
): Promise<Response> {
  return await h.form(
    "/oauth/token",
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "pilih-jobs-cli",
      ...extra,
    },
    { noOrigin: true }
  );
}

export async function revoke(
  h: Harness,
  fields: Record<string, string>
): Promise<Response> {
  return await h.form(
    "/oauth/revoke",
    { client_id: "pilih-jobs-cli", ...fields },
    { noOrigin: true }
  );
}

export interface LoggedIn {
  cookie: string;
  grantId: string;
  tokens: TokenSet;
  userId: string;
}

/** The whole first-party login over the session path. */
export async function cliLogin(
  h: Harness,
  email: string,
  options: AuthorizeOptions & { cookie?: string } = {}
): Promise<LoggedIn> {
  const cookie = options.cookie ?? (await signedInCookie(h, email)).cookie;
  const back = await approveWithSession(h, cookie, options);
  const res = await exchange(h, back.searchParams.get("code") ?? "");
  expect(res.status).toBe(200);
  const tokens = (await res.json()) as TokenSet;
  const row = h.t.sqlite
    .query(
      "SELECT grant_id, user_id FROM mcp_tokens WHERE kind = 'oauth' ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get() as { grant_id: string; user_id: string };
  return { cookie, tokens, grantId: row.grant_id, userId: row.user_id };
}

/** JSON call to /api/v1 with a bearer. */
export async function v1(
  h: Harness,
  method: string,
  path: string,
  bearer: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{
  body: Record<string, unknown>;
  response: Response;
  status: number;
}> {
  const init: CallInit = {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      "X-Pilih-Client": "cli/0.1.0",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await h.call(path, init);
  const text = await response.text();
  return {
    response,
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

export const DEVICE_BODY = {
  name: "alice-mbp (macOS)",
  platform: "macos",
  arch: "arm64",
  cli_version: "0.1.0",
  capabilities: ["discover", "apply", "render_cv"],
} as const;

/** POST /api/v1/devices with the login's access token. */
export async function registerCliDevice(
  h: Harness,
  accessToken: string,
  body: Record<string, unknown> = DEVICE_BODY
) {
  return await v1(h, "POST", "/api/v1/devices", accessToken, body);
}

export function row<T = Record<string, unknown>>(
  h: Harness,
  sql: string,
  ...binds: Array<string | number | null>
): NoInfer<T> {
  return h.t.sqlite.query(sql).get(...binds) as T;
}

export function rows<T = Record<string, unknown>>(
  h: Harness,
  sql: string,
  ...binds: Array<string | number | null>
): NoInfer<T>[] {
  return h.t.sqlite.query(sql).all(...binds) as T[];
}
