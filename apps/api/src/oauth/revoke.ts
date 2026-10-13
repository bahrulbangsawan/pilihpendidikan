// POST /oauth/revoke — RFC 7009 token revocation (17 §8).
//
// Form: `token`, optional `token_type_hint` (`refresh_token` |
// `access_token`), `client_id` (public clients; confidential ones
// authenticate as at the token endpoint), and the non-standard
// `forget_device=true` (`pilih-jobs logout --forget-device`, 17 §8 step 3).
//
//   refresh token  → the whole grant: the grant, every refresh row of it and
//                    every access token minted under it; with
//                    `forget_device` the device bound to the grant is
//                    revoked too (21 §10 lease effects included)
//   access token   → that one `mcp_tokens` row (its refresh family stays)
//
// The answer is `200` for unknown, expired or already revoked tokens
// (RFC 7009 §2.2), and also when the token belongs to another client: that
// mismatch is ignored and nothing is revoked. Tokens that were not issued
// through a grant (personal tokens, browser sessions, legacy MCP tokens)
// cannot be revoked here. Rate limit: `exchange` (30/min/IP).

import { hashToken } from "../auth";
import type { Env } from "../env";
import { formString, readForm } from "../http";
import { scopeFromCaller } from "../jobs/core/scope";
import { GuardFailedError } from "../jobs/repo/core/db";
import { applyDeviceRevocationEffects } from "../jobs/repo/devices/effects";
import {
  liveGrantIdsOfDevice,
  loadUserDevice,
  revokeDeviceStatements,
} from "../jobs/repo/devices/identity";
import { checkRateLimits, clientIpFor, EXCHANGE_IP } from "../rate-limit";
import type { GrantRow } from "./grants";
import {
  findGrant,
  findRefreshByHash,
  revokeGrantStatements,
  runIdentityBatch,
} from "./grants";
import type { OAuthClientRow } from "./shared";
import { oauthError, oauthJson } from "./shared";
import { authenticateClient } from "./token";

const TRUE_VALUES = new Set(["true", "1", "yes"]);

async function forgetDevice(env: Env, grant: GrantRow, now: number) {
  if (!grant.device_id) {
    return;
  }
  const scope = scopeFromCaller({ userId: grant.user_id });
  const device = await loadUserDevice(env.DB, scope, grant.device_id);
  if (!device || device.revoked_at !== null) {
    return;
  }
  const grantIds = await liveGrantIdsOfDevice(env.DB, scope, device);
  try {
    await runIdentityBatch(
      env.DB,
      revokeDeviceStatements(env.DB, scope, {
        deviceId: device.id,
        grantIds,
        now,
      })
    );
  } catch (err) {
    if (err instanceof GuardFailedError) {
      return; // revoked concurrently
    }
    throw err;
  }
  await applyDeviceRevocationEffects(env, scope, {
    deviceId: device.id,
    deviceRevision: device.revision + 1,
    now,
  });
}

/** True when the token was a refresh token (handled or ignored). */
async function revokeRefresh(
  env: Env,
  client: OAuthClientRow,
  tokenHash: string,
  forget: boolean
): Promise<boolean> {
  const row = await findRefreshByHash(env.DB, tokenHash);
  if (!row) {
    return false;
  }
  const grant = await findGrant(env.DB, row.grant_id);
  if (!grant || grant.client_id !== client.client_id) {
    return true;
  }
  const now = Date.now();
  if (grant.revoked_at === null) {
    await runIdentityBatch(
      env.DB,
      revokeGrantStatements(env.DB, grant.id, "user", now)
    );
  }
  if (forget) {
    await forgetDevice(env, grant, now);
  }
  return true;
}

interface AccessRow {
  grant_id: string | null;
  id: string;
  status: string;
}

/** True when the token was an access token (handled or ignored). */
async function revokeAccess(
  env: Env,
  client: OAuthClientRow,
  tokenHash: string,
  forget: boolean
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id, grant_id, status FROM mcp_tokens WHERE token_hash = ? LIMIT 1"
  )
    .bind(tokenHash)
    .first<AccessRow>();
  if (!row) {
    return false;
  }
  const grant = row.grant_id ? await findGrant(env.DB, row.grant_id) : null;
  if (!grant || grant.client_id !== client.client_id) {
    return true;
  }
  const now = Date.now();
  if (row.status === "active") {
    await env.DB.prepare(
      "UPDATE mcp_tokens SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'"
    )
      .bind(now, row.id)
      .run();
  }
  if (forget) {
    await forgetDevice(env, grant, now);
  }
  return true;
}

export async function handleRevoke(
  request: Request,
  env: Env
): Promise<Response> {
  const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
    [EXCHANGE_IP, clientIpFor(request)],
  ]);
  if (!limit.ok) {
    return oauthError("slow_down", "Too many requests.", 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }
  const form = await readForm(request);
  const token = formString(form, "token");
  if (!token) {
    return oauthError("invalid_request", "token is required.");
  }
  const client = await authenticateClient(env, request, form);
  if (!client) {
    return oauthError("invalid_client", "Client authentication failed.", 401);
  }
  const tokenHash = await hashToken(token);
  const forget = TRUE_VALUES.has(
    formString(form, "forget_device").toLowerCase()
  );
  const accessFirst = formString(form, "token_type_hint") === "access_token";
  const order = accessFirst
    ? [revokeAccess, revokeRefresh]
    : [revokeRefresh, revokeAccess];
  for (const revoke of order) {
    if (await revoke(env, client, tokenHash, forget)) {
      break;
    }
  }
  return oauthJson({});
}
