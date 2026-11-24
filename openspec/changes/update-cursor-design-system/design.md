## Context

Four TanStack Start apps (`home`, `cv`, `invoice`, `portfolio`) consumed
`@rulisme/ui`, a library of 27 shadcn components (radix base, "mira"
geometry) skinned to Warp through tokens each app duplicated in its own
`styles.css`. The Cursor design system replaces Warp entirely. It is
cursor.com's system in its dark theme, measured value by value from the live
site: a warm near-black page, cards one step lighter with a hairline, pill
buttons, one family at weight 400 on eight type roles, and orange spent only
on text links. Cursor's own typeface (CursorGothic) is proprietary, so Geist
stands in for it; nothing of Cursor's (logo, artwork, copy) is shipped.

## Goals / Non-Goals

- Goals: one source of truth for tokens; every shadcn component available
  and restyled; every app's chrome on the Cursor design system; the rules
  enforced in CI; a page that shows the whole system.
- Non-Goals: changing what any app does; changing the printed documents'
  structure, sizes or page formats; a light theme; deploying.

## Decisions

- **Shared theme, not per-app copies.** `packages/ui/src/styles/theme.css`
  holds every token and utility; apps import it. The parity script now checks
  that apps import it and define nothing. *Alternative*: keep byte-identical
  copies per app (the Warp approach); rejected because it duplicates 200 lines
  four times and needs a script to stop drift.
- **Measured, not approximated.** Every colour, size, radius, shadow and
  rhythm comes from cursor.com's computed styles and CSS variables
  (`cook/refs/`); translucent tokens are `color-mix()` exactly as cursor.com
  defines them.
- **Dark only.** cursor.com also ships a light theme; pilihpendidikan does
  not. `:root` carries the one scheme and `.dark` is an alias with the same
  values, so markup that still sets `className="dark"` changes nothing.
- **Style: lyra, base: radix.** The CLI scaffold (`init --preset lyra --base
  radix`, `add --all`) is the source for new components; they are ported into
  `packages/ui/src/ui` with relative imports and lucide icons, then restyled
  to cursor.com's geometry (pills, 4px cards, 8px fields and windows).
- **Roles as `@utility type-*`, weights as `weight-*`.** A role sets size,
  line height and tracking together at weight 400; `weight-*` overrides the
  weight (500 for titles and labels inside app surfaces, 600 for a rare
  figure) because Tailwind sorts font-weight utilities after font-size ones.
  `cn()` registers both groups. *Alternative*: `--text-*` theme keys (the Warp
  approach); rejected because they cannot carry the per-role tracking.
- **Colour names.** `--primary` is the light pill (cursor.com's button),
  `--link` the orange, and shadcn's `--accent` stays the hover wash (`pane`).
- **Flat surfaces.** Cards are separated by colour and a 2.5% hairline;
  menus take Cursor's two whisper shadows (`shadow-md`), windows one soft drop
  (`shadow-lg`).
- **Motion is stripped to the spec.** Overlays, accordions and mounts no
  longer animate, and pressables do not move on `:active`; only colours
  transition (140ms). The Blocks spinner and drag-to-reorder keep moving as
  functional feedback.
- **Print documents in the Cursor print style, at print sizes.** The CV
  templates, the invoice and the portfolio deck drop Helvetica, uppercase and
  tracking for Inter, sentence case and weight, with the print ink colours as
  literals so the dark chrome never recolours paper. react-pdf cannot read
  the variable font's axes, so the PDFs embed static cuts (400 / 600 / 700),
  and the on-screen paper uses the same three weights; print sizes stay off
  the screen roles. The cuts, a glyph-cache repair, the line-break policy and
  the text normaliser live once, in `packages/ui/src/print/`, which each
  builder's `src/lib/pdf-fonts.ts` registers with its own react-pdf `Font`.
  Each cut merges the `@fontsource/inter` latin, latin-ext and vietnamese
  subsets into one font (`scripts/build-print-fonts.sh`): with one font per
  subset, react-pdf broke words where the font changed and set inserted
  hyphens and ellipses in a cut that lacked them. *Alternative*: keep the
  documents print-faithful in Helvetica (the first pass); rejected because
  "one family" and "no uppercase" are rules of the system, and the documents
  are what the builders exist to make.
- **Design page as its own Vite app** (`apps/design`, port 4006), importing
  `@rulisme/ui` like any other consumer, so the page proves the published
  package rather than a private copy.

## Risks / Trade-offs

- Taller controls (36px default, from 28px) make the editors' toolbars and
  forms longer → toolbars use `sm` (28px pills); forms keep their structure.
- No overlay animation is a visible behaviour change → it is what the spec
  asks for (cursor.com opens overlays instantly).
- The `border` (1.27:1) and `input` (1.74:1) hairlines are under the 3:1
  non-text guideline → kept because cursor.com chose them; fields stay
  identifiable through their placeholder and the focus outline.
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

- None blocking. A light scheme is out of scope; adding one later would mean
  a second token block in the theme and a reviewed contrast table.
