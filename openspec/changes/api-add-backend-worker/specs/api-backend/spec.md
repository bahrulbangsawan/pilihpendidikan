## ADDED Requirements

### Requirement: Document storage and ownership
The api Worker SHALL store CV, invoice, portfolio and job documents under the
same keys the old backend used and SHALL let only the owner (or an
`ADMIN_EMAILS` admin) change or delete a document.

#### Scenario: Owner saves a CV
- **WHEN** the owner sends `PUT /api/cv/<id>` with a write-scoped token and a valid CV body
- **THEN** the response is 200 `{ok: true, id, data}` and `cv:<id>` holds the new document

#### Scenario: Someone else tries to save it
- **WHEN** another signed-in user sends the same `PUT`
- **THEN** the response is 403 and the document is unchanged

#### Scenario: No credential
- **WHEN** a `PUT`, `DELETE` or list request carries no valid token
- **THEN** the response is 401 with a `WWW-Authenticate: Bearer` header

#### Scenario: Read-only token
- **WHEN** a read-scoped token sends a write
- **THEN** the response is 403 `{"error": "insufficient_scope"}`

#### Scenario: Public read
- **WHEN** anyone requests `GET /api/cv/<id>` (or `.json`) for an existing document
- **THEN** the document JSON is returned with `Cache-Control: no-store`

### Requirement: PDF print redirects
The api Worker SHALL redirect `/{cv,invoice,portfolio}/<slug>.pdf` to the
matching app's print view with the query parameter that app reads.

#### Scenario: CV print link
- **WHEN** `GET /cv/<slug>.pdf` is requested for an existing CV in production
- **THEN** the response is 302 to `https://cv.pilihpendidikan.com/?cv=<slug>&print=1`

#### Scenario: Local development
- **WHEN** the same request reaches `wrangler dev`
- **THEN** the redirect targets `http://localhost:4003` (4004 invoice, 4005 portfolio)

#### Scenario: Missing document
- **WHEN** the slug does not exist
- **THEN** the response is 404

### Requirement: Email sign-in and personal tokens
The api Worker SHALL sign people in with single-use email links and let a
signed-in person mint, list, revoke and delete personal tokens with a
`write` or `read` scope, storing only SHA-256 hashes of every credential.

#### Scenario: Sign in from /connect
- **WHEN** a person submits their email at `/connect` and confirms the emailed link
- **THEN** an HttpOnly `__Host-session` cookie is set and `/connect` shows their tokens

#### Scenario: Link reuse
- **WHEN** a confirmed link is submitted again
- **THEN** the response is 410 and no session is created

#### Scenario: Minting a token
- **WHEN** a signed-in person creates a token at `/connect`
- **THEN** the token is shown once with a Copy button and `GET /api/whoami` with it reports their email and scope

#### Scenario: Cross-site form post
- **WHEN** a POST to `/connect` arrives without a same-origin `Origin`
- **THEN** the response is 403 and nothing changes

### Requirement: OAuth for MCP clients
The api Worker SHALL implement OAuth 2.1 authorization code with PKCE S256,
dynamic client registration and RFC 8414 / RFC 9728 discovery.

#### Scenario: Client connects
- **WHEN** a registered client completes authorize → email approval → token with the right verifier
- **THEN** it receives a Bearer access token valid for 90 days

#### Scenario: Wrong verifier or reused code
- **WHEN** the token request carries a wrong `code_verifier` or a code that was already used
- **THEN** the response is `invalid_grant`

#### Scenario: Unsafe redirect URI
- **WHEN** a client registers a plain-http redirect URI that is not loopback
- **THEN** registration is refused with `invalid_redirect_uri`

### Requirement: MCP server
The api Worker SHALL serve MCP at `/mcp` and `/sse` to any signed-in caller
with every `cv_*`, `invoice_*`, `portfolio_*` and `jobs_*` tool and the
legacy aliases, scoped to the caller's own documents.

#### Scenario: Tool list
- **WHEN** a write-scoped caller lists tools
- **THEN** 82 tools are listed and no legacy alias name appears

#### Scenario: Legacy name
- **WHEN** a client calls `get_cv`
- **THEN** it runs `cv_get`

#### Scenario: Read-only token
- **WHEN** a read-scoped caller lists tools
- **THEN** only the 16 read-only tools are listed

#### Scenario: Unauthenticated
- **WHEN** `/mcp` is called without a credential
- **THEN** the response is 401 with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`

#### Scenario: Session replay with another account
- **WHEN** a live session id is presented with a different account's token
- **THEN** the request is refused with 404 "Session not found"

### Requirement: CORS
The api Worker SHALL allow credentialed cross-origin requests only from the
three app origins, and from their localhost ports only while it runs locally.

#### Scenario: App preflight
- **WHEN** `https://cv.pilihpendidikan.com` sends a preflight
- **THEN** the response echoes that origin with `Access-Control-Allow-Credentials: true`

#### Scenario: Foreign origin
- **WHEN** any other origin sends a preflight to production
- **THEN** no `Access-Control-Allow-Origin` header is returned

### Requirement: Gated data migration
The data migration scripts SHALL only report what they would copy unless
`--execute` is passed, and SHALL never delete source data.

#### Scenario: Dry run
- **WHEN** `migrate-cv-kv.ts` or `migrate-tokens.ts` runs without `--execute`
- **THEN** it prints counts and writes nothing to source or destination
