// The Worker's request router, independent of the MCP Durable Object so the
// whole HTTP surface can be exercised in `bun test` with fake bindings.
//
// Dispatch order:
//   0. plain http outside localhost          → 308 to https
//   1. OPTIONS                               → CORS preflight
//   2. /health                               → 200
//   3. /.well-known/oauth-*, /oauth/*        → OAuth (public CORS)
//   4. /mcp, /sse                            → MCP (auth → Durable Object)
//   5. /, /connect                           → sign-in + token page (HTML)
//   6. /auth/tokens*                         → personal tokens (credentialed CORS)
//   7. /auth/*                               → sign-in, exchange, logout, me
//   8. /api/v1/*                             → Job Tracker kernel (credentialed
//                                              CORS; src/jobs/core/router.ts)
//   9. /api/*, /{cv,invoice,portfolio}/*.pdf → documents (credentialed CORS)
//  10. anything else                         → 404
//
// The same object also serves `scheduled` (crons, dispatched by
// `controller.cron` in src/jobs/cron) and `queue` (the `jobs-ai` consumer in
// src/jobs/queue, and the `jobs-scrape` consumer of cloud discovery in
// src/jobs/cloud). `createApp(mcp, deps)` takes optional kernel dependencies
// (a fake clock, a scripted AI provider) so tests drive all three.

import { applyCors, handlePreflight } from "./cors";
import type { Env } from "./env";
import { jsonError } from "./http";
import { runScheduled } from "./jobs/cron/index";
import type { KernelDeps } from "./jobs/core/deps";
import { dispatchV1, V1_PREFIX } from "./jobs/core/router";
import { handleCloudBatch, isCloudQueue } from "./jobs/cloud/consumer";
import { handleJobsAiBatch } from "./jobs/queue/consumer";
import { v1RouteTable } from "./jobs/routes/index";
import { isLocalRequest } from "./origins";
import { routeAuth } from "./routes/auth";
import { routeConnect } from "./routes/connect";
import { routeDocuments } from "./routes/documents";
import type { McpHandler } from "./routes/mcp";
import { isSsePath, isStreamablePath, routeMcp } from "./routes/mcp";
import { routeOAuth } from "./routes/oauth";
import { routeTokens } from "./routes/tokens";

// Thrown by the Durable Object when a session id is replayed with another
// account's credential (see PilihMcpServer in index.ts).
export const SESSION_MISMATCH = "mcp_session_mismatch";

export interface McpHandlers {
  sse: McpHandler;
  streamable: McpHandler;
}

async function dispatchMcp(
  handler: McpHandler,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    return await routeMcp(handler, request, env, ctx);
  } catch (err) {
    if (err instanceof Error && err.message.includes(SESSION_MISMATCH)) {
      // 404 tells a Streamable HTTP client to start a new session.
      return jsonError(404, "Session not found.");
    }
    throw err;
  }
}

// Never serve credentials over plain http in production.
function httpsUpgrade(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || isLocalRequest(url)) {
    return null;
  }
  url.protocol = "https:";
  return Response.redirect(url.toString(), 308);
}

function isV1Path(pathname: string): boolean {
  return pathname === V1_PREFIX || pathname.startsWith(`${V1_PREFIX}/`);
}

async function route(
  mcp: McpHandlers,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: KernelDeps
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname === "/health") {
    return new Response("OK");
  }
  const oauth = routeOAuth(request, env, ctx, url);
  if (oauth) {
    return await oauth;
  }
  if (isStreamablePath(pathname)) {
    return await dispatchMcp(mcp.streamable, request, env, ctx);
  }
  if (isSsePath(pathname)) {
    return await dispatchMcp(mcp.sse, request, env, ctx);
  }
  const connect = routeConnect(request, env, ctx, url);
  if (connect) {
    return await connect;
  }
  if (isV1Path(pathname)) {
    return applyCors(
      await dispatchV1(v1RouteTable(), request, env, ctx, deps),
      request
    );
  }
  const credentialed =
    routeTokens(request, env, url) ??
    routeAuth(request, env, ctx, url) ??
    routeDocuments(request, env, ctx, url);
  if (credentialed) {
    return applyCors(await credentialed, request);
  }
  return applyCors(jsonError(404, "Not found."), request);
}

export function createApp(mcp: McpHandlers, deps: KernelDeps = {}) {
  return {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ): Promise<Response> {
      return (
        httpsUpgrade(request) ??
        handlePreflight(request) ??
        (await route(mcp, request, env, ctx, deps))
      );
    },
    scheduled(
      controller: ScheduledController,
      env: Env,
      ctx: ExecutionContext
    ) {
      ctx.waitUntil(
        runScheduled(controller, env, ctx, deps).catch((err: unknown) => {
          console.error("scheduled run failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        })
      );
    },
    async queue(
      batch: MessageBatch<unknown>,
      env: Env,
      ctx: ExecutionContext
    ): Promise<void> {
      if (isCloudQueue(batch.queue)) {
        await handleCloudBatch(batch, env, ctx, deps);
        return;
      }
      await handleJobsAiBatch(batch, env, ctx, deps);
    },
  } satisfies ExportedHandler<Env>;
}
