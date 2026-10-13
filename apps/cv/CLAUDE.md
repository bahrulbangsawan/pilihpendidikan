# apps/cv — CV Builder

TanStack Start (SSR) app that builds CVs and exports them as PDF or JSON.
Consumes the shared `@rulisme/ui` library. Deployed to Cloudflare Workers via
`@cloudflare/vite-plugin` as `cv-pilihpendidikan` on `cv.pilihpendidikan.com`.

Workspace-wide rules (commands, conventions, typography) live in the root
`CLAUDE.md`, `TYPOGRAPHY.md` and `DESIGN.md`; proposals go in the root
`openspec/` (prefix change ids with `cv-`).

## Commands

- `bun dev` — Vite dev server on port **4003**
- `bun run build` — `wrangler types` + `vite build`; `bun run preview`
- `bun run test` — Vitest
- `bun run lint` — Biome (`biome check .`); `bun run format` — Biome autofix
- `bun run typecheck` — `wrangler types` + `tsc --noEmit`
- `bun run deploy` — `wrangler deploy` (owner approval required)

The root `bun run check` runs Biome, the typography lint and the parity checks
over this app too.

## Structure

- `src/router.tsx` — router setup; routes in `src/routes/`: `__root.tsx` (head, hreflang, preconnect to the API), `-root-components.tsx` (document shell, ThemeProvider, i18n), `-root-helpers.ts` (JSON-LD), `index.tsx` (EN), `id.tsx` (ID), `$.tsx` (catch-all 404). `routeTree.gen.ts` is generated — never edit it by hand.
- `src/components/cv-generator.tsx` — the editor shell: toolbars, MCP dialog, import/export, the `D` download shortcut, local draft, cloud load/save, and the `?print=1` print view.
- `src/components/cv-form.tsx` / `cv-preview.tsx` — the form and the live preview.
- The CV engine is `@pilihpendidikan/cv-engine` (`packages/cv-engine`, see its `CLAUDE.md`): the `CVData` types (`/types`), `CVDataSchema` (`/schema`), the blank document (`/document`), the Markdown export (`/markdown`), the layout helpers the previews share with the PDF (`/template-utils`) and, in the browser-only `/pdf` subpath, the four `@react-pdf` templates, `CVDocument` and `renderCvPdfBlob`. Import the subpaths, not the package root, so zod stays out of the client bundle. The Download PDF handler loads `/pdf` and `src/lib/pdf-fonts.ts` with dynamic imports behind its SSR guard: `@react-pdf/renderer` must never enter the Worker.
- `src/components/templates/` — the HTML preview of each template (`basic`, `harvard`, `simple`, `standard`), plus `preview-entries.tsx`. Each preview's PDF twin is `packages/cv-engine/src/pdf/<t>-pdf.tsx`. Add a template by creating both halves (the PDF in cv-engine, wired into `CVDocument` and `CV_STYLES`) and wiring the preview into the picker.
- `src/lib/use-cloud-save.ts` — owner-authenticated optimistic cloud save (`PUT /api/cv/:id`, Bearer token, rollback).
- `src/lib/og-url.ts` — OG image URLs on the public `og.bahrul.me` renderer.
- `src/lib/blank-cv.ts` — the builder's blank CV (cv-engine's `createEmptyCV` with the builder's English headings); `src/lib/preprocess-image.ts` — client-side image normalisation for the PDF; `src/lib/pdf-fonts.ts` — `registerCvPrint`, the print setup the PDF render runs (below).
- `src/i18n/` — EN/ID copy (`locales/{en,id}.json`) and the language switcher.
- `src/data/sample-cv.json` — sample document (prefill).
- `public/` — `robots.txt`, `sitemap.xml`, `llms.txt`, favicons.

## Preview ↔ PDF parity

Each template has two renderers kept in sync by hand, and since the
extraction they live in two packages: the HTML preview
`apps/cv/src/components/templates/<t>-preview.tsx` (here) and the
`@react-pdf` document `packages/cv-engine/src/pdf/<t>-pdf.tsx`. **They change
together:** a change set that touches a PDF template without its preview
fails `bun scripts/check-cv-template-parity.ts --base <ref>` (or
`--files a,b,c`); the root `bun run check` runs it as
`bun run parity:cv-templates` against `HEAD`, and CI against the pull
request base. For an intentional PDF-only fix (a react-pdf quirk the
preview does not have), run it with `CV_PARITY_OVERRIDE=1` and say why in the
PR. A preview-only change is fine (screen chrome has no PDF twin).

PR checklist for a template change:

- [ ] Preview and PDF changed together (`check-cv-template-parity.ts` passes, or the override is explained)
- [ ] Download PDF checked for each touched template, light and Night Desk preview compared with it
- [ ] `cd packages/cv-engine && bun test` passes; after an intentional visual change, the T8-01 baseline is regenerated (`CV_PDF_BASELINE=update bun test test/pdf-baseline.test.tsx`) and its diff reviewed

## Backend

`MCP_API` in `cv-generator.tsx` is `http://localhost:8788` in dev (`apps/api`
under `wrangler dev`) and `https://api.pilihpendidikan.com` in prod. Users mint
a personal token at `https://api.pilihpendidikan.com/connect` (`MCP_URL`) and
paste it into the MCP dialog to enable cloud save. `?cv=<slug>` loads a saved
CV; `/cv/<slug>.pdf` on the API redirects to `?cv=<slug>&print=1`.

## Shared UI

- Imports primitives from `@rulisme/ui` (e.g. `@rulisme/ui/ui/button`, `@rulisme/ui/form/form-field`, `@rulisme/ui/lib/utils`).
- `@rulisme/ui` is compiled from source: `tsconfig.json` maps it to `packages/ui/src` and Vite's `resolve.tsconfigPaths` follows that in dev and build, so component edits show up without a library build.
- shadcn config in `components.json`. Tailwind 4 scans `packages/ui/src` via `@source` in `src/styles.css`.

## Design system — Zedative

Every app shares Zedative: the root `DESIGN.md` is the spec (§ Implementation
maps each rule to code) and `TYPOGRAPHY.md` the enforced rules. `src/styles.css`
imports the shared theme (`@rulisme/ui/styles/theme.css`) and defines no tokens
of its own (`bun run parity:typography`); it holds only the print-artifact CSS.
What is specific to this app:

- **Editor frame.** A split view: the form pane and the preview pane, each under a sticky 56px toolbar band (`h-14`, a `border-line` bottom rule, `size="sm"` / `icon-sm` buttons), divided by a `border-line` rule with a `Diamond` where the toolbars' rule crosses it. Form sections are bands ruled off by full-width hairlines, with the drag grip in the left gutter; section titles are `type-subtitle weight-semibold`, like `SectionList`. The preview sits on `graph-paper` and the sheet rests in a 1px `border-border` frame (screen only). Below `md` the panes stack.
- **Theme.** Light by default (`defaultTheme="light"`, `enableSystem={false}` in `-root-components.tsx`); the toolbar toggle switches to Night Desk (`.dark`), remembered in localStorage. The head script in `__root.tsx` applies a stored "dark" before paint. `theme-color` is `#f4f4f2`, `color-scheme` is `light dark`.
- **Primary action and shortcut.** Downloading the PDF is a split control (the same in all three builders): a `ButtonGroup` of a cobalt "Download PDF" button, which downloads in one step and carries `<Kbd aria-hidden>D</Kbd>` and `aria-keyshortcuts="D"`, and a chevron icon button opening the PDF / Markdown / JSON menu, whose PDF row repeats `D`. `useShortcut("D", …)` in `cv-generator.tsx` runs the same handler; it is off while that button is disabled, in the print view and while loading, and stays quiet while typing in a field, while a dialog, menu or select list is open, and on a focused select trigger. Never show a hint without a working key.
- **Print documents.** The rendered CV is a print artifact on Zedative: `templates/*-preview.tsx`, their PDF twins (`packages/cv-engine/src/pdf/*-pdf.tsx`) and `.cv-page` are white paper set in Inter, sentence case with no letter-spacing, `#000000` name and headings, `#393d45` body, `#5a6170` dates and meta, `#cbcfd4` rules, `#1348dc` links and a 2px-radius photo in a `#dadde2` frame, identical in light and Night Desk (`.cv-page` re-scopes the colour tokens to those values). They keep print sizes and the static weights 400 / 600 / 700, which only the size, leading and weight lint checks skip (`TYPOGRAPHY.md` § Exceptions). The PDF's type comes from the shared print module: `registerCvPrint` (`src/lib/pdf-fonts.ts`), which `renderCvPdfBlob` runs with the very react-pdf `Font` it renders with, registers the merged Inter cuts and the line-break policy (`@rulisme/ui/print/pdf-fonts`: words whole, breaks after hyphens, dashes and slashes, long URLs and emails at their separators) and hands cv-engine the text normaliser (`@rulisme/ui/print/pdf-text`, through `registerCvPrintText`; cv-engine sits below `@rulisme/ui`, so it cannot import it); `.cv-page` sets `overflow-wrap: anywhere`. `toPdfText` (cv-engine `src/pdf/print.ts`) runs every string through that normaliser; the summary and descriptions keep the user's line breaks, one Text per line (`getTextLines`). `@media print` in `src/styles.css` hides every `cv-no-print` element and releases the panes, so both the editor and the `?print=1` view print a bare page: mark new chrome `cv-no-print`.
- **Scrollbars.** Both panes hide their scrollbars with `no-scrollbar` (`@rulisme/ui/styles/shadcn.css`).

## Browser testing

Use `agent-browser` (not chrome-devtools/claude-in-chrome MCP): `agent-browser open http://localhost:4003 && agent-browser screenshot cv.png`.
