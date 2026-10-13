// /oauth/token (RFC 6749 §4.1.3, §6; 17 §7.2).
//
//   grant_type=authorization_code
//     MCP (DCR) clients  unchanged: client authentication (secret for
//                        confidential clients), the single-use code issued to
//                        this client, `redirect_uri` if sent, PKCE S256; a
//                        90-day `kind='session'` write token, `scope: "mcp"`.
//     first-party        the code carries the grant (17 §4.3). `redirect_uri`
//                        is required and must equal the one stored with the
//                        code (after `redirectMatches`); PKCE S256; a 1 h
//                        `kind='oauth'` access token with the grant's scopes
//                        and, only with `offline_access`, a refresh token.
//                        A `device_hint` stored with the code re-binds the
//                        user's existing device to this grant and revokes its
//                        previous grant family (17 §6 step 6) — same batch.
//   grant_type=refresh_token   first-party grants only (refresh.ts).
//
// Rate limits: `exchange` 30/min/IP for every call, plus `refresh-grant`
// 10/min per grant on refreshes.

import { hashToken, randomSecret, timingSafeEqual } from "../auth";
import { createToken } from "../auth";
import type { Env } from "../env";
import { formString, readForm } from "../http";
import { scopeFromCaller } from "../jobs/core/scope";
import { GuardFailedError } from "../jobs/repo/core/db";
import { findUserById } from "../jobs/repo/core/users";
import { recordDeviceChange } from "../jobs/repo/devices/effects";
import {
  findLiveUserDevice,
  loadUserDevice,
  rebindDeviceStatements,
} from "../jobs/repo/devices/identity";
import { checkRateLimits, clientIpFor, EXCHANGE_IP } from "../rate-limit";
import type { GrantRow } from "./grants";
import {
  findGrant,
  insertAccessToken,
  insertRefresh,
  refreshExpiry,
  runIdentityBatch,
  touchGrant,
} from "./grants";
import { handleRefreshGrant } from "./refresh";
import type { OAuthClientRow, StoredCode } from "./shared";
import {
  findClient,
  FIRST_PARTY_ACCESS_TTL_SECONDS,
  isFirstParty,
  OAUTH_TOKEN_TTL_SECONDS,
  oauthError,
  oauthJson,
  readBasicAuth,
  redirectMatches,
  splitScopes,
  SUPPORTED_SCOPES,
} from "./shared";

const BASE64_PLUS_RE = /\+/g;
const BASE64_SLASH_RE = /\//g;
const BASE64_PAD_RE = /=+$/;
// RFC 7636 §4.1: 43–128 unreserved characters.
const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export async function s256(verifier: string): Promise<string> {
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

/**
 * The calling client: `client_id` (Basic or form) plus the secret for
 * confidential clients. Public clients (`none`) are identified by id only.
 */
export async function authenticateClient(
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

export function invalidGrant(description: string): Response {
  return oauthError("invalid_grant", description);
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Space-delimited scopes of the access token. */
  scope: string;
}

/** The token response of first-party grants (17 §7.2). */
export function tokenResponse(tokens: IssuedTokens): Response {
  return oauthJson(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: FIRST_PARTY_ACCESS_TTL_SECONDS,
      ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
      scope: tokens.scope,
    },
    { headers: { Pragma: "no-cache" } }
  );
}

// MCP (DCR) clients: unchanged since before the Job Tracker (TOAUTH-MCP-COMPAT).
async function issueLegacyToken(
  env: Env,
  client: OAuthClientRow,
  stored: StoredCode,
  form: FormData | null
): Promise<Response> {
  const redirectUri = formString(form, "redirect_uri");
  if (redirectUri && redirectUri !== stored.redirectUri) {
    return invalidGrant("redirect_uri does not match.");
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

interface Rebind {
  deviceId: string;
  statements: D1PreparedStatement[];
}

async function planRebind(
  env: Env,
  grant: GrantRow,
  hint: string | null | undefined,
  now: number
): Promise<Rebind | null> {
  if (!hint) {
    return null;
  }
  const scope = scopeFromCaller({ userId: grant.user_id });
  const device = await findLiveUserDevice(env.DB, scope, hint);
  if (!device) {
    return null;
  }
  return {
    deviceId: device.id,
    statements: rebindDeviceStatements(env.DB, scope, {
      deviceId: device.id,
      oldGrantId: device.grant_id,
      newGrantId: grant.id,
      now,
    }),
  };
}

async function issueForGrant(
  env: Env,
  client: OAuthClientRow,
  grant: GrantRow,
  email: string,
  rebind: Rebind | null
): Promise<IssuedTokens> {
  const now = Date.now();
  const accessToken = randomSecret();
  const access = await insertAccessToken(env.DB, {
    token: accessToken,
    email,
    userId: grant.user_id,
    grantId: grant.id,
    deviceId: rebind?.deviceId ?? grant.device_id,
    scopes: grant.scopes,
    label: client.client_name ?? "pilih-jobs CLI",
    expiresAt: now + FIRST_PARTY_ACCESS_TTL_SECONDS * 1000,
    now,
  });
  const offline = splitScopes(grant.scopes).includes("offline_access");
  const refreshToken = offline ? randomSecret() : null;
  const statements = [...(rebind?.statements ?? []), access.statement];
  if (refreshToken) {
    const refresh = await insertRefresh(env.DB, {
      token: refreshToken,
      grantId: grant.id,
      parentId: null,
      now,
      expiresAt: refreshExpiry(grant.created_at, now),
    });
    statements.push(refresh.statement);
  }
  statements.push(touchGrant(env.DB, grant.id, now));
  await runIdentityBatch(env.DB, statements);
  return { accessToken, refreshToken, scope: grant.scopes };
}

async function noteRebind(env: Env, grant: GrantRow, deviceId: string) {
  const scope = scopeFromCaller({ userId: grant.user_id });
  const device = await loadUserDevice(env.DB, scope, deviceId);
  if (!device) {
    return;
  }
  try {
    await recordDeviceChange(env, scope, {
      deviceId,
      revision: device.revision,
      now: Date.now(),
    });
  } catch (err) {
    console.warn({
      evt: "device_change_failed",
      device_id: deviceId,
      error: err instanceof Error ? err.name : String(err),
    });
  }
}

// First-party clients (17 §7.2): the code is bound to a grant.
async function issueFirstPartyTokens(
  env: Env,
  client: OAuthClientRow,
  stored: StoredCode,
  form: FormData | null
): Promise<Response> {
  const redirectUri = formString(form, "redirect_uri");
  if (
    !(redirectUri && redirectMatches(client, redirectUri)) ||
    redirectUri !== stored.redirectUri
  ) {
    return invalidGrant("redirect_uri does not match.");
  }
  const grant = stored.grantId ? await findGrant(env.DB, stored.grantId) : null;
  if (
    !grant ||
    grant.revoked_at !== null ||
    grant.client_id !== client.client_id ||
    grant.user_id !== stored.userId
  ) {
    return invalidGrant("The authorization is no longer valid.");
  }
  const user = await findUserById(env.DB, grant.user_id);
  if (!user || user.deleted_at !== null) {
    return invalidGrant("The account is not available.");
  }
  const now = Date.now();
  const rebind = await planRebind(env, grant, stored.deviceHint, now);
  let tokens: IssuedTokens;
  try {
    tokens = await issueForGrant(env, client, grant, user.email, rebind);
  } catch (err) {
    if (!(err instanceof GuardFailedError) || rebind === null) {
      throw err;
    }
    // The hinted device was revoked or re-bound meanwhile: sign in without
    // it (the CLI registers a new device).
    tokens = await issueForGrant(env, client, grant, user.email, null);
    return tokenResponse(tokens);
  }
  if (rebind) {
    await noteRebind(env, grant, rebind.deviceId);
  }
  return tokenResponse(tokens);
}

async function handleAuthorizationCode(
  request: Request,
  env: Env,
  form: FormData | null
): Promise<Response> {
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
    return invalidGrant("Authorization code is not valid.");
  }
  if (!timingSafeEqual(await s256(verifier), stored.codeChallenge)) {
    return invalidGrant("PKCE verification failed.");
  }
  const bound = stored.grantId !== undefined;
  if (bound !== isFirstParty(client)) {
    return invalidGrant("Authorization code is not valid.");
  }
  return bound
    ? await issueFirstPartyTokens(env, client, stored, form)
    : await issueLegacyToken(env, client, stored, form);
}

export async function handleToken(
  request: Request,
  env: Env
): Promise<Response> {
  const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
    [EXCHANGE_IP, clientIpFor(request)],
  ]);
  if (!limit.ok) {
    return oauthError("slow_down", "Too many token requests.", 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }
  const form = await readForm(request);
  const grantType = formString(form, "grant_type");
  if (grantType === "authorization_code") {
    return await handleAuthorizationCode(request, env, form);
  }
  if (grantType === "refresh_token") {
    const client = await authenticateClient(env, request, form);
    if (!client) {
      return oauthError("invalid_client", "Client authentication failed.", 401);
    }
    return await handleRefreshGrant(env, client, form);
  }
  return oauthError(
    "unsupported_grant_type",
    "Supported grant types: authorization_code, refresh_token."
  );
}
