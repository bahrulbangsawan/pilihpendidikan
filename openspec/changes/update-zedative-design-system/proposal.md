# Change: Replace the Warp design system with Zedative

## Why

The workspace is skinned with Warp, a dark "moonlit terminal" system whose
tokens are copied into four apps and kept in step by parity scripts. The owner
supplied a new design, Zedative (`zedative.DESIGN.md`): warm graph paper ruled
into hairline rails with diamond nodes, one family (Inter Variable) in six
roles, and one cobalt accent. It should become the design system of every app,
built on shadcn/ui, with a page that renders the whole system.

## What Changes

- **BREAKING** Root `DESIGN.md` becomes the Zedative spec plus an
  Implementation section; the Warp copies in `apps/{cv,invoice,portfolio}` are
  removed. `TYPOGRAPHY.md` is rewritten for the six roles.
- One shared theme, `@rulisme/ui/styles/theme.css`: tokens mapped onto the
  shadcn variables, the derived "Night Desk" dark scheme, `type-*` roles,
  `weight-*` utilities, radius, elevation (lip, float, offset), rails,
  diamond nodes, graph paper, paper grain. Apps stop defining tokens.
- `@pilihpendidikan/config/motion.css` follows the Zedative motion rules: 150ms
  on `cubic-bezier(0.4, 0, 0.2, 1)`, the `translateY(1px) scale(0.99)` press,
  no entrances, no route transitions, no overlay animation.
- `@rulisme/ui` grows from 27 to the full shadcn set (61 components from the
  CLI, lyra geometry, radix base, lucide icons) and every component is
  restyled to Zedative. New: `Kbd`, `Band` / `Rail` / `Diamond`,
  `typeClass()`.
- `apps/home`, `apps/cv`, `apps/invoice` and `apps/portfolio` move to the
  shared theme and Zedative chrome (light by default; the builders keep a
  Night Desk toggle).
- The printed documents (the four CV templates, the invoice, the portfolio
  deck) follow Zedative too, in the on-screen preview and the PDF alike:
  Inter as the only family (the PDFs embed static Inter cuts from one shared
  print module, `@rulisme/ui/print/*`),
  no uppercase or letter-spacing, Zedative ink colours that Night Desk never
  changes, 2px framed photos. They keep their print sizes, layouts, page
  formats and preview ↔ PDF parity, and the invoice keeps the user's accent.
- New `apps/design` (Vite, port 4006): the living design system page —
  foundations, every component with pinned states, do/don't pairs, recipes,
  an example screen.
- **BREAKING** Lint and parity scripts are rewritten: no generic sizes,
  `leading-*`, `tracking-*`, uppercase, `font-<weight>`, big radii,
  gradients, glass, hex classes, enter animations, syntax colours outside the
  editor mock, or manual `dark:` colours; apps must import the theme and
  define no tokens.

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
  `openspec/project.md`, `apps/api/src/html.ts` and `apps/api/src/email.ts`
  (the API's own pages and the sign-in email),
  every `components.json`, the apps' web manifests.
- No API behaviour, data or deploy changes. Dependency security patches ride
  along so `bun run check` passes: root `overrides` lift the MCP SDK packages
  past GHSA-6qxp-vccf-f47h and `sharp` to 0.35.5 (details in
  `apps/api/CLAUDE.md`). Deploying the restyled apps still needs the owner's
  go-ahead.
