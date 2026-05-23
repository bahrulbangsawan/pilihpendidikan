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

# apps/cv-bahrul — CV Builder

TanStack Start (SSR) app that builds and exports CVs as PDFs. Consumes the shared `@rulisme/ui` library. Deployed to Cloudflare via `@cloudflare/vite-plugin`.

## Commands

- `bun dev` — Vite dev server on port **4003** (`vite dev --port 4003`)
- `bun run build` / `bun run preview`
- `bun run test` — Vitest (`vitest run`)
- `bun run lint` — **ESLint** (`@tanstack/eslint-config`); `bun run format` — Prettier
- `bun run typecheck` — `tsc --noEmit`
- `bun run deploy` — `wrangler deploy`

> **Toolchain differs from the rest of the repo.** cv-bahrul (and invoice-bahrul) lint with **ESLint + Prettier** and test with **Vitest** — not the Biome/Ultracite + typography lint chain used by `apps/web`/`apps/mcp-ui`. Run `bun run lint && bun run typecheck && bun run test` here, not `bun x ultracite`.

## Structure

- `src/router.tsx` — TanStack Router setup; routes in `src/routes/` (`__root.tsx`, `index.tsx`, `$.tsx` catch-all). `routeTree.gen.ts` is generated — never edit by hand.
- `src/components/cv-form.tsx` / `cv-preview.tsx` / `cv-pdf.tsx` — the editing form, live preview, and PDF renderer.
- `src/components/templates/` — one `-pdf.tsx` + `-preview.tsx` pair per template (`basic`, `harvard`, `simple`, `standard`). Add a template by creating both halves and wiring them into the picker.
- `src/data/sample-cv.json` — sample document shape.
- PDFs are generated with `@react-pdf/renderer` — `*-pdf.tsx` use `@react-pdf` primitives (not DOM elements), so preview and PDF layouts are maintained separately; keep them in sync by hand.

## Shared UI

- Imports primitives from `@rulisme/ui` (e.g. `@rulisme/ui/ui/button`, `@rulisme/ui/form/form-field`, `@rulisme/ui/lib/utils`).
- `@rulisme/ui` resolves to its built `dist/` — **run `bun run build` (or `bun run dev`) in `packages/ui` first**, or imports resolve to stale/missing files. See `packages/ui/CLAUDE.md`.
- shadcn config in `components.json`. Tailwind 4.

## Browser testing

Use `agent-browser` (not chrome-devtools/claude-in-chrome MCP): `agent-browser open http://localhost:4003 && agent-browser screenshot cv.png`.

<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `bunx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
