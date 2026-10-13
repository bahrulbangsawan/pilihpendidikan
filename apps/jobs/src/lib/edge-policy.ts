// Response headers and the CSRF gate for every dynamic response of the jobs
// Worker (job-tracker-spec 12 §1, 11 §4.1). `src/server.ts` runs this around
// the TanStack Start handler; static assets get the same fixed headers from
// `public/_headers` (STATIC_SECURITY_HEADERS, checked by the test).

/** TanStack Start's server-function endpoint prefix (default config). */
export const SERVER_FN_BASE = "/_serverFn";

/**
 * Carries the per-response CSP nonce from the edge to the router, which
 * stamps it on every script it renders (`ssr.nonce`). Any copy the client
 * sends is dropped first.
 */
export const NONCE_HEADER = "x-jobs-csp-nonce";

const NONCE_BYTES = 16;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Headers on every response, dynamic or static. */
export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

/** CSP of everything that is not an HTML page (JSON, redirects, files). */
export const NON_HTML_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'";

/**
 * The chrome-free render page (08 §6.4): its URL carries a render ticket,
 * so it never sends a Referer, is never cached and is never indexed.
 */
export const RENDER_PATH_PREFIX = "/render/";

/**
 * A response that may be framed by the app itself (the sandboxed PDF preview
 * of the CV tab, `/download/files/{id}/content?inline=1`). The download
 * route sets this internal marker; the edge turns it into `SAMEORIGIN`
 * framing and strips it.
 */
export const FRAMEABLE_HEADER = "x-jobs-frameable";

/** CSP of a same-origin-frameable file (the inline PDF preview). */
export const FRAMEABLE_FILE_CSP =
  "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

/** A fresh base64 nonce (128 bits). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * The page CSP. Production allows scripts only with this response's nonce
 * (`strict-dynamic` lets the router's module scripts load their chunks);
 * styles allow inline `style` attributes (CSS variables on components).
 * Vite's dev server injects un-nonced scripts and an HMR socket, so dev
 * relaxes `script-src` and `connect-src` and nothing else.
 */
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  // 'wasm-unsafe-eval' lets the PDF engine compile its layout WebAssembly
  // (yoga, 08 §6.2); it allows no JavaScript eval. Client-side navigation
  // keeps the first document's CSP, so every page carries it.
  const script = dev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`;
  const connect = dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'";
  const directives = [
    "default-src 'self'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connect,
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!dev) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

/**
 * The render page's CSP (08 §6.4): only this response's scripts, the PDF
 * engine's WebAssembly, same-origin server-function calls and blob/data
 * images; no frames, no forms, no plugins.
 */
export function renderPageCsp(nonce: string, dev: boolean): string {
  const script = dev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`;
  return [
    "default-src 'none'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    dev
      ? "connect-src 'self' ws: wss: data: blob:"
      : "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function isRenderPath(pathname: string): boolean {
  return pathname.startsWith(RENDER_PATH_PREFIX);
}

/** Origins allowed to POST to server functions for a request to `url`. */
export function allowedOrigins(
  url: URL,
  appOrigin: string | undefined
): string[] {
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (local) {
    return [url.origin];
  }
  return [appOrigin ?? url.origin];
}

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: "forbidden", message }), {
    status: 403,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The CSRF gate of 11 §4.1 (same rule as the api's `isSameOriginPost`): a
 * state-changing request to a server function must carry an `Origin` equal to
 * the jobs origin, or, when a browser sends no usable Origin, `Sec-Fetch-Site:
 * same-origin`. A cross-site fetch of a GET server function is refused too.
 * Returns the 403 to send, or null to let the request through.
 */
export function checkServerFnRequest(
  request: Request,
  origins: readonly string[]
): Response | null {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(SERVER_FN_BASE)) {
    return null;
  }
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return forbidden("Cross-origin request refused.");
  }
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return null;
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== "null") {
    return origins.includes(origin)
      ? null
      : forbidden("Cross-origin request refused.");
  }
  return fetchSite === "same-origin"
    ? null
    : forbidden("Request origin could not be verified.");
}

function htmlCsp(nonce: string, dev: boolean, pathname: string): string {
  return isRenderPath(pathname)
    ? renderPageCsp(nonce, dev)
    : contentSecurityPolicy(nonce, dev);
}

/** Copy of `response` with the security headers for its content type. */
export function withSecurityHeaders(
  response: Response,
  nonce: string,
  dev: boolean,
  pathname = "/"
): Response {
  const secured = new Response(response.body, response);
  const frameable = secured.headers.get(FRAMEABLE_HEADER) === "same-origin";
  secured.headers.delete(FRAMEABLE_HEADER);
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  if (dev) {
    secured.headers.delete("Strict-Transport-Security");
  }
  const isHtml = secured.headers.get("Content-Type")?.startsWith("text/html");
  let csp = NON_HTML_CSP;
  if (isHtml) {
    csp = htmlCsp(nonce, dev, pathname);
  } else if (frameable) {
    csp = FRAMEABLE_FILE_CSP;
    secured.headers.set("X-Frame-Options", "SAMEORIGIN");
  }
  secured.headers.set("Content-Security-Policy", csp);
  // Every dynamic response is personal (or a sign-in page): never cache it.
  if (!secured.headers.has("Cache-Control") || isHtml) {
    secured.headers.set("Cache-Control", "private, no-store");
  }
  if (isRenderPath(pathname)) {
    // The URL carried a render ticket (08 §6.4).
    secured.headers.set("Cache-Control", "no-store");
    secured.headers.set("Referrer-Policy", "no-referrer");
  }
  return secured;
}

export interface EdgePolicyOptions {
  /** Production origin of the app (`JOBS_APP_ORIGIN`). */
  appOrigin?: string;
  /** Vite dev server: relaxed script/connect CSP, no HSTS. */
  dev: boolean;
}

/**
 * Runs `next` behind the CSRF gate with a fresh nonce on the request (for
 * the router) and the security headers on the response.
 */
export async function applyEdgePolicy(
  request: Request,
  next: (request: Request) => Response | Promise<Response>,
  options: EdgePolicyOptions
): Promise<Response> {
  const nonce = createNonce();
  const url = new URL(request.url);
  const refused = checkServerFnRequest(
    request,
    allowedOrigins(url, options.appOrigin)
  );
  if (refused) {
    return withSecurityHeaders(refused, nonce, options.dev, url.pathname);
  }
  const headers = new Headers(request.headers);
  headers.delete(NONCE_HEADER);
  headers.set(NONCE_HEADER, nonce);
  const forwarded = new Request(request, { headers });
  return withSecurityHeaders(
    await next(forwarded),
    nonce,
    options.dev,
    url.pathname
  );
}
