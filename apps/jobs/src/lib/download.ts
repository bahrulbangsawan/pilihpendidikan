// `/download/*`: the two non-JSON API routes the browser may fetch through
// the BFF (DOWNLOAD_ROUTE_KEYS): an interview's .ics and a stored file's
// content — plus the `.eml` of an approved email draft, which the BFF builds
// itself (09 §6.1, src/lib/eml-download.ts) — and the account export the api
// emails a link to (`/download/account/exports/<id>`, browser session). The path after `/download/` is
// the API path after `/api/v1/`; only these shapes, with plain-id segments,
// are accepted.

import { isSafeParamValue } from "./api-routes";
import { FRAMEABLE_HEADER } from "./edge-policy";

const ICS_RE = /^applications\/([^/]+)\/interviews\/([^/]+)\.ics$/;
const CONTENT_RE = /^files\/([^/]+)\/content$/;
const EXPORT_RE = /^account\/exports\/([^/]+)$/;
const EML_RE = /^applications\/([^/]+)\/emails\/([^/]+)\.eml$/;
const ATTACHMENT_RE = /^attachment/i;

export type DownloadTarget =
  | { kind: "ics"; apiPath: string }
  | { kind: "file"; apiPath: string }
  /** The account export ZIP emailed by the api (11 §10, leaf-2.8). */
  | { kind: "export"; apiPath: string }
  | { kind: "eml"; appId: string; emlId: string };

export function matchDownloadPath(splat: string): DownloadTarget | null {
  const ics = ICS_RE.exec(splat);
  if (ics) {
    const [, appId = "", ivwId = ""] = ics;
    if (isSafeParamValue(appId) && isSafeParamValue(ivwId)) {
      return {
        kind: "ics",
        apiPath: `/api/v1/applications/${appId}/interviews/${ivwId}.ics`,
      };
    }
    return null;
  }
  const exported = EXPORT_RE.exec(splat);
  if (exported) {
    const [, exportId = ""] = exported;
    return isSafeParamValue(exportId)
      ? { kind: "export", apiPath: `/api/v1/account/exports/${exportId}` }
      : null;
  }
  const eml = EML_RE.exec(splat);
  if (eml) {
    const [, appId = "", emlId = ""] = eml;
    return isSafeParamValue(appId) && isSafeParamValue(emlId)
      ? { kind: "eml", appId, emlId }
      : null;
  }
  const content = CONTENT_RE.exec(splat);
  if (content) {
    const [, fileId = ""] = content;
    if (isSafeParamValue(fileId)) {
      return { kind: "file", apiPath: `/api/v1/files/${fileId}/content` };
    }
  }
  return null;
}

/** Headers of a streamed download; PDFs may be shown inline (`?inline=1`). */
export function downloadHeaders(upstream: Headers, inline: boolean): Headers {
  const headers = new Headers();
  const type = upstream.get("Content-Type") ?? "application/octet-stream";
  headers.set("Content-Type", type);
  const length = upstream.get("Content-Length");
  if (length) {
    headers.set("Content-Length", length);
  }
  const etag = upstream.get("ETag");
  if (etag) {
    headers.set("ETag", etag);
  }
  const disposition = upstream.get("Content-Disposition") ?? "attachment";
  const inlinePdf = inline && type.startsWith("application/pdf");
  headers.set(
    "Content-Disposition",
    inlinePdf ? disposition.replace(ATTACHMENT_RE, "inline") : disposition
  );
  if (inlinePdf) {
    // The CV tab shows it in a same-origin <iframe> (08 §7); see FRAMEABLE_HEADER.
    headers.set(FRAMEABLE_HEADER, "same-origin");
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

/** Headers of a BFF-built `.eml` (09 §6.1). */
export function emlHeaders(fileName: string, length: number): Headers {
  return new Headers({
    "Content-Type": "message/rfc822",
    "Content-Length": String(length),
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
}
