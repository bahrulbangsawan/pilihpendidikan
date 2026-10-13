// RFC 8414 authorization-server metadata and RFC 9728 protected-resource
// metadata (17 §13). Strict clients compare these against what the endpoints
// really do, so keep them in step with register.ts / token.ts / revoke.ts:
//
//   grant_types_supported     authorization_code (everyone) and
//                             refresh_token (first-party grants)
//   revocation_endpoint       /oauth/revoke (RFC 7009)
//   scopes_supported          every 05 §1.2 scope + the DCR ceiling `mcp`

import { publicOrigin } from "../origins";
import { METADATA_SCOPES, oauthJson } from "./shared";

const AUTH_METHODS = ["client_secret_basic", "client_secret_post", "none"];

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
    scopes_supported: [...METADATA_SCOPES],
    resource_indicators_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

export function handleAuthorizationServerMetadata(request: Request): Response {
  return oauthJson(authorizationServerMetadata(publicOrigin(request)));
}

// Claude's connector canonicalizes the server URL with a trailing slash, so
// `resource` carries one to survive a simple string comparison.
export function handleProtectedResourceMetadata(request: Request): Response {
  const issuer = publicOrigin(request);
  return oauthJson({
    resource: `${issuer}/`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [...METADATA_SCOPES],
  });
}
