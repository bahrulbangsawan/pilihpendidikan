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

## Design system — Warp ("moonlit terminal")

This app and `apps/invoice-bahrul` share one dark, warm-neutral terminal design system (DESIGN.md "Warp"). The two apps' `src/styles.css` `@theme` blocks are **byte-identical** (parity-diffed) and are the **single source of truth** — never hardcode hex or `text-[Npx]` in components; use tokens.

- **Dark by default.** `<html class="dark">` is set in `src/routes/__root-components.tsx`; `theme-color` is `#121212`. There is no light theme for the editor chrome.
- **Surfaces (elevation ladder).** canvas `#121212` (`--background`) · banded `#1e1e1d` · card `#2f2f2f` (`--card`) · control `#383838` (`--secondary`/`--accent`) · floating `#40403f` (`--popover` — dialogs/popovers/selects). Text is warm off-white `#faf9f6` (`--foreground`) — **never `#fff`**; muted text is pale-stone `#b4b4b2`; hairline borders are warm off-white at ~12%.
- **Semantic mapping.** shadcn/reui vars (`--background`, `--card`, `--primary`, `--border`, `--muted`, `--popover`, …) are mapped onto Warp surfaces in `:root`/`.dark`, so every `@rulisme/ui` primitive inherits the skin. Re-skin a primitive **once** in `packages/ui` (then rebuild it) — never fork per app.
- **Type.** `--font-sans` is the Matter stack (system fallback); `--font-mono` is Geist/Matter Mono for code chips only. Named scale tokens (`text-display` → `text-heading-lg` → … → `text-caption-tracked` → `text-micro`) pair size + line-height + tracking: negative tracking at display sizes, `+2.2px` tracked 11px uppercase eyebrows (`text-caption-tracked uppercase`). Weights are **400/500 only** — `font-bold`/`font-semibold` are forbidden in chrome.
- **Radius.** buttons/nav `4px` (`rounded-sm`/`rounded-md`), cards/icons/floating panels `8px` (`rounded-lg`), `xl 14px`, images `20px` (`rounded-2xl`). Buttons are **never pill-shaped**; `rounded-full` is reserved for true circles (avatars, switches, FABs, number badges).
- **Spacing.** Tailwind's native 4-pt scale carries DESIGN.md's rhythm; DESIGN.md's px spacing values are **not** injected as `--spacing-N` overrides (that would silently rescale every existing `p-*`/`gap-*`).
- **Accent discipline.** `--color-gold-leaf` (`#bd9f65`) and `--color-muted-cobalt` (`#6f839f`) appear **only** in code/terminal/syntax and section headings — never on buttons, tags, or badges. No new bright brand color. **No shadows** anywhere — the system is flat. Focus rings are neutral (`--ring` pale-stone).
- **Print-template exception (do NOT dark-theme).** The rendered CV is a print artifact. `src/components/templates/{basic,harvard,simple,standard}-{preview,pdf}.tsx` and the `.cv-page` document stay **light/print-faithful** (ink on white paper). `.cv-page` is a self-contained light "island": `src/styles.css` locally re-scopes `--foreground`/`--border`/`--background`/`--card` to print values and pins the Helvetica print font, so the document renders ink-on-paper regardless of the dark editor around it. Apply Warp only to editor chrome.
- **Bundled fonts · hidden scrollbars.** Inter (UI body, weights 400/500) and Geist Mono (code chips) are bundled via `@fontsource` and `@import`ed at the top of `src/styles.css`, so the `--font-sans`/`--font-mono` stacks render their substitutes when Matter is unavailable. Editor scroll panels use the `scrollbar-hide` utility (defined in `src/styles.css`) to hide the scrollbar while keeping scroll behavior.
