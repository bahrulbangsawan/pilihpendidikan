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

# apps/invoice-bahrul — Invoice Builder

TanStack Start (SSR) app that builds and exports invoices as PDFs, with Indonesian region (wilayah) address data. Consumes `@rulisme/ui`. Deployed to Cloudflare via `@cloudflare/vite-plugin`.

## Commands

- `bun dev` — Vite dev server on port **4004**
- `bun run build` / `bun run preview`
- `bun run test` — Vitest; `bun run lint` — ESLint; `bun run format` — Prettier
- `bun run typecheck` — `tsc --noEmit`
- `bun run deploy` — `wrangler deploy`

> **Toolchain differs from the rest of the repo** — ESLint + Prettier + Vitest, not Biome/Ultracite. Same as cv-bahrul.

## Structure

- `src/router.tsx` + `src/routes/` (`__root.tsx`, `index.tsx`, `$.tsx`); `routeTree.gen.ts` is generated.
- `src/components/invoice-form.tsx` / `invoice-preview.tsx` / `invoice-pdf.tsx` / `invoice-generator.tsx` — form, live preview, `@react-pdf/renderer` output, and the orchestrator.
- `src/components/form/` — composed inputs (`address-fields`, `date-picker`, `period-range-picker`, `section-list-sortable`).
- `src/components/kibo-ui/color-picker/`, `src/components/reui/date-selector.tsx` — vendored UI bits not in `@rulisme/ui`.
- `src/data/wilayah/*.ts` — Indonesian province/region tables (one file per BPS province code, e.g. `11.ts`); `countries.ts` — country list. Bulk generated data — edit the source tables, don't hand-tweak individual entries.
- `src/data/sample-invoice.json` — sample document.
- Uses `date-fns` (dates), `color` (color math), `react-day-picker` (calendars).

## Shared UI

Same as cv-bahrul: imports from `@rulisme/ui/*`, which resolves to the built `dist/` — **build `packages/ui` first**. shadcn config in `components.json`.

## Browser testing

`agent-browser open http://localhost:4004 && agent-browser screenshot invoice.png` (not chrome-devtools/claude-in-chrome MCP).

<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `bunx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
