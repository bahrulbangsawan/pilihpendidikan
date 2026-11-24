# Change: Replace the Warp design system with the Cursor design system

> **Superseded file locations (CV print templates).** `cv-extract-cv-engine`
> moved the four CV `@react-pdf` templates (`apps/cv/src/components/templates/*-pdf.tsx`),
> `cv-pdf.tsx`, `template-utils.ts` and `cv-markdown.ts` out of `apps/cv` into
> `packages/cv-engine` (`src/pdf/*-pdf.tsx`, `src/pdf/cv-document.tsx`,
> `src/template-utils.ts`, `src/markdown.ts`; `job-tracker-spec/08` §3, D-14). The print rules
> below still hold for them unchanged: `scripts/lint-typography.sh` rules 17–18
> now also scan `packages/cv-engine/src/pdf`, the fonts still come from
> `@rulisme/ui/print/*` (registered by the caller through
> `renderCvPdfBlob(..., {registerFonts})`), and the HTML previews stay in
> `apps/cv/src/components/templates/*-preview.tsx` with
> `scripts/check-cv-template-parity.ts` guarding preview ↔ PDF pairs. Where
> the task list below names `apps/cv` PDF paths, read them as the
> `packages/cv-engine` paths.

## Why

The workspace was skinned with Warp, a dark "moonlit terminal" system whose
tokens were copied into four apps and kept in step by parity scripts. The
owner asked for every pilihpendidikan surface to match cursor.com: its
colours, buttons, sizing, spacing, typography and layout, in its dark theme
only. That system, named **Cursor** in this workspace (`DESIGN.md`), should
become the design system of every app, built on shadcn/ui, with a page that
renders the whole system.

## What Changes

- **BREAKING** Root `DESIGN.md` becomes the Cursor spec (every value measured
  from cursor.com, `cook/refs/`) plus an Implementation section; the Warp
  copies in `apps/{cv,invoice,portfolio}` are removed. `TYPOGRAPHY.md` is
  rewritten for the eight roles.
- One shared theme, `@rulisme/ui/styles/theme.css`: cursor.com's dark palette
  mapped onto the shadcn variables in one scheme (warm near-black `#14120b`
  page, `#1b1913` cards with a 2.5% hairline, `#edecec` ink, the light pill
  for the primary action, orange `#f54e00` only for text links), the eight
  `type-*` roles, `weight-*` utilities, radius, elevation (Cursor's flyout and
  window shadows) and the `band` / `rail` / `surface-card` layout utilities.
  Dark only: no light scheme, no theme switch; `.dark` is an alias. Apps stop
  defining tokens.
- `@pilihpendidikan/config/motion.css` follows cursor.com's motion: 140ms on
  `cubic-bezier(0.4, 0, 0.2, 1)`, colours only, no press offset, no
  entrances, no route transitions, no overlay animation.
- `@rulisme/ui` grows from 27 to the full shadcn set (61 components from the
  CLI, lyra geometry, radix base, lucide icons) and every component is
  restyled to the Cursor design system: pill buttons, 36px fields with 8px
  corners, 4px cards, 8px menus and windows. New: `Kbd`, `Band` / `Rail`,
  `typeClass()`, the app-surface composites in `blocks/`.
- `apps/home`, `apps/cv`, `apps/invoice`, `apps/portfolio` and `apps/jobs`
  move to the shared theme and cursor.com's chrome (marketing sections in the
  1300px rail separated by space; the builders and the Job Tracker in
  cursor.com's docs-style app chrome).
- The printed documents (the four CV templates, the invoice, the portfolio
  deck) follow the Cursor print style, in the on-screen preview and the PDF
  alike: Inter as the only family (the PDFs embed static Inter cuts from one
  shared print module, `@rulisme/ui/print/*`), no uppercase or
  letter-spacing, literal print ink colours that the dark chrome never
  changes, 2px framed photos. They keep their print sizes, layouts, page
  formats and preview ↔ PDF parity, and the invoice keeps the user's accent.
- The API's own pages (`/connect`, sign-in confirm, OAuth consent) and its
  emails take the same dark palette in plain CSS and email-safe inline styles.
- New `apps/design` (Vite, port 4006): the living design system page —
  foundations, every component with pinned states, do/don't pairs, recipes,
  an example screen.
- **BREAKING** Lint and parity scripts are rewritten: no generic sizes,
  `leading-*`, `tracking-*`, uppercase, `font-<weight>`, radii above 8px
  (pills and app containers aside), gradients, glass, hex classes, enter
  animations, syntax colours outside the editor mock, or manual `dark:`
  colours; apps must import the theme and define no tokens.

## Impact

- Affected specs: `design-system` (new capability); supersedes the Warp
  wording in the pending `home-add-hub-landing-page` change
  ("Design system and typography gates") and the Helvetica requirement
  (REQ-TL-6) in the `cv-add-cv-templates` and `invoice-add-cv-templates`
  records.
- Affected code: `packages/ui/**`, `packages/config/motion.css`,
  `apps/*/src/**` (chrome and the print documents), `apps/*/src/styles.css`, `apps/design/**`,
  `scripts/lint-typography.sh`, `scripts/check-*.ts`, `DESIGN.md`,
  `TYPOGRAPHY.md`, `CLAUDE.md`, `AGENTS.md`, app and package `CLAUDE.md` files,
  `openspec/project.md`, `apps/api/src/html.ts`, `apps/api/src/email.ts` and
  `apps/api/src/jobs/services/account/email.ts` (the API's own pages and
  emails), every `components.json`, the apps' web manifests.
- No API behaviour, data or deploy changes. Dependency security patches ride
  along so `bun run check` passes: root `overrides` lift the MCP SDK packages
  past GHSA-6qxp-vccf-f47h and `sharp` to 0.35.5 (details in
  `apps/api/CLAUDE.md`). Deploying the restyled apps still needs the owner's
  go-ahead.
