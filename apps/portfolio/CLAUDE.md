# apps/portfolio-bahrul — Portfolio Builder

TanStack Start (SSR) app that builds and exports a locked **Apple Developer
Academy** portfolio (A4 **landscape**) as PDF + JSON. Consumes the shared
`@rulisme/ui` library. Deployed to Cloudflare via `@cloudflare/vite-plugin`.
Host: `portfolio.bahrul.me`.

## Commands

- `bun dev` — Vite dev server on port **4005** (`vite dev --port 4005`)
- `bun run build` / `bun run preview`
- `bun run test` — Vitest (`vitest run`)
- `bun run lint` — **ESLint** (`@tanstack/eslint-config`); `bun run format` — Prettier
- `bun run typecheck` — `tsc --noEmit` (**the real gate for this app**)
- `bun run deploy` — `wrangler deploy`

> **Toolchain differs from the rest of the repo.** portfolio-bahrul (like
> cv-bahrul / invoice-bahrul) lints with **ESLint + Prettier** (no-semicolon
> style) and is **excluded from Biome/Ultracite** in the root `biome.jsonc`.
> Verify with `bun run typecheck` + Prettier, NOT `bun x ultracite`. The root
> `bun run check` / `ultracite fix` skip this app's files.

## Structure

- `src/router.tsx` — TanStack Router setup; routes in `src/routes/` (`__root.tsx`
  + sibling `__root-components.tsx` / `__root-helpers.ts`, `index.tsx` = EN,
  `id.tsx` = ID, `$.tsx` catch-all). `routeTree.gen.ts` is generated — never edit.
- `src/components/portfolio-data-model.ts` — the verbatim ADA data model
  (`Portfolio`, `PortfolioOwner`, `Affiliation` union, `Project`, `MediaAsset`,
  `Track`, `LIMITS`, `LINES`, `MAX_PROJECTS=5`, `isValidImageRatio`). Source of
  truth ported from `portfolio-mock/portfolio-data-model.ts`.
- `src/components/portfolio-form.tsx` — editor (owner + up to 5 projects). Clamps
  every text field to `LIMITS` chars; chip inputs bounded by `maxItems`; the
  image upload **rejects anything not exactly 16:9** (`isValidImageRatio`).
- `src/components/portfolio-preview.tsx` — the locked A4-landscape preview (dark
  cover + up to 5 project pages). Uses the `.pf-*` scoped CSS in `styles.css`;
  fit-scales the natural-size deck to the pane via a ResizeObserver transform.
- `src/components/portfolio-pdf.tsx` — `@react-pdf/renderer` `<PortfolioDocument>`
  reproducing the same A4-landscape layout (separate renderer; keep in sync with
  the preview by hand). Loaded via dynamic `import()` at download time.
- `src/components/portfolio-generator.tsx` — 50/50 split orchestration + toolbar
  (MCP token dialog, import JSON, prefill sample, clear-all confirm, theme,
  language) + download dropdown (PDF/JSON) + `PortfolioPrintView` (`?print=1` →
  `window.print()`, used by the `/portfolio/<slug>.pdf` redirect).
- `src/lib/use-cloud-save.ts` — owner-authenticated optimistic cloud save
  (`resource: "portfolio"`, `PUT /api/portfolio/:id`, Bearer-gated, rollback).
- `src/data/sample-portfolio.json` — sample document (prefill).

## Locked layout (do not loosen)

The portfolio is a **fixed-footprint** print artifact. Every locked rule from
`portfolio-mock/index.html` is preserved in the `.pf-*` block of `src/styles.css`:
fixed 16:9 image slot (150mm), bounded Scope-of-Work list, `-webkit-line-clamp`
per `LINES`, `align-content: start`, equal 12px rhythm, char caps per `LIMITS`.

## Design system — Warp (see `DESIGN.md`)

App chrome is the shared dark Warp system (`@theme` mirrors cv/invoice; light +
dark via next-themes). The **cover** is `#121212`; **project pages stay
print-light** (ink on paper) but adopt Matter type + tracked uppercase eyebrows.
NO drop shadows (pages get a hairline border), tags are 4px (never pills), text
is warm off-white `#faf9f6` (never pure `#fff`); accents `#bd9f65` / `#6f839f`
only in link/eyebrow contexts.

## Shared UI

Imports primitives from `@rulisme/ui` (resolves to its built `dist/` — run
`bun run build` in `packages/ui` first, or imports are stale/missing).

## Browser testing

Use `agent-browser` (not chrome-devtools/claude-in-chrome MCP):
`agent-browser open http://localhost:4005 && agent-browser screenshot pf.png`.
