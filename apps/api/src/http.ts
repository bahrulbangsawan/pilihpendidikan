// Small response and request helpers shared by the route modules. CORS is
// applied once at the dispatcher (app.ts), not here.

import type { AuthFailureReason } from "./auth";
import { hashToken } from "./auth";
import { publicOrigin } from "./origins";

const MAX_FORM_BYTES = 16_384;

export function jsonError(
  status: number,
  error: string,
  headers: Record<string, string> = {}
): Response {
  return Response.json({ error }, { status, headers });
}

export function unauthorized(reason: AuthFailureReason): Response {
  return Response.json(
    { error: reason },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' },
    }
  );
}

export function insufficientScope(): Response {
  return Response.json(
    { error: "insufficient_scope" },
    {
      status: 403,
      headers: {
        "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="write"',
      },
    }
  );
}

export function methodNotAllowed(allow: string): Response {
  return Response.json(
    { error: "Method not allowed." },
    { status: 405, headers: { Allow: allow } }
  );
}

export function tooManyRequests(retryAfter: number, message: string) {
  return Response.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

// CSRF check for the HTML form POSTs: the request must come from a page on
// this origin. Browsers send `Origin` on every POST; `Sec-Fetch-Site` covers
// the rare `Origin: null` case.
export function isSameOriginPost(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin && origin !== "null") {
    return origin === publicOrigin(request);
  }
  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}

// Parses a form body with a size cap. The HTML forms and OAuth clients send
// `application/x-www-form-urlencoded`, which is read as bounded text;
// multipart is accepted only with a declared, small Content-Length. Returns
// null when the body is too large or unreadable.
export async function readForm(request: Request): Promise<FormData | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) {
    return null;
  }
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      return declared > 0 ? await request.formData() : null;
    }
    const text = await request.text();
    if (text.length > MAX_FORM_BYTES) {
      return null;
    }
    const form = new FormData();
    for (const [key, value] of new URLSearchParams(text)) {
      form.append(key, value);
    }
    return form;
  } catch {
    return null;
  }
}

export function formString(form: FormData | null, name: string): string {
  const value = form?.get(name);
  return typeof value === "string" ? value.trim() : "";
}

// Logs a rejected credential with a hash prefix only — never the bearer.
export async function logAuthFailure(
  request: Request,
  reason: AuthFailureReason
): Promise<void> {
  const header = request.headers.get("Authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  console.warn({
    path: new URL(request.url).pathname,
    reason,
    hashPrefix: bearer ? (await hashToken(bearer)).slice(0, 8) : null,
  });
}

// `decodeURIComponent` throws on malformed escapes; route params use this so
// a bad path answers 400 instead of 500.
export function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
