# apps/portfolio — Portfolio Builder

TanStack Start (SSR) app that builds and exports a locked **Apple Developer
Academy** portfolio (A4 **landscape**) as PDF + JSON. Consumes the shared
`@rulisme/ui` library. Deployed to Cloudflare Workers via
`@cloudflare/vite-plugin` as `portfolio-pilihpendidikan` on
`portfolio.pilihpendidikan.com`.

Workspace-wide rules (commands, conventions, typography) live in the root
`CLAUDE.md`, `TYPOGRAPHY.md` and `DESIGN.md`; proposals go in the root
`openspec/` (prefix change ids with `portfolio-`).

## Commands

- `bun dev` — Vite dev server on port **4005**
- `bun run build` — `wrangler types` + `vite build`; `bun run preview`
- `bun run test` — Vitest
- `bun run lint` — Biome (`biome check .`); `bun run format` — Biome autofix
- `bun run typecheck` — `wrangler types` + `tsc --noEmit`
- `bun run deploy` — `wrangler deploy` (owner approval required)

Like `apps/cv` and `apps/invoice`, this app is covered by the root Biome
config, the typography lint and the typography parity check — run
`bun x ultracite fix && bun run check` from the repo root.

## Structure

- `src/router.tsx` — TanStack Router setup; routes in `src/routes/` (`__root.tsx`
  + route-private `-root-components.tsx` / `-root-helpers.ts`, `index.tsx` = EN,
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
  `window.print()`, used by the `/portfolio/<slug>.pdf` redirect on `apps/api`).
- `src/lib/use-cloud-save.ts` — owner-authenticated optimistic cloud save
  (`resource: "portfolio"`, `PUT /api/portfolio/:id`, Bearer-gated, rollback).
  `MCP_API` in `portfolio-generator.tsx` is `http://localhost:8788` in dev
  (`apps/api`) and `https://api.pilihpendidikan.com` in prod; tokens are minted
  at `https://api.pilihpendidikan.com/connect`.
- `src/data/sample-portfolio.json` — sample document (prefill).

## Locked layout (do not loosen)

The portfolio is a **fixed-footprint** print artifact. The `.pf-*` block of
`src/styles.css` keeps every locked rule from `portfolio-mock/index.html`:
bounded Scope-of-Work list, `-webkit-line-clamp` per `LINES`, char caps per
`LIMITS`. The project page is a flex column that **fills the A4 page**: the
rail+content row (`.pf-project-main`) grows to absorb slack, so the **16:9
image slot grows (height-driven, never cropped)** to fill the empty space, and
the reflection strip + footer pack flush at the bottom. Keep the slot exactly
16:9 (uploads are pre-validated 16:9) and never let content overflow the page.

## Design system — Warp (see `DESIGN.md`)

App chrome is the shared dark Warp system (`@theme` typography is byte-identical
to apps/cv and apps/invoice — `bun run parity:typography`; light + dark via
next-themes). The **cover** is `#121212`; **project pages stay
print-light** (ink on paper) but adopt Matter type + tracked uppercase eyebrows.
NO drop shadows (pages get a hairline border), tags are 4px (never pills), text
is warm off-white `#faf9f6` (never pure `#fff`); accents `#bd9f65` / `#6f839f`
only in link/eyebrow contexts.

## Shared UI

Imports primitives from `@rulisme/ui` (resolves to its built `dist/` at runtime —
run `bun run build` in `packages/ui` first, or use the root `bun dev`).

## Browser testing

Use `agent-browser` (not chrome-devtools/claude-in-chrome MCP):
`agent-browser open http://localhost:4005 && agent-browser screenshot pf.png`.
