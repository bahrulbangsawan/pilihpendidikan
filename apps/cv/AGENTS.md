# Agent notes — apps/cv

Read the root `AGENTS.md` and `CLAUDE.md` first, then this app's `CLAUDE.md`.
Proposals for this app go in the root `openspec/changes/` with a `cv-` prefix.

## Design system — Cursor

Every app shares the Cursor design system (root `DESIGN.md`, whose § Implementation maps each rule to code; rules enforced by `TYPOGRAPHY.md`). Rules an agent must follow here:

- **Tokens live only in `@rulisme/ui/styles/theme.css`.** `src/styles.css` imports it and holds only the print-artifact CSS (`bun run parity:typography`). Never hardcode hex, `text-[Npx]`, generic text sizes or `font-<weight>` in chrome (`bun run lint:typography`).
- **Type.** Roles only: `DocHeader` opens the form (36px title at weight 400), `type-title` for dialog and panel headings, `type-title-compact weight-semibold` for the editor's section titles, `type-body` for controls and labels (components set it), `type-caption` for helper text, meta, counters beside titles and errors. No uppercase, no tracking.
- **Frame.** cursor.com's dark app chrome: the form pane on the page colour and the preview pane on `bg-card`, each under a sticky 48px toolbar with a `border-border` bottom rule and `size="sm"` / `icon-sm` pill buttons, divided by a `border-border` rule. The sheet rests on a `bg-background` well. Cards 4px with a hairline, fields, menus and windows 8px, buttons and badges pills; no shadows on surfaces.
- **Theme and colour.** Dark only: one scheme, no toggle, no `dark:` overrides. The light pill is the one main action (Download PDF); orange is for text links only.
- **Shortcut.** The "Download PDF" button's `<Kbd>D</Kbd>` (plus `aria-keyshortcuts`) and `useShortcut("D", …)` go together, and match the invoice and portfolio builders' split control; never show a hint without a working key.
- **Motion.** No entrances, no route transitions, no press offset; only colour transitions (140ms) and drag-to-reorder movement.
- **Re-skin shared primitives once** in `packages/ui` (then rebuild) — never fork per app.
- **Print templates:** the previews (`src/components/templates/*-preview.tsx`), their `@react-pdf` twins (`packages/cv-engine/src/pdf/*-pdf.tsx`) and `.cv-page` follow the print style (Inter via `src/lib/pdf-fonts.ts`, no uppercase or letter-spacing, literal print ink colours, a 2px framed photo), stay white paper inside the dark chrome and keep print sizes and preview ↔ PDF parity: change a preview and its PDF together (`bun run parity:cv-templates` at the root, part of `bun run check`; see `CLAUDE.md` § Preview ↔ PDF parity). Keep `cv-no-print` on chrome so `@media print` prints a bare page.
- **CV engine:** the document types, schema, Markdown export and PDF templates live in `@pilihpendidikan/cv-engine`; import its subpaths, and load `/pdf` only with a dynamic import behind the SSR guard.

## Backend

Cloud save and loading go to `apps/api` through `MCP_API` (`http://localhost:8788` in dev, `https://api.pilihpendidikan.com` in prod). Never point the app back at the bahrul services; OG images are the one exception (`og.bahrul.me`, public).
