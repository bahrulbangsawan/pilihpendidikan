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

The apps were extracted from the `bahrul` monorepo with their git history.
This repo is self-contained: it installs, checks and builds on its own.

## Architecture

- Bun workspace with Turborepo orchestration (`apps/*`, `packages/*`)
- `apps/home` — hub landing page (TanStack Start SSR, dev port `4002`) → `pilihpendidikan.com`, with `www.` 301ing to the apex (Worker `home-pilihpendidikan`). One page in English (`/`) and Indonesian (`/id`). It links a builder or the MCP endpoint only when that service's entry in `src/config/services.ts` is `"live"`; `src/server.ts` does the www redirect and security headers; `/llms.txt` is generated from the same config
- `apps/cv` — CV builder (TanStack Start SSR, dev port `4003`) → `cv.pilihpendidikan.com` (Worker `cv-pilihpendidikan`)
- `apps/invoice` — invoice builder with Indonesian region data (dev port `4004`) → `invoice.pilihpendidikan.com` (Worker `invoice-pilihpendidikan`)
- `apps/portfolio` — Apple Developer Academy portfolio builder, A4 landscape (dev port `4005`) → `portfolio.pilihpendidikan.com` (Worker `portfolio-pilihpendidikan`)
- `apps/api` — backend Worker at `api.pilihpendidikan.com` (dev `wrangler dev` on `localhost:8788`): cloud save and public reads for cv/invoice/portfolio/jobs, email-link sign-in, personal tokens (`/connect`), PDF print redirects and the MCP server (`/mcp`, `/sse`). Hand-written router, D1 `pilihpendidikan` + KV (`AUTH_KV`, `CV_KV`, rebound `INVOICE_KV` / `PORTFOLIO_KV` / `JOBS_KV`, `RATE_LIMIT_KV`), Durable Object `PilihMcpServer`, tests with `bun test`. See `apps/api/CLAUDE.md`
- `apps/design` — the Zedative design system page (Vite SPA, dev port `4006`, not deployed): foundations, every `@rulisme/ui` component with pinned states, do/don't pairs, recipes. It renders `@rulisme/ui` from source (`vite.config.ts` alias), so component edits hot-reload there
- `packages/ui` — `@rulisme/ui`, the shared React 19 component library and the one Zedative theme (`src/styles/theme.css` → `@rulisme/ui/styles/theme.css`). Every app compiles it from `src/` (tsconfig `paths` + Vite `resolve.tsconfigPaths`, and Tailwind `@source`s `packages/ui/src`); `bun run build` also emits a `dist/` for its package exports
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
- **UI**: shadcn/ui (all 61 CLI components, lyra geometry, radix base) + `@base-ui/react` / Radix primitives + CVA variants, via `@rulisme/ui`, restyled to Zedative
- **PDF**: `@react-pdf/renderer` (one `*-pdf.tsx` renderer per document type)
- **Lint/format**: Biome 2.5 with the Ultracite rule set (`biome.jsonc`)
- **Tests**: Vitest per app; `bun test` for `apps/api`
- **Icons**: lucide-react
- **Font**: Inter Variable 4.0 with its `opsz` axis (`@fontsource-variable/inter`), loaded once by `@rulisme/ui/styles/theme.css`; it is the only family (every `--font-*` token resolves to it)

## Commands

- `bun install` — install the workspace
- `bun dev` — Turborepo fan-out (`@rulisme/ui` watch build + the hub, the three builders, the design page + the api Worker on `:8788`)
- `bun run dev:home` / `dev:cv` / `dev:invoice` / `dev:portfolio` — one app plus the `@rulisme/ui` watch build it depends on
- `bun run dev:design` — the design system page on `:4006` (renders `@rulisme/ui` from source; no library build needed)
- `bun run dev:api` — only the api Worker (`wrangler dev` on `:8788`; run `bun run db:migrate:local` in `apps/api` once first)
- `bun run build` — build `packages/ui`, then every app (`wrangler types` + `vite build`)
- `bun run check` — full chain: `biome check` → `turbo lint` → `lint:typography` → `parity:typography` → `parity:twmerge` → `parity:showcase` → `test` → `audit`
- `bun x ultracite fix` (or `bun run fix`) — format and autofix
- `bun run check-types` — `tsc` for `scripts/` plus `turbo typecheck`
- `bun run lint:typography` — Zedative style enforcement: type roles only, no `leading-*` / `tracking-*` / uppercase / `font-<weight>`, no big radii, gradients, glass, hex classes, enter animations, stray syntax colours or `dark:` overrides (see `TYPOGRAPHY.md`)
- `bun run parity:typography` — every app's `src/styles.css` imports `@rulisme/ui/styles/theme.css` and defines no tokens of its own
- `bun run parity:twmerge` — `cn()` (`packages/ui/src/lib/utils.ts`) registers every `type-*` and `weight-*` utility the theme defines
- `bun run parity:showcase` — every component file in `packages/ui/src/ui` is rendered on the design page (`apps/design`)

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
Deploys, DNS, Cloudflare resources and data migrations need the owner's go-ahead.

## Conventions

- Files: `kebab-case.tsx`; TanStack route-private files start with `-` (`-root-components.tsx`)
- Components: named exports, PascalCase, function components only; no default exports for components
- Imports: each app owns its `@/*` alias (→ `src/*`); shared UI from `@rulisme/ui/<dir>/<file>`. No barrel files. Verbatim module syntax
- React 19 ref-as-prop (no `forwardRef`); `data-slot` attributes on UI primitives
- `routeTree.gen.ts` is generated — never edit it by hand
- Design tokens live only in `packages/ui/src/styles/theme.css`; each app's `src/styles.css` imports it and adds nothing but print-artifact CSS. Never hardcode hex or arbitrary sizes in chrome
- Re-skin a shared primitive once in `packages/ui` (the apps pick it up from source) — never fork per app

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
- Light is canonical; `.dark` is the derived Night Desk scheme. next-themes toggles it in the builders (default light); the hub and the design page are light by default.
- `<Kbd>` hints inside primary actions advertise real single-letter shortcuts: register them with `useShortcut` (`@rulisme/ui/hooks/use-shortcut`), never one without the other.
- Print artifacts (the CV templates, the invoice page, the portfolio deck) follow Zedative too: Inter only, no uppercase or letter-spacing, Zedative ink colours that Night Desk never changes. They keep print sizes and the static weights 400 / 600 / 700, and each preview mirrors its `@react-pdf` output (see `TYPOGRAPHY.md` § Exceptions). The PDFs share one print module, `@rulisme/ui/print/*`: the merged Inter cuts (`pdf-fonts.ts`, rebuilt by `scripts/build-print-fonts.sh`), the line-break policy and the text normaliser (`pdf-text.ts`); each builder's `src/lib/pdf-fonts.ts` only registers them (DESIGN.md § Implementation › Print artifacts).

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
