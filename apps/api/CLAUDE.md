# apps/api — backend Worker

Cloudflare Worker `api-pilihpendidikan` on `api.pilihpendidikan.com`. It
stores the documents the three builder apps save, signs people in by email,
mints personal tokens, and serves an MCP server so AI apps can edit those
documents. No framework: a hand-written router over the Workers runtime.

Workspace-wide rules live in the root `CLAUDE.md`; provisioning and data
migration are in the root `DEPLOY.md`.

## Commands

- `bun run dev` — `wrangler dev` on **8788** (the apps call `http://localhost:8788` in dev)
- `bun run db:migrate:local` — apply `migrations/` to the local D1 (run once before `dev`)
- `bun run test` — `bun test` (fake KV, real SQLite for D1)
- `bun run typecheck` — `wrangler types` + `tsc` for `src/` and for tests/scripts
- `bun run build` — `wrangler types` + `wrangler deploy --dry-run` into `dist/`
- `bun run deploy` — `wrangler deploy` (owner approval required; see `DEPLOY.md`)

## Routes

| Path | What |
|---|---|
| `GET /api/whoami` | `{authenticated, email?, isAdmin?, scope?}` |
| `/api/{cv,invoice,portfolio}` | `GET` owner-scoped list (admins: `?mine=0` for all) |
| `/api/{cv,invoice,portfolio}/:id` | `GET` public JSON (`.json`, `?download`; cv/invoice `.pdf` → 301), `PUT` / `DELETE` owner + write scope |
| `/api/jobs`, `/api/jobs/:id` | jobs tracker; every method authenticated, not-owned = 404 |
| `GET /{cv,invoice,portfolio}/:slug.pdf` | 302 to the app print view (`?cv=` / `?invoice=` / `?id=` + `print=1`; localhost:4003/4004/4005 under `wrangler dev`) |
| `/auth/request`, `/auth/verify`, `/auth/exchange`, `/auth/logout`, `/auth/me` | email sign-in and browser sessions |
| `/auth/tokens`, `/auth/tokens/:id[/revoke]` | personal tokens (`scope: write | read`) |
| `/connect` | server-rendered page: sign in, mint/copy/revoke tokens |
| `/.well-known/oauth-*`, `/oauth/{register,authorize,magic,token}` | OAuth 2.1 + PKCE for MCP clients |
| `/mcp` (Streamable HTTP), `/sse` (legacy) | MCP server: `cv_*`, `invoice_*`, `portfolio_*`, `jobs_*` + 48 legacy aliases |

## Structure

- `src/index.ts` — entry: `PilihMcpServer` Durable Object + `createApp(...)`
- `src/app.ts` — router and dispatch order (testable without the DO)
- `src/auth.ts` — caller resolution, `mcp_tokens` access, hashing; `src/session.ts` cookies; `src/sign-in.ts` email links
- `src/routes/*` — route modules; `src/oauth/*` — OAuth endpoints; `src/documents/*` — REST handlers
- `src/mcp-tools.ts` — `registerAllTools()`: scope filter → request logger → ownership guard → tools (`src/tools/*`)
- `src/ownership.ts` — the single owner-stamp resolver (`owner:cv:`, `owner:inv:`, `owner:portfolio:`, `owner:job:`)
- `migrations/` — D1 schema (`mcp_tokens`, `oauth_clients`, `request_log`)
- `scripts/` — gated data migrations (dry run unless `--execute`)
- `test/fakes.ts` — fake bindings for `bun test`

## Rules

- Store secrets only as SHA-256 hashes; never log a bearer (hash prefix only).
- Every write route checks: authenticated (401) → write scope (403 `insufficient_scope`) → exists (404) → owner (403; jobs and MCP answer not-found).
- Credentialed CORS only for the three app origins; localhost app ports only while the Worker itself runs on localhost.
- HTML pages go through `htmlPage()` (strict CSP with nonce, no framing). Escape every interpolated value.
- Don't run the migration scripts with `--execute`, deploy, or touch remote resources without the owner's go-ahead.
- The MCP SDK packages are patched past GHSA-6qxp-vccf-f47h (`@modelcontextprotocol/sdk` 1.32.1, `client` / `server` 2.3.1). `agents` 0.26–0.28 pins the vulnerable versions as exact peers, so the root `package.json` `overrides` force the patched ones onto it (one copy in the tree). Verified with the test suite (`tool-surface.test.ts` drives the SDK client against every tool) and a local `wrangler dev` handshake on `/mcp` (initialize → tools/list → tools/call). Drop the three overrides once an `agents` release peers on patched versions. The same block pins `sharp` 0.35.5 (wrangler's miniflare still ships 0.35.4).
