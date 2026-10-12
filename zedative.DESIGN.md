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

Relay adapts the flavor to a single family: Inter Variable 4.0, sized by the Fluid Functionalism type scale (six roles, three weights). The original flavor's serif and monospace pairing is retired; the rails, paper, colour and motion below are unchanged.

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
- Code: `typeClass(role, variant)` from `@relay/ui/lib/type-scale`, or `useSize().type.<role>` inside a `SizeProvider`; never a raw `text-[13px]` or Tailwind `text-xs`/`text-sm`. Editable fields add `fieldTouchClass` (16px on touch screens so iOS does not zoom). The legacy `type-*` utilities are aliases of these roles. Rendered markdown goes in `.typeset`.
- Load: `@fontsource-variable/inter/opsz.css` and `opsz-italic.css`.

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
.w{margin-inline:12px}```

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
