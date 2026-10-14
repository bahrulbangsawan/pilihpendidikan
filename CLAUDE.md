<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Project: pilihpendidikan

Document builders for students and job seekers: a CV builder, an invoice
builder and an Apple Developer Academy portfolio builder, each a TanStack Start
app on Cloudflare Workers, plus the backend Worker they save to, a hub
landing page at the apex domain and the design system page (`apps/design`).

The **Job Tracker** (`job-tracker-spec/`, decisions D-01…D-36) adds a Kanban
dashboard (`apps/jobs`), a local Python CLI that discovers jobs and applies in
a browser with the user's approval (`apps/jobs-cli`, `pilih-jobs`), the
`/api/v1` API in `apps/api`, and two shared packages: the contracts
(`packages/jobs-contracts`) and the CV engine (`packages/cv-engine`). It ships
dark: every surface sits behind `DB.feature_flags` (D-33) until the owner turns
it on (`DEPLOY.md` § Job Tracker). **Cloud discovery** (`job-tracker-spec/24`,
D-37…D-41) adds a server-side catalog of remote-job boards scraped every hour:
an `apps/api` cron and queue, and a Python scraper container
(`apps/jobs-scraper`) built on the CLI's Scrapling engine
(`DEPLOY.md` § Cloud discovery).

The apps were extracted from the `bahrul` monorepo with their git history.
This repo is self-contained: it installs, checks and builds on its own.

## Architecture

- Bun workspace with Turborepo orchestration (`apps/*`, `packages/*`); one Python project (`apps/jobs-cli`, uv) joins it through a `package.json` shim
- `apps/home` — hub landing page (TanStack Start SSR, dev port `4002`) → `pilihpendidikan.com`, with `www.` 301ing to the apex (Worker `home-pilihpendidikan`). One page in English (`/`) and Indonesian (`/id`). It links a builder, the Job Tracker or the MCP endpoint only when that service's entry in `src/config/services.ts` is `"live"` (`jobs` is `"soon"`); `src/server.ts` does the www redirect and security headers; `/llms.txt` is generated from the same config. `public/install-cli.sh` / `install-cli.ps1` are the CLI install scripts (22 §2)
- `apps/cv` — CV builder (TanStack Start SSR, dev port `4003`) → `cv.pilihpendidikan.com` (Worker `cv-pilihpendidikan`). Its document types, schema, Markdown export and PDF templates come from `packages/cv-engine`; the HTML previews stay here
- `apps/invoice` — invoice builder with Indonesian region data (dev port `4004`) → `invoice.pilihpendidikan.com` (Worker `invoice-pilihpendidikan`)
- `apps/portfolio` — Apple Developer Academy portfolio builder, A4 landscape (dev port `4005`) → `portfolio.pilihpendidikan.com` (Worker `portfolio-pilihpendidikan`)
- `apps/jobs` — the Job Tracker dashboard (TanStack Start SSR, dev port `4007`) → `jobs.pilihpendidikan.com` (Worker `jobs-pilihpendidikan`): board, inbox, application detail, automation (approvals, rules, runs, live monitor), CLI & devices, sources, stats, profile, settings, and the chrome-free `/render/cv/$cvvId` page that renders tailored CV PDFs. A BFF: the API bearer lives only in the sealed `__Host-jobs-session` cookie (`BFF_COOKIE_KEY`), server functions call `apps/api` through the `API` service binding. See `apps/jobs/CLAUDE.md`
- `apps/jobs-cli` — `pilih-jobs` (alias `pj`), the local execution engine (Python 3.12 via uv, hatchling, Typer; PyPI dist `pilih-jobs`, import package `pilih_jobs`): OAuth PKCE login, sync (outbox + change feed), discovery on public ATS APIs with Scrapling behind a policy guard, Playwright browser agent with approvals, the task worker. Talks to `apps/api` only over HTTPS + JSON. See `apps/jobs-cli/CLAUDE.md`
- `apps/api` — backend Worker at `api.pilihpendidikan.com` (dev `wrangler dev` on `localhost:8788`): cloud save and public reads for cv/invoice/portfolio, the legacy `/api/jobs` facade, email-link sign-in, personal tokens (`/connect`), OAuth 2.1 for MCP clients and the CLI, PDF print redirects, the MCP server (`/mcp`, `/sse`) and the Job Tracker API under `/api/v1` (`src/jobs/`, 115 routes, incl. the cloud catalog `/api/v1/cloud-sources…`). Hand-written router, D1 `pilihpendidikan` (`DB`: tokens, users, OAuth grants, devices, feature flags) and `pilihpendidikan-jobs` (`JOBS_DB`: every Job Tracker record, the cloud catalog and runs), R2 `JOBS_FILES`, queues `jobs-ai` (+ `jobs-ai-dlq`) and `jobs-scrape` (+ `jobs-scrape-dlq`), crons `0 3 * * *`, `*/5 * * * *` and `0 * * * *` (cloud dispatch), service binding `SCRAPER`, KV (`AUTH_KV`, `CV_KV`, rebound `INVOICE_KV` / `PORTFOLIO_KV` / `JOBS_KV`, `RATE_LIMIT_KV`), Durable Object `PilihMcpServer`, tests with `bun test`. See `apps/api/CLAUDE.md` and `apps/api/src/jobs/README.md`
- `apps/jobs-scraper` — the cloud discovery scraper (`job-tracker-spec/24`): Worker `jobs-scraper-pilihpendidikan` (no route, reached only by the api's `SCRAPER` binding) driving a Cloudflare Container (`ScraperContainer`, Durable Object) that runs `pilih-scraper` (`python/`, uv, Starlette) on the CLI's `pilih_jobs.discovery` engine: JSON API, RSS/Atom, JSON-LD, embedded JSON, CSS + Scrapling adaptive, opt-in browser, AI excerpts; SSRF guard. Dev: `bun run dev:python` (:8791) or `bun run dev` (wrangler + Docker, :8792). See `apps/jobs-scraper/CLAUDE.md`
- `apps/design` — the Zedative design system page (Vite SPA, dev port `4006`, not deployed): foundations, every `@rulisme/ui` component with pinned states, do/don't pairs, recipes. It renders `@rulisme/ui` from source (`vite.config.ts` alias), so component edits hot-reload there
- `packages/ui` — `@rulisme/ui`, the shared React 19 component library and the one Zedative theme (`src/styles/theme.css` → `@rulisme/ui/styles/theme.css`). Every app compiles it from `src/` (tsconfig `paths` + Vite `resolve.tsconfigPaths`, and Tailwind `@source`s `packages/ui/src`); `bun run build` also emits a `dist/` for its package exports
- `packages/jobs-contracts` — `@pilihpendidikan/jobs-contracts` (D-20): Zod schemas for every Job Tracker table and `/api/v1` route, state machines, the `fp1` fingerprint, queue / agent / scoring / tailoring contracts, the adapter manifest and data files. TypeScript source exports; `schema/*.json` (generated, committed) feeds the CLI's generated Pydantic models. See its `CLAUDE.md`
- `packages/cv-engine` — `@pilihpendidikan/cv-engine` (D-14): `CVData` types, `CVDataSchema`, Markdown export, CV bullets and the four `@react-pdf` templates (`src/pdf/`, browser only), shared by `apps/cv`, `apps/api` and `apps/jobs`. See its `CLAUDE.md`
- `packages/config` — `@pilihpendidikan/config`: shared `tsconfig.base.json` and `motion.css`
- `e2e/` — the full-stack Job Tracker scenarios (`bun run e2e`): real `wrangler dev`, `vite dev`, CLI and Chromium processes on this machine (`e2e/README.md`; what is not automated is in `e2e/HANDOFF.md`)
- `job-tracker-spec/` — the Job Tracker specification (24 documents, incl. `24-CLOUD-DISCOVERY.md`; `00-README.md` indexes the decisions and assumptions)
- `openspec/` — spec-driven change management (see `openspec/AGENTS.md`); the Job Tracker changes are `jobs-*` (cloud discovery: `jobs-add-cloud-discovery`), `api-add-user-ids-and-jobs-db`, `api-extend-oauth-for-cli`, `cv-extract-cv-engine`
- `.github/workflows/` — CI (`ci.yml`: check, check-types, build, OpenSpec), the CLI OS / Python matrix (`cli-matrix.yml`), the full-stack suite (`e2e.yml`, nightly), opt-in live checks (`nightly-live.yml`) and the CLI release (`release-cli.yml`, tags `cli-v*`)

The builders talk to the backend through one constant per app (`MCP_API` in
`src/components/*-generator.tsx`): `http://localhost:8788` in dev,
`https://api.pilihpendidikan.com` in prod. `apps/jobs` uses its `API` service
binding (dev: `JOBS_API_FALLBACK_URL` in `.dev.vars`), `apps/api` reaches the
scraper through its `SCRAPER` binding (dev: `SCRAPER_FALLBACK_URL`), and the CLI
`--api-url` / `PILIH_JOBS_API_URL` (default `https://api.pilihpendidikan.com`).
OG images use the public `https://og.bahrul.me` endpoint (`src/lib/og-url.ts`).

## Stack

- **Runtime**: Bun 1.4.2, Cloudflare Workers (`@cloudflare/vite-plugin`, `nodejs_compat`); D1, R2, Queues, Cron Triggers, KV and a Durable Object in `apps/api`
- **Framework**: React 19 + TanStack Router + TanStack Start (SSR); `@tanstack/react-query` in `apps/jobs`
- **Build**: Vite 8 (Rolldown); `packages/ui` builds with Vite library mode + `tsc` declarations; `packages/jobs-contracts` and `packages/cv-engine` export TypeScript source (no build step)
- **Styling**: Tailwind CSS 4 (CSS-native config, `@theme inline`)
- **UI**: shadcn/ui (all 61 CLI components, lyra geometry, radix base) + `@base-ui/react` / Radix primitives + CVA variants, via `@rulisme/ui`, restyled to Zedative
- **PDF**: `@react-pdf/renderer` (one `*-pdf.tsx` renderer per document type; the CV's four in `packages/cv-engine/src/pdf/`)
- **Contracts**: Zod 4 (catalog `^4.6.5`) → JSON Schema (`z.toJSONSchema`) → Pydantic v2 (`datamodel-code-generator`) for the CLI (D-20)
- **Containers**: Cloudflare Containers (`@cloudflare/containers`) for the scraper (`apps/jobs-scraper`, linux/amd64 image, `basic` instance)
- **CLI (Python)**: Python 3.12 via uv 0.12 (`requires-python >=3.11,<3.14`), hatchling, Typer, Rich, httpx, Pydantic v2, keyring, Playwright 1.63, Scrapling 0.4.15 (`[fetchers]`, exact pin); ruff, pyright (strict), import-linter, pytest, pip-audit
- **Lint/format**: Biome 2.5 with the Ultracite rule set (`biome.jsonc`) for TypeScript; ruff for Python
- **Tests**: Vitest per app; `bun test` for `apps/api`, `packages/jobs-contracts`, `packages/cv-engine` and `e2e/`; pytest for `apps/jobs-cli`
- **Icons**: lucide-react
- **Font**: Inter Variable 4.0 with its `opsz` axis (`@fontsource-variable/inter`), loaded once by `@rulisme/ui/styles/theme.css`; it is the only family (every `--font-*` token resolves to it)

## Commands

- `bun install` — install the workspace. The CLI needs **uv** (A-06; `scripts/require-uv.sh` fails loudly without it): `cd apps/jobs-cli && uv sync` once
- `bun dev` — Turborepo fan-out (`@rulisme/ui` watch build + the hub, the three builders, the Job Tracker dashboard, the design page + the api Worker on `:8788`)
- `bun run dev:home` / `dev:cv` / `dev:invoice` / `dev:portfolio` — one app plus the `@rulisme/ui` watch build it depends on
- `bun run dev:jobs` — the Job Tracker dashboard on `:4007` (plus its workspace dependencies). Run `bun run dev:api` next to it (after `bun run db:migrate:local && bun run db:migrate:jobs:local && bun run db:seed:local` in `apps/api`), or `bun run dev:mock-api` in `apps/jobs` for contract fixtures on `:8790`; copy `apps/jobs/.dev.vars.example` to `.dev.vars` first
- `bun run dev:design` — the design system page on `:4006` (renders `@rulisme/ui` from source; no library build needed)
- Cloud discovery locally: `bun run dev:python` in `apps/jobs-scraper` + `SCRAPER_FALLBACK_URL=http://localhost:8791` in `apps/api/.dev.vars`, then "Run now" on `/sources` as an `ADMIN_EMAILS` operator (or `curl "http://localhost:8788/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"`)
- `bun run dev:api` — only the api Worker (`wrangler dev` on `:8788`; run `bun run db:migrate:local` in `apps/api` once first, plus `db:migrate:jobs:local` and `db:seed:local` for the Job Tracker)
- `bun run db:seed:demo -- --email you@example.com [--reset]` (in `apps/api`, with the local api running) — fill the local Job Tracker with demo data for that user through the real `/api/v1` routes: applications on every board column, interviews, offers, an inbox of scored postings, sources, rules, a demo device and approvals waiting (`apps/api/CLAUDE.md` § Demo data; local only)
- CLI against the local api: `cd apps/jobs-cli && uv run pilih-jobs --api-url http://localhost:8788 login` (or `PILIH_JOBS_API_URL`)
- `bun run build` — build `packages/ui`, then every app (`wrangler types` + `vite build`; `apps/api`: `wrangler deploy --dry-run`; `apps/jobs-cli`: `uv build`)
- `bun run check` — full chain: `biome check` → `turbo lint` (incl. the CLI: ruff, ruff format, import-linter) → `lint:typography` → `parity:typography` → `parity:twmerge` → `parity:showcase` → `parity:cv-templates` → `contracts:check` → `test` (`turbo test`, incl. pytest) → `audit` (`bun audit` + `audit:python`: the CLI and the scraper lock files)
- `bun x ultracite fix` (or `bun run fix`) — format and autofix
- `bun run check-types` — `tsc` for `scripts/` plus `turbo typecheck` (incl. pyright for the CLI)
- `bun run e2e` — the full-stack scenarios (`bun test e2e --timeout 900000`, about 30 minutes; needs uv, `uv sync` in `apps/jobs-cli`, Chromium via `uv run --project apps/jobs-cli playwright install chromium`, and free ports 4003 / 4007 / 8788). Not part of `check`; CI runs it nightly (`e2e.yml`)
- `bun run lint:typography` — Zedative style enforcement: type roles only, no `leading-*` / `tracking-*` / uppercase / `font-<weight>`, no big radii, gradients, glass, hex classes, enter animations, stray syntax colours or `dark:` overrides (see `TYPOGRAPHY.md`)
- `bun run parity:typography` — every app's `src/styles.css` imports `@rulisme/ui/styles/theme.css` and defines no tokens of its own
- `bun run parity:twmerge` — `cn()` (`packages/ui/src/lib/utils.ts`) registers every `type-*` and `weight-*` utility the theme defines
- `bun run parity:showcase` — every component file in `packages/ui/src/ui` is rendered on the design page (`apps/design`)
- `bun run parity:cv-templates` — a change set (uncommitted and untracked files included, against `HEAD`) that touches a CV PDF template in `packages/cv-engine/src/pdf/` also touches its preview in `apps/cv` (`CV_PARITY_OVERRIDE=1` for an intentional PDF-only fix). CI also runs it against the pull request base
- `bun run contracts:check` — the contracts drift guard (D-20): `packages/jobs-contracts` regenerates its JSON Schema, vectors and data files into a temp dir and `apps/jobs-cli` regenerates its Pydantic models; either differing from the committed files fails
- `bun run audit:python` — `pip-audit --strict` over the locked dependencies of the CLI and of the scraper (`uv export` of each `uv.lock`)

Run `bun x ultracite fix && bun run check` before committing.

## Deploy

Each app deploys with `bun run deploy` (`wrangler deploy`) from its directory
after `bun run build`. Every `wrangler.jsonc` binds its Worker to a custom
domain (`routes: [{ pattern: "<app>.pilihpendidikan.com", custom_domain: true }]`);
`apps/home` binds both `pilihpendidikan.com` and `www.pilihpendidikan.com`.
The first deploy follows `DEPLOY.md`: create the D1/KV/Email resources, fill
the `REPLACE_WITH_…` ids in `apps/api/wrangler.jsonc`, migrate data (dry run,
then `--execute`), deploy `apps/api`, then the three apps. The hub
(`apps/home`) needs none of that and can deploy first. Each builder goes live
on the hub through the **Going live** checklist in `DEPLOY.md` (deploy →
smoke-test → flip its status in `apps/home/src/config/services.ts` → redeploy
the hub).

The Job Tracker has its own order (`DEPLOY.md` § Job Tracker, 14 §8):
resources (D1 `pilihpendidikan-jobs`, R2 `pilihpendidikan-jobs-files`, queues
`jobs-ai` / `jobs-ai-dlq`, secrets `OPENAI_API_KEY` and `BFF_COOKIE_KEY`) →
migrations → api deployed dark (`JOBS_V1_ENABLED=false`) → legacy `JOBS_KV` →
`JOBS_DB` migration (dry run, execute, verify) → flags on → deploy `apps/jobs`
→ publish the CLI (`release-cli.yml`) → flip `jobs` live on the hub.
Cloud discovery deploys the scraper first (queues `jobs-scrape` /
`jobs-scrape-dlq`, then `apps/jobs-scraper` with Docker, then the api; Workers
Paid for Containers), then `JOBS_CLOUD_DISCOVERY_ENABLED` (`DEPLOY.md` § Cloud
discovery).
Deploys, DNS, Cloudflare resources, data migrations, feature-flag changes and
CLI releases need the owner's go-ahead.

## Conventions

- Files: `kebab-case.tsx`; TanStack route-private files start with `-` (`-root-components.tsx`)
- Components: named exports, PascalCase, function components only; no default exports for components
- Imports: each app owns its `@/*` alias (→ `src/*`); shared UI from `@rulisme/ui/<dir>/<file>`; the Job Tracker contracts from `@pilihpendidikan/jobs-contracts/<subpath>` and the CV engine from `@pilihpendidikan/cv-engine/<subpath>` (load `/pdf` only with a dynamic import in the browser). No barrel files. Verbatim module syntax
- React 19 ref-as-prop (no `forwardRef`); `data-slot` attributes on UI primitives
- `routeTree.gen.ts` is generated — never edit it by hand
- Design tokens live only in `packages/ui/src/styles/theme.css`; each app's `src/styles.css` imports it and adds nothing but print-artifact CSS. Never hardcode hex or arbitrary sizes in chrome
- Re-skin a shared primitive once in `packages/ui` (the apps pick it up from source) — never fork per app
- Job Tracker wire contracts change in `packages/jobs-contracts` first (`bun run build` there), then `bun run contracts` in `apps/jobs-cli`; commit the regenerated `schema/*.json` and `contracts/_generated/` (never hand-edit them). `bun run contracts:check` guards it
- `/api/v1`: only `apps/api/src/jobs/repo/**` touches `JOBS_DB`, every user-scoped statement carries a `user_id` predicate, not owned = 404, every new route gets a scope and an isolation-sweep case (`apps/api/src/jobs/README.md`)
- Feature flags and kill switches live in `DB.feature_flags` (D-33), never in vars; only `JOBS_MIN_CLI_VERSION` / `JOBS_RECOMMENDED_CLI_VERSION` are vars
- Python (`apps/jobs-cli`): ruff + pyright strict, every test directory has an `__init__.py`, spec-numbered tests carry their id (`test_T20_01_…`); `scrapling` only in `discovery.engine`, `playwright` only in `browser` / `agent.executor` (import-linter). Biome does not lint Python
- Tests that implement a numbered spec test carry its id in the title (`T6-05 …`, `S-12 …`)

## Design system

Every app uses **Zedative** (`DESIGN.md`): warm off-white graph paper ruled into
hairline rails with diamond nodes, one family (Inter Variable) in six roles,
one cobalt accent. `DESIGN.md` § Implementation maps every rule to code;
`TYPOGRAPHY.md` holds the enforced rules; `apps/design` renders the whole
system.

- Six type roles, each baking size, line height, weight and optical size: `type-display` (the hero h1 only), `type-title`, `type-subtitle`, `type-body` (the default), `type-caption`, `type-micro`, each with a `-compact` step. `typeClass(role, variant)` from `@rulisme/ui/lib/type-scale` returns the same classes.
- Three weights: `weight-normal` (400), `weight-semibold` (550, headings and selected items), `weight-bold` (700, display only). No uppercase, no letter-spacing, no `font-<weight>` utilities.
- Colour: running text inherits `ink`; headings, labels and controls are `foreground`; cobalt (`primary`) is scarce: the one primary action, checked controls, links, focus, then the footer slab. Syntax colours (`syn-1..4`) live only in editor mocks.
- Shape and depth: cards and sections are square, controls 4px, chips 2px, windows 6px; pressables carry an inset lip that disappears on hover; floating windows get the one soft drop (`shadow-float`). Frame chrome in `Band` / `Rail` / `Diamond` (`@rulisme/ui/ui/rails`) and `graph-paper`.
- Motion: 150ms on `cubic-bezier(0.4, 0, 0.2, 1)`, only colours and the lip; the `press` offset on `:active`. Nothing enters, overlays open instantly, no route transitions.
- Light is canonical; `.dark` is the derived Night Desk scheme. next-themes toggles it in the builders and the Job Tracker dashboard (default light; the dashboard switches in Settings and the ⌘K palette); the hub and the design page are light by default.
- `<Kbd>` hints inside primary actions advertise real single-letter shortcuts: register them with `useShortcut` (`@rulisme/ui/hooks/use-shortcut`), never one without the other.
- Print artifacts (the CV templates, the invoice page, the portfolio deck) follow Zedative too: Inter only, no uppercase or letter-spacing, Zedative ink colours that Night Desk never changes. They keep print sizes and the static weights 400 / 600 / 700, and each preview mirrors its `@react-pdf` output (see `TYPOGRAPHY.md` § Exceptions). The CV's PDF templates live in `packages/cv-engine/src/pdf/` and their HTML previews in `apps/cv/src/components/templates/`: change both together (`bun run parity:cv-templates`). The PDFs share one print module, `@rulisme/ui/print/*`: the merged Inter cuts (`pdf-fonts.ts`, rebuilt by `scripts/build-print-fonts.sh`), the line-break policy and the text normaliser (`pdf-text.ts`); each builder's `src/lib/pdf-fonts.ts` only registers them, and the CV's `registerCvPrint` (`apps/cv`, and `apps/jobs` for its render page) also hands cv-engine the normaliser through `registerCvPrintText` (DESIGN.md § Implementation › Print artifacts).

## Browser testing

Use `agent-browser` (not chrome-devtools or claude-in-chrome MCP):

```sh
agent-browser open http://localhost:4003
agent-browser snapshot -i
agent-browser screenshot cv.png
agent-browser close
```

Project config is in `agent-browser.json`.

<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `bunx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
