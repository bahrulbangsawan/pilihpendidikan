// Posting fingerprints (`fp1`, 03 §4.2), content hashes and dedupe groups.
//
// The CLI re-implements every function here in Python and must reproduce
// `test-vectors/*.json` byte for byte, so each step is spelled out. Hashing
// uses WebCrypto (`crypto.subtle`), so the module runs unchanged in Workers,
// Bun and browsers. Registrable domains come from the vendored Public Suffix
// List (`psl/public_suffix_list.dat`, compiled into `psl-data.ts`).
import { STABLE_SOURCE_KINDS } from "./enums";
import { PSL_ICANN_RULES, PSL_PRIVATE_RULES } from "./psl-data";

// ---------------------------------------------------------------------------
// normalizeText (03 §4.2)
// ---------------------------------------------------------------------------

/**
 * Unicode White_Space (exactly: U+0009–U+000D, U+0020, U+0085, U+00A0,
 * U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000).
 */
const WHITESPACE_RUN =
  /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;

/**
 * Characters removed by step 5: general categories P* (punctuation), S*
 * (symbols), Cc (controls) and Cf (format, e.g. U+200B, U+FEFF), except the
 * five kept characters `+ # . / -`.
 */
const STRIPPED_CHAR = /(?![+#./-])[\p{P}\p{S}\p{Cc}\p{Cf}]/gu;
const SPACE_RUN = / {2,}/g;
const EDGE_SPACES = /^ +| +$/g;

/**
 * normalize(s):
 *  1. Unicode NFKC.
 *  2. Lowercase (Unicode default full case mapping, locale independent).
 *  3. Replace every run of White_Space characters with one U+0020.
 *  4. Trim U+0020 from both ends.
 *  5. Remove punctuation, symbols, controls and format characters
 *     (categories P*, S*, Cc, Cf) except `+ # . / -` (keeps "c++", "c#",
 *     ".net", "ci/cd", "full-stack").
 *  6. Collapse runs of U+0020 left by step 5 and trim again.
 */
export function normalizeText(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(WHITESPACE_RUN, " ")
    .replace(EDGE_SPACES, "")
    .replace(STRIPPED_CHAR, "")
    .replace(SPACE_RUN, " ")
    .replace(EDGE_SPACES, "");
}

// ---------------------------------------------------------------------------
// canonicalUrl (03 §4.2)
// ---------------------------------------------------------------------------

/** Query parameters dropped as tracking (03 §4.2), besides any `utm_*`. */
export const TRACKING_PARAMS = [
  "gh_src",
  "lever-source",
  "ref",
  "source",
  "fbclid",
  "gclid",
] as const;
const TRACKING_SET: ReadonlySet<string> = new Set(TRACKING_PARAMS);
const PLUS = /\+/g;

function decodeComponent(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(PLUS, " "));
  } catch {
    return raw;
  }
}

function isTrackingParam(rawName: string): boolean {
  const name = decodeComponent(rawName).toLowerCase();
  return name.startsWith("utm_") || TRACKING_SET.has(name);
}

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function canonicalQuery(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const kept: { name: string; segment: string }[] = [];
  for (const segment of raw.split("&")) {
    if (segment === "") {
      continue;
    }
    const eq = segment.indexOf("=");
    const name = eq === -1 ? segment : segment.slice(0, eq);
    if (!isTrackingParam(name)) {
      kept.push({ name, segment });
    }
  }
  kept.sort(
    (a, b) =>
      compareCodeUnits(a.name, b.name) || compareCodeUnits(a.segment, b.segment)
  );
  return kept.map((entry) => entry.segment).join("&");
}

function parseHttpUrl(input: string | null | undefined): URL | null {
  if (!input) {
    return null;
  }
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.hostname === "" ? null : url;
  } catch {
    return null;
  }
}

/**
 * canonical_url(u) for http(s) URLs, null for anything else:
 *  1. Parse with the WHATWG URL Standard (this lowercases scheme and host,
 *     maps IDN hosts to punycode via UTS #46, drops the scheme's default
 *     port, resolves `.`/`..` path segments, serializes an empty path as `/`
 *     and percent-encodes path and query per the standard's encode sets, so
 *     path and query are ASCII).
 *  2. Output `scheme://host[:port]path[?query]`: userinfo and the fragment
 *     are dropped; a non-default port is kept.
 *  3. Query: split the serialized query on `&`, drop empty segments, and drop
 *     every segment whose name (text before the first `=`, `+` read as a
 *     space, percent-decoded, lowercased) starts with `utm_` or is one of
 *     `gh_src`, `lever-source`, `ref`, `source`, `fbclid`, `gclid`.
 *  4. Sort the remaining segments by (raw name, raw segment) in code-unit
 *     order — a stable, byte-wise order because both are ASCII — and join
 *     them with `&`. Segments are kept verbatim (no re-encoding). If none
 *     remain, the `?` is omitted.
 */
export function canonicalUrl(input: string | null | undefined): string | null {
  const url = parseHttpUrl(input);
  if (!url) {
    return null;
  }
  const port = url.port === "" ? "" : `:${url.port}`;
  const query = canonicalQuery(url.search);
  return `${url.protocol}//${url.hostname}${port}${url.pathname}${
    query === "" ? "" : `?${query}`
  }`;
}

// ---------------------------------------------------------------------------
// Public Suffix List (ICANN + PRIVATE sections)
// ---------------------------------------------------------------------------

interface SuffixRules {
  exact: ReadonlySet<string>;
  exceptions: ReadonlySet<string>;
  /** Wildcard rule `*.X` stored as `X`. */
  wildcards: ReadonlySet<string>;
}

let allRules: SuffixRules | null = null;
let icannRules: SuffixRules | null = null;

function compileRules(...lists: string[]): SuffixRules {
  const exact = new Set<string>();
  const exceptions = new Set<string>();
  const wildcards = new Set<string>();
  for (const list of lists) {
    for (const rule of list.split(" ")) {
      if (rule.startsWith("!")) {
        exceptions.add(rule.slice(1));
      } else if (rule.startsWith("*.")) {
        wildcards.add(rule.slice(2));
      } else if (rule !== "") {
        exact.add(rule);
      }
    }
  }
  return { exact, exceptions, wildcards };
}

function rulesFor(includePrivate: boolean): SuffixRules {
  if (includePrivate) {
    allRules ??= compileRules(PSL_ICANN_RULES, PSL_PRIVATE_RULES);
    return allRules;
  }
  icannRules ??= compileRules(PSL_ICANN_RULES);
  return icannRules;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const TRAILING_DOT = /\.$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Lowercase ASCII host of a domain or URL input: accepts `acme.com`,
 * `WWW.Acme.COM.`, `bücher.de`, `https://jobs.acme.com/x`. Uses WHATWG URL
 * host parsing (UTS #46 → punycode) and strips one trailing dot. Returns null
 * for empty or unparseable input.
 */
export function asciiHost(input: string | null | undefined): string | null {
  const trimmed = input?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }
  try {
    const url = new URL(SCHEME.test(trimmed) ? trimmed : `http://${trimmed}`);
    const host = url.hostname.replace(TRAILING_DOT, "");
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

function isIpHost(host: string): boolean {
  return host.startsWith("[") || IPV4.test(host);
}

/**
 * Number of labels of the public suffix of `labels` per the PSL algorithm
 * (https://publicsuffix.org/list/): a matching exception rule prevails and
 * yields its own length minus one; otherwise the longest matching normal or
 * wildcard rule wins; with no match the default rule `*` gives one label.
 */
function publicSuffixLength(labels: string[], rules: SuffixRules): number {
  const n = labels.length;
  for (let i = 0; i < n; i++) {
    if (rules.exceptions.has(labels.slice(i).join("."))) {
      return n - i - 1;
    }
  }
  let longest = 1;
  for (let i = 0; i < n; i++) {
    const matchesExact = rules.exact.has(labels.slice(i).join("."));
    const matchesWildcard =
      i + 1 < n && rules.wildcards.has(labels.slice(i + 1).join("."));
    if (matchesExact || matchesWildcard) {
      longest = Math.max(longest, n - i);
    }
  }
  return longest;
}

function hostLabels(input: string | null | undefined): string[] | null {
  const host = asciiHost(input);
  if (!host || isIpHost(host)) {
    return null;
  }
  const labels = host.split(".");
  return labels.includes("") ? null : labels;
}

export interface SuffixOptions {
  /** Use the PRIVATE section too (default true: github.io, pages.dev …). */
  includePrivate?: boolean;
}

/** The public suffix of a host, e.g. `co.uk` for `jobs.acme.co.uk`. */
export function publicSuffix(
  input: string | null | undefined,
  options: SuffixOptions = {}
): string | null {
  const labels = hostLabels(input);
  if (!labels) {
    return null;
  }
  const length = publicSuffixLength(
    labels,
    rulesFor(options.includePrivate ?? true)
  );
  return labels.slice(Math.max(0, labels.length - length)).join(".");
}

/**
 * The registrable domain (public suffix + one label), e.g. `acme.co.uk` for
 * `careers.acme.co.uk`. Null for IP addresses, single labels, public
 * suffixes themselves and unparseable input.
 */
export function registrableDomain(
  input: string | null | undefined,
  options: SuffixOptions = {}
): string | null {
  const labels = hostLabels(input);
  if (!labels) {
    return null;
  }
  const length = publicSuffixLength(
    labels,
    rulesFor(options.includePrivate ?? true)
  );
  if (length >= labels.length) {
    return null;
  }
  return labels.slice(labels.length - length - 1).join(".");
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Lowercase hex SHA-256 of the UTF-8 bytes of `text` (WebCrypto). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  let out = "";
  for (const byte of new Uint8Array(digest)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// ---------------------------------------------------------------------------
// fp1 fingerprint (03 §4.2)
// ---------------------------------------------------------------------------

export const FINGERPRINT_PREFIX = "fp1:";

export interface FingerprintInput {
  apply_url?: string | null;
  canonical_url?: string | null;
  company_domain?: string | null;
  /** `locations[0].raw` of the normalized posting. */
  location_primary?: string | null;
  source_job_ref?: string | null;
  source_kind: string;
  source_org?: string | null;
  title: string;
}

/**
 * The domain part of a `gen|` key: the registrable domain of the first host
 * found in company_domain, then apply_url, then canonical_url; when that host
 * has no registrable domain (IP address, single label, bare public suffix)
 * the host itself; "" when there is no host at all.
 */
export function postingDomain(input: {
  apply_url?: string | null;
  canonical_url?: string | null;
  company_domain?: string | null;
}): string {
  const host =
    asciiHost(input.company_domain) ??
    parseHttpUrl(input.apply_url)?.hostname ??
    parseHttpUrl(input.canonical_url)?.hostname ??
    null;
  if (!host) {
    return "";
  }
  const clean = host.replace(TRAILING_DOT, "");
  return registrableDomain(clean) ?? clean;
}

/**
 * The fingerprint key (03 §4.2):
 *
 * - `src|<source_kind>|<normalize(source_org)>|<source_job_ref>` when the
 *   source kind is one of greenhouse, lever, ashby, smartrecruiters, workable,
 *   workday AND both the normalized org and the trimmed job ref are non-empty
 *   (the ref is otherwise verbatim);
 * - otherwise `gen|<domain>|<normalize(title)>|<normalize(location_primary)>|<url>`
 *   where `<domain>` is `postingDomain(...)` and `<url>` is
 *   `canonicalUrl(apply_url) ?? canonicalUrl(canonical_url) ?? ""`.
 */
export function fingerprintKey(input: FingerprintInput): string {
  const org = normalizeText(input.source_org);
  const ref = input.source_job_ref?.trim() ?? "";
  const stable = (STABLE_SOURCE_KINDS as readonly string[]).includes(
    input.source_kind
  );
  if (stable && org !== "" && ref !== "") {
    return `src|${input.source_kind}|${org}|${ref}`;
  }
  const url =
    canonicalUrl(input.apply_url) ?? canonicalUrl(input.canonical_url) ?? "";
  return [
    "gen",
    postingDomain(input),
    normalizeText(input.title),
    normalizeText(input.location_primary),
    url,
  ].join("|");
}

/** `fp1:` + sha256_hex(utf8(key)). */
export async function fingerprint(input: FingerprintInput): Promise<string> {
  return `${FINGERPRINT_PREFIX}${await sha256Hex(fingerprintKey(input))}`;
}

/** Key of a migrated legacy job: `legacy|<user_id>|<legacy id>` (06 §12.2). */
export function legacyFingerprintKey(userId: string, legacyId: string): string {
  return `legacy|${userId}|${legacyId}`;
}

/** `fp1:` + sha256_hex(`legacy|<user_id>|<legacy id>`). */
export async function legacyFingerprint(
  userId: string,
  legacyId: string
): Promise<string> {
  return `${FINGERPRINT_PREFIX}${await sha256Hex(
    legacyFingerprintKey(userId, legacyId)
  )}`;
}

/** `sha256_hex(normalize(title) + "\n" + normalize(description_text))` (03 §4.2). */
export function contentHash(
  title: string,
  descriptionText: string
): Promise<string> {
  return sha256Hex(
    `${normalizeText(title)}\n${normalizeText(descriptionText)}`
  );
}

/**
 * The cross-source duplicate key (15 §11):
 * `sha256_hex(<registrable company domain>|normalize(title)|normalize(location_primary))`.
 * Only `company_domain` counts (an ATS host would group unrelated employers);
 * null when the posting has no company domain.
 */
export function dedupeGroupKey(input: {
  company_domain?: string | null;
  location_primary?: string | null;
  title: string;
}): string | null {
  const host = asciiHost(input.company_domain);
  if (!host) {
    return null;
  }
  const domain = registrableDomain(host) ?? host;
  return `${domain}|${normalizeText(input.title)}|${normalizeText(
    input.location_primary
  )}`;
}

/** sha256 hex of `dedupeGroupKey`, or null without a company domain. */
export async function dedupeGroup(input: {
  company_domain?: string | null;
  location_primary?: string | null;
  title: string;
}): Promise<string | null> {
  const key = dedupeGroupKey(input);
  return key === null ? null : await sha256Hex(key);
}

/** `locations[0].raw` or "" (the primary location of 03 §4.2). */
export function primaryLocation(
  locations: readonly { raw: string }[] | null | undefined
): string {
  return locations?.[0]?.raw ?? "";
}
