## Context

Four TanStack Start apps (`home`, `cv`, `invoice`, `portfolio`) consume
`@rulisme/ui`, a library of 27 shadcn components (radix base, "mira"
geometry) skinned to Warp through tokens each app duplicated in its own
`styles.css`. Zedative replaces Warp entirely. It is light, uses one family in
six roles with weights paired to optical size, and leans on hairlines, a
diamond motif and an inset button lip rather than surfaces and shadows.

## Goals / Non-Goals

- Goals: one source of truth for tokens; every shadcn component available
  and restyled; every app's chrome on Zedative; the rules enforced in CI; a
  page that shows the whole system.
- Non-Goals: changing what any app does; changing the printed documents'
  structure, sizes or page formats; deploying.

## Decisions

- **Shared theme, not per-app copies.** `packages/ui/src/styles/theme.css`
  holds every token and utility; apps import it. The parity script now checks
  that apps import it and define nothing. *Alternative*: keep byte-identical
  copies per app (the Warp approach); rejected because it duplicates 200 lines
  four times and needs a script to stop drift.
- **Style: lyra, base: radix.** Lyra is the boxy, sharp, hairline geometry
  closest to Zedative (0–4px radii, technical type). Radix matches the
  existing primitives the apps already use. The CLI scaffold (`init --preset
  lyra --base radix`, `add --all`) is the source for new components; they are
  ported into `packages/ui/src/ui` with relative imports and lucide icons.
- **Roles as `@utility type-*`, weights as `weight-*`.** A role sets size,
  line height, weight and optical size together; `weight-*` overrides the
  weight because Tailwind sorts font-weight utilities after font-size ones.
  `cn()` registers both groups. *Alternative*: `--text-*` theme keys (the Warp
  approach); rejected because they cannot carry `font-variation-settings`.
- **Colour names.** Zedative's "accent" (cobalt) is `--primary`; shadcn's
  `--accent` stays the hover wash (`pane`). Body text inherits `ink`;
  controls and headings use `foreground` (black).
- **Elevation as inset shadows.** The lip is `inset-shadow-lip`, so focus
  rings (`--tw-ring-shadow`) and the lip compose. `shadow-xs`/`sm` are flat;
  `shadow-md`…`2xl` all map to the one float shadow.
- **Night Desk dark is derived** from `shot` (#2f343e). The flavor names the
  scheme without values. Every text pair is measured (DESIGN.md).
- **Motion is stripped to the spec.** Overlays, accordions and mounts no
  longer animate; the Blocks spinner and drag-to-reorder keep moving as
  functional feedback.
- **Print documents on Zedative, at print sizes.** The CV templates, the
  invoice and the portfolio deck drop Helvetica, uppercase and tracking for
  Inter, sentence case and weight, with Zedative's ink colours as literals so
  Night Desk never recolours paper. react-pdf cannot read the variable font's
  `wght` / `opsz` axes, so the PDFs embed static cuts (400 / 600 / 700), and
  the on-screen paper uses the same three weights; print sizes stay off the
  six screen roles. The cuts, a glyph-cache repair, the line-break policy and
  the text normaliser live once, in `packages/ui/src/print/`, which each
  builder's `src/lib/pdf-fonts.ts` registers with its own react-pdf `Font`.
  Each cut merges the `@fontsource/inter` latin, latin-ext and vietnamese
  subsets into one font (`scripts/build-print-fonts.sh`): with one font per
  subset, react-pdf broke words where the font changed and set inserted
  hyphens and ellipses in a cut that lacked them. *Alternative*: keep the documents print-faithful in Helvetica (the
  first pass); rejected because "one family" and "no uppercase" are Zedative
  rules, and the documents are what the builders exist to make.
- **Design page as its own Vite app** (`apps/design`, port 4006), importing
  `@rulisme/ui` like any other consumer, so the page proves the published
  package rather than a private copy.

## Risks / Trade-offs

- Taller controls (36px default, from 28px) make the editors' toolbars and
  forms longer → toolbars use `sm` (32px); forms keep their structure.
- No overlay animation is a visible behaviour change → it is what the spec
  asks for ("remove any animation not described here").
- Hairlines measure 1.2–1.4:1 against paper, under the 3:1 non-text guideline
  → reported, kept (spec decision); fields keep placeholder text and a fill.
- More optional peer dependencies on `@rulisme/ui` (cmdk, vaul, recharts, …)
  → declared optional; an app pays only for what it imports.
- Inter sets wider than Helvetica, so a dense CV can run longer → print
  sizes and margins are kept, and page counts are compared before and after
  for each template.

## Migration Plan

1. Theme, motion, `cn()`, docs and scripts.
2. Components in `packages/ui`.
3. Apps, then the design page.
4. `bun run check`, `bun run check-types`, `bun run build`, browser review.

Rollback: revert the change; Warp lives in git history.

## Open Questions

- None blocking. Parchment, Mint and Ember schemes are named by the flavor
  but not specified; only Night Desk is implemented.
