// `GET /api/v1/files/{fil_id}/content` (05 §7, 14 §5.3): after the owner
// check, stream the R2 object with
//   ETag: "<sha256>"                     (the CLI verifies it, 08 §8)
//   Cache-Control: private, no-store
//   Content-Disposition: attachment; filename="<[A-Za-z0-9 ._-] name>"
//   X-Content-Type-Options: nosniff
// `If-None-Match` with the sha256 answers 304. Single byte ranges are served
// for evidence screenshots only (206 / 416); other kinds ignore `Range`.

import type { Env } from "../../../env";
import type { FileRow } from "../../repo/files";
import { extensionOfKey, safeDownloadName } from "./policy";

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;
const WEAK_PREFIX_RE = /^W\//;

export interface ByteRange {
  length: number;
  offset: number;
}

/**
 * The single range of a `Range` header for a body of `size` bytes: null
 * when absent or not a single `bytes=` range (served whole), "unsatisfiable"
 * when it starts past the end.
 */
export function parseByteRange(
  header: string | null,
  size: number
): ByteRange | "unsatisfiable" | null {
  const match = header ? RANGE_RE.exec(header.trim()) : null;
  if (!match || (match[1] === "" && match[2] === "")) {
    return null;
  }
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) {
      return "unsatisfiable";
    }
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) {
    return "unsatisfiable";
  }
  return { offset: start, length: end - start + 1 };
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) {
    return false;
  }
  return header
    .split(",")
    .map((part) => part.trim().replace(WEAK_PREFIX_RE, ""))
    .some((part) => part === etag || part === "*");
}

/**
 * The response of a download (see the file header), or null when the R2
 * object is missing (the route answers 404).
 */
export async function serveFileContent(
  env: Pick<Env, "JOBS_FILES">,
  request: Request,
  file: FileRow
): Promise<Response | null> {
  const etag = `"${file.sha256}"`;
  const name = safeDownloadName(
    file.original_name,
    file.id,
    extensionOfKey(file.r2_key)
  );
  const rangesAllowed = file.kind === "evidence_screenshot";
  const headers = new Headers({
    "Content-Type": file.content_type,
    ETag: etag,
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="${name}"`,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": rangesAllowed ? "bytes" : "none",
  });
  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  const range = rangesAllowed
    ? parseByteRange(request.headers.get("Range"), file.size_bytes)
    : null;
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${file.size_bytes}`);
    return new Response(null, { status: 416, headers });
  }
  const object = await env.JOBS_FILES.get(
    file.r2_key,
    range ? { range } : undefined
  );
  if (!object) {
    console.error({ evt: "file_object_missing", file_id: file.id });
    return null;
  }
  if (range) {
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${file.size_bytes}`
    );
    headers.set("Content-Length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(file.size_bytes));
  return new Response(object.body, { status: 200, headers });
}
