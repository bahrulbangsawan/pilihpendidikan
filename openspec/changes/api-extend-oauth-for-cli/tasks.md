## 1. Identity schema and client

- [x] 1.1 `DB` migration `apps/api/migrations/0002_users_devices_oauth.sql` (grants, refresh tokens, devices, `mcp_tokens` with `kind`, `scopes`, `grant_id`, `device_id`, `user_id`; flags seeded dark) and `0003_seed_cli_client.sql` (`pilih-jobs-cli`, `first_party`, `loopback_any_port`, scope ceiling; DCR clients get `mcp`)
- [x] 1.2 DCR refuses `pilih-` client ids (`apps/api/src/oauth/register.ts`)

## 2. Authorization

- [x] 2.1 RFC 8252 any-port loopback `redirectMatches` (`apps/api/src/oauth/shared.ts`); T17-01 in `apps/api/src/oauth/authorize.test.ts`
- [x] 2.2 Parameter validation shared by every consent step, required `state` ≥ 22, scope intersection, CLI base set, `JOBS_CLI_LOGIN_ENABLED` gate (`apps/api/src/oauth/params.ts`); T17-01
- [x] 2.3 Session-aware approve page and `POST /oauth/authorize/decision` with HMAC CSRF (10 min), Deny/Approve redirects, device-less grant + 300 s code (`apps/api/src/oauth/{authorize,consent,pending,magic}.ts`, `apps/api/src/routes/oauth.ts`, `apps/api/src/html.ts`); T17-02 in `apps/api/src/oauth/consent.test.ts`

## 3. Tokens

- [x] 3.1 1 h CLI access tokens, refresh token only with `offline_access`, `no-store` (`apps/api/src/oauth/{token,grants}.ts`); `apps/api/src/oauth/token.test.ts`
- [x] 3.2 Refresh rotation, 60 s encrypted grace re-issue, reuse → family revocation + device lease effects, idle/absolute expiry, scope narrowing, `refresh-grant` 10/min (`apps/api/src/oauth/refresh.ts`); S-05 and T17 refresh cases in `apps/api/src/oauth/refresh.test.ts`
- [x] 3.3 `POST /oauth/revoke` (RFC 7009) incl. `forget_device` (`apps/api/src/oauth/revoke.ts`); `apps/api/src/oauth/revoke.test.ts`
- [x] 3.4 Scopes on the caller and the 05 §1.2 legacy mapping (`apps/api/src/auth.ts`, `apps/api/src/jobs/core/scopes.ts`); T17-07 in `apps/api/src/oauth/metadata.test.ts`
- [x] 3.5 RFC 8414 / 9728 metadata updated (`apps/api/src/oauth/discovery.ts`); T17-08 snapshot

## 4. Devices

- [x] 4.1 `POST/GET /api/v1/devices`, `PATCH`, `/revoke`, `/heartbeat` (`apps/api/src/jobs/routes/devices/index.ts`, `services/devices/*`, `repo/devices/{identity,effects}.ts`); TDEV-REGISTER, TDEV-PRESENCE, TDEV-PATCH, TDEV-REVOKE, TDEV-HEARTBEAT in `routes/devices/devices.test.ts`
- [x] 4.2 `device_hint` rebinding and the full login → register → revoke flow (`apps/api/src/oauth/devices-flow.test.ts`)
- [x] 4.3 Existing MCP OAuth clients unchanged (`apps/api/src/oauth/mcp-compat.test.ts`, TOAUTH-MCP-COMPAT)

## 5. Verification

- [x] 5.1 leaf-2.2 gates G1–G5 verified (`.unlazy/jobs/status.log`: "leaf-2.2 VERIFIED"): identity suite with T17-01…T17-08, T11-TOKEN, S-05, TDEV-*, TOAUTH-MCP-COMPAT; route scopes for 05 §3; tsc and Biome on owned paths
- [x] 5.2 Cross-user isolation and scope sweep over every device route (S-31 in `apps/api/src/jobs/isolation-sweep.test.ts`, leaf-2.11 VERIFIED)
- [x] 5.3 Handoff recorded (NOT executed — leaf-5.1 / owner): the full-stack scenarios S-04 (real browser consent through `pilih-jobs login`), S-17 (revoke from the web mid-run) and T17-14/T17-15 need the `e2e/` suite, which does not exist in the repository yet; T17-16 (SSH-forwarded login on Linux) is manual

## 6. Owner actions

- [x] 6.1 Handoff recorded (NOT executed — owner action): apply `DB` migrations 0002/0003 to the remote `pilihpendidikan` database
- [x] 6.2 Handoff recorded (NOT executed — owner action): deploy `apps/api` and flip `JOBS_CLI_LOGIN_ENABLED` in the remote `DB.feature_flags` after smoke tests
- [x] 6.3 Handoff recorded (NOT executed — owner action): release gate G3, an external security review of the OAuth diff before the public CLI release (13 §8)
