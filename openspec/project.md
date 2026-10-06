# Project Context

## Purpose

pilihpendidikan hosts browser-based document builders for students and job
seekers — a CV builder, an invoice builder and an Apple Developer Academy
portfolio builder — plus the backend Worker that stores their documents and
exposes them to AI assistants over MCP. The apps were extracted from the
`bahrul` monorepo with their git history and now live on
`*.pilihpendidikan.com`.

## Tech Stack

- **Runtime**: Bun 1.4.2, Cloudflare Workers (`nodejs_compat`)
- **Framework**: React 19 + TanStack Router + TanStack Start (SSR)
- **Bundler**: Vite 8 with `@cloudflare/vite-plugin`; Wrangler for deploys
- **Orchestration**: Turborepo (`apps/*`, `packages/*`)
- **Styling**: Tailwind CSS 4 — CSS-native config, `@theme inline`, Warp tokens
- **UI**: `@rulisme/ui` (`packages/ui`): shadcn/ui on `@base-ui/react` / Radix + CVA
- **PDF**: `@react-pdf/renderer`
- **Icons**: lucide-react
- **Font**: Inter 400/500 + Geist Mono 400 via `@fontsource`
- **Lint/format**: Biome 2.5 with the Ultracite rule set
- **Tests**: Vitest (apps), `bun test` (`apps/api`)
- **Language**: TypeScript throughout

## Workspace Apps & Packages

| Path | Description | Dev port | Production |
|---|---|---|---|
| `apps/cv` | CV builder (four templates, PDF + JSON export) | `4003` | `cv.pilihpendidikan.com` (Worker `cv-pilihpendidikan`) |
| `apps/invoice` | Invoice builder with Indonesian region data | `4004` | `invoice.pilihpendidikan.com` (Worker `invoice-pilihpendidikan`) |
| `apps/portfolio` | Apple Developer Academy portfolio builder (A4 landscape) | `4005` | `portfolio.pilihpendidikan.com` (Worker `portfolio-pilihpendidikan`) |
| `apps/api` | Backend Worker: cloud save, sign-in, tokens, MCP server | `8788` (wrangler dev) | `api.pilihpendidikan.com` |
| `packages/ui` | `@rulisme/ui` shared components, built to `dist/` | — | — |
| `packages/config` | `@pilihpendidikan/config`: `tsconfig.base.json`, `motion.css` | — | — |

## Project Conventions

### Code Style

- Biome (`biome.jsonc`) is the only linter/formatter: `bun x ultracite fix`, then `bun run check`
- Files `kebab-case.tsx`; route-private files start with `-`
- Named exports, PascalCase function components, no default-exported components
- React 19 ref-as-prop (no `forwardRef`); `data-slot` on primitives
- No barrel files; `@/*` alias per app; shared UI via `@rulisme/ui/<dir>/<file>`
- Typography follows `TYPOGRAPHY.md`; tokens are parity-checked across the three apps

### Architecture Patterns

- Each app is a single editor route (`/` English, `/id` Indonesian) with a split form/preview layout and a `*-generator.tsx` orchestrator
- Every document type has an on-screen preview (`*-preview.tsx`) and a separate `@react-pdf` renderer (`*-pdf.tsx`); keep them in sync by hand
- Drafts persist to `localStorage`; cloud documents load via `?cv=`, `?invoice=` or `?portfolio=` and save optimistically through `useCloudSave` with a Bearer token
- The backend origin is the `MCP_API` constant in each generator (`localhost:8788` in dev, `api.pilihpendidikan.com` in prod)
- OG images come from the public `og.bahrul.me` endpoint (`src/lib/og-url.ts`)

### Testing Strategy

- Vitest per app, `bun test` for `apps/api` (`bun run test` fans out through Turborepo)
- `bun run check` must pass before committing; `bun run build` must succeed for every app
- Browser checks with `agent-browser` against the dev servers

### Git Workflow

- `main` is the default branch; no remote is configured yet
- Commit messages: imperative subject, body explaining why

## Domain Context

- CV templates: basic, harvard, simple, standard
- Invoices use Indonesian administrative regions (province → city → district) from BPS wilayah data
- Portfolios follow the Apple Developer Academy Indonesia submission rules: up to 5 projects, fixed character limits, 16:9 images, A4 landscape

## Important Constraints

- Printed documents are print-faithful light "islands" inside the dark Warp chrome
- No deploys, DNS changes or remote data migrations without the owner's approval

## External Dependencies

- Cloudflare Workers (hosting, custom domains)
- `og.bahrul.me` (public OG image renderer)
- `api.pilihpendidikan.com` (`apps/api`) for cloud save, auth and MCP
