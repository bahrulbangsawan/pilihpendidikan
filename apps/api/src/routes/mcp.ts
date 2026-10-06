// MCP transports: Streamable HTTP at `/mcp` and legacy HTTP+SSE at `/sse`
// (plus the `/sse/message` POSTs the stream advertises). Any signed-in
// caller may connect; the tools then scope every document to its owner.
//
// The caller is resolved here, before the Durable Object is touched, and
// handed to it through `ctx.props`. No credential → 401 with an RFC 9728
// `WWW-Authenticate` challenge, which is what sends MCP clients into the
// OAuth flow.

import { resolveCaller, touchToken } from "../auth";
import { corsHeaders, resolveAllowedOrigin } from "../cors";
import type { Env } from "../env";
import { setMcpProps } from "../env";
import { logAuthFailure } from "../http";
import { publicOrigin } from "../origins";

export interface McpHandler {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> | Response;
}

export function isSsePath(pathname: string): boolean {
  return pathname === "/sse" || pathname.startsWith("/sse/");
}

export function isStreamablePath(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/mcp/");
}

// Some "add custom connector" dialogs only take a URL, so a personal token
// may arrive as `?token=`. A real Authorization header always wins.
function promoteQueryToken(request: Request): Request {
  if (request.headers.get("Authorization")) {
    return request;
  }
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request, { headers });
}

export async function routeMcp(
  handler: McpHandler,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const authed = promoteQueryToken(request);
  const result = await resolveCaller(authed, env);
  if (!result.caller) {
    await logAuthFailure(authed, result.reason);
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        ...corsHeaders(resolveAllowedOrigin(request)),
        "WWW-Authenticate": `Bearer resource_metadata="${publicOrigin(request)}/.well-known/oauth-protected-resource"`,
      },
    });
  }
  if (result.tokenId) {
    ctx.waitUntil(touchToken(env.DB, result.tokenId).catch(() => undefined));
  }
  setMcpProps(ctx, {
    email: result.caller.email,
    isAdmin: result.caller.isAdmin,
    scope: result.caller.scope,
  });
  return await handler.fetch(authed, env, ctx);
}
