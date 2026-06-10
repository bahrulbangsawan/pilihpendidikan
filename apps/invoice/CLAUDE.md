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

## Design system — Warp ("moonlit terminal")

This app and `apps/cv-bahrul` share one dark, warm-neutral terminal design system (DESIGN.md "Warp"). The two apps' `src/styles.css` `@theme` blocks are **byte-identical** (parity-diffed) and are the **single source of truth** — never hardcode hex or `text-[Npx]` in components; use tokens.

- **Dark by default.** `<html class="dark">` is set in `src/routes/__root-shell.tsx`; `theme-color` is `#121212`. There is no light theme for the editor chrome.
- **Surfaces (elevation ladder).** canvas `#121212` (`--background`) · banded `#1e1e1d` · card `#2f2f2f` (`--card`) · control `#383838` (`--secondary`/`--accent`) · floating `#40403f` (`--popover` — dialogs/popovers/selects). Text is warm off-white `#faf9f6` (`--foreground`) — **never `#fff`**; muted text is pale-stone `#b4b4b2`; hairline borders are warm off-white at ~12%.
- **Semantic mapping.** shadcn/reui vars (`--background`, `--card`, `--primary`, `--border`, `--muted`, `--popover`, …) are mapped onto Warp surfaces in `:root`/`.dark`, so every `@rulisme/ui` primitive inherits the skin. Re-skin a primitive **once** in `packages/ui` (then rebuild it) — never fork per app.
- **Type.** `--font-sans` is the Matter stack (system fallback); `--font-mono` is Geist/Matter Mono for code chips only. Named scale tokens (`text-display` → `text-heading-lg` → … → `text-caption-tracked` → `text-micro`) pair size + line-height + tracking: negative tracking at display sizes, `+2.2px` tracked 11px uppercase eyebrows (`text-caption-tracked uppercase`). Weights are **400/500 only** — `font-bold`/`font-semibold` are forbidden in chrome.
- **Radius.** buttons/nav `4px` (`rounded-sm`/`rounded-md`), cards/icons/floating panels `8px` (`rounded-lg`), `xl 14px`, images `20px` (`rounded-2xl`). Buttons are **never pill-shaped**; `rounded-full` is reserved for true circles (avatars, switches, FABs, number badges).
- **Spacing.** Tailwind's native 4-pt scale carries DESIGN.md's rhythm; DESIGN.md's px spacing values are **not** injected as `--spacing-N` overrides (that would silently rescale every existing `p-*`/`gap-*`).
- **Accent discipline.** `--color-gold-leaf` (`#bd9f65`) and `--color-muted-cobalt` (`#6f839f`) appear **only** in code/terminal/syntax and section headings — never on buttons, tags, or badges. No new bright brand color. **No shadows** anywhere — the system is flat. Focus rings are neutral (`--ring` pale-stone). Exception: the per-invoice **accent color** (`accentColor`, default `#f48120`, and the swatch presets in `invoice-form.tsx`) is **document content** — the user's invoice branding applied to the invoice output — not editor chrome, and is intentionally left as raw hex.
- **Print-template exception (do NOT dark-theme).** The rendered invoice is a print artifact. `src/components/{invoice-preview,invoice-pdf}.tsx` and the `.invoice-page` document stay **light/print-faithful** (ink on white paper). `.invoice-page` is a self-contained light "island": `src/styles.css` locally re-scopes `--foreground`/`--border`/`--background`/`--card` to print values and pins the Helvetica print font, so the document renders ink-on-paper regardless of the dark editor around it. Apply Warp only to editor chrome.
- **Bundled fonts · hidden scrollbars.** Inter (UI body, weights 400/500) and Geist Mono (code chips) are bundled via `@fontsource` and `@import`ed at the top of `src/styles.css`, so the `--font-sans`/`--font-mono` stacks render their substitutes when Matter is unavailable. Editor scroll panels use the `scrollbar-hide` utility (defined in `src/styles.css`) to hide the scrollbar while keeping scroll behavior.
