# Change: Add the apps/api backend Worker

## Why

The CV, invoice and portfolio apps (and the jobs tracker, which has no UI and
is used through MCP) moved out of the `bahrul` monorepo. Their backend — cloud
save, public document reads, PDF print links, email sign-in, personal tokens,
OAuth for MCP clients and the MCP server itself — stayed behind in the old
`bahrul-mcp` Worker on `mcp.bahrul.me`, which is being turned into an
owner-only admin backend. The apps already point at `api.pilihpendidikan.com`;
this change provides it.

Decided upstream in the bahrul change `refactor-admin-redesign-extract-tools`
(design D8 and its migration plan).

## What Changes

- New Worker `apps/api` (`api-pilihpendidikan`, custom domain
  `api.pilihpendidikan.com`, `wrangler dev` on port 8788), registered in the
  workspace with `dev`, `build`, `typecheck`, `test`, `lint`, `deploy`,
  `cf-typegen` and `db:migrate:local` scripts.
- Own storage: D1 `pilihpendidikan` (`mcp_tokens` with `kind` personal |
  session and `scope` write | read, `oauth_clients`, `request_log`) with its
  own `migrations/`; new KV `AUTH_KV`, `CV_KV`, `RATE_LIMIT_KV`; the existing
  `INVOICE_KV`, `PORTFOLIO_KV` and `JOBS_KV` namespaces are rebound by id.
- Document API ported with the same paths, shapes and ownership keys:
  `/api/{cv,invoice,portfolio}` (owner-scoped list, public GET + `.json`,
  owner PUT / DELETE), `/api/jobs`, `/api/whoami`, and
  `/{cv,invoice,portfolio}/<slug>.pdf` 302s to each app's print view.
- Auth: email sign-in links (`/auth/request`, `/auth/verify`, `/auth/exchange`,
  `/auth/logout`, `/auth/me`), browser sessions in an HttpOnly cookie,
  personal tokens (`/auth/tokens`), and OAuth 2.1 with PKCE
  (`/.well-known/*`, `/oauth/register|authorize|magic|token`) for MCP clients.
- `/connect`: a small server-rendered page to sign in and mint, copy and
  revoke tokens (replaces "generate a token at mcp.bahrul.me").
- MCP server (`/mcp` Streamable HTTP, `/sse` legacy) on a `PilihMcpServer`
  Durable Object with all `cv_*`, `invoice_*`, `portfolio_*` and `jobs_*`
  tools, the 48 legacy aliases and the ownership guard. Read-scoped tokens
  get only read-only tools; sessions are bound to the account that opened them.
- Gated data scripts: `scripts/migrate-cv-kv.ts` and
  `scripts/migrate-tokens.ts` (dry run unless `--execute`).
- `DEPLOY.md` with the ordered provisioning and migration plan.

## Impact

- Affected specs: `api-backend` (new capability)
- Affected code: `apps/api/**`, root `package.json` / `bun.lock`, root docs
- Not done here (needs the owner): creating Cloudflare resources, filling the
  `REPLACE_WITH_…` ids, onboarding the email domain, running the scripts with
  `--execute`, deploying.
