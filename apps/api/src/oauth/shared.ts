// Shared pieces of the OAuth 2.1 authorization server that lets MCP clients
// (Claude, Claude Code, Cursor, MCP Inspector, …) connect:
//
//   discovery  GET  /.well-known/oauth-authorization-server (RFC 8414)
//              GET  /.well-known/oauth-protected-resource   (RFC 9728)
//   register   POST /oauth/register   (RFC 7591 dynamic client registration)
//   authorize  GET  /oauth/authorize → consent + email form
//              POST /oauth/authorize → emails a confirmation link
//   magic      GET  /oauth/magic     → confirm page (no side effects)
//              POST /oauth/magic     → issues the code, redirects to client
//   token      POST /oauth/token     (authorization_code + PKCE S256)
//
// Every secret (client secret, link token, code) is stored only as a
// SHA-256 hash. The access token is a `session` row in mcp_tokens.

import { corsHeadersPublic } from "../cors";

export const SUPPORTED_SCOPES = ["mcp"] as const;
// Cookie that ties an emailed approval link to the browser that started the
// authorization, so a link sent to someone else's inbox cannot be approved by
// them on an attacker's behalf.
export const OAUTH_FLOW_COOKIE = "oauth-flow";
export const CODE_TTL_SECONDS = 300;
// Access tokens issued to MCP clients. There is no refresh grant, so this is
// how long a connection lasts before the client has to authorize again.
export const OAUTH_TOKEN_TTL_SECONDS = 90 * 86_400;

export type TokenEndpointAuthMethod =
  | "client_secret_basic"
  | "client_secret_post"
  | "none";

export interface OAuthClientRow {
  client_id: string;
  client_secret_hash: string;
  client_name: string | null;
  redirect_uris: string;
  token_endpoint_auth_method: TokenEndpointAuthMethod;
  created_at: number;
}

// What the emailed link carries until it is confirmed.
export interface PendingAuthorization {
  email: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  // SHA-256 of the OAUTH_FLOW_COOKIE value set on the initiating browser.
  browserBinding: string;
}

export interface StoredCode {
  email: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
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
  status = 400
): Response {
  return oauthJson({ error, error_description: description }, { status });
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

export async function findClient(
  db: D1Database,
  clientId: string
): Promise<OAuthClientRow | null> {
  const row = await db
    .prepare(
      "SELECT client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method, created_at FROM oauth_clients WHERE client_id = ? LIMIT 1"
    )
    .bind(clientId)
    .first<OAuthClientRow>();
  return row ?? null;
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
