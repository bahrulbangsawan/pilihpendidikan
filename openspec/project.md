# Project Context

## Purpose

pilihpendidikan hosts browser-based document builders for students and job
seekers — a CV builder, an invoice builder and an Apple Developer Academy
portfolio builder — plus the backend Worker that stores their documents and
exposes them to AI assistants over MCP, and the Job Tracker
(`job-tracker-spec/`): a web dashboard (`apps/jobs`), a local Python CLI
(`apps/jobs-cli`, `pilih-jobs`) that runs discovery and browser automation on
the user's machine, and the `/api/v1` API inside `apps/api` as the single
source of truth. The apps were extracted from the
`bahrul` monorepo with their git history and now live on
`*.pilihpendidikan.com`.

## Tech Stack

- **Runtime**: Bun 1.4.2, Cloudflare Workers (`nodejs_compat`)
- **Framework**: React 19 + TanStack Router + TanStack Start (SSR)
- **Bundler**: Vite 8 with `@cloudflare/vite-plugin`; Wrangler for deploys
- **Orchestration**: Turborepo (`apps/*`, `packages/*`)
- **Styling**: Tailwind CSS 4 — CSS-native config; one Zedative theme (`@rulisme/ui/styles/theme.css`)
- **UI**: `@rulisme/ui` (`packages/ui`): every shadcn/ui component (lyra geometry, radix base) on `@base-ui/react` / Radix + CVA, restyled to Zedative
- **PDF**: `@react-pdf/renderer`
- **Icons**: lucide-react
- **Font**: Inter Variable 4.0 (opsz axis) via `@fontsource-variable/inter`, the only family
- **Lint/format**: Biome 2.5 with the Ultracite rule set
- **Tests**: Vitest (apps), `bun test` (`apps/api`, `packages/jobs-contracts`, `packages/cv-engine`), pytest (`apps/jobs-cli`)
- **Contracts**: Zod 4 in `packages/jobs-contracts` → committed JSON Schema → generated Pydantic v2 models for the CLI (D-20)
- **Job Tracker backend**: D1 `pilihpendidikan-jobs` (`JOBS_DB`), R2 `pilihpendidikan-jobs-files` (`JOBS_FILES`), Queue `jobs-ai` + DLQ `jobs-ai-dlq`, feature flags in `DB.feature_flags`; OpenAI (Decisions + Responses, `store: false`) called only from `apps/api`
- **CLI**: Python 3.12 via `uv` (hatchling), Typer, httpx, keyring, Scrapling `[fetchers]` (no stealth features, D-16), Playwright for Python
- **Language**: TypeScript, plus Python for `apps/jobs-cli`

## Workspace Apps & Packages

| Path | Description | Dev port | Production |
|---|---|---|---|
| `apps/home` | Hub landing page; links each builder only once it is live | `4002` | `pilihpendidikan.com` + `www.` 301 (Worker `home-pilihpendidikan`) |
| `apps/cv` | CV builder (four templates, PDF + JSON export) | `4003` | `cv.pilihpendidikan.com` (Worker `cv-pilihpendidikan`) |
| `apps/invoice` | Invoice builder with Indonesian region data | `4004` | `invoice.pilihpendidikan.com` (Worker `invoice-pilihpendidikan`) |
| `apps/portfolio` | Apple Developer Academy portfolio builder (A4 landscape) | `4005` | `portfolio.pilihpendidikan.com` (Worker `portfolio-pilihpendidikan`) |
| `apps/api` | Backend Worker: cloud save, sign-in, tokens, OAuth (MCP clients + the `pilih-jobs-cli` first-party client), MCP server, and the Job Tracker API `/api/v1/*` with its queue consumer and crons | `8788` (wrangler dev) | `api.pilihpendidikan.com` |
| `apps/jobs` | Job Tracker dashboard (TanStack Start SSR, BFF session cookie, Zedative) | `4007` | `jobs.pilihpendidikan.com` (Worker `jobs-pilihpendidikan`; not deployed, hub entry `soon`) |
| `apps/jobs-cli` | `pilih-jobs` Python CLI (uv project; `package.json` is a Turborepo shim): discovery, browser agent, worker, sync | — | PyPI `pilih-jobs` (not published) |
| `apps/design` | Zedative design system page (Vite SPA, renders `@rulisme/ui` from source) | `4006` | not deployed |
| `packages/ui` | `@rulisme/ui` shared components and the Zedative theme (apps compile it from `src/`; `dist/` for package exports) | — | — |
| `packages/config` | `@pilihpendidikan/config`: `tsconfig.base.json`, `motion.css` | — | — |
| `packages/jobs-contracts` | `@pilihpendidikan/jobs-contracts`: Job Tracker Zod contracts (records, `/api/v1` schemas, state machines, fingerprint, adapters manifest), committed JSON Schema, golden test vectors | — | — |
| `packages/cv-engine` | `@pilihpendidikan/cv-engine`: `CVData` types and schema, markdown export, bullets; `./pdf` (browser only) holds the four `@react-pdf` templates and `renderCvPdfBlob` | — | — |

## Project Conventions

### Code Style

- Biome (`biome.jsonc`) is the only linter/formatter: `bun x ultracite fix`, then `bun run check`
- Files `kebab-case.tsx`; route-private files start with `-`
- Named exports, PascalCase function components, no default-exported components
- React 19 ref-as-prop (no `forwardRef`); `data-slot` on primitives
- No barrel files; `@/*` alias per app; shared UI via `@rulisme/ui/<dir>/<file>`
- Design follows `DESIGN.md` (Zedative) and `TYPOGRAPHY.md`; tokens live only in the shared theme, and every app's `styles.css` is parity-checked to import it and define nothing

### Architecture Patterns

- Each app is a single editor route (`/` English, `/id` Indonesian) with a split form/preview layout and a `*-generator.tsx` orchestrator
- Every document type has an on-screen preview (`*-preview.tsx`) and a separate `@react-pdf` renderer (`*-pdf.tsx`); keep them in sync by hand. The CV renderers live in `packages/cv-engine/src/pdf` (`scripts/check-cv-template-parity.ts` guards the pairs); the Worker must never import `@pilihpendidikan/cv-engine/pdf`
- The Job Tracker is different from the builders: `apps/jobs` keeps the API bearer in a sealed `HttpOnly` `__Host-jobs-session` cookie and calls `apps/api` server-side (BFF, D-15); `/api/v1` is bearer-only, user-scoped (`user_id` from the lazy `users` row, D-03), not-owned = 404 with no admin bypass (D-26), revisioned (`base_revision` → 409) and idempotent (`Idempotency-Key`); only `apps/api/src/jobs/repo/**` touches `JOBS_DB`
- Drafts persist to `localStorage`; cloud documents load via `?cv=`, `?invoice=` or `?portfolio=` and save optimistically through `useCloudSave` with a Bearer token
- The backend origin is the `MCP_API` constant in each generator (`localhost:8788` in dev, `api.pilihpendidikan.com` in prod)
- OG images come from the public `og.bahrul.me` endpoint (`src/lib/og-url.ts`)

### Testing Strategy

- Vitest per app, `bun test` for `apps/api` and the two TS packages, pytest for `apps/jobs-cli` (`bun run test` fans out through Turborepo; the Python leg needs `uv`, `scripts/require-uv.sh`)
- Spec-numbered tests carry their id in the title (`T6-03 …`, `test_T20_01_…`, `S-31 …`)
- `bun run check` must pass before committing; `bun run build` must succeed for every app
- Browser checks with `agent-browser` against the dev servers

### Git Workflow

- `main` is the default branch; no remote is configured yet
- Commit messages: imperative subject, body explaining why

## Domain Context

- CV templates: basic, harvard, simple, standard
- Invoices use Indonesian administrative regions (province → city → district) from BPS wilayah data
- Portfolios follow the Apple Developer Academy Indonesia submission rules: up to 5 projects, fixed character limits, 16:9 images, A4 landscape
- Job Tracker vocabulary (`job-tracker-spec/00-README.md` §7): posting, fingerprint (`fp1:`), tracked job, application (stages `saved` … `withdrawn`, submission status), application modes `manual` / `assisted` / `approval` / `auto`, automation task, lease, attempt, device, fact sheet, answer bank, evidence, outbox, change feed. Decisions are D-01…D-36, open assumptions A-01…A-11

## Important Constraints

- Printed documents are ink on white paper inside the Zedative chrome, in light and Night Desk alike: Inter only, no uppercase or letter-spacing, Zedative ink colours, print sizes and the static weights 400 / 600 / 700 (the PDFs embed `@fontsource/inter`)
- No deploys, DNS changes or remote data migrations without the owner's approval. For the Job Tracker this includes creating `JOBS_DB`, `JOBS_FILES` and the `jobs-ai` queues, `OPENAI_API_KEY`, the legacy `JOBS_KV` → `JOBS_DB` migration `--execute`, flipping D-33 flags in production, and publishing `pilih-jobs`
- Discovery never uses Scrapling's stealth features and never touches LinkedIn or Indeed (D-16, D-17); submissions are never inferred (D-18) and a lease lost after `submit_intent` is never retried (D-19); `auto` mode stays behind `JOBS_AUTO_MODE_ENABLED` and the A-07 legal review

## External Dependencies

- Cloudflare Workers (hosting, custom domains)
- `og.bahrul.me` (public OG image renderer)
- `api.pilihpendidikan.com` (`apps/api`) for cloud save, auth, MCP and the Job Tracker API
- OpenAI API (Decisions `gpt-6-luna`, Responses Structured Outputs), from `apps/api` only (D-12)
- Job sources: official ATS JSON board APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable), Workday (opt-in), career pages; PyPI for the CLI
