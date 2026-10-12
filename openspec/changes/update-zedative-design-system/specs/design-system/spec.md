## ADDED Requirements

### Requirement: Single shared theme
Every UI app SHALL take its design tokens, type utilities and motifs from
`@rulisme/ui/styles/theme.css`, and no app SHALL define tokens of its own.

#### Scenario: App imports the theme
- **WHEN** `bun run parity:typography` runs
- **THEN** it passes only if every `apps/*/src/styles.css` imports `@rulisme/ui/styles/theme.css` and declares no `@theme` block, `--font-*`, `--text-*`, `--color-*`, `--radius-*` or `--shadow-*` token and no `type-*` or `weight-*` utility

#### Scenario: Token drift
- **WHEN** an app adds a `--color-*` declaration to its `styles.css`
- **THEN** `bun run parity:typography` fails and names the app

### Requirement: Zedative tokens and schemes
The theme SHALL map the Zedative palette onto the shadcn variables with light
as the default scheme, and SHALL provide a derived "Night Desk" dark scheme
under `.dark` whose text pairs clear 4.5:1.

#### Scenario: Light default
- **WHEN** an app renders without the `dark` class
- **THEN** the page background is `#f4f4f2`, the primary fill is `#1348dc` and running text is `#393d45`

#### Scenario: Night Desk
- **WHEN** a builder switches to dark
- **THEN** every token resolves to its Night Desk value and muted text measures at least 4.5:1 on every surface

### Requirement: Six-role type scale
Text SHALL be set only in the six Zedative roles (display, title, subtitle,
body, caption, micro, each with a compact step) and the three weights
(400/opsz 14, 550/opsz 18, 700/opsz 25), in Inter Variable.

#### Scenario: Forbidden size
- **WHEN** chrome code uses `text-sm`, `text-[13px]`, `leading-*`, `tracking-*`, `uppercase` or `font-semibold`
- **THEN** `bun run lint:typography` fails

#### Scenario: Role and weight merge
- **WHEN** `cn("type-title", "weight-normal")` and `cn("text-xs", "type-body")` are evaluated
- **THEN** the first keeps both classes and renders at 400, and the second returns `type-body`

### Requirement: Complete restyled component library
`@rulisme/ui` SHALL ship every shadcn component installed by `shadcn add --all`
for the lyra style on the radix base, restyled to Zedative: buttons and fields
36px (32px at `sm`), 4px controls, 2px chips, square cards, 6px windows, an
inset lip on pressables that disappears on hover, and no enter or exit
animation.

#### Scenario: Coverage
- **WHEN** the design page coverage script runs against `packages/ui/src/ui`
- **THEN** it reports no component file that the page does not render

#### Scenario: Primary button
- **WHEN** a default `Button` renders
- **THEN** it is 36px tall, cobalt with a `#053794` inset bottom lip, and the lip is removed on hover

### Requirement: Drafting-paper chrome
Every app SHALL frame its chrome in Zedative bands: full-bleed 1px rules, a
ruled column with diamond nodes where rules cross, graph paper behind
documents and hero bands, and paper grain at barely-visible strength.

#### Scenario: Hub
- **WHEN** `pilihpendidikan.com` renders
- **THEN** its sections are bands with bottom hairlines around a 1120px ruled column with diamond nodes, the hero headline is the display role in italic cobalt, and the footer is a solid cobalt slab

#### Scenario: Builder
- **WHEN** a builder renders its editor
- **THEN** the toolbar is a band ruled by a hairline, the panes are divided by a `line` rule, and the document preview sits on graph paper

### Requirement: Print documents follow Zedative
The printed documents (the CV templates, the invoice and the portfolio deck)
SHALL use Inter as their only family, SHALL not uppercase or letter-space any
text, and SHALL take Zedative's ink colours (`#000000` headings, `#393d45`
body, `#5a6170` secondary, `#cbcfd4` rules, `#1348dc` links) in both the
on-screen preview and the downloaded PDF, keeping their print sizes, layouts,
page formats and the user's own invoice accent colour.

#### Scenario: PDF family
- **WHEN** a CV, invoice or portfolio PDF is generated
- **THEN** every text run is set in the embedded Inter cuts (400, 600 or 700) and no StyleSheet sets `textTransform` or `letterSpacing`

#### Scenario: Paper ignores Night Desk
- **WHEN** a builder switches to Night Desk
- **THEN** the on-screen document keeps white paper and the same ink colours as in light

#### Scenario: Lint
- **WHEN** a print preview, a `*-pdf.tsx` file or an app's `styles.css` adds `uppercase`, `tracking-*`, `letterSpacing`, `letter-spacing`, `text-transform: uppercase` or a family other than Inter
- **THEN** `bun run lint:typography` fails

### Requirement: Design system page
The workspace SHALL include `apps/design`, a page that renders the Zedative
foundations (contrast-checked colour roles, palette, type specimens, spacing,
radius, elevation, motion), every component with pinned interaction states,
do/don't pairs for the DESIGN.md rules, the DESIGN.md recipes, and one example
screen, in light and Night Desk.

#### Scenario: States without interaction
- **WHEN** the Actions section renders
- **THEN** each button variant shows its default, hover, focus, active, disabled and loading states side by side

#### Scenario: Clean load
- **WHEN** the page loads at 375px and 1280px
- **THEN** there are no console errors, the page starts at the top and nothing overflows horizontally
