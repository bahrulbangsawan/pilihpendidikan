// RFC 8414 authorization-server metadata and RFC 9728 protected-resource
// metadata. Strict clients compare these against what the endpoints really
// do, so keep them in step with register.ts / token.ts.

import { publicOrigin } from "../origins";
import { oauthJson, SUPPORTED_SCOPES } from "./shared";

export function handleAuthorizationServerMetadata(request: Request): Response {
  const issuer = publicOrigin(request);
  return oauthJson({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    scopes_supported: [...SUPPORTED_SCOPES],
    resource_indicators_supported: true,
    authorization_response_iss_parameter_supported: true,
  });
}

// Claude's connector canonicalizes the server URL with a trailing slash, so
// `resource` carries one to survive a simple string comparison.
export function handleProtectedResourceMetadata(request: Request): Response {
  const issuer = publicOrigin(request);
  return oauthJson({
    resource: `${issuer}/`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [...SUPPORTED_SCOPES],
  });
}
