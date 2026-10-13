// grant_type=refresh_token for first-party grants (17 §7.2, RFC 9700
// §2.2.2, D-30).
//
//   1. The token's row must exist, belong to a grant of this client, and
//      neither the row nor the grant may be revoked or the row expired →
//      otherwise `invalid_grant` (nothing else happens).
//   2. Unused row → rotation, in ONE batch fenced by a guard (`used_at IS
//      NULL`): mark it used, insert the child (expiry = min(grant + 90 d,
//      now + 30 d)), insert a 1 h access token. The child is then kept for
//      60 s in KV `oauth:rft-grace:<parent_hash>`, AES-GCM encrypted with a
//      key derived from the PARENT token (only its holder can read it).
//   3. Used row whose child is still unused, within 60 s of the rotation →
//      the SAME child again plus a new access token (the CLI crashed before
//      it stored the child).
//   4. Anything else is reuse: the grant family is revoked (reason
//      `refresh_reuse`: the grant, every refresh row, every access token of
//      it), the device's live leases fail as for a revocation (21 §10), the
//      event is logged (ids only) and the answer is `invalid_grant`.
//
// `scope` may narrow the new access token to a subset of the grant; the
// refresh token keeps the grant. Rate limit `refresh-grant`: 10/min per grant.

import type { OAuthScope } from "@pilihpendidikan/jobs-contracts/enums";
import { hashToken, randomSecret, toBase64Url } from "../auth";
import type { Env } from "../env";
import { formString } from "../http";
import { scopeFromCaller } from "../jobs/core/scope";
import { GuardFailedError } from "../jobs/repo/core/db";
import { findUserById } from "../jobs/repo/core/users";
import { failDeviceLeasesAfterReuse } from "../jobs/repo/devices/effects";
import { loadUserDevice } from "../jobs/repo/devices/identity";
import type { RateLimitRule } from "../rate-limit";
import { checkRateLimits } from "../rate-limit";
import type { GrantRow, RefreshRow } from "./grants";
import {
  findGrant,
  findRefreshByHash,
  findRefreshChild,
  identityGuard,
  insertAccessToken,
  insertRefresh,
  refreshExpiry,
  revokeGrantStatements,
  runIdentityBatch,
  touchGrant,
} from "./grants";
import type { OAuthClientRow } from "./shared";
import {
  FIRST_PARTY_ACCESS_TTL_SECONDS,
  formatScopes,
  isFirstParty,
  oauthError,
  oauthJson,
  REFRESH_GRACE_MS,
  splitScopes,
} from "./shared";

/** `refresh-grant`: 10 refreshes per minute per grant (17 §7.2). */
export const REFRESH_GRANT_LIMIT: RateLimitRule = {
  purpose: "refresh-grant",
  max: 10,
  windowMs: 60_000,
};

const GRACE_TTL_SECONDS = 60;
const GRACE_KEY_LABEL = "pilih-rft-grace:v1:";
const GRACE_POLL_ATTEMPTS = 3;
const GRACE_POLL_DELAY_MS = 50;

function invalidGrant(description: string): Response {
  return oauthError("invalid_grant", description);
}

// ---------------------------------------------------------------------------
// The grace record (encrypted child token, 60 s)
// ---------------------------------------------------------------------------

interface GraceRecord {
  /** Base64url AES-GCM ciphertext of `{child_id, child_token}`. */
  ct: string;
  /** When the grace window closes (KV TTLs are coarse). */
  expires_at: number;
  iv: string;
}

interface GracePayload {
  child_id: string;
  child_token: string;
}

function graceKey(parentHash: string): string {
  return `oauth:rft-grace:${parentHash}`;
}

async function graceCipherKey(parentToken: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${GRACE_KEY_LABEL}${parentToken}`)
  );
  return await crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function storeGrace(
  env: Env,
  parent: { hash: string; token: string },
  payload: GracePayload,
  rotatedAt: number
): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await graceCipherKey(parent.token),
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const record: GraceRecord = {
    iv: toBase64Url(iv),
    ct: toBase64Url(new Uint8Array(ciphertext)),
    expires_at: rotatedAt + REFRESH_GRACE_MS,
  };
  await env.AUTH_KV.put(graceKey(parent.hash), JSON.stringify(record), {
    expirationTtl: GRACE_TTL_SECONDS,
  });
}

async function readGrace(
  env: Env,
  parent: { hash: string; token: string },
  now: number
): Promise<GracePayload | null> {
  const record = await env.AUTH_KV.get<GraceRecord>(
    graceKey(parent.hash),
    "json"
  );
  if (!record || record.expires_at < now) {
    return null;
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(record.iv) },
      await graceCipherKey(parent.token),
      fromBase64Url(record.ct)
    );
    return JSON.parse(new TextDecoder().decode(plain)) as GracePayload;
  } catch {
    return null;
  }
}

// A concurrent rotation commits its batch and then writes the grace record;
// a request racing it waits briefly for the record.
async function awaitGrace(
  env: Env,
  parent: { hash: string; token: string },
  now: number
): Promise<GracePayload | null> {
  for (let attempt = 0; attempt < GRACE_POLL_ATTEMPTS; attempt++) {
    const found = await readGrace(env, parent, now);
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, GRACE_POLL_DELAY_MS));
  }
  return await readGrace(env, parent, now);
}

// ---------------------------------------------------------------------------
// The grant
// ---------------------------------------------------------------------------

interface RefreshCall {
  client: OAuthClientRow;
  email: string;
  env: Env;
  grant: GrantRow;
  now: number;
  parent: { hash: string; token: string };
  row: RefreshRow;
  /** Scopes of the new access token (the grant's, or a narrowed subset). */
  scopes: string;
}

function tokenBody(
  accessToken: string,
  refreshToken: string,
  scope: string
): Response {
  return oauthJson(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: FIRST_PARTY_ACCESS_TTL_SECONDS,
      refresh_token: refreshToken,
      scope,
    },
    { headers: { Pragma: "no-cache" } }
  );
}

async function newAccessToken(call: RefreshCall, token: string) {
  return await insertAccessToken(call.env.DB, {
    token,
    email: call.email,
    userId: call.grant.user_id,
    grantId: call.grant.id,
    deviceId: call.grant.device_id,
    scopes: call.scopes,
    label: call.client.client_name ?? "pilih-jobs CLI",
    now: call.now,
    expiresAt: call.now + FIRST_PARTY_ACCESS_TTL_SECONDS * 1000,
  });
}

/** Step 2: rotate an unused refresh token. Null when it lost a race. */
async function rotate(call: RefreshCall): Promise<Response | null> {
  const { env, row, grant, now } = call;
  const childToken = randomSecret();
  const child = await insertRefresh(env.DB, {
    token: childToken,
    grantId: grant.id,
    parentId: row.id,
    now,
    expiresAt: refreshExpiry(grant.created_at, now),
  });
  const accessToken = randomSecret();
  const access = await newAccessToken(call, accessToken);
  try {
    await runIdentityBatch(env.DB, [
      identityGuard(
        env.DB,
        `refresh-unused:${row.id}`,
        "SELECT 1 FROM oauth_refresh_tokens r JOIN oauth_grants g ON g.id = r.grant_id WHERE r.id = ? AND r.used_at IS NULL AND r.revoked_at IS NULL AND g.revoked_at IS NULL",
        row.id
      ),
      env.DB.prepare(
        "UPDATE oauth_refresh_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL"
      ).bind(now, row.id),
      child.statement,
      access.statement,
      touchGrant(env.DB, grant.id, now),
    ]);
  } catch (err) {
    if (err instanceof GuardFailedError) {
      return null;
    }
    throw err;
  }
  await storeGrace(
    env,
    call.parent,
    { child_id: child.id, child_token: childToken },
    now
  );
  return tokenBody(accessToken, childToken, call.scopes);
}

/** Step 3: re-issue the unused child within 60 s. Null when not possible. */
async function reissueChild(
  call: RefreshCall,
  child: RefreshRow
): Promise<Response | "pending" | null> {
  const { env, grant, now } = call;
  const grace = await awaitGrace(env, call.parent, now);
  if (!grace) {
    return "pending";
  }
  if (
    grace.child_id !== child.id ||
    (await hashToken(grace.child_token)) !== child.token_hash
  ) {
    return null;
  }
  const accessToken = randomSecret();
  const access = await newAccessToken(call, accessToken);
  try {
    await runIdentityBatch(env.DB, [
      identityGuard(
        env.DB,
        `refresh-child-unused:${child.id}`,
        "SELECT 1 FROM oauth_refresh_tokens r JOIN oauth_grants g ON g.id = r.grant_id WHERE r.id = ? AND r.used_at IS NULL AND r.revoked_at IS NULL AND g.revoked_at IS NULL",
        child.id
      ),
      access.statement,
      touchGrant(env.DB, grant.id, now),
    ]);
  } catch (err) {
    if (err instanceof GuardFailedError) {
      return null;
    }
    throw err;
  }
  return tokenBody(accessToken, grace.child_token, call.scopes);
}

/** Step 4: reuse — revoke the family, fail the device's leases, audit. */
async function reuseDetected(call: RefreshCall): Promise<Response> {
  const { env, grant, row, now } = call;
  await runIdentityBatch(
    env.DB,
    revokeGrantStatements(env.DB, grant.id, "refresh_reuse", now)
  );
  // Audit (11 §8: ids only, never token material). The durable record is
  // `oauth_grants.revoked_reason = 'refresh_reuse'`.
  console.warn({
    evt: "oauth_refresh_reuse",
    grant_id: grant.id,
    refresh_id: row.id,
    user_id: grant.user_id,
    device_id: grant.device_id,
    client_id: grant.client_id,
  });
  if (grant.device_id) {
    const scope = scopeFromCaller({ userId: grant.user_id });
    const device = await loadUserDevice(env.DB, scope, grant.device_id);
    if (device && device.grant_id === grant.id) {
      try {
        await failDeviceLeasesAfterReuse(env, scope, {
          deviceId: device.id,
          deviceRevision: device.revision,
          now,
        });
      } catch (err) {
        // The credentials are revoked; lease expiry (≤ 2 min, cron reaper)
        // still applies the same effects if this half failed.
        console.error({
          evt: "oauth_refresh_reuse_leases_failed",
          grant_id: grant.id,
          device_id: device.id,
          error: err instanceof Error ? err.name : String(err),
        });
      }
    }
  }
  return invalidGrant(
    "Refresh token reuse detected; this sign-in was revoked. Sign in again."
  );
}

/** The access-token scopes: the grant's, or the requested subset of it. */
function narrowScopes(
  grantScopes: string,
  requested: string
): OAuthScope[] | null {
  const granted = splitScopes(grantScopes) as OAuthScope[];
  if (!requested.trim()) {
    return granted;
  }
  const asked = splitScopes(requested);
  if (!asked.every((scope) => granted.includes(scope as OAuthScope))) {
    return null;
  }
  return granted.filter((scope) => asked.includes(scope));
}

type Prepared = { call: RefreshCall } | { response: Response };

async function prepare(
  env: Env,
  client: OAuthClientRow,
  parent: { hash: string; token: string },
  requestedScope: string
): Promise<Prepared> {
  const row = await findRefreshByHash(env.DB, parent.hash);
  const grant = row ? await findGrant(env.DB, row.grant_id) : null;
  if (!(row && grant) || grant.client_id !== client.client_id) {
    return { response: invalidGrant("Refresh token is not valid.") };
  }
  const now = Date.now();
  if (row.revoked_at !== null || grant.revoked_at !== null) {
    return { response: invalidGrant("Refresh token was revoked.") };
  }
  if (row.expires_at <= now) {
    return { response: invalidGrant("Refresh token expired. Sign in again.") };
  }
  const scopes = narrowScopes(grant.scopes, requestedScope);
  if (!scopes || scopes.length === 0) {
    return {
      response: oauthError(
        "invalid_scope",
        "scope must be a subset of the granted scopes."
      ),
    };
  }
  const user = await findUserById(env.DB, grant.user_id);
  if (!user || user.deleted_at !== null) {
    return { response: invalidGrant("The account is not available.") };
  }
  return {
    call: {
      env,
      client,
      grant,
      row,
      now,
      parent,
      email: user.email,
      scopes: formatScopes(scopes),
    },
  };
}

async function refreshOnce(
  env: Env,
  client: OAuthClientRow,
  parent: { hash: string; token: string },
  requestedScope: string
): Promise<Response | null> {
  const prepared = await prepare(env, client, parent, requestedScope);
  if ("response" in prepared) {
    return prepared.response;
  }
  const { call } = prepared;
  if (call.row.used_at === null) {
    return await rotate(call);
  }
  const child = await findRefreshChild(env.DB, call.row);
  const inGrace =
    child !== null &&
    child.used_at === null &&
    child.revoked_at === null &&
    call.now - call.row.used_at <= REFRESH_GRACE_MS;
  if (child && inGrace) {
    const reissued = await reissueChild(call, child);
    if (reissued === "pending") {
      return oauthError(
        "temporarily_unavailable",
        "A refresh of this token is in progress. Retry in a second.",
        503,
        { "Retry-After": "1" }
      );
    }
    if (reissued) {
      return reissued;
    }
    // The child was used meanwhile (or the record does not match): reuse.
  }
  return await reuseDetected(call);
}

export async function handleRefreshGrant(
  env: Env,
  client: OAuthClientRow,
  form: FormData | null
): Promise<Response> {
  if (!isFirstParty(client)) {
    return invalidGrant("This client cannot use refresh tokens.");
  }
  const token = formString(form, "refresh_token");
  if (!token) {
    return oauthError("invalid_request", "refresh_token is required.");
  }
  const parent = { token, hash: await hashToken(token) };
  const row = await findRefreshByHash(env.DB, parent.hash);
  if (row) {
    const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
      [REFRESH_GRANT_LIMIT, `grant:${row.grant_id}`],
    ]);
    if (!limit.ok) {
      return oauthError("slow_down", "Too many refreshes.", 429, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }
  }
  const requestedScope = formString(form, "scope");
  // A lost race on the rotation guard re-reads the row once: the winner's
  // rotation then makes this call the grace case.
  const first = await refreshOnce(env, client, parent, requestedScope);
  if (first) {
    return first;
  }
  return (
    (await refreshOnce(env, client, parent, requestedScope)) ??
    invalidGrant("Refresh token is not valid.")
  );
}
