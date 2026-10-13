---
version: "alpha"
name: "Zedative"
description: "Warm off-white graph paper ruled into hairline rails with diamond nodes, one type family (Inter Variable) set in six roles, and a light-theme editor as the hero."
colors:
  primary: "#1348dc"
  on-primary: "#ffffff"
  surface: "#f4f4f2"
  surface-container: "#fafafa"
  on-surface: "#000000"
  on-surface-variant: "#5a6170"
  outline: "#dadde2"
  ink: "#393d45"
  accent-deep: "#053794"
  line: "#cbcfd4"
  pane: "#ebebec"
  pane-2: "#dcdcdd"
  shot: "#2f343e"
  syn-1: "#5c78e2"
  syn-2: "#649f57"
  syn-3: "#d3604f"
  syn-4: "#a449ab"
typography:
  display:
    fontFamily: "Inter Variable"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 34px
  title:
    fontFamily: "Inter Variable"
    fontSize: 16px
    fontWeight: 550
    lineHeight: 22px
  subtitle:
    fontFamily: "Inter Variable"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  body:
    fontFamily: "Inter Variable"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  caption:
    fontFamily: "Inter Variable"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  micro:
    fontFamily: "Inter Variable"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 14px
rounded:
  xs: 2px
  md: 4px
  lg: 6px
  full: 9999px
spacing:
  unit: 4px
  section: 96px
  max-width: 1120px
---

# Zedative

> A code tool's homepage drawn on warm graph paper: one ruled column with diamond nodes at every crossing, a blue italic headline, one family (Inter) for everything, and the product itself as a light-theme editor window.

Source: https://flavors.design/f/zedative

pilihpendidikan adapts the flavor to a single family: Inter Variable 4.0, sized by the Fluid Functionalism type scale (six roles, three weights). The original flavor's serif and monospace pairing is retired; the rails, paper, colour and motion below are unchanged. It is the design system of every app in this workspace (`apps/home`, `apps/cv`, `apps/invoice`, `apps/portfolio`, `apps/jobs`, `apps/design`) and of `@rulisme/ui`. **Implementation** at the end of this file maps every rule to the code; `TYPOGRAPHY.md` holds the lint rules that enforce it; `apps/design` renders the whole system.

## Overview

Zedative is an engineering notebook that happens to sell software. The page is a warm off-white (`#f4f4f2`) with faint paper grain, and every section is a full-bleed band ruled by 1px hairlines, with a centred 1120px column that has its own side rules and **small rotated-square nodes** where the rules cross. Inside that frame the voice is split cleanly: one family, Inter, carries everything. Headings step up in size and weight (italic and blue for the hero and brand moments, upright black elsewhere), and everything else — body, nav, buttons, captions — sits in the body and caption roles on a whole-pixel rhythm. The single colour is a saturated cobalt (`#1348dc`) that appears in the hero headline, the primary button, prices, a few section titles and then floods the whole footer.

The emotional register is quiet confidence from people who care about milliseconds: no gradients shouting, no illustrations, no rounded pills. The product is shown, not described — a pixel-honest light-theme editor with a sidebar of branches, an agent thread and a syntax-highlighted file. It is not a dark hacker aesthetic, not a playful SaaS, not a Swiss grid; it is technical drafting paper with a literary headline.

## Colors

| Role        | Value     | Notes                                                         |
| ----------- | --------- | ------------------------------------------------------------- |
| bg          | `#f4f4f2` | warm paper, the page and every band                           |
| bg-2        | `#fafafa` | editor code pane, plan cards, letter sheet, nodes             |
| fg          | `#000000` | headings, button labels, nav links                            |
| ink         | `#393d45` | body copy — blue-grey, never pure black                       |
| fg-muted    | `#5a6170` | muted text: line numbers, timestamps, counts, descriptions    |
| offgray     | `#727a89` | decorative only: graph paper, lips, shadows, kbd edges        |
| accent      | `#1348dc` | hero h1, primary button, prices, footer slab                  |
| accent-fg   | `#ffffff` | text on the blue                                              |
| accent-deep | `#053794` | the 2px inset lip under the blue button                       |
| border      | `#dadde2` | button, card and tile outlines                                |
| line        | `#cbcfd4` | section rails, column rules, dividers, diamond nodes          |
| pane        | `#ebebec` | editor chrome and the agent thread                            |
| pane-2      | `#dcdcdd` | editor title bar, active sidebar row                          |
| shot        | `#2f343e` | dark screenshot placeholders and the app icon                 |
| syn-1..4    | `#5c78e2` `#649f57` `#d3604f` `#a449ab` | light-theme syntax: types, strings, numbers/errors, keywords |

Scheme: light. Contrast rule: ink on paper ≈ 10:1; muted text clears 4.5:1 on every surface (5.6:1 on bg, 6:1 on bg-2, 5.2:1 on pane). The old offgray `#727a89` measured 3.9:1 on paper, so it no longer sets text and only tints decoration.
Color rules: the blue is the only saturated colour outside code. It appears in at most two places per viewport except in the footer, where it becomes the background. Graph paper is always `--offgray` at 6% — present but barely. Syntax colours live only inside the editor mock. Every tint is a `color-mix()` off a token.

## Typography

One family: `"Inter Variable", ui-sans-serif, system-ui, sans-serif` (Inter 4.0 with its `opsz` axis). Every font token (`--font-sans`, `--font-mono`, `--font-serif`, `--font-heading`) resolves to it.

Six roles from the Fluid Functionalism type scale, each a size and a whole-pixel line height, at the default and compact steps (compact is for dense regions: toolbars, filter bars, sidebars):

| Role | Default | Compact | Use |
|---|---|---|---|
| display | 28/34 | 24/30 | the page title (hero h1) only |
| title | 16/22 | 15/20 | section headings, dialog and sheet titles |
| subtitle | 14/20 | 13/18 | card titles, leads, quotes, chat bubbles |
| body | 13/20 | 12/18 | body copy, control labels, menu rows |
| caption | 12/16 | 11/14 | descriptions, meta, errors, group labels, tooltips |
| micro | 11/14 | 10/12 | kbd caps, counters, tiny badges; single line |

- Weights: three, as `font-variation-settings` paired with optical size so a label keeps its width when it gets heavier: 400 / opsz 14 for text, 550 / opsz 18 for headings and selected items, 700 / opsz 25 for the display role only. In code: `weight-semibold`, `weight-bold` (`weight-normal` to reset).
- Rules: no uppercase, no letter-spacing; hierarchy comes from size and weight. Pick a role by purpose, not by matching a pixel value. The hero headline stays italic and accent blue.
- Code: the `type-<role>` and `type-<role>-compact` utilities, or `typeClass(role, variant)` from `@rulisme/ui/lib/type-scale`; never a raw `text-[13px]` or Tailwind `text-xs`/`text-sm`. Editable fields add `field-touch` (16px on touch screens so iOS does not zoom). Rendered markdown goes in `.typeset`.
- Load: `@fontsource-variable/inter/opsz.css` and `opsz-italic.css` (done once, in `@rulisme/ui/styles/theme.css`).

## Layout

- Max width 1120px column with its own 1px side rules; an outer pair of fainter rules sits `--rail` (112px) further out
- Base unit 4px; spacing scale 4 / 8 / 12 / 16 / 24 / 32 / 48 / 96
- Section rhythm: each section is a band with a 1px bottom rule across the full viewport; inner padding 48px, the hero 112px top
- Grid: 3 butted cells under the hero; editor 256px / 1fr / 1.25fr; testimonials 3 columns with the middle one raised; features 3×2 cells then full-width `+` rows; stats 4 cells; plugins 4×3 tiles; pricing 3 cards 32px apart; footer 2fr + 4 columns
- Density: balanced — generous vertical air around small, dense content
- Section heads are either centred (title + lead) or a left title/lead with the action button bottom-right on the same row

## Elevation & Depth

Flat drafting paper. Depth is almost entirely hairlines; the few shadows are either an inset lip on buttons or a soft two-layer drop under the editor and app icon.

- Rails: `border-inline: 1px solid var(--line)` on every `.w` column, `border-bottom: 1px solid var(--line)` on every band; nodes are 7px squares with `border: 1px solid var(--line)`, `background: var(--bg-2)`, `transform: rotate(45deg)` pinned where rules meet.
- Buttons: `box-shadow: inset 0 -2px 0 0 color-mix(in srgb, var(--offgray) 12%, transparent)` on secondary/tiles; primary uses `inset 0 -2px 0 0 var(--accent-deep), 0 1px 3px 0 accent-12%`. On hover the lip is removed (`box-shadow: none`).
- Big shadow `--shadow: 0 20px 25px -5px muted-22%, 0 8px 10px -6px muted-22%` only under the editor window, the Watch Demo tab and the app icon.
- Highlighted cards (middle testimonial, Pro plan, letter) get a flat offset `6px 6px 0 color-mix(accent 9–10%)` plus 8–12px graph paper inside.
- Paper grain: fixed SVG `feTurbulence` overlay at `opacity: var(--grain)` (0.06), `mix-blend-mode: multiply`. Graph paper: two 1px `linear-gradient`s at `--grid` pitch.
- Forbidden: glows, glass blur, gradients on buttons, shadows on ordinary cards.

## Shapes

- Radius: 4px buttons and nav links; 2px kbd, tiles, avatars; 6px the editor window top corners; 0 on section bands, plan cards, testimonial cards and the letter
- The app icon is the only big curve: 152px square at 40px radius with a 32px-radius inner tile
- Diamonds (45° squares) mark every rail intersection; circles only for status dots and window traffic lights
- Screenshot frames: a 1px dashed outline 6px outside the dark image

## Components

- Buttons: 36px tall (32px in nav), `0 12px 0 10px`, body role, 4px radius. Primary is solid blue with a darker 2px inset lip; secondary is paper at 60% with a 1px border at 60% and a grey lip. Both carry a trailing `<kbd>` shortcut hint (D, C, S) and a leading 14px icon. Text links end in a `›` chevron.
- Nav: 56px, column width, wordmark (logo square + title role) · Product ▾ Resources ▾ Plugins Docs Pricing │ Nightly · search with `⌘ ⇧ P` kbd │ Sign up [S] · blue Download [D]. A pale-blue "News:" bar sits under it.
- Editor mock: traffic lights, a branch sidebar grouped by repo with one active row, an agent thread with a bordered prompt, `○ Read …` tool lines and an answer, and a code pane with tabs, a breadcrumb, counter line numbers, a current-line fill and a wavy red underline. A "▶ Watch Demo" tab hangs from the band's top rule.
- Testimonials: subtitle-role quotes in black, one phrase marked with a 15% blue highlight; 32px framed initials avatar + semibold name + caption-role role.
- Feature cells: dashed-frame dark screenshot, subtitle-role semibold title, body-role text; below, full-width accordion rows ending in `+`.
- Open source: blue title, a ribbon of 20px square avatars between rules, then 4 stat cells with display-size tabular numbers.
- Plugin tiles: 2px radius, lip shadow, name + `↓ 2.4M` count, one-line description, `☺ author`; rows fade to 55% then 22% opacity.
- Pricing: caption label, display-size blue semibold price, check-list with blue ticks, full-width button pinned to the bottom. Middle card: graph paper, blue caption label, "Free trial" toggle, primary button; third card: blue-tinted button.
- Letter: a bordered envelope holding a sheet with a ring pattern and a round seal, caption label "A letter", title heading, rule, signature.
- Footer: solid blue slab, semibold column heads, underlined links with ↗ for external, and a hatched band with the wordmark in outline.

## Do's and Don'ts

- Do rule every section with full-bleed 1px lines and put a diamond node where the column rule crosses them.
- Do set the hero headline in the display role (Inter, 700), italic, in the accent blue; everything else in its role.
- Do show the product as a light-theme editor mock with real-looking code, not a screenshot or illustration.
- Do put a `<kbd>` shortcut inside primary actions.
- Do keep the blue scarce above the footer, then flood the footer with it.
- Do use graph paper and grain at barely-visible strength.
- Do give buttons an inset bottom lip that disappears on hover.

- Don't add a second font family; Inter Variable is the only one.
- Don't use weights other than 400 / 550 / 700, uppercase, letter-spacing, or sizes off the six roles.
- Don't round cards or sections; only buttons (4px) and small chips (2px) have radii.
- Don't add gradients, glows or glass.
- Don't use pure black for paragraphs; body is `--ink`.
- Don't let syntax colours leak out of the editor.

## Motion

- Duration 150ms, easing `cubic-bezier(0.4, 0, 0.2, 1)`
- What animates: button and tile background + lip shadow, nav link hover fill, footer underline colour, link opacity
- What never animates: layout, sections, the editor; nothing enters on scroll
- Signature move: buttons press `translateY(1px) scale(0.99)` on `:active`; the active branch dot and footer status dot pulse slowly
- Pulses live inside `@media (prefers-reduced-motion: no-preference)`

## Tweaks

Five knobs. `--grid` is the graph-paper pitch (6–40px) used by the hero, bands and cards; `--grid-ink` is its strength (0–20% of muted); `--node` sizes the rail diamonds (0 hides them); `--rail` sets how far the outer faint rules sit from the column; `--grain` is the paper noise opacity. Schemes: Night Desk, Parchment, Mint, Ember — each sets every colour literal on `:root`, including the four syntax colours.

## Reference CSS

```css
:root{
--bg:#f4f4f2;
--bg-2:#fafafa;
--fg:#000000;
--ink:#393d45;
--fg-muted:#5a6170;
--offgray:#727a89;
--accent:#1348dc;
--accent-fg:#ffffff;
--accent-deep:#053794;
--border:#dadde2;
--line:#cbcfd4;
--pane:#ebebec;
--pane-2:#dcdcdd;
--shot:#2f343e;
--syn-1:#5c78e2;
--syn-2:#649f57;
--syn-3:#d3604f;
--syn-4:#a449ab;
--font-display:"Inter Variable", ui-sans-serif, system-ui, sans-serif;
--font-body:var(--font-display);
--font-mono:var(--font-display);
--radius:4px;
--radius-xs:2px;
--radius-lg:6px;
--space-1:4px;
--space-2:8px;
--space-3:12px;
--space-4:16px;
--space-5:24px;
--space-6:32px;
--space-7:48px;
--space-8:96px;
--shadow:0 20px 25px -5px color-mix(in srgb, var(--offgray) 22%, transparent), 0 8px 10px -6px color-mix(in srgb, var(--offgray) 22%, transparent);
--lip:inset 0 -2px 0 0 color-mix(in srgb, var(--offgray) 12%, transparent);
--ease:cubic-bezier(0.4, 0, 0.2, 1);
--dur:150ms;
--max:1120px;
--rail:112px;
--node:7px;
--grid:16px;
--grain:0.06;
--wash:color-mix(in srgb, var(--accent) 7%, transparent);
--gridline:color-mix(in srgb, var(--offgray) calc(var(--grid-ink) * 1%), transparent);
--grid-ink:6;
}
.sec{position:relative;border-bottom:1px solid var(--line)}
.w{position:relative;max-width:var(--max);margin-inline:auto;border-inline:1px solid var(--line);background:var(--bg)}
.sec>.w::before,.sec>.w::after{content:"";position:absolute;z-index:3;top:calc(var(--node) / -2 - 0.5px);width:var(--node);height:var(--node);border:1px solid var(--line);background:var(--bg-2);transform:rotate(45deg)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 12px 0 10px;border:1px solid color-mix(in srgb, var(--border) 60%, transparent);border-radius:var(--radius);background:color-mix(in srgb, var(--bg-2) 60%, transparent);box-shadow:var(--lip);color:var(--fg);font:400 13px/20px var(--font-body);white-space:nowrap;cursor:pointer;transition:background-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease)}
.btn:hover{background:color-mix(in srgb, var(--pane) 70%, transparent);box-shadow:none}
.pri{border-color:transparent;background:var(--accent);box-shadow:inset 0 -2px 0 0 var(--accent-deep),0 1px 3px 0 color-mix(in srgb, var(--accent) 12%, transparent);color:var(--accent-fg)}
kbd{display:inline-flex;align-items:center;gap:2px;height:20px;padding:0 6px;border:1px solid color-mix(in srgb, var(--offgray) 22%, transparent);border-radius:var(--radius-xs);background:color-mix(in srgb, var(--bg-2) 50%, transparent);font:400 11px/14px var(--font-mono);color:var(--fg-muted)}
```

## Reference markup

```html
<nav class="nav"><div class="w">
  <a class="mark" href="#"><svg><use href="#i-mark"/></svg>Zedative</a>
  <div class="links"><a href="#">Product<svg><use href="#i-down"/></svg></a><a href="#">Docs</a><a href="#">Pricing</a></div>
  <div class="right"><a class="btn sm k pri" href="#">Download<kbd>D</kbd></a></div>
</div></nav>
<header class="sec hero"><div class="w">
  <h1>Code review at resting pulse</h1>
  <p class="lead">Zedative is a native diff reader built for speed, focus, and reviewing alongside humans and agents.</p>
  <div class="acts">
    <a class="btn k pri" href="#"><svg><use href="#i-dl"/></svg>Download now<kbd>D</kbd></a>
    <a class="btn k" href="#"><svg><use href="#i-branch"/></svg>Clone source<kbd>C</kbd></a>
  </div>
  <small>Available for Linux and every desktop OS</small>
</div></header>
<section class="sec"><div class="w trio">
  <div><h3>Fast</h3><p>Written in Rust and drawn on the GPU.</p></div>
  <div><h3>Calm</h3><p>No red badges, no confetti.</p></div>
  <div><h3>Shared</h3><p>Review in the same buffer.</p></div>
</div></section>
```

## How to apply this flavor

1. Replace the target page's design tokens with the palette, fonts and spacing above; load Inter Variable 4.0 with its `opsz` axis.
2. Wrap every section in a full-bleed band with a bottom hairline and a ruled 1120px column with diamond nodes.
3. Restyle components to match the Components section (lipped buttons with kbd hints, hairline cells, role-based type in one family); keep the page's content and structure.
4. If the product has a UI, draw it as a light-theme window in HTML instead of an image.
5. Apply the motion rules; remove any animation not described here, then check the Don't list.

---

## Implementation

Everything above is the spec. This section is how the workspace implements it. When the two disagree, fix the code.

### Where it lives

| Concern | File | Imported as |
|---|---|---|
| Tokens, type roles, radius, elevation, rails, paper, grain, base layer | `packages/ui/src/styles/theme.css` | `@rulisme/ui/styles/theme.css` |
| Motion: curve, duration, `press`, `pulse-dot`, the Blocks spinner, reduced-motion switch | `packages/config/motion.css` | `@pilihpendidikan/config/motion.css` |
| shadcn runtime variants and utilities (`data-open:` …, `no-scrollbar`, `scroll-fade`) | `packages/ui/src/styles/shadcn.css` | `@rulisme/ui/styles/shadcn.css` |
| Components (61 shadcn components + rails, kbd, spinner, not-found, form pieces) | `packages/ui/src/{ui,form,reui}` | `@rulisme/ui/ui/<file>` |
| `cn()` (registers the type utilities with tailwind-merge) | `packages/ui/src/lib/utils.ts` | `@rulisme/ui/lib/utils` |
| `typeClass()`, role and weight lists | `packages/ui/src/lib/type-scale.ts` | `@rulisme/ui/lib/type-scale` |
| The living design system page | `apps/design` | `bun run dev:design` → `localhost:4006` |

Each app's `src/styles.css` is four imports (`tailwindcss`, `motion.css`, `shadcn.css`, `theme.css`) plus an `@source` for `packages/ui/src` (the apps compile `@rulisme/ui` from source), followed only by its print-artifact rules. Apps never redefine a token; `bun run parity:typography` fails if one does.

### Token map

Zedative calls the cobalt "accent"; shadcn calls its hover wash "accent". In code the cobalt is `--primary` and `--accent` is the hover wash (`pane`).

| Zedative | CSS variable | Tailwind | Light | Night Desk |
|---|---|---|---|---|
| bg | `--background` | `bg-background` | `#f4f4f2` | `#181b21` |
| bg-2 | `--card`, `--popover`, `--secondary` | `bg-card`, `bg-popover` | `#fafafa` | `#1f232a` |
| fg | `--foreground` (+ `-card-`, `-popover-`, `-secondary-`, `-accent-foreground`) | `text-foreground` | `#000000` | `#f4f4f2` |
| ink | `--ink` | `text-ink` (the `body` default) | `#393d45` | `#c9cdd4` |
| fg-muted | `--muted-foreground` | `text-muted-foreground` | `#5a6170` | `#9aa1ad` |
| offgray | `--offgray` | `text-offgray` (decoration only) | `#727a89` | `#858c99` |
| accent | `--primary`, `--ring` | `bg-primary`, `text-primary` | `#1348dc` | `#7c9cff` |
| accent-fg | `--primary-foreground` | `text-primary-foreground` | `#ffffff` | `#0b1430` |
| accent-deep | `--primary-deep` | `bg-primary-deep` | `#053794` | `#3f5fc8` |
| border | `--border` | `border-border` | `#dadde2` | `#3e4552` |
| line | `--line`, `--input` | `border-line`, `border-input` | `#cbcfd4` | `#363c47` / `#434a57` |
| pane | `--muted`, `--accent`, `--pane`, `--sidebar` | `bg-muted`, `bg-accent`, `bg-pane` | `#ebebec` | `#252a32` |
| pane-2 | `--pane-2`, `--sidebar-accent` | `bg-pane-2` | `#dcdcdd` | `#2f343e` |
| shot | `--shot` | `bg-shot` | `#2f343e` | `#0f1115` |
| — (tooltip) | `--tooltip`, `--tooltip-foreground` | `bg-tooltip` | `#2f343e` / `#fafafa` | `#e4e6ea` / `#181b21` |
| wash | `--wash` (accent 7%) | `bg-wash` | | accent 12% |
| — (highlight) | `--highlight` (accent 15%) | `bg-highlight` | | accent 22% |
| syn-1..4 | `--syn-1` … `--syn-4` | `text-syn-1` … (editor mock only) | DESIGN.md values | `#8aa2ff` `#8fc985` `#f0907f` `#d38ad9` |
| — (error) | `--destructive`, `--destructive-foreground` | `text-destructive` | `#b42318` / `#ffffff` | `#ff8a80` / `#1a0705` |
| — (charts) | `--chart-1` … `--chart-5` | `bg-chart-1` … | cobalt, deep, muted, offgray, `#9aa1ad` | lifted equivalents |

Body text inherits `ink`; headings, labels, buttons, inputs and menu rows use `foreground`. The DESIGN.md has no error colour; `#b42318` is derived (5.97:1 on bg, 5.08:1 on its own 10% tint) and sits far from the cobalt in hue.

### Type roles and weights

`type-display`, `type-title`, `type-subtitle`, `type-body`, `type-caption`, `type-micro`, each with a `-compact` step. A role sets size, whole-pixel line height, weight and optical size together (display 700/opsz 25, title 550/opsz 18, the rest 400/opsz 14). `weight-normal`, `weight-semibold` and `weight-bold` override the weight; Tailwind always sorts them after the roles. `<b>` and `<strong>` render at 550. `body` defaults to `type-body` in `ink`. Inputs and textareas add `field-touch`. `cn()` knows both groups, so `cn("type-body", className)` lets a caller swap the role. `TYPOGRAPHY.md` lists what the lint forbids.

### Radius

| Class | Value | Used by |
|---|---|---|
| `rounded-none` | 0 | cards, sections, bands, alerts, tables, sheets, the letter |
| `rounded-sm` (`rounded-xs`) | 2px | kbd, badges, chips, tiles, avatars, checkboxes, switches, menu rows |
| `rounded-md` | 4px | buttons, nav links, inputs, selects, toggles, tab triggers |
| `rounded-lg` | 6px | windows: dialogs, popovers, menus, toasts, command, the editor window |
| `rounded-full` | 9999px | status dots, traffic lights, radio buttons |

`rounded-xl` and up are capped at 6px in the theme and rejected by the lint.

### Elevation

| Level | Class | Rests there |
|---|---|---|
| Flat | none | page, bands, cards, tables, inputs |
| Lip | `inset-shadow-lip` (`inset-shadow-lip-primary` + `shadow-primary` on primary) | buttons, tiles, toggles; removed with `hover:inset-shadow-none` |
| Offset | `shadow-offset` (+ `graph-paper`) | highlighted cards |
| Float | `shadow-float` (= `shadow-md` … `shadow-2xl`) | dialogs, popovers, menus, toasts, the editor window |

`shadow-xs` and `shadow-sm` are flat (no shadow), so ordinary cards stay flat even when a component asks for them. The lip is an inset shadow, so focus rings compose with it instead of replacing it.

### Rails, nodes and paper

- Utilities: `band` (full-bleed, 1px bottom `line`), `rail` (1120px column with side rules, 12px clear of the viewport edge), `rail-nodes` (diamonds at the column's top corners), `diamond` (one node, positioned by the caller), `graph-paper`, `bg-wash`, `bg-highlight`.
- Components: `Band`, `Rail` (`nodes` defaults to on) and `Diamond` from `@rulisme/ui/ui/rails`.
- Grain is a fixed `body::after` overlay at `--grain` with `--grain-blend`; it is hidden in print and forced-colors mode.
- Editors use the same frame: toolbars are bands, panes are ruled by `line`, a diamond marks where a toolbar's rule meets the pane divider, and the document preview sits on `graph-paper`.

### Focus

The DESIGN.md does not specify focus. Actions (buttons, toggles, tabs, checkboxes, radios, switches, slider thumbs, links) get a 2px solid `ring` outline at a 2px offset: `outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring` (`outline-solid` is required: `outline-none` also zeroes Tailwind's outline style). Fields (input, textarea, select, combobox, OTP) turn their border `ring` with a 3px halo: `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20`. The base layer gives every other focusable element the same 2px outline. Inside a cobalt slab (`bg-primary`, the footer) the outline turns `primary-foreground`. The shadcn `data-*:` state variants (`data-checked:`, `data-active:` …) are zero-specificity, so a `hover:` on the same property is scoped to the inactive state (`data-[state=unchecked]:hover:`).

### Motion

`motion.css` sets 150ms on `cubic-bezier(0.4, 0, 0.2, 1)` as the default for every `transition-*` utility (`ease-standard`). Components transition only `background-color`, `border-color`, `color`, `opacity` and `box-shadow`. `press` applies the `translateY(1px) scale(0.99)` offset instantly on `:active`. `pulse-dot` is the slow status pulse. Overlays (dialogs, menus, popovers, tooltips, accordions) open and close without animation, nothing fades in on mount, and there are no route transitions. The Blocks spinner keeps moving because loading feedback is functional.

### Component recipes

| Zedative recipe | `@rulisme/ui` |
|---|---|
| Primary button | `Button` `default`: cobalt, `inset-shadow-lip-primary`, `shadow-primary`, lip removed on hover |
| Secondary button (paper 60%, border 60%, grey lip) | `Button` `outline` |
| Neutral filled control | `Button` `secondary` (pane + lip) |
| Nav link | `Button` `ghost` (hover fill `pane`), `size="sm"` (32px) in the nav |
| Text link with `›` | `Button` `link` (adds the chevron when there is no icon) |
| `<kbd>` hint | `Kbd`; inside a primary button it becomes a translucent white cap |
| Tiny badge | `Badge` (`secondary` / `outline` by default; `default` spends the blue) |
| Plan / feature card | `Card` (square, bordered, flat); highlighted adds `shadow-offset graph-paper` |
| Accordion row ending in `+` | `Accordion` |
| Framed initials avatar | `Avatar` (2px, framed) |
| Window (editor, dialog) | `Dialog`, `Sheet`, `Popover`, `Command`: 6px, bordered, `shadow-float` |
| Band / ruled column / diamond | `Band`, `Rail`, `Diamond` |

Control heights move together: buttons, inputs, selects, toggles and OTP slots are 36px by default and 32px at `sm`.

### Charts

Zedative allows one saturated colour, so a chart is an **emphasis chart**: the
series that matters in cobalt (`chart-1`), context series in the greys
(`chart-3` … `chart-5`), `chart-2` (deep cobalt) only next to `chart-1` as a
stacked or paired value. The palette cannot keep five categorical series
apart (several pairs measure under ΔE 15, and `chart-5` sits under 3:1), so a
chart with more than two series pairs with a numbers table, and labels sit on
the marks rather than in a colour-only legend. Tooltips use the window recipe.

### Print artifacts

The CV templates, the invoice page and the portfolio deck are ink on paper, and each mirrors its `@react-pdf` twin. They follow Zedative too: Inter is the only family, there is no uppercase and no letter-spacing, headings stand apart by weight and a hairline, text is `#000000` / `#393d45` / `#5a6170` with `#cbcfd4` rules and `#1348dc` links, and photos are 2px-radius squares in a 1px `#dadde2` frame. What stays theirs: print sizes, the static weights 400 / 600 / 700 (react-pdf cannot use the variable axes, so headings use 600 where the screen uses 550), each template's layout, and the user's own invoice accent colour. The paper re-scopes the token variables to those literal values, so Night Desk never recolours a document. The portfolio deck's cover is a `shot` (`#2f343e`) slab whose links take Night Desk's lifted cobalt (`#7c9cff`, 4.79:1 there). `TYPOGRAPHY.md` § Exceptions lists which lint rules skip print files (sizes, leading and weights only).

How the builders set type on paper — one shared module, `packages/ui/src/print/`, used by all three (the CV's four `@react-pdf` templates live in `packages/cv-engine/src/pdf/`, shared by the CV builder and the Job Tracker's tailored-CV render page; each one's HTML preview stays in `apps/cv/src/components/templates/`):

- **PDF fonts** — `pdf-fonts.ts` registers Inter at 400 / 600 / 700 from `print/fonts/`: one font per weight that merges the `@fontsource/inter` latin, latin-ext and vietnamese subsets (`scripts/build-print-fonts.sh` rebuilds them and the coverage table `print-coverage.ts`), so names such as Ševčík, Łukasz or Nguyễn stay in one font and a word never breaks where a font would change. It also repairs react-pdf's glyph cache (a letter built into a composite such as É no longer vanishes from the next PDF of a session). Each builder's `src/lib/pdf-fonts.ts` calls `registerPrintFonts(Font)` and sets `PDF_FONT_FAMILY` on its pages. cv-engine sits below `@rulisme/ui` and cannot import the print module, so the CV's `registerCvPrint` (in `apps/cv` and, for the render page, `apps/jobs`) also hands it the text normaliser through `registerCvPrintText`. The on-screen paper uses `--font-sans` at the static cuts' optical size (`opsz` 14).
- **Line breaking** — words stay whole (the browser never hyphenates the paper, and react-pdf's English patterns split Indonesian badly). Lines may break after a hyphen, a dash or a slash, as browsers do, without an added hyphen; a run longer than a column holds (a URL, an email, an IBAN) also breaks after its separators (`.` `@` `_` `?` `&` …), and only as a last resort anywhere, marked with a hyphen. The paper sets `overflow-wrap: anywhere`, so a long run never leaves the sheet; where it breaks can differ from the PDF.
- **Characters** — `pdf-text.ts` makes every string safe before the PDF sees it: accents composed (NFC), the hyphen variants and line separators normalised, arrows spelled out (`->`), emoji dropped; a one-line field collapses its spaces and line breaks like `white-space: normal`, and a multi-line field (CV summary and descriptions, invoice addresses and notes) keeps the user's lines, one Text per line in the PDF and `whitespace-pre-line` on the paper. Scripts the cuts lack (CJK, Cyrillic, Greek) are left to react-pdf's fallback font. The invoice writes the ordinary yen sign.
- **Browser print** (the `?print=1` views behind the API's `.pdf` links) is always light (`color-scheme: light` in `theme.css`'s print rule) and keeps the paper's own colours (`print-color-adjust: exact`), so the invoice's accent rule and the deck's cover survive.
- **On screen** the paper sits under the page's grain overlay, which multiplies in light and overlays in Night Desk; the document's own colours are identical in both schemes, and print and PDF carry no grain.

### Night Desk (derived dark)

The DESIGN.md names a Night Desk scheme without values, so `.dark` is derived from the brand's dark surface (`shot`): the light ramp inverted around elevation (raised surfaces get lighter), vividness lowered, the cobalt lifted to `#7c9cff` with dark text on it. Every text pair was measured; see below. Light is the default theme in every app; the builders keep their theme toggle.

### Measured contrast

All values are WCAG 2.x ratios measured from the token pairs.

| Pair | Light | Night Desk |
|---|---|---|
| foreground on background | 19.07 | 15.66 |
| ink on background | 9.89 | 10.81 |
| muted-foreground on background / card / pane / pane-2 | 5.64 / 5.96 / 5.22 / 4.54 | 6.63 / 6.06 / 5.55 / 4.80 |
| primary-foreground on primary | 7.03 | 6.96 |
| primary as text on background | 6.38 | 6.62 |
| destructive on background | 5.97 | 7.56 |
| tooltip-foreground on tooltip | 11.96 | 13.80 |
| primary-foreground at 80% on primary (footer secondary text) | ≥ 4.62 | ≥ 4.48 at 75%, so use 80% or more |

Known lows, kept because the spec chose them: the `border` and `line` hairlines measure 1.24 and 1.42 against paper (below the 3:1 non-text guideline), and the light syntax colours measure 3.0 to 4.9 on `bg-2` (`syn-2` drops to 2.71 on the editor's current-line wash). Fields stay identifiable through their placeholder text and fill.

### Deviations from the flavor

- Night Desk dark is derived (above); the flavor gives no values.
- An error red (`#b42318` / `#ff8a80`) is added; the flavor has none.
- Radio buttons stay round: a functional convention, not decoration.
- The loading spinner (Blocks) and drag-to-reorder movement keep animating: they are direct feedback, not decoration.
- `outline` carries the flavor's secondary recipe and `secondary` is a neutral pane fill, so shadcn's variant names keep their usual meaning.
