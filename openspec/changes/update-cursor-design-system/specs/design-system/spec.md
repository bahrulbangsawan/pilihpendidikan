## ADDED Requirements

### Requirement: Single shared theme
Every UI app SHALL take its design tokens, type utilities and layout
utilities from `@rulisme/ui/styles/theme.css`, and no app SHALL define
tokens of its own.

#### Scenario: App imports the theme
- **WHEN** `bun run parity:typography` runs
- **THEN** it passes only if every `apps/*/src/styles.css` imports `@rulisme/ui/styles/theme.css` and declares no `@theme` block, `--font-*`, `--text-*`, `--color-*`, `--radius-*` or `--shadow-*` token and no `type-*` or `weight-*` utility

#### Scenario: Token drift
- **WHEN** an app adds a `--color-*` declaration to its `styles.css`
- **THEN** `bun run parity:typography` fails and names the app

### Requirement: Cursor tokens in one dark scheme
The theme SHALL map cursor.com's dark palette onto the shadcn variables in
one scheme on `:root`, with `.dark` as an alias of the same values, and SHALL
offer no light scheme and no theme switch. Muted text SHALL clear 4.5:1 on
every surface it is used on.

#### Scenario: Dark only
- **WHEN** any app renders, with or without the `dark` class
- **THEN** the page background is `#14120b`, cards are `#1b1913`, running text is `#edecec`, the primary fill is `#edecec` with `#14120b` text, and text links are `#f54e00`

#### Scenario: No theme switch
- **WHEN** a user looks for a theme control in any app
- **THEN** there is none, and `theme-color` and `color-scheme` announce the dark page (`#14120b`, `dark`)

### Requirement: Eight-role type scale
Text SHALL be set only in the eight Cursor roles (hero, headline, display,
title, subtitle, body, caption, micro, each with a compact step) in Geist
Variable, at weight 400 by default, with `weight-semibold` (500) and
`weight-bold` (600) as the only overrides.

#### Scenario: Forbidden size
- **WHEN** chrome code uses `text-sm`, `text-[13px]`, `leading-*`, `tracking-*`, `uppercase` or `font-semibold`
- **THEN** `bun run lint:typography` fails

#### Scenario: Role and weight merge
- **WHEN** `cn("type-title", "weight-normal")` and `cn("text-xs", "type-body")` are evaluated
- **THEN** the first keeps both classes and renders at 400, and the second returns `type-body`

### Requirement: Complete restyled component library
`@rulisme/ui` SHALL ship every shadcn component installed by `shadcn add --all`
for the lyra style on the radix base, restyled to the Cursor design system:
pill buttons 36px tall (`sm` 28px, `lg` 43px, `xs` 24px), 36px fields with
8px corners, 4px cards with a hairline, 8px menus and windows, colour-only
transitions in 140ms, no press offset and no enter or exit animation.

#### Scenario: Coverage
- **WHEN** the design page coverage script runs against `packages/ui/src/ui`
- **THEN** it reports no component file that the page does not render

#### Scenario: Primary button
- **WHEN** a default `Button` renders
- **THEN** it is a 36px pill filled `#edecec` with `#14120b` text, its fill turns `#d7d6d5` on hover, and it does not move when pressed

### Requirement: cursor.com chrome
Every app SHALL lay out its chrome as cursor.com does: marketing and docs
pages in the 1300px rail with 20px gutters and sections separated by space,
not rules; app screens in cursor.com's docs-style app chrome (a header over a
`border` rule, panes divided by `border` rules, the sidebar on the card
colour); the light pill once per view as the main action.

#### Scenario: Hub
- **WHEN** `pilihpendidikan.com` renders
- **THEN** its sections sit in the 1300px rail, 67.2px apart with no rules between them, the hero headline is a type role at weight 400, and orange appears only on text links

#### Scenario: Builder
- **WHEN** a builder renders its editor
- **THEN** each pane sits under a 48px toolbar with a `border-border` bottom rule, the panes are divided by a `border-border` rule, and the document preview rests on a `bg-background` well inside the card-coloured pane

### Requirement: Print documents follow the Cursor print style
The printed documents (the CV templates, the invoice and the portfolio deck)
SHALL use Inter as their only family, SHALL not uppercase or letter-space any
text, and SHALL take the print ink colours (`#000000` headings, `#393d45`
body, `#5a6170` secondary, `#cbcfd4` rules, `#1348dc` links) in both the
on-screen preview and the downloaded PDF, keeping their print sizes, layouts,
page formats and the user's own invoice accent colour.

#### Scenario: PDF family
- **WHEN** a CV, invoice or portfolio PDF is generated
- **THEN** every text run is set in the embedded Inter cuts (400, 600 or 700) and no StyleSheet sets `textTransform` or `letterSpacing`

#### Scenario: Paper ignores the dark chrome
- **WHEN** a builder renders its document inside the dark chrome
- **THEN** the on-screen document is white paper with the same ink colours as its PDF

#### Scenario: Lint
- **WHEN** a print preview, a `*-pdf.tsx` file or an app's `styles.css` adds `uppercase`, `tracking-*`, `letterSpacing`, `letter-spacing`, `text-transform: uppercase` or a family other than Inter
- **THEN** `bun run lint:typography` fails

### Requirement: Design system page
The workspace SHALL include `apps/design`, a page that renders the Cursor
foundations (contrast-checked colour roles, palette, type specimens, spacing,
radius, elevation, motion), every component with pinned interaction states,
do/don't pairs for the DESIGN.md rules, the DESIGN.md recipes, and one example
screen, in the one dark scheme.

#### Scenario: States without interaction
- **WHEN** the Actions section renders
- **THEN** each button variant shows its default, hover, focus, active, disabled and loading states side by side

#### Scenario: Clean load
- **WHEN** the page loads at 375px and 1280px
- **THEN** there are no console errors, the page starts at the top and nothing overflows horizontally
