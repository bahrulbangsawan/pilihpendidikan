# Agent notes — apps/cv

Read the root `AGENTS.md` and `CLAUDE.md` first, then this app's `CLAUDE.md`.
Proposals for this app go in the root `openspec/changes/` with a `cv-` prefix.

## Design system — Zedative

Every app shares Zedative (root `DESIGN.md`, whose § Implementation maps each rule to code; rules enforced by `TYPOGRAPHY.md`). Rules an agent must follow here:

- **Tokens live only in `@rulisme/ui/styles/theme.css`.** `src/styles.css` imports it and holds only the print-artifact CSS (`bun run parity:typography`). Never hardcode hex, `text-[Npx]`, generic text sizes or `font-<weight>` in chrome (`bun run lint:typography`).
- **Type.** Roles only: `type-title` for dialog and panel headings, `type-subtitle weight-semibold` for the editor's section titles (as in `SectionList`), `type-body` for controls and labels (components set it), `type-caption` for helper text, meta, counters beside titles and errors. No uppercase, no tracking.
- **Frame.** Toolbars are 56px bands with `size="sm"` / `icon-sm` buttons; the panes and the form's section bands are ruled by `border-line`; a `Diamond` marks where the toolbars' rule crosses the pane divider; the preview sits on `graph-paper` with the sheet in a 1px `border-border` frame. Cards are square, controls 4px, chips 2px, windows 6px; no shadows on surfaces.
- **Theme and colour.** Light by default, Night Desk (`.dark`) through the toolbar toggle; no `dark:` overrides. Cobalt is scarce: the Download PDF split button, checked controls, links and focus.
- **Shortcut.** The "Download PDF" button's `<Kbd>D</Kbd>` (plus `aria-keyshortcuts`) and `useShortcut("D", …)` go together, and match the invoice and portfolio builders' split control; never show a hint without a working key.
- **Motion.** No entrances, no route transitions; only the shared hover/press feedback and drag-to-reorder movement.
- **Re-skin shared primitives once** in `packages/ui` (then rebuild) — never fork per app.
- **Print templates:** the previews (`src/components/templates/*-preview.tsx`), their `@react-pdf` twins (`packages/cv-engine/src/pdf/*-pdf.tsx`) and `.cv-page` follow Zedative on paper (Inter via `src/lib/pdf-fonts.ts`, no uppercase or letter-spacing, Zedative ink colours, a 2px framed photo), look the same in both themes and keep print sizes and preview ↔ PDF parity: change a preview and its PDF together (`bun run parity:cv-templates` at the root, part of `bun run check`; see `CLAUDE.md` § Preview ↔ PDF parity). Keep `cv-no-print` on chrome so `@media print` prints a bare page.
- **CV engine:** the document types, schema, Markdown export and PDF templates live in `@pilihpendidikan/cv-engine`; import its subpaths, and load `/pdf` only with a dynamic import behind the SSR guard.

## Backend

Cloud save and loading go to `apps/api` through `MCP_API` (`http://localhost:8788` in dev, `https://api.pilihpendidikan.com` in prod). Never point the app back at the bahrul services; OG images are the one exception (`og.bahrul.me`, public).
