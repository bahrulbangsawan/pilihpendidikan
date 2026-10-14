// Pure request routing of the scraper Worker (unit-tested without Docker).
//
// Only `GET /healthz` and `POST /v1/{scrape,probe,directory}` reach the
// container; everything else is 404. Bodies over 4 MB are refused (413). The
// container instance is `pool-<hash(domain) % size>`, so every request for one
// domain lands on the same process and the engine's per-domain politeness
// (robots cache, delays) holds across runs.

export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const FORWARDED_POST_PATHS = new Set([
  "/v1/scrape",
  "/v1/probe",
  "/v1/directory",
]);
const HOST_RE = /^https?:\/\/([^/?#:]+)/i;

export type Route =
  | { kind: "health" }
  | { kind: "forward"; path: string }
  | { kind: "reject"; status: 404 | 405 | 413 };

export function routeRequest(
  method: string,
  pathname: string,
  contentLength: string | null
): Route {
  if (pathname === "/healthz") {
    return method === "GET"
      ? { kind: "health" }
      : { kind: "reject", status: 405 };
  }
  if (!FORWARDED_POST_PATHS.has(pathname)) {
    return { kind: "reject", status: 404 };
  }
  if (method !== "POST") {
    return { kind: "reject", status: 405 };
  }
  const declared = contentLength === null ? 0 : Number(contentLength);
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) {
    return { kind: "reject", status: 413 };
  }
  return { kind: "forward", path: pathname };
}

const HASH_MODULUS = 2_147_483_647; // 2^31 - 1 (prime)
const HASH_BASE = 131;

/** Polynomial string hash: stable, dependency-free, good enough to spread domains. */
export function stringHash(text: string): number {
  let hash = 7;
  for (const char of text) {
    hash = (hash * HASH_BASE + (char.codePointAt(0) ?? 0)) % HASH_MODULUS;
  }
  return hash;
}

export function poolSize(raw: string | undefined): number {
  const size = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(size) && size >= 1 && size <= 20 ? size : 1;
}

/**
 * The domain a request is about: `source.canonical_domain` (scrape), else the
 * host of `url` (probe) or `directory.url` (directory); "" when absent.
 */
export function routingKey(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return "";
  }
  const record = body as Record<string, unknown>;
  const source = record.source as Record<string, unknown> | undefined;
  if (typeof source?.canonical_domain === "string") {
    return source.canonical_domain.toLowerCase();
  }
  const directory = record.directory as Record<string, unknown> | undefined;
  let url = "";
  if (typeof record.url === "string") {
    url = record.url;
  } else if (typeof directory?.url === "string") {
    url = directory.url;
  }
  return (HOST_RE.exec(url)?.[1] ?? "").toLowerCase();
}

export function instanceName(key: string, size: number): string {
  return `pool-${stringHash(key) % size}`;
}
