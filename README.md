# pilihpendidikan

Document builders that run in the browser and export print-ready PDFs, a job
application tracker with a local CLI, and the hub page at the apex domain:

| App | What it builds | Dev | Production |
| --- | -------------- | --- | ---------- |
| `apps/home` | Hub landing page: lists the builders, linking each one only once it is live | <http://localhost:4002> | <https://pilihpendidikan.com> (`www.` 301s here) |
| `apps/cv` | CVs, four templates (basic, harvard, simple, standard) | <http://localhost:4003> | <https://cv.pilihpendidikan.com> |
| `apps/invoice` | Invoices with Indonesian region (wilayah) addresses | <http://localhost:4004> | <https://invoice.pilihpendidikan.com> |
| `apps/portfolio` | Apple Developer Academy portfolios, A4 landscape | <http://localhost:4005> | <https://portfolio.pilihpendidikan.com> |
| `apps/jobs` | Job Tracker dashboard: board, inbox, approvals, devices, stats | <http://localhost:4007> | <https://jobs.pilihpendidikan.com> (not live yet) |
| `apps/jobs-cli` | `pilih-jobs`, the Job Tracker CLI (Python): discovery, browser apply with approval, sync | `uv run pilih-jobs` | PyPI `pilih-jobs` (not published yet) |
| `apps/api` | Backend Worker: cloud save, sign-in, personal tokens, OAuth, MCP server, Job Tracker API (`/api/v1`) | <http://localhost:8788> | <https://api.pilihpendidikan.com> |
| `apps/design` | The Zedative design system page: tokens, type roles, every component | <http://localhost:4006> | not deployed |

Every web app is bilingual (English at `/`, Indonesian at `/id`). The builders
keep a local draft in the browser and can save to the cloud with a personal
token minted at <https://api.pilihpendidikan.com/connect>. AI assistants can
edit the same documents through the MCP server at
`https://api.pilihpendidikan.com/mcp` (Streamable HTTP; legacy clients use
`/sse`).

The Job Tracker (specified in `job-tracker-spec/`) is built and tested but
ships dark: its API answers only behind feature flags the owner turns on, and
the hub lists it as "soon" until it goes live (`DEPLOY.md` § Job Tracker).

## Requirements

- [Bun](https://bun.sh) 1.4.2 or newer
- Node 22.22+, 24.15+ or 26+ (for tooling that shells out to Node)
- [uv](https://docs.astral.sh/uv/) 0.12+ for the Python CLI (`apps/jobs-cli`);
  `bun run check` runs its lint, tests and audit and fails without uv. uv
  downloads Python 3.12 itself.

## Getting started

```sh
bun install
(cd apps/jobs-cli && uv sync)   # the CLI's Python environment
bun dev            # builds @rulisme/ui, then runs every app and the api Worker
bun run dev:cv     # or one app: dev:home, dev:cv, dev:invoice, dev:portfolio, dev:jobs, dev:design, dev:api
```

### Running the API locally

The apps call `http://localhost:8788` in dev. `bun dev` starts the api
Worker there alongside them; to run it on its own:

```sh
cd apps/api
bun run db:migrate:local   # once: create the local D1 tables
bun run dev                # wrangler dev on http://localhost:8788
```

Open <http://localhost:8788/connect>, enter any email address and follow the
sign-in link wrangler prints in the terminal (local email is simulated). Mint
a token there and paste it into an app's "Connect via MCP" dialog to try
cloud save. No Cloudflare login is needed for local development.

### Running the Job Tracker locally

```sh
# terminal 1: the api with the Job Tracker turned on locally
cd apps/api
cp .dev.vars.example .dev.vars   # JOBS_AI_MODE=fake: no OpenAI calls
bun run db:migrate:local && bun run db:migrate:jobs:local
bun run db:seed:local            # turns the Job Tracker flags on in the local D1
bun run dev                      # api on :8788

# terminal 2: the dashboard (from the repo root)
cp apps/jobs/.dev.vars.example apps/jobs/.dev.vars
bun run dev:jobs                 # http://localhost:4007

# terminal 3: the CLI
cd apps/jobs-cli && uv run pilih-jobs --api-url http://localhost:8788 login
```

Sign in to the dashboard with the e-mail link wrangler prints. `apps/jobs`
also has `bun run dev:mock-api` (contract fixtures on :8790) for UI work
without the api. The CLI's own guide is [`apps/jobs-cli/README.md`](apps/jobs-cli/README.md).

The apps compile `@rulisme/ui` straight from `packages/ui/src` (TypeScript
`paths` plus Vite's `resolve.tsconfigPaths`), so a component change shows up
in every running app without a library build. `bun run build` still emits
its `dist/` for the package exports.

## Checks

```sh
bun x ultracite fix   # format and autofix (Biome, Ultracite rules)
bun run check         # biome → turbo lint (+ ruff) → style lint → parities → contracts drift → tests (+ pytest) → audit (+ pip-audit)
bun run check-types   # tsc + turbo typecheck (+ pyright)
bun run build         # packages/ui, then each app (wrangler types + vite build) and the CLI wheel
bun run e2e           # full-stack Job Tracker scenarios, about 30 minutes (see e2e/README.md)
```

CI (`.github/workflows/`) runs `check`, `check-types` and `build` on every
push and pull request, the CLI on macOS, Windows and Linux with Python
3.11–3.13 (`cli-matrix.yml`), the e2e suite nightly, and releases the CLI from
`cli-v*` tags (`release-cli.yml`, owner-approved).

## Layout

```
apps/home                               hub landing page (pilihpendidikan.com) + CLI install scripts
apps/cv  apps/invoice  apps/portfolio   TanStack Start apps on Cloudflare Workers
apps/jobs                               Job Tracker dashboard (jobs.pilihpendidikan.com)
apps/jobs-cli                           pilih-jobs, the Job Tracker CLI (Python, uv)
apps/api                                backend Worker (api.pilihpendidikan.com)
apps/design                             Zedative design system page (localhost:4006)
packages/ui                             @rulisme/ui component library + the Zedative theme
packages/jobs-contracts                 @pilihpendidikan/jobs-contracts (Zod → JSON Schema → Pydantic)
packages/cv-engine                      @pilihpendidikan/cv-engine (CV types, schema, PDF templates)
packages/config                         @pilihpendidikan/config (tsconfig base, motion.css)
e2e/                                    full-stack Job Tracker scenarios
job-tracker-spec/                       the Job Tracker specification
scripts/                                style lint, parity checks, require-uv.sh
openspec/                               change proposals and specs
.github/workflows/                      CI, CLI matrix, e2e, live checks, CLI release
docs/archive/                           reports written before the extraction
portfolio-mock/                         the static mock the portfolio app was built from
```

## Deploy

The hub (`apps/home`) has no backend dependency and can deploy on its own.
The builders' first deploy needs Cloudflare resources created and data
migrated, in a fixed order: see [`DEPLOY.md`](DEPLOY.md). After that:

```sh
bun run build
cd apps/api && bun run deploy  # the backend first
cd apps/cv && bun run deploy   # then apps/invoice, apps/portfolio
```

Each `wrangler.jsonc` binds its Worker (`home-pilihpendidikan`,
`api-pilihpendidikan`, `cv-pilihpendidikan`, `invoice-pilihpendidikan`,
`portfolio-pilihpendidikan`, `jobs-pilihpendidikan`) to its custom domain.

The Job Tracker needs its own resources, migrations and a dark launch before
`apps/jobs` deploys, and the CLI is released to PyPI from a `cli-v*` tag: both
are in `DEPLOY.md` (§ Job Tracker, § pilih-jobs CLI releases). Every deploy,
data migration, flag change and release needs the owner's go-ahead.

The hub links a builder only when its entry in
`apps/home/src/config/services.ts` is `"live"`. When a subdomain goes live,
follow the **Going live** checklist in `DEPLOY.md`.

## History

These apps were extracted from the `bahrul` monorepo (where they lived as
`apps/cv-bahrul`, `apps/invoice-bahrul` and `apps/portfolio-bahrul`) with
`git filter-repo`, so `git log` carries their full history. The commit
"Import working tree from bahrul" holds the edits that were uncommitted at
extraction time. Reports in `docs/archive/` and `og-metadata-audit.md`
predate the move and still refer to the old `*.bahrul.me` hosts.

See `CLAUDE.md` for conventions, `DESIGN.md` for the Zedative design system
and `TYPOGRAPHY.md` for the enforced type rules. Run `bun run dev:design` to
browse the system.
