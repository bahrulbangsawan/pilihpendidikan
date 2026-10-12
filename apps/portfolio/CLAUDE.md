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
  Its empty state is chrome (`Empty` from `@rulisme/ui`).
- `src/components/portfolio-pdf.tsx` — `@react-pdf/renderer` `<PortfolioDocument>`
  reproducing the same A4-landscape layout (separate renderer; keep in sync with
  the preview by hand). Loaded via dynamic `import()` at download time.
- `src/components/portfolio-generator.tsx` — 50/50 split orchestration + form
  toolbar (MCP token dialog, import JSON, prefill sample, clear-all confirm,
  theme, language) + preview toolbar (the primary **Download PDF** button with
  its `D` shortcut, and a format menu for PDF/JSON; a floating download menu on
  mobile) + `PortfolioPrintView` (`?print=1` → `window.print()`, used by the
  `/portfolio/<slug>.pdf` redirect on `apps/api`).
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

## Design system — Zedative

The chrome follows the root `DESIGN.md` (rules mapped to code in its
**Implementation** section) and `TYPOGRAPHY.md`; `src/styles.css` only imports
the shared theme (`bun run parity:typography`) and adds the deck's `.pf-*`
print CSS. What is specific to this app:

- **Editor frame.** A split view: each pane is headed by a 56px toolbar band
  (`h-14`, `border-line` rule, `size="sm"` / `icon-sm` buttons), the panes are
  divided by a `line` rule, a `Diamond` marks where the toolbar rule crosses the
  divider, and the deck rests on `graph-paper`. Form sections are full-bleed
  `Band`s. Below `md` the panes stack and a floating button downloads.
- **Theme.** Light is canonical: next-themes runs with `defaultTheme="light"`
  and `enableSystem={false}` (the inline script in `__root.tsx` matches it);
  the toolbar toggle switches to Night Desk (`.dark`).
- **Shortcut.** The primary action is downloading the PDF: the toolbar button
  carries `<Kbd>D</Kbd>` and `aria-keyshortcuts="D"`, and `useShortcut("D")`
  performs the same download (never while typing, never behind an open
  window). Keep the hint and the shortcut together.
- **Print document (the deck).** The deck is ink on paper and mirrors its
  `@react-pdf` twin (`TYPOGRAPHY.md` § Exceptions): literal colours, never
  re-themed by Night Desk, its own base type (it does not inherit the chrome's
  body role) in Inter at weights 400 / 600 / 700, copy in sentence case with
  no letter-spacing. The PDF's type comes from the shared print module
  (`@rulisme/ui/print/pdf-fonts`, registered by `src/lib/pdf-fonts.ts`): the
  merged Inter cuts and the line-break policy (words whole, breaks after
  hyphens, dashes and slashes, long URLs and emails at their separators);
  `.pf-deck` sets `overflow-wrap: anywhere`. `src/lib/pdf-text.ts` runs every
  string through `@rulisme/ui/print/pdf-text`, collapsing spaces and line
  breaks as the preview's paragraphs do.
  `.pf-deck` prints in colour (`print-color-adjust: exact`), so the cover slab
  survives a browser print. It takes Zedative's colours in
  **both renderers, kept in sync by hand**: the cover is `shot` `#2f343e` with
  `#fafafa` text, `#b4b9c3` / `#9aa1ad` secondary text and a `#4a505c` rule;
  links are cobalt `#1348dc` on paper and the lifted `#7c9cff` on the cover
  (every text pair ≥ 4.5:1); tags and badges are 2px chips; no drop shadows
  (the sheet gets a 1px `border` frame on screen, removed in print).

## Shared UI

Imports primitives from `@rulisme/ui`, compiled from `packages/ui/src`
(tsconfig `paths` + Vite `resolve.tsconfigPaths`; Tailwind `@source`s the same
folder), so component edits show up without a library build.

## Browser testing

Use `agent-browser` (not chrome-devtools/claude-in-chrome MCP):
`agent-browser open http://localhost:4005 && agent-browser screenshot pf.png`.
