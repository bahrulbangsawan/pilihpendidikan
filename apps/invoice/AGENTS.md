# Agent notes — apps/invoice

Read the root `AGENTS.md` and `CLAUDE.md` first, then this app's `CLAUDE.md`.
Proposals for this app go in the root `openspec/changes/` with an `invoice-` prefix.

## Design system — Cursor

Every app shares the Cursor design system: cursor.com's dark theme, warm near-black paper, cards one step lighter with a hairline, pill buttons, one family (Geist) at weight 400 on eight type roles, orange only for text links. Read the root `DESIGN.md` (especially § Implementation) and `TYPOGRAPHY.md`; this app's specifics are in its `CLAUDE.md`. Rules an agent must follow:

- **Tokens live in `packages/ui/src/styles/theme.css` only.** `src/styles.css` imports it and holds nothing but the print artifact's CSS (`bun run parity:typography`). Never hardcode hex, arbitrary sizes or `dark:` colour overrides in chrome.
- **Type.** The eight roles (`type-hero` … `type-micro`) and `weight-semibold` / `weight-bold`; never `text-xs`/`text-sm`, `font-medium`, `uppercase`, `tracking-*` or `leading-*` (`bun run lint:typography`). Money and quantities use `tabular-nums`.
- **Shape and depth.** Cards 4px with a hairline, fields, menus and windows 8px, buttons, badges and swatches round; no shadows beyond what the shared components carry.
- **Frame.** cursor.com's dark app chrome: the form pane on the page colour and the preview pane on `bg-card`, each under a 48px toolbar with a `border-border` bottom rule, divided by a `border-border` rule; the sheet rests on a `bg-background` well.
- **Motion.** Nothing enters and nothing animates layout: no `animate-*`, `transition-all`, transform transitions, entrance helpers or route transitions.
- **Theme.** Dark only: one scheme, no toggle.
- **Shortcut.** The `<Kbd>D</Kbd>` on "Download PDF" and `useShortcut("d", …)` go together; never one without the other.
- **Document accent colour.** The per-invoice `accentColor` (default `#f48120`) and its swatch presets are document content, not chrome — leave them as raw hex.
- **Re-skin shared primitives once** in `packages/ui` (then rebuild) — never fork per app.
- **Print document:** `src/components/{invoice-preview,invoice-pdf}.tsx` and `.invoice-page` follow the print style (Inter via `src/lib/pdf-fonts.ts`, no uppercase or letter-spacing, literal print ink colours, the user's accent on the top rule) and stay white paper inside the dark chrome. Keep the preview and the PDF in sync by hand.

## Backend

Cloud save and loading go to `apps/api` through `MCP_API` (`http://localhost:8788` in dev, `https://api.pilihpendidikan.com` in prod). Never point the app back at the bahrul services; OG images are the one exception (`og.bahrul.me`, public).
