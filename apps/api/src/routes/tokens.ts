// `/auth/tokens` — personal-token CRUD for the signed-in caller.
//
//   GET    /auth/tokens             → {tokens: PublicToken[]}
//   POST   /auth/tokens             {label?, scope?} → 201 {...token, token}
//   POST   /auth/tokens/:id/revoke  → {ok: true}
//   DELETE /auth/tokens/:id         → {ok: true} (revoked tokens only)

import type { Caller } from "../auth";
import { resolveCaller } from "../auth";
import type { Env } from "../env";
import {
  jsonError,
  logAuthFailure,
  methodNotAllowed,
  safeDecode,
  tooManyRequests,
  unauthorized,
} from "../http";
import { readJsonBody } from "../json-body";
import type { TokenChangeResult } from "../personal-tokens";
import {
  cleanLabel,
  deleteOwnedToken,
  listPersonalTokens,
  mintPersonalToken,
  parseScope,
  revokeOwnedToken,
  toPublicToken,
} from "../personal-tokens";

const TOKEN_REVOKE_RE = /^\/auth\/tokens\/([^/]+)\/revoke$/;
const TOKEN_ID_RE = /^\/auth\/tokens\/([^/]+)$/;

async function withCaller(
  request: Request,
  env: Env,
  next: (caller: Caller) => Promise<Response>
): Promise<Response> {
  const result = await resolveCaller(request, env);
  if (!result.caller) {
    await logAuthFailure(request, result.reason);
    return unauthorized(result.reason);
  }
  return await next(result.caller);
}

function changeResponse(result: TokenChangeResult): Response {
  return result.ok
    ? Response.json({ ok: true })
    : jsonError(result.status, result.error);
}

async function handleList(env: Env, caller: Caller): Promise<Response> {
  const rows = await listPersonalTokens(env, caller);
  return Response.json(
    { tokens: rows.map(toPublicToken) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function handleCreate(
  request: Request,
  env: Env,
  caller: Caller
): Promise<Response> {
  let body: { label?: unknown; scope?: unknown } | null;
  try {
    body = (await readJsonBody(request, { maxBytes: 4096 })) as typeof body;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const scope = parseScope(body?.scope);
  if (!scope) {
    return jsonError(400, 'scope must be "write" or "read".');
  }
  const result = await mintPersonalToken(
    env,
    caller,
    cleanLabel(body?.label),
    scope
  );
  if (!result.ok) {
    return result.status === 429
      ? tooManyRequests(result.retryAfter ?? 60, result.error)
      : jsonError(result.status, result.error);
  }
  return Response.json(
    { ...toPublicToken(result.row), token: result.token },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}

export function routeTokens(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> | Response | null {
  const { pathname } = url;
  const { method } = request;
  if (pathname === "/auth/tokens") {
    if (method === "GET") {
      return withCaller(request, env, (caller) => handleList(env, caller));
    }
    if (method === "POST") {
      return withCaller(request, env, (caller) =>
        handleCreate(request, env, caller)
      );
    }
    return methodNotAllowed("GET, POST, OPTIONS");
  }
  const revoke = pathname.match(TOKEN_REVOKE_RE);
  if (revoke) {
    if (method !== "POST") {
      return methodNotAllowed("POST, OPTIONS");
    }
    const id = safeDecode(revoke[1]);
    if (!id) {
      return jsonError(400, "Invalid token id.");
    }
    return withCaller(request, env, async (caller) =>
      changeResponse(await revokeOwnedToken(env, caller, id))
    );
  }
  const byId = pathname.match(TOKEN_ID_RE);
  if (byId) {
    if (method !== "DELETE") {
      return methodNotAllowed("DELETE, OPTIONS");
    }
    const id = safeDecode(byId[1]);
    if (!id) {
      return jsonError(400, "Invalid token id.");
    }
    return withCaller(request, env, async (caller) =>
      changeResponse(await deleteOwnedToken(env, caller, id))
    );
  }
  return null;
}
