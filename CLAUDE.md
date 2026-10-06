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
app on Cloudflare Workers, plus the backend Worker they save to.

The apps were extracted from the `bahrul` monorepo with their git history.
This repo is self-contained: it installs, checks and builds on its own.

## Architecture

- Bun workspace with Turborepo orchestration (`apps/*`, `packages/*`)
- `apps/cv` — CV builder (TanStack Start SSR, dev port `4003`) → `cv.pilihpendidikan.com` (Worker `cv-pilihpendidikan`)
- `apps/invoice` — invoice builder with Indonesian region data (dev port `4004`) → `invoice.pilihpendidikan.com` (Worker `invoice-pilihpendidikan`)
- `apps/portfolio` — Apple Developer Academy portfolio builder, A4 landscape (dev port `4005`) → `portfolio.pilihpendidikan.com` (Worker `portfolio-pilihpendidikan`)
- `apps/api` — backend Worker at `api.pilihpendidikan.com` (dev `wrangler dev` on `localhost:8788`): cloud save and public reads for cv/invoice/portfolio/jobs, email-link sign-in, personal tokens (`/connect`), PDF print redirects and the MCP server (`/sse`, `/mcp`). Added by a follow-up change; the three apps already point at it
- `packages/ui` — `@rulisme/ui`, the shared React 19 component library (built to `dist/`, consumed by all three apps)
- `packages/config` — `@pilihpendidikan/config`: shared `tsconfig.base.json` and `motion.css`
- `openspec/` — spec-driven change management (see `openspec/AGENTS.md`)

The apps talk to the backend through one constant per app (`MCP_API` in
`src/components/*-generator.tsx`): `http://localhost:8788` in dev,
`https://api.pilihpendidikan.com` in prod. OG images use the public
`https://og.bahrul.me` endpoint (`src/lib/og-url.ts`).

## Stack

- **Runtime**: Bun 1.4.2, Cloudflare Workers (`@cloudflare/vite-plugin`, `nodejs_compat`)
- **Framework**: React 19 + TanStack Router + TanStack Start (SSR)
- **Build**: Vite 8 (Rolldown); `packages/ui` builds with Vite library mode + `tsc` declarations
- **Styling**: Tailwind CSS 4 (CSS-native config, `@theme inline`)
- **UI**: shadcn/ui + `@base-ui/react` / Radix primitives + CVA variants, via `@rulisme/ui`
- **PDF**: `@react-pdf/renderer` (one `*-pdf.tsx` renderer per document type)
- **Lint/format**: Biome 2.5 with the Ultracite rule set (`biome.jsonc`)
- **Tests**: Vitest per app
- **Icons**: lucide-react
- **Font**: Inter 400/500 and Geist Mono 400, self-hosted via `@fontsource` in each app's `src/styles.css`. `--font-sans` lists "Matter" first, but Matter is not loaded, so Inter renders

## Commands

- `bun install` — install the workspace
- `bun dev` — Turborepo fan-out (`@rulisme/ui` watch build + the three apps)
- `bun run dev:cv` / `dev:invoice` / `dev:portfolio` — one app plus the `@rulisme/ui` watch build it depends on
- `bun run build` — build `packages/ui`, then every app (`wrangler types` + `vite build`)
- `bun run check` — full chain: `biome check` → `turbo lint` → `lint:typography` → `parity:typography` → `parity:twmerge` → `test` → `audit`
- `bun x ultracite fix` (or `bun run fix`) — format and autofix
- `bun run check-types` — `tsc` for `scripts/` plus `turbo typecheck`
- `bun run lint:typography` — typography rule enforcement (see `TYPOGRAPHY.md`)
- `bun run parity:typography` — the Warp `@theme inline` typography tokens stay byte-identical across `apps/cv` (canonical), `apps/invoice` and `apps/portfolio`
- `bun run parity:twmerge` — the `cn()` the apps use (`packages/ui/src/lib/utils.ts`) registers every Warp font-size token (twMerge silently strips unregistered `text-*` sizes)

Run `bun x ultracite fix && bun run check` before committing.

## Deploy

Each app deploys with `bun run deploy` (`wrangler deploy`) from its directory
after `bun run build`. Every `wrangler.jsonc` binds its Worker to a custom
domain (`routes: [{ pattern: "<app>.pilihpendidikan.com", custom_domain: true }]`).
Deploys, DNS and Cloudflare resources need the owner's go-ahead.

## Conventions

- Files: `kebab-case.tsx`; TanStack route-private files start with `-` (`-root-components.tsx`)
- Components: named exports, PascalCase, function components only; no default exports for components
- Imports: each app owns its `@/*` alias (→ `src/*`); shared UI from `@rulisme/ui/<dir>/<file>`. No barrel files. Verbatim module syntax
- React 19 ref-as-prop (no `forwardRef`); `data-slot` attributes on UI primitives
- `routeTree.gen.ts` is generated — never edit it by hand
- Design tokens live in each app's `src/styles.css` (`@theme inline`); never hardcode hex or `text-[Npx]` in chrome
- Re-skin a shared primitive once in `packages/ui`, then rebuild it — never fork per app

## Design system

All three apps use the dark **Warp** ("moonlit terminal") design system
(`DESIGN.md`). Typography rules live in `TYPOGRAPHY.md`, which CI enforces.

- Named size tokens bake line-height and tracking: `text-display`, `text-heading-lg`, `text-heading`, `text-heading-sm`, `text-subheading`, `text-body`, `text-body-sm`, `text-caption-tracked`, `text-micro`. `text-xs` is the compact-chrome default.
- Weights are 400/500 only (`font-regular` / `font-medium`); `font-bold` and `font-semibold` are forbidden in chrome.
- Print artifacts are the exception: the CV templates, the invoice page and the portfolio deck render ink on paper and mirror their `@react-pdf` output (see `TYPOGRAPHY.md` § Exceptions).
- Dark is canonical; next-themes toggles the `.dark` class.

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
