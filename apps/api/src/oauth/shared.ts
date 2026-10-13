// Shared pieces of the OAuth 2.1 authorization server. It serves two kinds
// of clients:
//
//   - MCP clients (Claude, Claude Code, Cursor, MCP Inspector, …) that
//     register themselves through RFC 7591 DCR. Their `allowed_scopes` is the
//     legacy `mcp` ceiling; their flow is unchanged (email consent, 90-day
//     `session` access token, no refresh token).
//   - First-party clients pre-registered by migration (`pilih-jobs-cli`,
//     17 §3.2): any-port loopback redirects (RFC 8252), required `state`,
//     scoped grants, session-aware consent, 1 h `oauth` access tokens and
//     rotating refresh tokens (17 §4–§8).
//
//   discovery  GET  /.well-known/oauth-authorization-server (RFC 8414)
//              GET  /.well-known/oauth-protected-resource   (RFC 9728)
//   register   POST /oauth/register   (RFC 7591 dynamic client registration)
//   authorize  GET  /oauth/authorize → approve page (first-party + browser
//                                      session) or consent + email form
//              POST /oauth/authorize → emails a confirmation link
//   decision   POST /oauth/authorize/decision → approve / deny (first-party)
//   magic      GET  /oauth/magic     → confirm page (no side effects)
//              POST /oauth/magic     → issues the code (MCP clients)
//   token      POST /oauth/token     (authorization_code + PKCE S256,
//                                      refresh_token for first-party grants)
//   revoke     POST /oauth/revoke    (RFC 7009)
//
// Every secret (client secret, link token, code, access and refresh token)
// is stored only as a SHA-256 hash.

import type { OAuthScope } from "@pilihpendidikan/jobs-contracts/enums";
import {
  MCP_CLIENT_SCOPE,
  OAUTH_SCOPES,
} from "@pilihpendidikan/jobs-contracts/enums";
import { corsHeadersPublic } from "../cors";

/** What the DCR (MCP) token response reports and what its tokens carry. */
export const SUPPORTED_SCOPES = [MCP_CLIENT_SCOPE] as const;

/** Every scope the metadata advertises (17 §13): the 05 §1.2 list + `mcp`. */
export const METADATA_SCOPES: readonly string[] = Object.freeze([
  ...OAUTH_SCOPES,
  MCP_CLIENT_SCOPE,
]);

// Cookie that ties an emailed approval link to the browser that started the
// authorization, so a link sent to someone else's inbox cannot be approved by
// them on an attacker's behalf.
export const OAUTH_FLOW_COOKIE = "oauth-flow";
export const CODE_TTL_SECONDS = 300;
// Access tokens issued to MCP (DCR) clients. They get no refresh token, so
// this is how long a connection lasts before the client authorizes again.
export const OAUTH_TOKEN_TTL_SECONDS = 90 * 86_400;

const DAY_MS = 86_400_000;
/** First-party access tokens (17 §7.1). */
export const FIRST_PARTY_ACCESS_TTL_SECONDS = 3600;
/** Refresh tokens: idle 30 d, absolute 90 d from grant creation (17 §7.1). */
export const REFRESH_IDLE_TTL_MS = 30 * DAY_MS;
export const REFRESH_ABSOLUTE_TTL_MS = 90 * DAY_MS;
/** D-30: a used refresh token re-issues its unused child for 60 s. */
export const REFRESH_GRACE_MS = 60_000;
/** First-party clients must send a `state` of at least 22 chars (17 §4.1). */
export const MIN_FIRST_PARTY_STATE_LENGTH = 22;
export const MAX_STATE_LENGTH = 512;
/** `device_name` is shown on consent and capped (17 §4.1). */
export const MAX_DEVICE_NAME_LENGTH = 60;
/** Consent CSRF tokens expire after 10 min (17 §4.3). */
export const CONSENT_CSRF_TTL_MS = 600_000;

/** First-party (pre-registered) client of the `pilih-jobs` CLI (17 §3.2). */
export const CLI_CLIENT_ID = "pilih-jobs-cli";
/** DCR refuses client ids with this prefix (17 §3.2). */
export const RESERVED_CLIENT_ID_PREFIX = "pilih-";

export type TokenEndpointAuthMethod =
  | "client_secret_basic"
  | "client_secret_post"
  | "none";

export interface OAuthClientRow {
  /** Space-delimited scope ceiling; `mcp` for DCR clients. */
  allowed_scopes: string | null;
  client_id: string;
  client_name: string | null;
  client_secret_hash: string;
  created_at: number;
  /** 1 for migration-seeded first-party clients. */
  first_party: number;
  /** 1 = RFC 8252 §7.3 any-port loopback redirects. */
  loopback_any_port: number;
  redirect_uris: string;
  token_endpoint_auth_method: TokenEndpointAuthMethod;
}

/** Authorize parameters that travel with an emailed approval link. */
export interface PendingAuthorization {
  // SHA-256 of the OAUTH_FLOW_COOKIE value set on the initiating browser.
  browserBinding: string;
  clientId: string;
  codeChallenge: string;
  /** First-party only: the `device_hint` (`dev_…`) as sent. */
  deviceHint?: string;
  /** First-party only: the `device_name` as sent (cleaned). */
  deviceName?: string;
  email: string;
  redirectUri: string;
  /** First-party only: the raw `scope` parameter. */
  scope?: string;
  state: string;
}

/** What `oauth:code:<sha256>` holds until the token exchange. */
export interface StoredCode {
  clientId: string;
  codeChallenge: string;
  /** First-party only: a device the user owns, re-bound at exchange. */
  deviceHint?: string | null;
  email: string;
  /** First-party only: the `oauth_grants` row created on approval. */
  grantId?: string;
  redirectUri: string;
  /** First-party only: granted scopes, space-delimited. */
  scopes?: string;
  /** First-party only: `users.id`. */
  userId?: string;
}

export function oauthJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(corsHeadersPublic())) {
    headers.set(key, value);
  }
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

export function oauthError(
  error: string,
  description: string,
  status = 400,
  headers: Record<string, string> = {}
): Response {
  return oauthJson(
    { error, error_description: description },
    { status, headers }
  );
}

const LOOPBACK_HOSTS: Record<string, true> = {
  localhost: true,
  "127.0.0.1": true,
  "[::1]": true,
};

// https anywhere; plain http only on loopback (native / CLI clients). No
// fragments (RFC 6749 §3.1.2), no userinfo.
export function isAcceptableRedirectUri(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  if (url.hash || url.username || url.password) {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  return (
    url.protocol === "http:" && Object.hasOwn(LOOPBACK_HOSTS, url.hostname)
  );
}

const CLIENT_COLUMNS =
  "client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method, created_at, first_party, allowed_scopes, loopback_any_port";

export async function findClient(
  db: D1Database,
  clientId: string
): Promise<OAuthClientRow | null> {
  const row = await db
    .prepare(
      `SELECT ${CLIENT_COLUMNS} FROM oauth_clients WHERE client_id = ? LIMIT 1`
    )
    .bind(clientId)
    .first<OAuthClientRow>();
  return row ?? null;
}

export function isFirstParty(client: Pick<OAuthClientRow, "first_party">) {
  return client.first_party === 1;
}

export function parseRedirectUris(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

// RFC 8252 §7.3 port wildcarding applies only to IP-literal loopback hosts
// (`localhost` is NOT RECOMMENDED, RFC 8252 §8.3).
const ANY_PORT_HOSTS: Record<string, true> = {
  "127.0.0.1": true,
  "[::1]": true,
};

function isAnyPortLoopbackMatch(registered: string, requested: URL): boolean {
  if (!URL.canParse(registered)) {
    return false;
  }
  const allowed = new URL(registered);
  return (
    allowed.protocol === "http:" &&
    allowed.hostname === requested.hostname &&
    allowed.pathname === requested.pathname &&
    allowed.port === ""
  );
}

/**
 * Is `requested` an acceptable redirect URI of `client` (17 §4.2)?
 *
 *   1. exact match with a registered URI (unchanged behaviour), else
 *   2. for `loopback_any_port` clients only: `http://127.0.0.1:<port>` or
 *      `http://[::1]:<port>` with the registered path exactly, in canonical
 *      form, and no query, fragment or userinfo.
 */
export function redirectMatches(
  client: Pick<OAuthClientRow, "redirect_uris" | "loopback_any_port">,
  requested: string
): boolean {
  const registered = parseRedirectUris(client.redirect_uris);
  if (registered.includes(requested)) {
    return true;
  }
  if (client.loopback_any_port !== 1 || !URL.canParse(requested)) {
    return false;
  }
  const url = new URL(requested);
  if (
    url.protocol !== "http:" ||
    !Object.hasOwn(ANY_PORT_HOSTS, url.hostname) ||
    url.href !== requested ||
    requested.includes("?") ||
    requested.includes("#") ||
    url.username ||
    url.password ||
    url.port === "" ||
    url.port === "0"
  ) {
    return false;
  }
  return registered.some((uri) => isAnyPortLoopbackMatch(uri, url));
}

const BASIC_PREFIX = "Basic ";

export function readBasicAuth(
  header: string | null
): { id: string; secret: string } | null {
  if (!header?.startsWith(BASIC_PREFIX)) {
    return null;
  }
  try {
    const decoded = atob(header.slice(BASIC_PREFIX.length).trim());
    const separator = decoded.indexOf(":");
    if (separator === -1) {
      return null;
    }
    return {
      id: decodeURIComponent(decoded.slice(0, separator)),
      secret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

// RFC 7636: 43–128 characters from the unreserved set. An S256 challenge is
// always 43 base64url characters.
const PKCE_CHALLENGE_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidCodeChallenge(value: string): boolean {
  return PKCE_CHALLENGE_RE.test(value);
}

const WHITESPACE_RE = /\s+/;
const WHITESPACE_RUN_RE = /\s+/g;

/** The space-delimited names of a scope string (empty names dropped). */
export function splitScopes(value: string | null | undefined): string[] {
  return (value ?? "")
    .trim()
    .split(WHITESPACE_RE)
    .filter((part) => part.length > 0);
}

const KNOWN_SCOPES = new Set<string>(OAUTH_SCOPES);

/**
 * The scopes a first-party grant gets (17 §5): the requested names that are
 * real 05 §1.2 scopes AND inside the client's `allowed_scopes` ceiling, in
 * 05 §1.2 order. Unknown names and `mcp` are dropped; anything above the
 * ceiling is clipped.
 */
export function grantableScopes(
  client: Pick<OAuthClientRow, "allowed_scopes">,
  requested: string | null | undefined
): OAuthScope[] {
  const ceiling = new Set(splitScopes(client.allowed_scopes));
  const asked = new Set(splitScopes(requested));
  return OAUTH_SCOPES.filter(
    (scope) => asked.has(scope) && ceiling.has(scope) && KNOWN_SCOPES.has(scope)
  );
}

/** Space-delimited scope list in 05 §1.2 order. */
export function formatScopes(scopes: readonly string[]): string {
  const set = new Set(scopes);
  return OAUTH_SCOPES.filter((scope) => set.has(scope)).join(" ");
}

// Control characters (CR/LF included) never reach a page, an email subject or
// a stored name.
const FIRST_PRINTABLE = 0x20;
const DELETE_CHAR = 0x7f;
const C1_END = 0x9f;

export function stripControlChars(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const control =
      code < FIRST_PRINTABLE || (code >= DELETE_CHAR && code <= C1_END);
    out += control ? " " : ch;
  }
  return out;
}

/** `device_name` as shown on consent: printable, trimmed, ≤ 60 chars. */
export function cleanDeviceName(value: string | null | undefined): string {
  const clean = stripControlChars(value ?? "")
    .replace(WHITESPACE_RUN_RE, " ")
    .trim();
  return [...clean].slice(0, MAX_DEVICE_NAME_LENGTH).join("").trim();
}
