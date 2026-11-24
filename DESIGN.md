---
version: "beta"
name: "Zedative"
description: "cursor.com's dark system: warm near-black paper, one step lighter cards with a 2.5% hairline and 4px corners, pill buttons, one family (Geist) at weight 400 on cursor.com's type scale, and orange only for text links."
scheme: "dark only"
colors:
  background: "#14120b"
  card: "#1b1913"
  pane: "#201e18"
  pane-2: "#26241e"
  pane-3: "#2b2923"
  foreground: "#edecec"
  muted-foreground: "#edecec at 60%"
  border: "#edecec at 10%"
  input: "#edecec at 20%"
  hairline: "#edecec at 2.5%"
  primary: "#edecec"
  on-primary: "#14120b"
  primary-hover: "#d7d6d5"
  link: "#f54e00"
  destructive: "#e0607f"
  success: "#4cc79b"
typography:
  family: "Geist Variable (Geist Mono Variable for code)"
  weight: 400
  roles:
    hero: "72/1.1, -0.03em (compact 52/1.15, -0.025em)"
    headline: "36/1.2, -0.02em (compact 26/1.25, -0.0125em)"
    display: "26/1.25, -0.0125em (compact 22/1.3, -0.005em)"
    title: "22/1.3, -0.005em (compact 18/1.4)"
    subtitle: "16/1.5, 0.005em (compact 14/1.5, 0.01em)"
    body: "14/1.5, 0.01em (compact 13/1.5, 0.005em)"
    caption: "12/1.5, 0.01em (compact 11/1.5, 0.0044em)"
    micro: "11/1.45 (compact 10/1.4)"
---

# Zedative

Zedative is the pilihpendidikan design system. Since November 2026 it is cursor.com's system in its dark theme, measured value by value from the live site (computed styles and CSS variables, `cook/refs/`): the same paper, ink, card, border and orange, the same pill buttons, the same type scale, container and section rhythm. Only the typeface differs, because Cursor's own (CursorGothic) is proprietary: Geist sets within 0.4% of its widths with an identical cap height. Nothing of Cursor's is shipped: no logo, no artwork, no copy.

**Dark only.** There is one scheme. There is no light theme and no theme switch in any app. Print artifacts (the CV, invoice and portfolio documents) stay white paper (§ Print artifacts).

## Overview

A calm, warm, near-black page. Everything is set at weight 400; hierarchy comes from size and from two greys (ink at 60% for secondary copy, 50% for dates and meta). Cards are one step lighter than the page, drawn with a hairline you feel more than see. Buttons are pills: the primary one is a light pill with dark text, the secondary a warm-grey pill, the ghost a transparent pill with a 20% outline. The only saturated colour is Cursor's orange, and it is spent on text links ("Open the CV builder →"), the active item of a docs nav and the orange badge. Sections are separated by space, never by rules. Nothing moves except colour, in 140ms.

## Colors

| Role | Token | Value |
|---|---|---|
| Page | `background` | `#14120b` |
| Card, popover, window, sidebar | `card`, `popover`, `sidebar` | `#1b1913` |
| Hover fill, chips, menu highlight | `pane` (= `muted`, `accent`) | `#201e18` |
| Secondary pill, selected row | `pane-2` (= `secondary`) | `#26241e` |
| Secondary hover | `pane-3` | `#2b2923` |
| Headings, controls, body | `foreground`, `ink` | `#edecec` |
| Large secondary copy (≥ 18px) | `ink-sec` | ink at 60% |
| Small grey text | `muted-foreground` | ink at 60% |
| Dates and meta (≥ 16px, on page or card) | `ink-mid` | ink at 50% |
| Decoration | `offgray` | ink at 40% |
| Dividers, field borders | `border`, `line` | ink at 10% |
| Outline-pill border, hovered or focused field | `input` | ink at 20% |
| Card outline | `hairline` | ink at 2.5% |
| Primary pill | `primary` / `primary-foreground` | `#edecec` / `#14120b`, hover `primary-deep` `#d7d6d5` |
| Text links | `link` | `#f54e00`, 75% on hover |
| Error | `destructive` | `#e0607f` |
| Success | `success` | `#4cc79b` |
| Tooltip | `tooltip` / `tooltip-foreground` | `#edecec` / `#14120b` |
| Screenshot placeholder | `shot` | `#0b0a06` |
| Selected tint | `wash` | ink at 5% |
| Marked text, selection | `highlight` | orange at 15% |
| Syntax (editor mocks only) | `syn-1` … `syn-4` | `#7fb3df` `#4cc79b` `#e0607f` `#c39cf0` |
| Charts | `chart-1` … `chart-5` | a neutral ink ramp: ink 90%, 70%, 55%, 40%, 25% (orange stays for links) |

## Typography

One family, Geist Variable (Geist Mono Variable for code), every role at weight 400. The roles are cursor.com's `type-*` utilities:

| Role | Size / line height / tracking | Compact | cursor.com use |
|---|---|---|---|
| `type-hero` | 72 / 1.1 / −0.03em | 52 / 1.15 / −0.025em | the closing "Try … now." |
| `type-headline` | 36 / 1.2 / −0.02em | 26 / 1.25 / −0.0125em | a centred section headline, the pricing title |
| `type-display` | 26 / 1.25 / −0.0125em | 22 / 1.3 / −0.005em | the hero h1, page titles |
| `type-title` | 22 / 1.3 / −0.005em | 18 / 1.4 | feature and section headings, dialog titles |
| `type-subtitle` | 16 / 1.5 / 0.005em | 14 / 1.5 / 0.01em | card titles and marketing copy, docs body |
| `type-body` | 14 / 1.5 / 0.01em | 13 / 1.5 / 0.005em | app copy, nav and footer links, buttons, menus |
| `type-caption` | 12 / 1.5 / 0.01em | 11 / 1.5 / 0.0044em | meta, group labels, tooltips |
| `type-micro` | 11 / 1.45 | 10 / 1.4 | counters and tiny badges |

A feature heading continues in grey at the same size: the title in `foreground`, the sentence after it in `ink-sec`. Marketing and docs headings stay at 400. Inside app surfaces (reui's blocks: card and section titles, setting-row labels, the sheet title, list and table primary cells, menu header names, builder section headings) titles and labels use `weight-semibold` (500); `weight-bold` (600) is for the rare figure that must stand out.

## Layout

- **Container**: 1300px (`max-w-rail`), 20px gutters (`px-5`). At 1440 the content starts at x = 70.
- **Header**: 52px, fixed, on the page colour, no rule. Links 14px with 5.6 × 15px padding; the actions on the right are a plain link, an outline `sm` pill and a primary `sm` pill.
- **Sections**: 67.2px above and below (`py-[67.2px]`), the hero 112px on top; a closing headline section 134.4px below. Sections are separated by space only.
- **Grids**: 24 columns with 10px gaps inside a large card; card grids use 10px gaps.
- **Large feature card**: 17.5px padding; the copy (383px) centred in 8 columns, the media in the other 16 at 680px tall; alternating sides; 90px between cards.
- **App chrome** (cursor.com/docs): a 48–49px header with a bottom `border`, a left nav on the card colour with a right `border`, 12px grey group labels, 29–32px rows, the active item orange; content in `type-subtitle`.

## Elevation & Depth

Flat. Cards are separated from the page by colour and a 2.5% hairline. Menus, popovers and selects use Cursor's flyout: two whisper shadows (`shadow-md`) over a 10% border. Windows (dialogs, the hero's product windows) add one soft drop (`shadow-lg`). Scrims are `shot` at 75% with no blur.

## Shapes

| Radius | Used by |
|---|---|
| 2px (`rounded-xs`) | media panels inside cards |
| 4px (`rounded-sm`, `rounded-md`) | cards, tiles, menu rows, code chips, tooltips |
| 8px (`rounded-lg`) | fields (inputs, selects, textareas), menus, popovers, dialogs, windows; in apps: kanban cards, the inner panel of a nested frame, property chips, square avatar tiles (32px+) |
| 12px (`rounded-xl`) | app containers only (reui): kanban lanes, the floating sheet, the outer frame of `SettingsCard` / `SectionCard` / `StatCard` / chart cards |
| pill (`rounded-full`) | every button, badges, toggles, tabs, switches, avatars |

## Components

- **Buttons** (`buttonVariants`): `default` light pill · `secondary` warm-grey pill with a hairline · `outline` transparent pill with a 20% border · `ghost` borderless · `link` orange text ending in → · `destructive` red at 10%. Sizes: `lg` 43px at 16px (Cursor's hero buttons), `default` 36px, `sm` 28px (Cursor's header buttons), `xs` 24px. Icon buttons are circles. Disabled filled buttons (primary, destructive) keep their colours at 50% opacity so the main action still reads as the main action; disabled secondary, outline, ghost and link buttons stay as they are with muted text.
- **Fields**: 36px, 8px radius, `border` on the page colour, `input` border on hover and focus, a 2px ink focus outline.
- **Cards** (`Card`): `bg-card`, 4px, `hairline`, 17.5px padding; title `type-subtitle`, description `type-subtitle` in grey.
- **Badges**: pills in the caption role; `default` is orange text on orange 10% (cursor.com's "Most popular").
- **Tabs**: the pricing toggle: a `pane` pill track with the active segment on `card` with a hairline ring.
- **Menus**: 8px windows, 32px rows with 4px corners, highlight `pane`, a trailing check for checked rows.
- **Kbd**: cursor.com's ⌘K chip: no border, ink-grey at 10%, caption role.
- **Sidebar**: card colour, 12px grey group labels, 30px rows, hover `pane/70`, active `pane-2` (apps) or orange text (docs-style nav).
- **Tables**: unboxed (no outer card), a 36px header of 13px grey labels over its underline, `border` row hairlines, hover `pane/60`; app tables put 14px primary cells over a 12px muted subline and use 28px ghost icon buttons for row actions.
- **Pickers** (reui's date selector, file upload, toggle group): `DatePicker` / `DateRangePicker` are fields led by a calendar icon with a round clear button, opening presets (row buttons) beside the Calendar; `FileTrigger` turns a Button into a file picker and `FileDropZone` is a dashed 8px drop field; `SegmentedControl` is the tabs track for one of a few choices.
- **Menu rows with icons**: options and menu items lead with a 16px lucide icon in `ink-sec` (or a `StatusDot`, a flag) and may end in a caption-role description; statuses use the 8px `StatusDot` (amber for warning).
- **Stage tones** (data only, never actions or links): `tone-blue`, `tone-violet`, `tone-amber`, plus `success`, `destructive` and the neutral `offgray`. `Badge tone` is a 4px chip on a 12% tint with a matching dot and the tone's text colour (AA on its tint); `StatusDot tone` the 8px dot. The Job Tracker maps stages so neighbouring lanes differ: saved neutral, preparing violet, ready blue, applied amber, interviewing / offer / accepted success, rejected destructive, withdrawn neutral (lane icons, dots and stage chips in board, list, table and sheet).
- **Sheet** (`floating`): 12px off the viewport with 12px corners and a full border; in the Job Tracker a 22px 500-weight title, the company 14px muted under it, a 40px avatar, 32px property chips (8px corners, no `Kbd` inside: shortcut hints live in menus), and a footer under a hairline with 16px padding.
- **Patterns** (`packages/ui/src/blocks`): `PageHeader` / `PageContent` frame an app screen (title `type-title-compact` at 500 with a `CountBadge`, an 18px bordered square); `SubNavLayout`, `SettingsCard` and `SettingsRow` build settings; **nested frames** (reui): `SettingsCard`, framed `SectionCard`, `StatCard` and the Job Tracker's chart cards are an outer 12px frame (`card`, 10% border, 4px padding) carrying the header (500-weight title, muted description) and footer, around an inner 8px panel one step darker (`background`, 10% border) holding the rows or content — the radii nest exactly (12 − 4 = 8); `Kanban` lanes are 288px borderless `card` columns with 12px corners, a 44px header (stage icon, 500-weight title, `CountBadge`) and cards on `pane` with their own border and 8px corners; `StatCard`s show a 13px label, a 22px value, a delta chip (tint + border + arrow, neutral bordered at zero) and a 12px footer; `UserMenu`, `AppBrand`, `GhostPage` and `WindowFrame` are app chrome. The design page's Patterns section renders each.
- **Footer**: the card colour, five 252px columns 10px apart, grey 14px headings, 14px links, then the copyright line and a language pill.

## Do's and Don'ts

- Do keep every marketing and docs heading at weight 400; let size and the grey continuation carry hierarchy. Inside app blocks, titles and labels take `weight-semibold` (500).
- Do spend the orange only on text links, the active docs-nav item and the orange badge.
- Do separate sections with space; draw rules only inside app chrome (header bottom, sidebar edge, table rows).
- Do use the light pill once per view as the main action.
- Don't add gradients, glows, glass, decorative orbs or particles; the hero's painted backdrop is the one illustration.
- Don't use uppercase, letter-spacing utilities or `font-<weight>` utilities; the roles carry tracking.
- Don't add `dark:` overrides: there is one scheme.
- Don't move pressables on `:active`; only colours change.

## Motion

140ms on `cubic-bezier(0.4, 0, 0.2, 1)` (cursor.com's `--duration` and ease) for background, border and text colour. Links dim to 75%, nav links to ink at 60%. Nothing enters, overlays open instantly, no route transitions, no press offset. The Blocks spinner and the slow status pulse keep moving because they are feedback.

## Implementation

Everything above is the spec. This section is how the workspace implements it. When the two disagree, fix the code.

### Where it lives

| Concern | File | Imported as |
|---|---|---|
| Tokens, type roles, radius, elevation, layout utilities, base layer | `packages/ui/src/styles/theme.css` | `@rulisme/ui/styles/theme.css` |
| Motion: curve, duration, `press` (a no-op), `pulse-dot`, the Blocks spinner, reduced motion | `packages/config/motion.css` | `@pilihpendidikan/config/motion.css` |
| shadcn runtime variants and utilities | `packages/ui/src/styles/shadcn.css` | `@rulisme/ui/styles/shadcn.css` |
| Components (primitives, composites, form pieces, ports; the full list is in `packages/ui/CLAUDE.md` § Components) | `packages/ui/src/{ui,blocks,form,reui}` | `@rulisme/ui/ui/<file>`, `@rulisme/ui/blocks/<file>` |
| `cn()` (registers the type utilities with tailwind-merge) | `packages/ui/src/lib/utils.ts` | `@rulisme/ui/lib/utils` |
| `typeClass()`, role and weight lists | `packages/ui/src/lib/type-scale.ts` | `@rulisme/ui/lib/type-scale` |
| The living design system page | `apps/design` | `bun run dev:design` → `localhost:4006` |
| Measured references | `cook/refs/` | — |

Each app's `src/styles.css` is four imports (`tailwindcss`, `motion.css`, `shadcn.css`, `theme.css`) plus an `@source` for `packages/ui/src`, followed only by its print-artifact rules. Apps never redefine a token; `bun run parity:typography` fails if one does.

### Tokens in code

`:root` carries the one scheme; `.dark` is an alias with the same values, so markup that still sets `className="dark"` changes nothing. Every value in § Colors is a CSS variable of the same name with a Tailwind colour (`bg-card`, `text-ink-sec`, `border-hairline`, `text-link` …). Translucent tokens are `color-mix(in oklab, #edecec N%, transparent)`, exactly as cursor.com defines them. `--font-print` (Inter) is reserved for the print artifacts.

### Layout utilities

`rail` is the 1300px container with 20px gutters; `band` a plain full-bleed section. `Band`, `Rail` and `Diamond` (`@rulisme/ui/ui/rails`) remain for older markup: `Diamond`, `rail-nodes`, `graph-paper` and `hatch` render nothing. `surface-card` paints the card recipe on any element.

### Focus

Every focusable element gets cursor.com's focus: a 2px solid `ring` (ink) outline 0.3ch off the control; fields draw it with no offset over their `input` border.

### Charts

`chart-1` (ink 90%) for the series that matters, `chart-2` … `chart-5` the lighter steps of the same ink ramp for comparisons and context. Orange is never a data colour. Labels sit on the marks; more than three series pair with a numbers table.

### Print artifacts

The CV templates, the invoice page and the portfolio deck are ink on white paper and mirror their `@react-pdf` twins. They keep their own look: Inter (`--font-print` on screen, the merged static cuts in `packages/ui/src/print/` in the PDF), the static weights 400 / 600 / 700, no uppercase or letter-spacing, `#000000` / `#393d45` / `#5a6170` text, `#cbcfd4` rules, `#1348dc` links, and the user's own invoice accent. Each paper re-scopes the token variables to those literal values in its app's `styles.css`, so the dark chrome never recolours a document. `TYPOGRAPHY.md` § Exceptions lists which lint rules skip print files.

How the builders set type on paper — one shared module, `packages/ui/src/print/`, used by all three (the CV's four `@react-pdf` templates live in `packages/cv-engine/src/pdf/`, shared by the CV builder and the Job Tracker's tailored-CV render page; each one's HTML preview stays in `apps/cv/src/components/templates/`):

- **PDF fonts** — `pdf-fonts.ts` registers Inter at 400 / 600 / 700 from `print/fonts/`: one font per weight merging the latin, latin-ext and vietnamese subsets (`scripts/build-print-fonts.sh` rebuilds them and `print-coverage.ts`), and repairs react-pdf's glyph cache. Each builder's `src/lib/pdf-fonts.ts` calls `registerPrintFonts(Font)`; the CV's `registerCvPrint` (in `apps/cv` and `apps/jobs`) also hands cv-engine the text normaliser through `registerCvPrintText`.
- **Line breaking** — words stay whole; lines may break after a hyphen, dash or slash; a run longer than a column also breaks after its separators and, as a last resort, anywhere with a hyphen. The paper sets `overflow-wrap: anywhere`.
- **Characters** — `pdf-text.ts` normalises every string (NFC, hyphen variants, arrows spelled out, emoji dropped); multi-line fields keep the user's lines.
- **Browser print** (`?print=1`) is always light (`color-scheme: light` in the theme's print rule) and keeps the paper's colours (`print-color-adjust: exact`).

### Measured contrast

WCAG 2.x ratios from the token pairs (translucent tokens composited over the surface):

| Pair | page | card | pane | pane-2 |
|---|---|---|---|---|
| foreground | 15.89 | 14.90 | 14.13 | 13.16 |
| muted-foreground / ink-sec (60%) | 6.25 | 6.07 | 5.90 | 5.66 |
| ink-mid (50%) | 4.68 | 4.61 | 4.52 | 4.38 |
| link (orange) | 5.33 | 5.00 | 4.74 | 4.41 |
| destructive | 5.48 | 5.15 | 4.88 | 4.54 |

The primary pill and the tooltip measure 15.89. `ink-mid` stays off `pane-2`. Known lows, kept because cursor.com chose them: the `border` (1.27) and `input` (1.74) hairlines are under the 3:1 non-text guideline; fields stay identifiable through their placeholder and the focus outline.

### Deviations from cursor.com

- Typeface: Geist instead of the proprietary CursorGothic (0.34% mean width error, identical cap height); Geist Mono instead of berkeleyMono.
- Dark only: cursor.com also ships a light theme; pilihpendidikan does not.
- App body copy is 14px (`type-body`) where cursor.com's docs use 15–16px, for dense app screens; marketing and docs-like pages use `type-subtitle` (16px).
- The hero's backdrop is our own painted landscape, drawn in SVG (`apps/home/src/components/painted-backdrop.tsx`), not Cursor's artwork.
