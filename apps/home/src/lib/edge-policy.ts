// Host canonicalisation and response headers for every Worker response.
// Static assets get the same headers from `public/_headers`; keep the two in
// sync (src/lib/edge-policy.test.ts checks it).

export const APEX_HOST = "pilihpendidikan.com";
export const APEX_ORIGIN = `https://${APEX_HOST}`;
const WWW_HOST = `www.${APEX_HOST}`;

// Adapted from apps/api/src/html.ts for a public, indexable page. See
// openspec/changes/home-add-hub-landing-page/design.md (D4).
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

// Short, so a redeploy after flipping a service status shows within minutes.
export const HTML_CACHE_CONTROL = "public, max-age=300";

/** 301 target on the apex for a `www.` request, or null for any other host. */
export function apexRedirect(request: Request): string | null {
  const url = new URL(request.url);
  if (url.hostname !== WWW_HOST) {
    return null;
  }
  return `${APEX_ORIGIN}${url.pathname}${url.search}`;
}

/** Copy of `response` carrying the security headers (and an HTML cache policy). */
export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  const isHtml = secured.headers.get("Content-Type")?.startsWith("text/html");
  if (isHtml && secured.status === 200) {
    secured.headers.set("Cache-Control", HTML_CACHE_CONTROL);
  }
  return secured;
}

/** Redirect `www.` to the apex, otherwise run `next` and add the headers. */
export async function applyEdgePolicy(
  request: Request,
  next: () => Response | Promise<Response>
): Promise<Response> {
  const location = apexRedirect(request);
  if (location) {
    return withSecurityHeaders(
      new Response(null, { status: 301, headers: { Location: location } })
    );
  }
  return withSecurityHeaders(await next());
}
