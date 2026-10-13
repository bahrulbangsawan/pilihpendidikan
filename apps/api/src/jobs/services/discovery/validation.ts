// Input hygiene for discovery data (05 §4, 11 T-08, 15 §10.2, 20 §9).
//
// - Strings must not carry NUL or other control characters (TAB, LF and CR
//   are allowed) nor unpaired UTF-16 surrogates: they would corrupt stored
//   text and every consumer of it.
// - User-supplied URLs are syntax-checked only — the server never fetches
//   them (T-08): http/https, no userinfo, ≤ 2048 characters.
// - Excluded hosts (LinkedIn, Indeed; adapters.json `excluded`) are refused
//   (D-17).
// - Descriptions are capped at 64 KB of UTF-8 (15 §10.1).
// - Client timestamps more than 24 h ahead are clamped (20 §9).

import { excludedSourceFor } from "@pilihpendidikan/jobs-contracts/adapters";
import {
  asciiHost,
  registrableDomain,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import type { ExcludedSourceId } from "@pilihpendidikan/jobs-contracts/enums";
import { DESCRIPTION_MAX_BYTES } from "@pilihpendidikan/jobs-contracts/records";

/** 11 T-08: user-supplied URLs are at most 2048 characters. */
export const URL_MAX_LENGTH = 2048;
/** 20 §9: client timestamps may run at most 24 h ahead of the server. */
export const CLIENT_CLOCK_SKEW_MS = 86_400_000;
/** 15 §10.2: `posted_at` may be at most one day in the future. */
export const POSTED_AT_MAX_AHEAD_MS = 86_400_000;

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const DEL = 0x7f;
const HIGH_SURROGATE_START = 0xd8_00;
const LOW_SURROGATE_START = 0xdc_00;
const SURROGATE_END = 0xdf_ff;

function isForbiddenControl(code: number): boolean {
  if (code === DEL) {
    return true;
  }
  return code < SPACE && code !== TAB && code !== LF && code !== CR;
}

/**
 * True when `text` contains NUL / C0 controls other than TAB, LF, CR, DEL,
 * or an unpaired surrogate.
 */
export function hasForbiddenCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isForbiddenControl(code)) {
      return true;
    }
    if (code >= HIGH_SURROGATE_START && code <= SURROGATE_END) {
      const isHigh = code < LOW_SURROGATE_START;
      const next = text.charCodeAt(i + 1);
      const pairs =
        isHigh && next >= LOW_SURROGATE_START && next <= SURROGATE_END;
      if (!pairs) {
        return true;
      }
      i++;
    }
  }
  return false;
}

/** Deepest JSON nesting accepted in discovery payloads (items nest ≤ 4). */
export const MAX_JSON_DEPTH = 32;
/** What `findForbiddenString` rejects, for error messages. */
export const FORBIDDEN_TEXT = `control characters, unpaired surrogates or nesting deeper than ${MAX_JSON_DEPTH} levels`;

/**
 * The JSON path of the first string (value or object key) in `value` with a
 * forbidden character — or of the first value nested deeper than
 * `MAX_JSON_DEPTH` (a 1 MB body could otherwise nest deep enough to exhaust
 * the stack) — or null when the value is clean.
 */
export function findForbiddenString(
  value: unknown,
  path = "",
  depth = 0
): string | null {
  if (typeof value === "string") {
    return hasForbiddenCharacters(value) ? path || "$" : null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  if (depth >= MAX_JSON_DEPTH) {
    return path || "$";
  }
  const entries: [string, unknown, string][] = Array.isArray(value)
    ? value.map((item, index) => ["", item, `${path}[${index}]`])
    : Object.entries(value).map(([key, item]) => [
        key,
        item,
        path ? `${path}.${key}` : key,
      ]);
  for (const [key, item, childPath] of entries) {
    if (hasForbiddenCharacters(key)) {
      return childPath;
    }
    const hit = findForbiddenString(item, childPath, depth + 1);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

export type UrlProblem = "length" | "malformed" | "scheme" | "userinfo";

/**
 * Syntax check of a URL the server stores but never fetches (11 T-08).
 * `allowHttp` admits `http:` (user-provided custom URLs, 15 §10.2).
 */
export function checkUrl(
  raw: string,
  options: { allowHttp: boolean }
): UrlProblem | null {
  if (raw.length > URL_MAX_LENGTH) {
    return "length";
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "malformed";
  }
  const schemeOk =
    url.protocol === "https:" ||
    (options.allowHttp && url.protocol === "http:");
  if (!schemeOk) {
    return "scheme";
  }
  if (url.username !== "" || url.password !== "") {
    return "userinfo";
  }
  return url.hostname === "" ? "malformed" : null;
}

const URL_PROBLEM_TEXT: Record<UrlProblem, string> = {
  length: `URLs are limited to ${URL_MAX_LENGTH} characters.`,
  malformed: "Not a valid absolute URL.",
  scheme: "Only http(s) URLs are accepted.",
  userinfo: "URLs must not contain a user name or password.",
};

export function urlProblemMessage(problem: UrlProblem): string {
  return URL_PROBLEM_TEXT[problem];
}

/** The excluded source (D-17) a URL or host points at, or null. */
export function excludedHostOf(
  hostOrUrl: string | null | undefined
): ExcludedSourceId | null {
  if (!hostOrUrl) {
    return null;
  }
  return excludedSourceFor(hostOrUrl);
}

const HTTP_URL_RE = /^https?:\/\//i;
const DOMAIN_RE = /^[a-z0-9.-]{1,253}$/;

/**
 * The registrable domain of a URL's host (the host itself when it has none,
 * e.g. an IPv4 address), or null when there is no host or it is not a plain
 * domain (an IPv6 literal): what `apply_domain` stores (04 §2.1).
 */
export function domainOfUrl(url: string | null | undefined): string | null {
  const host = asciiHost(url);
  if (!host) {
    return null;
  }
  const domain = registrableDomain(host) ?? host;
  return DOMAIN_RE.test(domain) ? domain : null;
}

/**
 * Every string inside an adapter config that looks like an http(s) URL,
 * with its path (custom_url `url`, career_page `url`, generic_listing
 * `start_url`, and anything a future adapter adds).
 */
export function urlsInConfig(
  value: unknown,
  path = "config"
): { path: string; url: string }[] {
  if (typeof value === "string") {
    return HTTP_URL_RE.test(value.trim()) ? [{ path, url: value.trim() }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      urlsInConfig(item, `${path}[${index}]`)
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      urlsInConfig(item, `${path}.${key}`)
    );
  }
  return [];
}

const CONTINUATION_MIN = 0x80;
const CONTINUATION_END = 0xbf;

/**
 * `text` cut to at most `maxBytes` of UTF-8 on a character boundary
 * (15 §10.1: descriptions ≤ 64 KB, flag on overflow).
 */
export function truncateUtf8(
  text: string,
  maxBytes: number = DESCRIPTION_MAX_BYTES
): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) {
    return { text, truncated: false };
  }
  let end = maxBytes;
  while (
    end > 0 &&
    bytes[end] >= CONTINUATION_MIN &&
    bytes[end] <= CONTINUATION_END
  ) {
    end--;
  }
  return {
    text: new TextDecoder().decode(bytes.subarray(0, end)),
    truncated: true,
  };
}

/** UTF-8 byte length of a string. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * A client timestamp, clamped to `now` when it runs more than 24 h ahead
 * (20 §9); values merely ahead of the server clock are clamped too so a
 * skewed CLI cannot push `last_seen_at` into the future.
 */
export function clampClientTime(
  value: number,
  now: number
): { clamped: boolean; flagged: boolean; value: number } {
  if (value <= now) {
    return { value, clamped: false, flagged: false };
  }
  return {
    value: now,
    clamped: true,
    flagged: value - now > CLIENT_CLOCK_SKEW_MS,
  };
}
