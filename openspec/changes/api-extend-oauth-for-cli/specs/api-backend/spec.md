## MODIFIED Requirements

### Requirement: OAuth for MCP clients
The api Worker SHALL implement OAuth 2.1 authorization code with PKCE S256,
dynamic client registration and RFC 8414 / RFC 9728 discovery, and SHALL keep
dynamically registered (MCP) clients on their original behaviour: email-link
consent, the `mcp` scope ceiling (the legacy `write` mapping), exact redirect
matching and 90-day access tokens without a refresh token, while the same
server also serves the first-party `pilih-jobs-cli` client described by the
`api-auth` capability. (Source: 17 §3.1, §3.2, §7.1; D-09)

#### Scenario: Client connects
- **WHEN** a registered client completes authorize → email approval → token with the right verifier
- **THEN** it receives a Bearer access token valid for 90 days

#### Scenario: Wrong verifier or reused code
- **WHEN** the token request carries a wrong `code_verifier` or a code that was already used
- **THEN** the response is `invalid_grant`

#### Scenario: Unsafe redirect URI
- **WHEN** a client registers a plain-http redirect URI that is not loopback
- **THEN** registration is refused with `invalid_redirect_uri`

#### Scenario: Existing MCP token after the extension
- **WHEN** an MCP access token issued before the CLI extension is presented to `/mcp`
- **THEN** it still resolves with its original `write` behaviour and no re-connection is needed
