// Strong ETags and `If-None-Match` → 304 (05 §5 board, 12 §10 polling).
//
//   const body = await buildBoard(…);
//   return await c.jsonWithEtag(body);          // 200 + ETag, or 304
//
// The tag is `"<first 32 hex of SHA-256(JSON body)>"`, so identical content
// always yields the same tag across isolates. Files use their sha256 as the
// tag (14 §5.3); pass it to `etagFromHash`.

import { REQUEST_ID_HEADER } from "./http";

const WEAK_PREFIX_RE = /^W\//;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Strong ETag of a JSON value (or of a raw string). */
export async function etagOf(value: unknown): Promise<string> {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${(await sha256Hex(text)).slice(0, 32)}"`;
}

/** Strong ETag of a known content hash (e.g. `files.sha256`). */
export function etagFromHash(hex: string): string {
  return `"${hex}"`;
}

/** True when `If-None-Match` lists `etag` (or `*`); weak tags match weakly. */
export function ifNoneMatches(request: Request, etag: string): boolean {
  const header = request.headers.get("If-None-Match");
  if (!header) {
    return false;
  }
  const strong = etag.replace(WEAK_PREFIX_RE, "");
  return header
    .split(",")
    .map((part) => part.trim())
    .some((tag) => tag === "*" || tag.replace(WEAK_PREFIX_RE, "") === strong);
}

/** `304 Not Modified` with the tag and no body. */
export function notModified(etag: string, requestId: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      ETag: etag,
      "Cache-Control": "private, no-cache",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
