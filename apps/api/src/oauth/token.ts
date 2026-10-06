// /oauth/token — exchanges an authorization code for an access token.
// Checks, in order: grant type, client authentication (secret for
// confidential clients), the code (single use), that it was issued to this
// client and redirect_uri, and the PKCE S256 verifier. The access token is a
// `session` row in mcp_tokens that expires after OAUTH_TOKEN_TTL_SECONDS.

import { createToken, hashToken, randomSecret, timingSafeEqual } from "../auth";
import type { Env } from "../env";
import { formString, readForm } from "../http";
import { checkRateLimits, clientIpFor, EXCHANGE_IP } from "../rate-limit";
import type { OAuthClientRow, StoredCode } from "./shared";
import {
  findClient,
  OAUTH_TOKEN_TTL_SECONDS,
  oauthError,
  oauthJson,
  readBasicAuth,
  SUPPORTED_SCOPES,
} from "./shared";

const BASE64_PLUS_RE = /\+/g;
const BASE64_SLASH_RE = /\//g;
const BASE64_PAD_RE = /=+$/;
// RFC 7636 §4.1: 43–128 unreserved characters.
const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  let binary = "";
  for (const b of new Uint8Array(digest)) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(BASE64_PLUS_RE, "-")
    .replace(BASE64_SLASH_RE, "_")
    .replace(BASE64_PAD_RE, "");
}

async function authenticateClient(
  env: Env,
  request: Request,
  form: FormData | null
): Promise<OAuthClientRow | null> {
  const basic = readBasicAuth(request.headers.get("Authorization"));
  const clientId = basic?.id || formString(form, "client_id");
  const secret = basic?.secret || formString(form, "client_secret");
  if (!clientId) {
    return null;
  }
  const client = await findClient(env.DB, clientId);
  if (!client) {
    return null;
  }
  if (client.token_endpoint_auth_method === "none") {
    return client;
  }
  if (!(secret && client.client_secret_hash)) {
    return null;
  }
  return timingSafeEqual(await hashToken(secret), client.client_secret_hash)
    ? client
    : null;
}

async function consumeCode(env: Env, code: string): Promise<StoredCode | null> {
  const key = `oauth:code:${await hashToken(code)}`;
  const stored = await env.AUTH_KV.get<StoredCode>(key, "json");
  if (!stored) {
    return null;
  }
  await env.AUTH_KV.delete(key);
  return stored;
}

export async function handleToken(
  request: Request,
  env: Env
): Promise<Response> {
  const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
    [EXCHANGE_IP, clientIpFor(request)],
  ]);
  if (!limit.ok) {
    return oauthError("slow_down", "Too many token requests.", 429);
  }
  const form = await readForm(request);
  if (formString(form, "grant_type") !== "authorization_code") {
    return oauthError(
      "unsupported_grant_type",
      "Only authorization_code is supported."
    );
  }
  const client = await authenticateClient(env, request, form);
  if (!client) {
    return oauthError("invalid_client", "Client authentication failed.", 401);
  }
  const code = formString(form, "code");
  const verifier = formString(form, "code_verifier");
  if (!(code && PKCE_VERIFIER_RE.test(verifier))) {
    return oauthError(
      "invalid_request",
      "code and a valid code_verifier are required."
    );
  }
  const stored = await consumeCode(env, code);
  if (!stored || stored.clientId !== client.client_id) {
    return oauthError("invalid_grant", "Authorization code is not valid.");
  }
  const redirectUri = formString(form, "redirect_uri");
  if (redirectUri && redirectUri !== stored.redirectUri) {
    return oauthError("invalid_grant", "redirect_uri does not match.");
  }
  if (!timingSafeEqual(await s256(verifier), stored.codeChallenge)) {
    return oauthError("invalid_grant", "PKCE verification failed.");
  }
  const accessToken = randomSecret();
  await createToken(env.DB, {
    email: stored.email,
    token: accessToken,
    label: `OAuth: ${client.client_name ?? "MCP client"}`,
    kind: "session",
    scope: "write",
    expiresAt: Date.now() + OAUTH_TOKEN_TTL_SECONDS * 1000,
  });
  return oauthJson(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: OAUTH_TOKEN_TTL_SECONDS,
      scope: SUPPORTED_SCOPES.join(" "),
    },
    { headers: { Pragma: "no-cache" } }
  );
}
