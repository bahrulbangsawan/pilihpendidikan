# Tasks

## Implementation
- [x] Worker scaffold: `wrangler.jsonc` (D1, KV incl. rebound INVOICE/PORTFOLIO/JOBS ids, EMAIL, DO, cron), env types, CORS for the three app origins plus localhost in dev
- [x] D1 migration `0001_initial.sql` (`mcp_tokens`, `oauth_clients`, `request_log`)
- [x] Auth: email sign-in links, `/auth/exchange`, sessions, logout, `/auth/me`, personal tokens with scope, `/api/whoami`
- [x] OAuth discovery, dynamic registration, authorize + email approval, token with PKCE
- [x] `/connect` page
- [x] `/api/{cv,invoice,portfolio,jobs}` CRUD with ownership, public reads, PDF print redirects
- [x] MCP server (`/mcp`, `/sse`) with cv/invoice/portfolio/jobs tools, aliases, ownership guard, read-scope filter, session binding
- [x] Request logging to `request_log` + daily purge
- [x] Data scripts `scripts/migrate-cv-kv.ts` and `scripts/migrate-tokens.ts` (dry run unless `--execute`)

## Tests
- [x] Ported: auth, jobs tools, jobs REST + cross-surface parity, portfolio tools, invoice totals
- [x] `src/api-smoke.test.ts` (routes, CORS, ownership, PDF, sign-in, /connect, tokens, OAuth, MCP auth)
- [x] `src/tool-surface.test.ts` (tool families, aliases, read scope, real SDK round trip)
- [x] `scripts/*.test.ts` (dry run writes nothing; execute copies and verifies)

## Docs
- [x] Root README / CLAUDE.md / AGENTS.md, `apps/api/CLAUDE.md`, `DEPLOY.md`

## Deploy (owner, not done)
- [ ] Create D1 / KV, fill ids, onboard the email domain
- [ ] Apply D1 migrations remotely, deploy `apps/api`
- [ ] Run both scripts dry, then with `--execute`
- [ ] Deploy cv / invoice / portfolio
