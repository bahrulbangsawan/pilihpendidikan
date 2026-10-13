## ADDED Requirements

### Requirement: Stable user ids
The api Worker SHALL keep a `users` table in `DB` whose `id` (`usr_<ULID>`)
is the canonical, immutable user id and whose unique normalized `email`
remains the login key, and SHALL create the row lazily and idempotently the
first time an email authenticates, with no backfill job. (Source: 03 §2;
04 §1; D-03)

#### Scenario: First sign-in
- **WHEN** a person whose email has no `users` row presents a valid credential
- **THEN** exactly one `users` row is created for the normalized email and the caller carries its `usr_` id

#### Scenario: Concurrent first requests
- **WHEN** two requests for the same new email resolve at the same time
- **THEN** both callers get the same `usr_` id and one row exists

#### Scenario: Existing token
- **WHEN** a token row minted before this change is used
- **THEN** it keeps working and its `mcp_tokens.user_id` is filled in

### Requirement: Extended caller identity
Caller resolution SHALL return, besides the legacy `email`, `isAdmin` and
`scope`, the `userId`, the OAuth `scopes`, the `credentialKind`
(`browser_session`, `personal_write`, `personal_read`, `oauth_mcp`,
`oauth_cli`), the `deviceId` and `grantId` of the token, its `tokenId` and
the user's `userDeletedAt` tombstone, and the Job Tracker API MUST refuse a
tombstoned user with `401 invalid_token` (`reason: revoked_token`).
(Source: 03 §2; 05 §1.1, §1.3; 11 §10)

#### Scenario: Browser session
- **WHEN** a browser-session bearer is resolved
- **THEN** `credentialKind` is `browser_session` and `deviceId` is null

#### Scenario: Deleted account
- **WHEN** a user whose `users.deleted_at` is set calls an `/api/v1` route with a still-stored token
- **THEN** the response is 401 with `reason: revoked_token`

### Requirement: Credential scope map
The api Worker SHALL derive OAuth scopes from the credential: browser
sessions get every scope except `automation:execute`; `write` personal tokens
and MCP OAuth tokens get every scope except `automation:execute`,
`ai:invoke` and `automation:manage`; `read` personal tokens get exactly
`jobs:read cv:read files:read`; OAuth `oauth`-kind tokens get exactly their
stored scopes, with the `mcp` ceiling expanding to the MCP set. Existing
`write`/`read` behaviour of the document routes MUST NOT change.
(Source: 05 §1.2; 17 §5)

#### Scenario: Personal token cannot spend AI
- **WHEN** a `write` personal token calls a route that requires `ai:invoke`
- **THEN** the response is 403 `insufficient_scope` naming `ai:invoke`

#### Scenario: Read token
- **WHEN** a `read` personal token is resolved
- **THEN** its scopes are `jobs:read cv:read files:read`

### Requirement: Token kinds and identity tables
The `DB` migration `0002_users_devices_oauth.sql` SHALL add `users`,
`oauth_grants`, `oauth_refresh_tokens` and `devices`, extend `oauth_clients`
with `first_party`, `allowed_scopes` and `loopback_any_port`, and rebuild
`mcp_tokens` with `user_id`, `scopes`, `grant_id`, `device_id` and
`kind ∈ ('personal','session','oauth')` while keeping every existing row and
storing only SHA-256 hashes of credentials. Migration `0003` SHALL register
the first-party public client `pilih-jobs-cli` and give every earlier DCR
client the `mcp` scope ceiling. (Source: 04 §1; 17 §3.2)

#### Scenario: Migration on a populated database
- **WHEN** `0002` and `0003` are applied to a `DB` that holds personal tokens and DCR clients
- **THEN** every token still resolves with its former scope and every DCR client has `allowed_scopes = 'mcp'`

#### Scenario: CLI client row
- **WHEN** `0003` has been applied
- **THEN** `oauth_clients` holds `pilih-jobs-cli` with `first_party = 1`, `loopback_any_port = 1` and `token_endpoint_auth_method = 'none'`

### Requirement: Feature flags in the identity database
The api Worker SHALL read kill switches and rollout flags only from
`DB.feature_flags` through a 30-second isolate cache, with the canonical
keys `JOBS_V1_ENABLED`, `JOBS_CLI_LOGIN_ENABLED`, `JOBS_AUTOMATION_ENABLED`,
`JOBS_AUTO_MODE_ENABLED`, `JOBS_EMAIL_SERVER_SEND_ENABLED`, `AI_DISABLED`
and `JOBS_LEGACY_BACKEND`, seeded dark by the migration; only
`JOBS_MIN_CLI_VERSION` and `JOBS_RECOMMENDED_CLI_VERSION` are Worker vars.
(Source: 04 §1; 14 §3; D-33)

#### Scenario: Fresh deployment
- **WHEN** the migrations have just been applied
- **THEN** every boolean flag is `false`, `JOBS_LEGACY_BACKEND` is `"kv"`, and `/api/v1` routes other than `/meta` answer 404

#### Scenario: Flag flip without redeploy
- **WHEN** an operator sets `JOBS_V1_ENABLED` to `true` in `feature_flags`
- **THEN** the routes become reachable within the 30 s cache window without a deploy

#### Scenario: Local development
- **WHEN** `bun run db:seed:local` runs
- **THEN** only the local D1 is written (the script refuses `--remote`) with v1, CLI login and automation on and auto mode and server-sent email off

### Requirement: Logged break-glass support access
Admins SHALL have no bypass on Job Tracker data; support access to one
user's data MUST go through the `support-access` script, which requires a
ticket id, a reason and an operator, writes a `support_access_log` row
before reading, only issues `SELECT` statements against `JOBS_DB`, and does
nothing but print its plan without `--execute`. (Source: 11 §6.2; 04 §1;
D-26)

#### Scenario: Missing ticket
- **WHEN** the script runs without `--ticket`
- **THEN** it exits with an error and reads nothing

#### Scenario: Executed access
- **WHEN** it runs with `--execute`
- **THEN** a `sal_` row naming the operator, subject user, reason, ticket and scope exists before any `JOBS_DB` read, and a non-SELECT statement would throw before being sent
