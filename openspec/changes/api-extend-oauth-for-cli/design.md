## Context

`apps/api` already runs a hand-rolled OAuth 2.1 authorization server for MCP
clients (authorization code + PKCE S256, DCR, RFC 8414 / 9728 metadata,
email-link consent, 90-day opaque access tokens in D1 `mcp_tokens`). The CLI
needs refresh, revocation, scopes, loopback redirects on any port, device
binding and a consent step that reuses the browser session (17 §2).

## Goals / Non-Goals

- Goals: CLI login per 17 §10.1; least-privilege scopes with step-up;
  rotation with reuse detection; per-device revocation that also stops
  automation (21 §10); existing MCP clients unchanged.
- Non-Goals: RFC 8628 device grant and DPoP (deferred to M8, 17 §10.2,
  §11); OIDC (`GET /api/v1/me` returns identity); migrating to
  `@cloudflare/workers-oauth-provider`.

## Decisions

- **D-09 — extend, do not replace.** Tokens stay opaque SHA-256-hashed rows
  in `mcp_tokens`; `/connect` keeps listing them; MCP tokens issued before
  the change keep resolving (`oauth/mcp-compat.test.ts`, TOAUTH-MCP-COMPAT).
- **First-party flags only by migration.** `first_party`, `allowed_scopes`
  and `loopback_any_port` are columns set by `0003_seed_cli_client.sql`;
  DCR clients get `allowed_scopes = 'mcp'` (legacy `write` behaviour).
- **Grace re-issue (D-30).** The child refresh token is kept AES-GCM
  encrypted in KV `oauth:rft-grace:<sha256(parent)>` for 60 s with a key
  derived from the parent token, so only the holder of the parent can
  re-obtain it; any later presentation is reuse and revokes the family.
- **CSRF for the decision POST.** `"<issued_at>.<HMAC-SHA256>"` over the
  session hash and the authorize-parameter hash, valid 10 min, plus the
  existing same-origin check.
- **Devices (D-10).** `devices` lives in `DB` (identity) while lease effects
  live in `JOBS_DB`; revocation runs the `DB` batch first (credentials die
  immediately) and then `applyDeviceRevocationEffects` in `JOBS_DB`
  (`repo/devices/identity.ts`, `repo/devices/effects.ts`). Presence writes
  are throttled to one per 5 min; `online` = seen ≤ 6 min, `active` = a
  lease heartbeat ≤ 90 s (`core/device.ts`).
- **Kill switch (D-33).** `JOBS_CLI_LOGIN_ENABLED` in `DB.feature_flags`
  blocks first-party authorize requests with an error page; it is seeded
  dark by migration `0002`.

## Risks / Trade-offs

- Self-implemented security logic → mitigated by the 17 §15 server test plan
  (T17-01…T17-08, S-05, T11-TOKEN, TDEV-*) and release gate G3 (external
  review of the OAuth diff), which is an owner action not yet performed.
- Two databases in one revocation → credentials are revoked first; a failure
  of the `JOBS_DB` half leaves leases to the 5-minute reaper (21 §7), never a
  live credential.
- KV rate limiter is a non-atomic fixed window (05 §1.9) → acceptable for
  abuse damping.

## Migration Plan

1. Apply `DB` migrations `0002_users_devices_oauth.sql` and
   `0003_seed_cli_client.sql` locally (done for tests through `test/fakes.ts`
   with real SQLite) and later remotely — owner action, not executed.
2. Deploy `apps/api` — owner action, not executed.
3. Flip `JOBS_CLI_LOGIN_ENABLED` after smoke tests — owner action.
Rollback: turn the flag off; issued CLI grants can be revoked with
`/oauth/revoke` or device revocation; MCP clients are unaffected.

## Open Questions

- G3: external review of the OAuth diff before the public CLI release
  (13 §8) — owner.
- When to adopt RFC 8628 / DPoP (M8 triggers in 13 §2).
