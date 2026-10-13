## ADDED Requirements

### Requirement: First-party CLI client
The authorization server SHALL know a pre-registered public client
`pilih-jobs-cli` (`token_endpoint_auth_method = none`, no secret, redirect
URIs `http://127.0.0.1/callback` and `http://[::1]/callback`, `first_party`,
`loopback_any_port`, and the 05 §1.2 scope ceiling) created only by a `DB`
migration, and dynamic client registration MUST refuse any client id that
starts with `pilih-` and MUST give registered clients the `mcp` ceiling.
(Source: 17 §3.2; D-09)

#### Scenario: Seeded client
- **WHEN** the `DB` migrations are applied
- **THEN** `oauth_clients` holds `pilih-jobs-cli` with `first_party = 1` and `loopback_any_port = 1`

#### Scenario: Impersonating the first-party client
- **WHEN** a DCR request names a client id starting with `pilih-`
- **THEN** registration is refused and no client row is written

### Requirement: Any-port loopback redirects
The authorize and token endpoints SHALL accept, for a client flagged
`loopback_any_port`, a redirect URI on `http://127.0.0.1` or `http://[::1]`
with any port whose path equals a registered loopback URI exactly, and MUST
reject `localhost`, a different path, a query string, a fragment or userinfo;
other clients keep exact matching, and at the token endpoint the
`redirect_uri` MUST equal the one stored with the code. (Source: 17 §4.2;
RFC 8252 §7.3, §8.3)

#### Scenario: CLI ephemeral port
- **WHEN** `pilih-jobs-cli` authorizes with `redirect_uri=http://127.0.0.1:53127/callback`
- **THEN** the request is accepted

#### Scenario: DCR client on another port
- **WHEN** a DCR client registered with `http://127.0.0.1:3000/cb` uses port 3001
- **THEN** an error page is shown and the browser is not redirected

#### Scenario: localhost host
- **WHEN** the CLI client sends `http://localhost:53127/callback`
- **THEN** the request is rejected without a redirect

### Requirement: Authorization request rules for first-party clients
For a first-party client the authorize endpoint SHALL require `state` of at
least 22 characters, PKCE `S256` (plain rejected), and SHALL grant the
requested scopes intersected with the client ceiling (unknown scopes dropped,
no `scope` parameter meaning the CLI base set `jobs:read jobs:write
discovery:write automation:execute cv:read files:read files:write ai:invoke
offline_access`), refusing a request that leaves no grantable scope; the
whole flow MUST be refused while the `JOBS_CLI_LOGIN_ENABLED` flag is off.
`device_name` (≤ 60 characters, escaped) is display-only. (Source: 17 §4.1,
§5.1; D-29; D-33)

#### Scenario: Missing state
- **WHEN** `pilih-jobs-cli` authorizes without `state`
- **THEN** an error page is shown and no code is issued

#### Scenario: Scope clipping
- **WHEN** the CLI requests `jobs:read admin:all automation:manage` and the ceiling allows `jobs:read` and `automation:manage`
- **THEN** the grant carries `jobs:read automation:manage` only

#### Scenario: Login flag dark
- **WHEN** `JOBS_CLI_LOGIN_ENABLED` is off
- **THEN** a first-party authorize request renders "CLI sign-in is not available yet." with status 403

### Requirement: Session-aware consent
`GET /oauth/authorize` SHALL render an approve page (client name, device
name, human-readable scopes, the signed-in email, "Not you? Sign out",
Approve / Deny) when the request carries a valid browser session and the
client is first-party, and the email-link form otherwise; after an emailed
link for a first-party client the same approve page MUST be shown before any
code is issued. The page MUST forbid framing (`frame-ancestors 'none'`,
`X-Frame-Options: DENY`) and escape every value. (Source: 17 §4.3, §13)

#### Scenario: Signed-in user
- **WHEN** a browser with a valid `__Host-session` opens the CLI authorize URL
- **THEN** the approve page renders and no email is sent

#### Scenario: Third-party client with a session
- **WHEN** a DCR client is authorized from a browser that has a session
- **THEN** the existing email form renders

#### Scenario: Magic link never issues a first-party code directly
- **WHEN** the emailed link of a first-party flow is confirmed
- **THEN** the approve page is shown and no code is issued until the decision POST

### Requirement: Consent decision endpoint
`POST /oauth/authorize/decision` SHALL require a same-origin POST and a CSRF
token equal to an HMAC over the session hash and the authorize parameters,
valid for 10 minutes, SHALL re-validate every parameter, and SHALL on Deny
redirect 303 to `redirect_uri?error=access_denied&state=…&iss=…` and on
Approve create a device-less `oauth_grants` row with the granted scopes and a
single-use code valid 300 s, redirecting 303 with `code`, `state` and `iss`.
(Source: 17 §4.3)

#### Scenario: Missing or foreign CSRF token
- **WHEN** the decision POST has no CSRF token, or one bound to other parameters or another session, or one older than 10 minutes
- **THEN** the response is 403 and no grant is created

#### Scenario: Cross-origin POST
- **WHEN** the decision POST carries a foreign `Origin`
- **THEN** the response is 403

#### Scenario: Approve
- **WHEN** the user approves
- **THEN** a grant with `device_id` NULL exists and the browser is redirected to the loopback URI with a code bound to that grant

### Requirement: CLI access and refresh tokens
For `pilih-jobs-cli` the token endpoint SHALL return an opaque access token
valid 3600 s (`mcp_tokens` kind `oauth` with `scopes`, `grant_id`,
`user_id`), the granted `scope`, `Cache-Control: no-store`, and a refresh
token only when `offline_access` was granted; refresh tokens MUST expire after
30 days idle and 90 days from grant creation, and only SHA-256 hashes of
either token are stored. A single-use code, a wrong verifier or a mismatched
`redirect_uri` MUST yield `invalid_grant`. (Source: 17 §7.1, §7.2)

#### Scenario: Code exchange
- **WHEN** the CLI exchanges a valid code with the right verifier and `offline_access` was granted
- **THEN** the response has `expires_in: 3600`, a `refresh_token` and the granted `scope`

#### Scenario: Code reuse
- **WHEN** the same code is exchanged twice
- **THEN** the second exchange is `invalid_grant`

### Requirement: Refresh rotation with reuse detection
`grant_type=refresh_token` SHALL rotate on every use (mark the presented token
used, insert a child, issue a new access token, one batch), MAY narrow the
access-token scope to a subset, and SHALL re-issue the same child within 60 s
while that child is unused; any later presentation of a used token MUST
revoke the whole grant (grant, every refresh row, every access token,
`revoked_reason = 'refresh_reuse'`), fail the bound device's leases as for
device revocation, and answer `invalid_grant`. Refreshes are rate limited to
10 per minute per grant (`refresh-grant`) in addition to the `exchange` rule.
(Source: 17 §7.2, §7.3; D-30)

#### Scenario: Normal rotation
- **WHEN** an unused refresh token is presented
- **THEN** a new access token and a new refresh token are returned and the old one is marked used

#### Scenario: Crash before persisting
- **WHEN** the parent is presented again within 60 s and its child was never used
- **THEN** the same child refresh token and a new access token are returned

#### Scenario: Replay after rotation
- **WHEN** the parent is presented after the child was used
- **THEN** the response is `invalid_grant` and every token of the grant is revoked

### Requirement: Token revocation endpoint
`POST /oauth/revoke` SHALL implement RFC 7009: revoking a refresh token
revokes its whole grant, revoking an access token revokes only that row,
`forget_device=true` also revokes the device bound to the grant (with the
lease effects of 21 §10), and the answer MUST be 200 for unknown, expired,
already-revoked tokens and for a `client_id` that does not own the token (in
which case nothing is revoked). It is rate limited by the `exchange` rule.
(Source: 17 §8)

#### Scenario: Unknown token
- **WHEN** an unknown token is revoked
- **THEN** the response is 200

#### Scenario: Logout
- **WHEN** the CLI revokes its refresh token
- **THEN** the grant, its refresh family and its access tokens are revoked and the device stays registered unless `forget_device=true` was sent

### Requirement: Scope enforcement and credential mapping
Every `/api/v1` route SHALL declare a scope that the router checks before the
handler, answering `403 insufficient_scope` with `scope` and a
`WWW-Authenticate` header; legacy credentials MUST map as 05 §1.2 says
(browser session: all but `automation:execute`; write personal token and MCP
OAuth: all but `automation:execute`, `ai:invoke`, `automation:manage`; read
personal token: `jobs:read cv:read files:read`). (Source: 17 §5.2; 05 §1.2)

#### Scenario: Personal token and automation
- **WHEN** a write personal token calls an `automation:execute` or `ai:invoke` route
- **THEN** the response is 403 `insufficient_scope`

#### Scenario: Route without a scope
- **WHEN** a route is added to the route table without a declared scope
- **THEN** the route-table test fails

### Requirement: Device registration
`POST /api/v1/devices` SHALL accept only an access token of a
`pilih-jobs-cli` grant with `offline_access` and no device yet, insert a
`devices` row from `{name, platform, arch, cli_version, capabilities[],
public_key?}`, and bind the grant and every live access token of it to the
device in one batch, answering 201; a second registration on the same grant
MUST be `409 duplicate`, and `automation:execute` stays inert (`403
device_required`) until a device is bound. A login carrying `device_hint` for
an unrevoked device of the same user SHALL rebind that device to the new
grant and revoke the old grant's family. (Source: 17 §6; 05 §3; D-10)

#### Scenario: First registration
- **WHEN** a fresh CLI grant registers its device
- **THEN** the response is 201 with the device and the grant's `device_id` is set

#### Scenario: Second registration
- **WHEN** the same grant registers again
- **THEN** the response is 409 `duplicate`

#### Scenario: Re-login on the same machine
- **WHEN** the CLI logs in again with `device_hint=<its dev_id>`
- **THEN** the new grant is bound to the same device and the previous grant is revoked

### Requirement: Device list, rename and task toggle
`GET /api/v1/devices` (`devices:manage`) SHALL list only the caller's devices,
newest first with keyset pagination, hiding revoked ones unless asked, with
`online` (last seen ≤ 6 min) and `active` (a lease with an attempt heartbeat
≤ 90 s); presence MUST be written at most once per 5 minutes per device.
`PATCH /api/v1/devices/{dev_id}` SHALL rename or toggle `accepts_tasks` with
`base_revision`, where `automation:execute` may only toggle `accepts_tasks`
of the caller's own device. (Source: 05 §3; 04 §1)

#### Scenario: Another user's device
- **WHEN** a user patches a device id they do not own
- **THEN** the response is 404

#### Scenario: Worker disable
- **WHEN** the CLI's own device token sends `{accepts_tasks: false}`
- **THEN** the device stops accepting tasks and its revision increments

### Requirement: Device revocation
`POST /api/v1/devices/{dev_id}/revoke` (`devices:manage`) SHALL set
`devices.revoked_at`, revoke every grant of the device with
`revoked_reason = 'device_revoked'` together with its refresh rows and
access tokens, and then apply the 21 §10 lease effects (a lease past
`submit_intent` becomes `outcome_unknown`; otherwise the task is re-queued);
afterwards the device's own tokens MUST get `401 invalid_token` with
`reason: revoked_token`, while other credentials addressing the revoked
device get `403 device_revoked`. (Source: 17 §9; 21 §10; 05 §1.3)

#### Scenario: Revoke from the web mid-run
- **WHEN** the web revokes a device that holds a lease before `submit_intent`
- **THEN** the CLI's next call is 401 `revoked_token` and the task is back to `queued`

#### Scenario: Lease past submit intent
- **WHEN** the revoked device held a lease after `submit_intent`
- **THEN** the task and the application's submission become `outcome_unknown`

### Requirement: Device heartbeat
`POST /api/v1/devices/{dev_id}/heartbeat` SHALL be accepted only for the
caller's own device with `automation:execute`, record the CLI version,
capabilities and the device report, and answer `{server_time,
poll_interval_ms, cancel_lease_ids[], min_cli_version}` where
`cancel_lease_ids` lists lost, cancelled and paused-all leases and the poll
interval follows 21 §1.1 (5 s hot, 30 s idle, 60 s cold). (Source: 05 §3;
21 §1.1)

#### Scenario: Other device
- **WHEN** a CLI token sends a heartbeat for a device it is not bound to
- **THEN** the request is refused and nothing is recorded

### Requirement: Authorization server metadata
The RFC 8414 metadata SHALL advertise `grant_types_supported`
`["authorization_code", "refresh_token"]`, `code_challenge_methods_supported`
`["S256"]`, `revocation_endpoint` `/oauth/revoke` with its auth methods,
`authorization_response_iss_parameter_supported: true` and every 05 §1.2
scope plus `mcp`, and the RFC 9728 protected-resource metadata MUST list the
same scopes. (Source: 17 §13)

#### Scenario: Metadata snapshot
- **WHEN** `/.well-known/oauth-authorization-server` is fetched
- **THEN** every advertised endpoint and grant type is served by the Worker
