// Dispatcher for the OAuth surface; the handlers live in ../oauth/ (see
// ../oauth/shared.ts for the map of endpoints, 17 for the first-party flow).

import type { Env } from "../env";
import { handleAuthorizeGet, handleAuthorizePost } from "../oauth/authorize";
import { DECISION_PATH, handleAuthorizeDecision } from "../oauth/consent";
import {
  handleAuthorizationServerMetadata,
  handleProtectedResourceMetadata,
} from "../oauth/discovery";
import { handleMagicGet, handleMagicPost } from "../oauth/magic";
import { handleRegister } from "../oauth/register";
import { handleRevoke } from "../oauth/revoke";
import { oauthError } from "../oauth/shared";
import { handleToken } from "../oauth/token";

const WELL_KNOWN_AS = "/.well-known/oauth-authorization-server";
const WELL_KNOWN_PR = "/.well-known/oauth-protected-resource";

function isOAuthPath(pathname: string): boolean {
  return (
    pathname.startsWith("/oauth/") ||
    pathname === WELL_KNOWN_AS ||
    pathname.startsWith(`${WELL_KNOWN_AS}/`) ||
    pathname === WELL_KNOWN_PR ||
    pathname.startsWith(`${WELL_KNOWN_PR}/`)
  );
}

function routeMethod(
  method: string,
  handlers: Partial<Record<"GET" | "POST", () => Promise<Response> | Response>>
): Promise<Response> | Response {
  const handler = handlers[method as "GET" | "POST"];
  if (handler) {
    return handler();
  }
  return oauthError("invalid_request", "Method not allowed.", 405);
}

export function routeOAuth(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> | Response | null {
  const { pathname } = url;
  if (!isOAuthPath(pathname)) {
    return null;
  }
  const { method } = request;
  // Path-suffixed discovery (`/.well-known/…/sse`, `/…/mcp`) answers the same
  // document: some clients append the MCP path per RFC 8414 §3.1.
  if (pathname.startsWith(WELL_KNOWN_AS)) {
    return routeMethod(method, {
      GET: () => handleAuthorizationServerMetadata(request),
    });
  }
  if (pathname.startsWith(WELL_KNOWN_PR)) {
    return routeMethod(method, {
      GET: () => handleProtectedResourceMetadata(request),
    });
  }
  switch (pathname) {
    case "/oauth/register":
      return routeMethod(method, { POST: () => handleRegister(request, env) });
    case "/oauth/authorize":
      return routeMethod(method, {
        GET: () => handleAuthorizeGet(request, env, url),
        POST: () => handleAuthorizePost(request, env, ctx),
      });
    case DECISION_PATH:
      return routeMethod(method, {
        POST: () => handleAuthorizeDecision(request, env),
      });
    case "/oauth/magic":
      return routeMethod(method, {
        GET: () => handleMagicGet(request, env, url),
        POST: () => handleMagicPost(request, env),
      });
    case "/oauth/token":
      return routeMethod(method, { POST: () => handleToken(request, env) });
    case "/oauth/revoke":
      return routeMethod(method, { POST: () => handleRevoke(request, env) });
    default:
      return oauthError("invalid_request", "Unknown OAuth endpoint.", 404);
  }
}
