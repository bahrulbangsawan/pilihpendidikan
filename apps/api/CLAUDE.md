# apps/api — backend Worker

Cloudflare Worker `api-pilihpendidikan` on `api.pilihpendidikan.com`. It
stores the documents the three builder apps save, signs people in by email,
mints personal tokens, serves an MCP server so AI apps can edit those
documents, and hosts the Job Tracker API under `/api/v1` (D-01,
`job-tracker-spec/`). No framework: a hand-written router over the Workers
runtime. The Job Tracker kernel and its rules are in `src/jobs/README.md`.

Workspace-wide rules live in the root `CLAUDE.md`; provisioning and data
migration are in the root `DEPLOY.md`.

## Commands

- `bun run dev` — `wrangler dev` on **8788** (the apps call `http://localhost:8788` in dev)
- `bun run db:migrate:local` — apply `migrations/` to the local `DB` (run once before `dev`)
- `bun run db:migrate:jobs:local` — apply `migrations-jobs/` to the local `JOBS_DB`
- `bun run db:seed:local` — turn the Job Tracker flags on in the local `DB.feature_flags` (`scripts/seed-local.ts`; `--flag KEY=value`, `--persist-to`, `--dry-run`; never remote)
- `bun run db:seed:demo -- --email you@example.com [--reset]` — fill the LOCAL stack with demo Job Tracker data for that user (`scripts/seed-demo.ts`, data in `scripts/seed-demo-data.ts`; see § Demo data)
- `bun run test` — `bun test` (fake KV / R2 / Queue, real SQLite for both D1s); inside Claude Code run `env -u CLAUDECODE bun test` to see passing lines
- `bun run typecheck` — `wrangler types` + `tsc` for `src/` and for tests/scripts
- `bun run build` — `wrangler types` + `wrangler deploy --dry-run` into `dist/`
- `bun run deploy` — `wrangler deploy` (owner approval required; see `DEPLOY.md`, § Job Tracker for the dark launch, remote migrations and flags)
- `OPENAI_API_KEY=… JOBS_AI_LIVE=1 bun test src/jobs/ai/openai.live.test.ts` — T7-11, the live Decisions contract test (A-01; skipped otherwise; nightly opt-in in `.github/workflows/nightly-live.yml`)
- `bun run scoring:eval` — rubric r1 over the synthetic golden set (07 §13; `--fake` dry run, `--write` → `docs/scoring-eval/<date>.md`, `--limit`, `--concurrency`, `--fixture`; live runs need `OPENAI_API_KEY`)
- `bun run analytics:rebuild --user <usr_id> [--execute]` — recompute one user's `analytics_daily` rows from the event log on the LOCAL `JOBS_DB` (10 §4; dry run by default)
- `bun scripts/migrate-jobs-kv-to-d1.ts` — legacy jobs `JOBS_KV` → `JOBS_DB` (06 §12.4): inventory, classify, plan (`migration-plan.jsonl`, `--out <dir>`), `--execute`, `--verify`; dry run unless `--execute`, owner go-ahead for remote
- `bun scripts/support-access.ts --email … --ticket … --reason … --operator … [--scope …] [--execute]` — break-glass, read-only support access to one user's Job Tracker data, logged in `support_access_log` (11 §6.2, D-26)
- `bun scripts/migrate-cv-kv.ts`, `bun scripts/migrate-tokens.ts` — the original cv / token data migrations (dry run unless `--execute`)

## Demo data

`bun run db:seed:demo -- --email you@example.com` (flags: `--reset`,
`--api-url` default `http://localhost:8788`, `--persist-to`) talks to a
RUNNING local api (`bun run dev`, after the migrations and
`db:seed:local`; it runs `db:seed:local` itself when `/api/v1` is dark) and
writes everything through the real routes, so stages, revisions, events and
invariants hold. It never touches a remote: `--remote` and non-localhost
URLs are refused.

- Auth: a random bearer stored as `auth:session:<sha256>` = `{email,
  createdAt}` in the local `AUTH_KV` (`wrangler kv key put --local`, the same
  record the e-mail sign-in writes), deleted again at the end. Signing in on
  the dashboard (:4007) with the same e-mail shows the data (same `users` row).
- The demo device `Demo laptop (seed)` signs in like `pilih-jobs login`
  (consent with that session, PKCE code exchange, `POST /api/v1/devices`,
  `device_hint` re-binds it on later runs) and sends one heartbeat.
- Seeds: settings (AI consent, Asia/Jakarta), 15 profile facts, 5 saved
  answers, a base CV in the CV builder store (MCP `cv_create` + `PUT
  /api/cv/:id`) with one tailored CV variant; 24 manual applications over
  every column (notes, 14 interviews past and upcoming, 2 offers, follow-ups,
  priorities); 4 sources and one discovery run per enabled source (15
  postings) with 2 tracked, 3 seen, 1 dismissed, all scored by the queue;
  4 apply tasks (2 claimed by the device that ask for a submit / answer
  approval and release the lease, 1 queued, 1 cancelled); 3 rules (created
  after scoring; the `auto` one stays off unless `JOBS_AUTO_MODE_ENABLED`).
- Re-running is idempotent for applications, sources, answers and postings
  (stable refs, `unchanged`); each run adds 3 discovery-run records, and the
  enabled `Backend roles in Jakarta` rule may then act on matching inbox
  postings (the real rule engine: `ready` cards with queued tasks).
- `--reset` first cancels live tasks, revokes the demo device, purges every
  application, deletes rules, answers, facts and non-demo sources. Inbox
  states cannot be reset through the API (no route returns a job to `new`, and
  a purged card leaves its job `dismissed`), so seeded postings keep their
  state; the seed tracks its two again. Not seeded: submitted / failed /
  `outcome_unknown` attempts and evidence (they need a real CLI run), e-mail
  drafts, and `rule_activation` approvals while auto mode is off.

## Routes

| Path | What |
|---|---|
| `GET /api/whoami` | `{authenticated, email?, isAdmin?, scope?}` |
| `/api/{cv,invoice,portfolio}` | `GET` owner-scoped list (admins: `?mine=0` for all) |
| `/api/{cv,invoice,portfolio}/:id` | `GET` public JSON (`.json`, `?download`; cv/invoice `.pdf` → 301), `PUT` / `DELETE` owner + write scope |
| `/api/jobs`, `/api/jobs/:id` | legacy jobs facade (06 §12.6): every method authenticated, not-owned = 404, no admin bypass and `?mine=0` ignored (D-26); served from `JOBS_KV` or `JOBS_DB` by the `JOBS_LEGACY_BACKEND` flag (`src/jobs/legacy/`) |
| `GET /{cv,invoice,portfolio}/:slug.pdf` | 302 to the app print view (`?cv=` / `?invoice=` / `?id=` + `print=1`; localhost:4003/4004/4005 under `wrangler dev`) |
| `/auth/request`, `/auth/verify`, `/auth/exchange`, `/auth/logout`, `/auth/me` | email sign-in and browser sessions |
| `/auth/tokens`, `/auth/tokens/:id[/revoke]` | personal tokens (`scope: write | read`) |
| `/connect` | server-rendered page: sign in, mint/copy/revoke tokens |
| `/.well-known/oauth-*`, `/oauth/{register,authorize,magic,token}` | OAuth 2.1 + PKCE for MCP clients and the `pilih-jobs-cli` first-party client (loopback redirect, any port) |
| `POST /oauth/authorize/decision` | first-party approve / deny of the consent page (session-aware; same-origin + HMAC CSRF token) |
| `POST /oauth/revoke` | RFC 7009 revocation (200 for unknown tokens; a refresh token kills its family; `forget_device=true` also revokes the bound device) |
| `/mcp` (Streamable HTTP), `/sse` (legacy) | MCP server: `cv_*`, `invoice_*`, `portfolio_*`, `jobs_*` + 48 legacy aliases (the `jobs_*` tools go through the same facade and `JOBS_DB` services; no admin bypass) |
| `/api/v1/*` | Job Tracker API (05), bearer only, 404 while `JOBS_V1_ENABLED` is off (except `/meta`); `listRouteTable()` (`src/jobs/routes/table.ts`) lists all 105 routes with their scopes. Areas below |
| `GET /api/v1/meta`, `GET /api/v1/me` | public versions / flags; the caller (`routes/meta`) |
| `/api/v1/devices[/{dev_id}[/revoke\|/heartbeat]]` | register (`offline_access`), list (`?limit&cursor&include_revoked`), rename / pause, revoke (leases → outcome_unknown / queued), heartbeat (`routes/devices`) |
| `/api/v1/sources*`, `/api/v1/discovery/runs*`, `/api/v1/inbox[:bulk]`, `/api/v1/user-jobs*` | sources + adapters, CLI discovery runs and `postings:batch`, the inbox (bulk track ≤ 200), manual jobs (`routes/discovery`) |
| `/api/v1/board`, `/api/v1/applications*` | Kanban board, applications, events, interviews (`.ics`), offers (`routes/applications`) |
| `/api/v1/scores:request`, `/api/v1/scores/{posting_id}` | match scores (`routes/scoring`) |
| `/api/v1/files*`, `/api/v1/cvs`, `/api/v1/applications/{app_id}/cv-variants`, `/api/v1/cv-variants/*` | files (R2, multipart upload), CV variants, render tickets (`routes/files`, `routes/cv`) |
| `/api/v1/rules*`, `/api/v1/tasks*`, `/api/v1/devices/{dev_id}/tasks:claim`, `…/lease/{lease_id}/*`, `/api/v1/approvals*` | automation: rules, tasks, claim / lease protocol, approvals (`routes/automation`) |
| `/api/v1/ai/{page-classify,next-action,field-plan,verify-submission}` | AI proxy for the CLI worker (device + `ai:invoke`, consent, budget; `routes/ai-proxy`) |
| `/api/v1/profile/{facts,answers}*`, `/api/v1/settings` | applicant facts, screening answers, settings (`routes/profile`, `routes/account`) |
| `/api/v1/account/{export,exports/{export_id},delete,delete/confirm}`, `/api/v1/telemetry[/crash]` | account export (zip) and deletion (browser session only; public token confirm page), anonymous CLI telemetry (`routes/account`) |
| `/api/v1/changes`, `/api/v1/snapshot` | sync feed and snapshot (`routes/sync`) |
| `/api/v1/analytics/{summary,timeseries,breakdown}` | analytics (`routes/analytics`) |
| `/api/v1/applications/{app_id}/emails`, `/api/v1/emails/{eml_id}[/approve\|/handed-off]` | email applications: draft, show (with `payload_hash`), approve, hand-off (`routes/email`) |

The same Worker exports `scheduled` (`0 3 * * *` daily jobs incl. the
`request_log` purge, `*/5 * * * *` leases; `src/jobs/cron`) and `queue`
(the `jobs-ai` consumer + `jobs-ai-dlq`; `src/jobs/queue`).

## Structure

- `src/index.ts` — entry: `PilihMcpServer` Durable Object + `createApp(...)` (`fetch`, `scheduled`, `queue`)
- `src/app.ts` — router and dispatch order (testable without the DO); `createApp(mcp, deps)` takes an optional fake clock / AI provider
- `src/auth.ts` — caller resolution (`ResolvedCaller`: legacy `{email, isAdmin, scope}` + `userId` from the lazy `users` row, OAuth `scopes` of 05 §1.2, `credentialKind`, `deviceId`, `grantId`, `tokenId`), `mcp_tokens` access, hashing; `src/session.ts` cookies; `src/sign-in.ts` email links
- `src/jobs/` — the Job Tracker: `core/` (router, context, errors, scopes, flags, versions, ranks), `repo/` (the only `JOBS_DB` access), `ai/`, `queue/`, `cron/`, `routes/<area>/`, `services/<area>/` — see `src/jobs/README.md`
- `src/routes/*` — route modules; `src/oauth/*` — OAuth endpoints (`authorize`, `params`, `pending`, `consent` (decision page + CSRF), `grants`, `token`, `refresh` (rotation + 60 s grace), `revoke`, `magic`, `register`, `discovery`); `src/documents/*` — REST handlers
- Job Tracker device code: `src/jobs/{routes,services,repo}/devices` (`repo/devices/identity.ts` = `DB`, `effects.ts` = `JOBS_DB`)
- `src/mcp-tools.ts` — `registerAllTools()`: scope filter → request logger → ownership guard → tools (`src/tools/*`)
- `src/ownership.ts` — the single owner-stamp resolver (`owner:cv:`, `owner:inv:`, `owner:portfolio:`, `owner:job:`)
- `migrations/` — `DB` schema: `0001` tokens/clients/request log, `0002` users, grants, refresh tokens, devices, feature flags (seeded dark), support access log, `mcp_tokens` rebuilt with `kind` ∈ personal/session/oauth; `0003` the `pilih-jobs-cli` client
- `migrations-jobs/` — `JOBS_DB` schema (`0001_jobs_core.sql` = 04 §2 verbatim)
- `src/jobs/legacy/` — the `/api/jobs` + MCP `jobs_*` facade over `JOBS_KV` (`kv.ts`) or `JOBS_DB` (`d1.ts`, with the P3 on-the-fly KV fallback that logs `legacy_kv_fallback`); its SQL lives in `src/jobs/repo/legacy/`
- `scripts/` — gated data migrations (dry run unless `--execute`), `seed-local.ts`, `seed-demo.ts`, `support-access.ts`, `scoring-eval.ts`, `analytics-rebuild.ts`
- `test/fakes.ts` — fake bindings for `bun test` (both D1s, R2, Queue + `drain()`, fake clock, `createV1Client`); `test/seed-jobs.ts` — direct JOBS_DB seeding

## KV keys (Job Tracker / OAuth, all in `AUTH_KV`)

| Key | TTL | What |
|---|---|---|
| `oauth:code:<sha256>` | 5 min | authorization code (single use) |
| `oauth:rft-grace:<sha256(parent)>` | 60 s | refresh-rotation grace record (AES-GCM, key derived from the parent refresh token) |
| `jobs:device-report:<dev_id>` | 30 d | last device heartbeat report (dashboard) |
| `jobs:watch:<user_id>` | 300 s | the dashboard is open (faster CLI polling) |
| `jobs:render-ticket:<sha256(ticket)>` | 120 s | render ticket `{user_id, cvv_id, read_used, upload_used}` (PLAN C8) |
| `jobs:account-delete:<sha256>` | 1 h | one-time account deletion confirmation token |

## Rules

- Store secrets only as SHA-256 hashes; never log a bearer (hash prefix only).
- Every write route checks: authenticated (401) → write scope (403 `insufficient_scope`) → exists (404) → owner (403; jobs and MCP answer not-found).
- `ADMIN_EMAILS` bypass ownership only for cv / invoice / portfolio documents. Nothing bypasses it on Job Tracker data, legacy facade included (D-26, BREAKING: `DEPLOY.md` § Release notes); support access is `scripts/support-access.ts` (logged).
- Credentialed CORS only for the app origins (cv, invoice, portfolio, jobs); localhost app ports (4003–4005, 4007) only while the Worker itself runs on localhost.
- `/api/v1`: only `src/jobs/repo/**` touches `JOBS_DB`; every repo statement on a user-scoped table has a `user_id` predicate; not owned = 404; one `batch()` per write with `change_log` + the idempotency row; `revision` + `base_revision` (409 `revision_conflict`). `src/jobs/isolation.test.ts` (T11-JOBSDB, T11-SQL) enforces the first two; `src/jobs/isolation-sweep.test.ts` (S-31) calls every route of `listRouteTable()` and every MCP `jobs_*` tool as another user and as an admin (404 / nothing leaked), plus the token scope matrix — a new route without a sweep case fails it.
- Feature flags and kill switches live in `DB.feature_flags` (D-33), never in vars; versions (`JOBS_MIN_CLI_VERSION`, `JOBS_RECOMMENDED_CLI_VERSION`) are vars. `OPENAI_API_KEY` and `OPENROUTER_API_KEY` are secrets only `src/jobs/ai/**` reads; the var `JOBS_AI_PROVIDER` (`openai` default | `openrouter`) picks the live provider (`src/jobs/ai/openrouter.ts`: zero-data-retention routing on every call; models `OPENROUTER_MODEL_DECISIONS` / `_STRUCTURED` / `_ESCALATION`), and `JOBS_AI_MODE=fake` still wins.
- HTML pages go through `htmlPage()` (strict CSP with nonce, no framing). Escape every interpolated value.
- Don't run the migration scripts with `--execute`, deploy, or touch remote resources without the owner's go-ahead.
- The MCP SDK packages are patched past GHSA-6qxp-vccf-f47h (`@modelcontextprotocol/sdk` 1.32.1, `client` / `server` 2.3.1). `agents` 0.26–0.28 pins the vulnerable versions as exact peers, so the root `package.json` `overrides` force the patched ones onto it (one copy in the tree). Verified with the test suite (`tool-surface.test.ts` drives the SDK client against every tool) and a local `wrangler dev` handshake on `/mcp` (initialize → tools/list → tools/call). Drop the three overrides once an `agents` release peers on patched versions. The same block pins `sharp` 0.35.5 (wrangler's miniflare still ships 0.35.4).
