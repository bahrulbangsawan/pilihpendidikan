# Agent notes — apps/invoice

Read the root `AGENTS.md` and `CLAUDE.md` first, then this app's `CLAUDE.md`.
Proposals for this app go in the root `openspec/changes/` with an `invoice-` prefix.

## Design system — Zedative

Every app shares Zedative: warm graph paper, hairline rails with diamond nodes, one family (Inter Variable) in six type roles, one cobalt accent. Read the root `DESIGN.md` (especially § Implementation) and `TYPOGRAPHY.md`; this app's specifics are in its `CLAUDE.md`. Rules an agent must follow:

- **Tokens live in `packages/ui/src/styles/theme.css` only.** `src/styles.css` imports it and holds nothing but the print artifact's CSS (`bun run parity:typography`). Never hardcode hex, arbitrary sizes or `dark:` colour overrides in chrome; Night Desk swaps every token.
- **Type.** The six roles (`type-display` … `type-micro`) and `weight-semibold` / `weight-bold`; never `text-xs`/`text-sm`, `font-medium`, `uppercase`, `tracking-*` or `leading-*` (`bun run lint:typography`). Money and quantities use `tabular-nums`.
- **Shape and depth.** Sections and cards are square, controls 4px, chips and swatches 2px, windows 6px; no shadows beyond what the shared components carry.
- **Frame.** Toolbars are 56px bands, panes and form sections are ruled by `border-line`, a `Diamond` marks the toolbar/divider crossing, and the preview rests on `graph-paper`.
- **Motion.** Nothing enters and nothing animates layout: no `animate-*`, `transition-all`, transform transitions, entrance helpers or route transitions.
- **Theme.** Light by default; the toggle switches to Night Desk.
- **Shortcut.** The `<Kbd>D</Kbd>` on "Download PDF" and `useShortcut("d", …)` go together; never one without the other.
- **Document accent colour.** The per-invoice `accentColor` (default `#f48120`) and its swatch presets are document content, not chrome — leave them as raw hex.
- **Re-skin shared primitives once** in `packages/ui` (then rebuild) — never fork per app.
- **Print document:** `src/components/{invoice-preview,invoice-pdf}.tsx` and `.invoice-page` follow Zedative on paper (Inter via `src/lib/pdf-fonts.ts`, no uppercase or letter-spacing, Zedative ink colours, the user's accent on the top rule) and never change with Night Desk. Keep the preview and the PDF in sync by hand.

## Backend

Cloud save and loading go to `apps/api` through `MCP_API` (`http://localhost:8788` in dev, `https://api.pilihpendidikan.com` in prod). Never point the app back at the bahrul services; OG images are the one exception (`og.bahrul.me`, public).
