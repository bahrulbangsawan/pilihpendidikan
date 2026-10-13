// CORS for the api Worker.
//
// - Credentialed surface (everything the apps call, incl. /api/v1): the request Origin
//   is echoed only when it is on the allowlist, together with
//   `Access-Control-Allow-Credentials: true`. The localhost app ports are
//   allowed only while this Worker itself runs locally (`wrangler dev`), so a
//   page on someone's laptop can never make credentialed calls to production.
// - Public surface (OAuth discovery, registration and token endpoints): `*`
//   without credentials, as MCP clients expect.

import { APP_ORIGINS, DEV_APP_ORIGINS, isLocalRequest } from "./origins";

const PROD_ORIGINS = new Set<string>(Object.values(APP_ORIGINS));
const DEV_ORIGINS = new Set<string>(Object.values(DEV_APP_ORIGINS));

// `Mcp-Session-Id` / `MCP-Protocol-Version` are the Streamable HTTP
// transport's session headers; browser MCP clients send them after the
// handshake, so preflight must allow them. The rest are the /api/v1
// conventions (05 §1.4–§1.7, PLAN C8): idempotency, conditional requests,
// the CLI client header and the render ticket.
const ALLOWED_HEADERS =
  "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Idempotency-Key, If-Match, If-None-Match, X-Pilih-Client, X-Render-Ticket";
const EXPOSED_HEADERS =
  "Mcp-Session-Id, ETag, Idempotent-Replayed, Retry-After, X-Request-Id";
const MAX_AGE = "600";
const DEFAULT_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

export function resolveAllowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }
  if (PROD_ORIGINS.has(origin)) {
    return origin;
  }
  if (DEV_ORIGINS.has(origin) && isLocalRequest(new URL(request.url))) {
    return origin;
  }
  return null;
}

export function corsHeaders(
  origin: string | null,
  methods = DEFAULT_METHODS
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Expose-Headers": EXPOSED_HEADERS,
    "Access-Control-Max-Age": MAX_AGE,
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export function corsHeadersPublic(
  methods = "GET, POST, OPTIONS"
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": MAX_AGE,
  };
}

function isPublicCorsPath(pathname: string): boolean {
  return pathname.startsWith("/oauth/") || pathname.startsWith("/.well-known/");
}

// Answers every OPTIONS request. Returns null for any other method.
export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") {
    return null;
  }
  const { pathname } = new URL(request.url);
  const headers = isPublicCorsPath(pathname)
    ? corsHeadersPublic()
    : corsHeaders(resolveAllowedOrigin(request));
  return new Response(null, { status: 204, headers });
}

// Adds the credentialed CORS headers matching the request's Origin to a
// response built without origin context.
export function applyCors(response: Response, request: Request): Response {
  const origin = resolveAllowedOrigin(request);
  const headers = new Headers(response.headers);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Expose-Headers", EXPOSED_HEADERS);
  }
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
