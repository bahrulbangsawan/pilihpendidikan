// RFC 7591 dynamic client registration. Confidential clients get a secret
// (stored hashed, returned once); a client that asks for
// `token_endpoint_auth_method: "none"` is a public client protected by PKCE.

import { hashToken, randomSecret } from "../auth";
import type { Env } from "../env";
import { readJsonBody } from "../json-body";
import { checkRateLimits, clientIpFor, OAUTH_REGISTER_IP } from "../rate-limit";
import type { TokenEndpointAuthMethod } from "./shared";
import { isAcceptableRedirectUri, oauthError, oauthJson } from "./shared";

const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME = 100;
const FIRST_PRINTABLE = 0x20;
const DELETE_CHAR = 0x7f;

// Control characters (CR/LF included) would otherwise reach the subject line
// of the approval email.
function stripControlChars(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < FIRST_PRINTABLE || code === DELETE_CHAR ? " " : ch;
  }
  return out;
}

interface RegisterBody {
  client_name?: unknown;
  redirect_uris?: unknown;
  grant_types?: unknown;
  token_endpoint_auth_method?: unknown;
}

function authMethodOf(value: unknown): TokenEndpointAuthMethod | null {
  if (value === undefined || value === "client_secret_basic") {
    return "client_secret_basic";
  }
  if (value === "client_secret_post" || value === "none") {
    return value;
  }
  return null;
}

function clientNameOf(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const clean = stripControlChars(value).trim();
  return clean ? clean.slice(0, MAX_CLIENT_NAME) : null;
}

export async function handleRegister(
  request: Request,
  env: Env
): Promise<Response> {
  const limit = await checkRateLimits(env.RATE_LIMIT_KV, [
    [OAUTH_REGISTER_IP, clientIpFor(request)],
  ]);
  if (!limit.ok) {
    return oauthError("slow_down", "Too many registrations.", 429);
  }
  let body: RegisterBody | null;
  try {
    body = (await readJsonBody(request, { maxBytes: 16_384 })) as RegisterBody;
  } catch {
    return oauthError("invalid_client_metadata", "Invalid JSON body.");
  }
  const rawUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  const uris = rawUris.filter(
    (u): u is string => typeof u === "string" && isAcceptableRedirectUri(u)
  );
  if (
    uris.length === 0 ||
    uris.length !== rawUris.length ||
    uris.length > MAX_REDIRECT_URIS
  ) {
    return oauthError(
      "invalid_redirect_uri",
      "redirect_uris must be 1–10 https URLs (http only on localhost)."
    );
  }
  const grantTypes = Array.isArray(body?.grant_types)
    ? body.grant_types
    : ["authorization_code"];
  if (!grantTypes.includes("authorization_code")) {
    return oauthError(
      "invalid_client_metadata",
      "Only the authorization_code grant is supported."
    );
  }
  const authMethod = authMethodOf(body?.token_endpoint_auth_method);
  if (!authMethod) {
    return oauthError(
      "invalid_client_metadata",
      "Unsupported token_endpoint_auth_method."
    );
  }
  const clientId = crypto.randomUUID();
  const secret = authMethod === "none" ? null : randomSecret();
  const clientName = clientNameOf(body?.client_name);
  const createdAt = Date.now();
  await env.DB.prepare(
    "INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      clientId,
      secret ? await hashToken(secret) : "",
      clientName,
      JSON.stringify(uris),
      authMethod,
      createdAt
    )
    .run();
  return oauthJson(
    {
      client_id: clientId,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(createdAt / 1000),
      client_name: clientName,
      redirect_uris: uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: authMethod,
    },
    { status: 201 }
  );
}
