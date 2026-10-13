# Change: Extend the api's OAuth server for the pilih-jobs CLI

## Why

The `pilih-jobs` CLI (`jobs-add-cli`) must sign in as the same user as
`apps/jobs`, hold a credential bound to one installation, and lose it the
moment that installation is revoked. The hand-rolled OAuth 2.1 server in
`apps/api` only served MCP clients: no refresh tokens, no RFC 7009
revocation, `scope` ignored, exact redirect matching (no RFC 8252 any-port
loopback), no device binding and no use of an existing browser session
(job-tracker-spec 17 §2). D-09 extends that server instead of replacing it,
so existing MCP connections keep working.

## What Changes

- Pre-registered first-party public client `pilih-jobs-cli`
  (`token_endpoint_auth_method = none`, `first_party = 1`,
  `loopback_any_port = 1`, scope ceiling of 05 §1.2) seeded by `DB` migration
  `0003_seed_cli_client.sql`; DCR refuses any `pilih-` client id and keeps
  third-party clients at the `mcp` ceiling.
- RFC 8252 any-port loopback matching on `127.0.0.1` / `[::1]` (never
  `localhost`), exact path, no query/fragment/userinfo; `state` required
  (≥ 22 chars) for first-party clients; PKCE S256 stays mandatory.
- Session-aware consent: a valid `__Host-session` shows an approve page for
  first-party clients; `POST /oauth/authorize/decision` (same-origin + HMAC
  CSRF token, 10 min) creates a device-less `oauth_grants` row and a 300 s
  code. The email-link consent stays the fallback and for DCR clients.
- Scopes: requested ∩ client ceiling, unknown scopes dropped, CLI base set by
  default, `automation:manage` / `devices:manage` only by step-up (D-29).
- Tokens: 1 h CLI access tokens; refresh tokens (idle 30 d, absolute 90 d)
  rotated on every use with the 60 s grace re-issue and family revocation on
  reuse (D-30), plus the `refresh-grant` rate limit (10/min per grant).
- `POST /oauth/revoke` (RFC 7009) with the non-standard `forget_device=true`.
- Devices (D-10): `POST/GET /api/v1/devices`, `PATCH`, `/revoke` and
  `/heartbeat` (05 §3) with throttled presence and the 21 §10 lease effects;
  `device_hint` re-login rebinding.
- Metadata (RFC 8414 / RFC 9728) advertises `refresh_token`, the revocation
  endpoint and every scope; `JOBS_CLI_LOGIN_ENABLED` (D-33) gates CLI login.

Implemented in the working tree (uncommitted); nothing deployed, no remote
migration applied.

## Impact

- Affected specs: `api-auth` (new capability: the CLI login, token and
  device rules), `api-backend` (MODIFIED: "OAuth for MCP clients" — MCP
  clients unchanged, server now also serves the first-party client).
- Affected code: `apps/api/src/oauth/*` (`authorize`, `params`, `pending`,
  `consent`, `grants`, `token`, `refresh`, `revoke`, `register`, `magic`,
  `discovery`, `shared`), `apps/api/src/routes/oauth.ts`,
  `apps/api/src/html.ts`, `apps/api/src/auth.ts` (scopes, device, grant on
  the caller), `apps/api/src/jobs/{routes,services,repo}/devices/**`,
  `apps/api/src/jobs/core/{scopes,device}.ts`,
  `apps/api/migrations/0002_users_devices_oauth.sql`,
  `apps/api/migrations/0003_seed_cli_client.sql`.
- Sources: job-tracker-spec 17 (all sections), 05 §1.2, §1.3, §3, 21 §10,
  04 §1, 14 §3; decisions D-09, D-10, D-29, D-30, D-33; release gate G3
  (13 §8).
- Depends on `api-add-user-ids-and-jobs-db` (users, grants, refresh and
  device tables in `DB`).
