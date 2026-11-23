# Typography and Style Rules — Enforcement

This document is the authoritative spec for **enforcing** the Zedative design
system (`DESIGN.md`) in code. `DESIGN.md` owns the visual values; this file
owns the utilities, the lint rules and their exceptions. Where they conflict,
`DESIGN.md` wins on values and this file wins on rules.

Every UI surface in the workspace shares one type scale and one `cn()`:
**`apps/home`, `apps/cv`, `apps/invoice`, `apps/portfolio`, `apps/jobs`,
`apps/design`** and **`packages/ui`**.

## Single Source of Truth

All tokens and type utilities live in **`packages/ui/src/styles/theme.css`**
(`@rulisme/ui/styles/theme.css`). Each app's `src/styles.css` imports it and
defines no tokens of its own.

`scripts/check-typography-parity.ts` (`bun run parity:typography`) fails when
an app's `styles.css` does not import the theme, or declares any typography or
colour token (`--font-*`, `--text-*`, `--leading-*`, `--tracking-*`,
`--font-weight-*`, `--color-*`), any `@theme` block or any `type-*` /
`weight-*` utility.

## The Scale — eight roles

One family, Geist Variable (Geist Mono Variable for code; `--font-print`,
Inter, belongs to the print artifacts). Every role is cursor.com's `type-*`
utility: size, line height and tracking baked in, weight 400. Compact steps
are for dense regions: toolbars, filter bars, sidebars.

| Utility | Size / line / tracking | Compact | Use |
| ------- | ---------------------- | ------- | --- |
| `type-hero` | 72 / 1.1 / −0.03em | 52 / 1.15 / −0.025em | the closing call to action on a landing page |
| `type-headline` | 36 / 1.2 / −0.02em | 26 / 1.25 / −0.0125em | a centred section headline |
| `type-display` | 26 / 1.25 / −0.0125em | 22 / 1.3 / −0.005em | the hero h1, page titles |
| `type-title` | 22 / 1.3 / −0.005em | 18 / 1.4 | feature and section headings, dialog and sheet titles |
| `type-subtitle` | 16 / 1.5 / 0.005em | 14 / 1.5 / 0.01em | card titles, marketing and docs copy, leads |
| `type-body` | 14 / 1.5 / 0.01em | 13 / 1.5 / 0.005em | app copy, control labels, nav and menu rows (the `body` default) |
| `type-caption` | 12 / 1.5 / 0.01em | 11 / 1.5 / 0.0044em | descriptions, meta, errors, group labels, tooltips |
| `type-micro` | 11 / 1.45 | 10 / 1.4 | counters, tiny badges; single line |

In TypeScript, `typeClass(role, variant)` from `@rulisme/ui/lib/type-scale`
returns the same class names.

### Weights

Everything is 400, like cursor.com. Two heavier steps exist for the rare
label that needs them:

| Utility | Value | Use |
| ------- | ----- | --- |
| `weight-normal` | 400 | text (reset) |
| `weight-semibold` | 500 | a selected item in dense data, `<b>` / `<strong>` |
| `weight-bold` | 600 | a total or a figure that must stand out |

Headings never take a heavier weight: a feature heading continues in
`text-ink-sec` at the same size instead. `weight-*` always wins over the role
on the same element (Tailwind sorts font-weight utilities after font-size
ones).

### Fields

Editable fields (`Input`, `Textarea`, the field part of `InputGroup`, `Select`
triggers that take text) add `field-touch`, which sets 16px on coarse pointers
so iOS Safari does not zoom on focus.

### Colour of text

- Running text inherits `ink` from `body` (the same light ink as headings).
- Secondary copy at 18px and up (the grey continuation of a heading):
  `text-ink-sec`.
- Descriptions, meta, timestamps, counts: `text-muted-foreground`.
- Dates and meta at 16px on the page or a card: `text-ink-mid`.
- Text links: `text-link` (orange), dimming to 75% on hover, ending in →.
- `text-syn-*` only inside an editor mock.

## Forbidden Patterns

`scripts/lint-typography.sh` (`bun run lint:typography`) checks
`apps/home/src`, `apps/cv/src`, `apps/invoice/src`, `apps/portfolio/src`,
`apps/jobs/src`, `apps/design/src` and `packages/ui/src`, and fails on any
match. Its print rules (17 and 18) also scan the CV PDF templates in
`packages/cv-engine/src/pdf` and the shared print module in
`packages/ui/src/print`. Inline style font properties are checked as
TypeScript/JSX syntax by `scripts/check-inline-typography.ts` over the same
app roots.

| Pattern | Why | Use instead |
| ------- | --- | ----------- |
| `text-xs`, `text-sm`, `text-base`, `text-lg` … `text-9xl` | Sizes off the eight roles | a `type-*` role |
| `text-[…]` arbitrary size | Bypasses the scale | a `type-*` role |
| `leading-*` | Line height is baked into the role | the role |
| `tracking-*` | No letter-spacing | nothing |
| `uppercase`, `capitalize` | No uppercase | sentence case |
| `font-thin` … `font-black`, `font-normal`, `font-medium`, `font-semibold`, `font-bold` | One weight (400) with two rare steps | `weight-normal` / `weight-semibold` / `weight-bold` |
| `font-[…]` arbitrary family | One family | `font-sans`, `font-mono` for code, `font-print` on print artifacts |
| Inline `style={{ fontSize / fontFamily / fontWeight }}` | Bypasses the system | a role class |
| `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-4xl` (and side variants) | cursor.com stops at 8px (pills aside) | `rounded-xs` 2px / `-sm` 4px / `-lg` 8px / `-full` (see DESIGN.md § Shapes) |
| `bg-gradient-*`, `bg-linear-*`, `bg-radial-*`, `bg-conic-*` | No gradients | flat token fills |
| `backdrop-blur*` | No glass | an opaque surface |
| `-[#…]` hex in a class | Raw colour | a token |
| `animate-in`, `animate-out`, `fade-in-*`, `zoom-in-*`, `slide-in-*` (and `-out`) | Nothing enters; overlays open instantly | nothing |
| `text-syn-*` / `bg-syn-*` outside an editor mock | Syntax colours stay in the editor | `text-link`, `text-muted-foreground` |

Editor mocks are files named `*editor-mock*.tsx` and `apps/design/src`.

## Exceptions

New exceptions need a change that updates this section, naming the file, the
reason no token works and the alternative considered.

| Component | Pattern | Reason | Alternative considered |
| --------- | ------- | ------ | ---------------------- |
| `@react-pdf` renderers (the CV templates `packages/cv-engine/src/pdf/*-pdf.tsx`, `apps/invoice/src/components/invoice-pdf.tsx`, `apps/portfolio/src/components/portfolio-pdf.tsx`) | `StyleSheet` `fontSize` / `fontWeight` (and `fontFamily: PDF_FONT_FAMILY`, the shared print family) | react-pdf has no `className`; StyleSheet props are the only way to set type in the exported PDF. `check-inline-typography.ts` skips `*-pdf.tsx` files that import `@react-pdf/renderer`, and the shared `packages/ui/src/print/pdf-fonts.ts` (its cut list names the embedded weights). Lint rule 17 still holds them, the print module and every app's `src/styles.css` to one family (Inter: no other family in a StyleSheet, a fallback list or `Font.register`, no built-in PDF font, no literal family in print CSS, which uses `var(--font-print)`); rule 18 to no uppercase or letter-spacing | None — the PDF renderer cannot read CSS tokens |
| On-screen print documents (`apps/cv/src/components/templates/*-preview.tsx`, the HTML twins of the cv-engine PDFs, `templates/preview-entries.tsx`, `apps/invoice/src/components/invoice-preview.tsx`) | Print sizes (`text-[…rem]`, generic sizes), `leading-*`, and the static Inter weights 400 / 600 / 700 | The paper mirrors its PDF twin, which embeds static Inter cuts (react-pdf cannot use the variable `wght` / `opsz` axes) at print sizes. Only the size, leading and weight checks skip these files (`PRINT_GLOBS`); one family, no uppercase, no letter-spacing, tokens instead of hex and every other rule apply | The eight screen roles — rejected: the printed CV and invoice would stop matching their PDFs |
| Print / PDF colours (`*-pdf.tsx`, `.cv-page`, `.invoice-page`, `.pf-*`) | Literal print values on white paper (`#000000` headings, `#393d45` ink, `#5a6170` muted, `#cbcfd4` rules, `#1348dc` links); the user's own invoice accent | A print artifact is white paper inside the dark chrome, so the paper re-scopes the token variables to these literals | None — print must look the same in every scheme |
| Hub painted backdrop (`apps/home/src/components/painted-backdrop.tsx`) | Literal paint colours and SVG gradients inside an SVG | It is an illustration (the hero's landscape), not chrome; no lint rule matches SVG attributes | A flat `bg-card` frame — rejected: cursor.com's hero frames its window on a painting |
| Flag SVGs, social-platform logos | Brand / `#fff` colours | Third-party marks, not chrome | None — recognition requires accurate colour |

The portfolio deck (`portfolio-preview.tsx`) styles its pages through the
scoped `.pf-*` CSS in `apps/portfolio/src/styles.css`, so the component itself
needs no exemption; its empty state is chrome and uses the roles. Lint rules
17 and 18 cover that CSS (and every app's `src/styles.css`): Inter only, no
`text-transform: uppercase`, no `letter-spacing`.

## Per-Component Guide

- **Buttons, nav links, tabs, toggles, inputs, menu rows:** `type-body`
  (components set it; don't restate it). Hero buttons (`size="lg"`) are
  `type-subtitle`.
- **Hero h1:** `type-display`, once per page; a landing page's closing line
  `type-hero`, a centred section headline `type-headline`.
- **Feature or section heading, dialog / sheet title:** `type-title` (its
  grey continuation in `text-ink-sec`).
- **Card title and copy, docs body:** `type-subtitle`.
- **Descriptions, helper text, errors, meta, group labels:** `type-caption`
  in `text-muted-foreground` (errors: `text-destructive`).
- **Counters, tiny badges:** `type-micro`.
- **Numbers that line up:** add `tabular-nums`.
- **Code / commands:** `font-mono` (set by the base layer on `code`, `kbd`,
  `pre`) in a `bg-pane` chip.

## tailwind-merge Configuration

`cn()` in `packages/ui/src/lib/utils.ts` (imported by every app as
`@rulisme/ui/lib/utils`) registers two class groups with tailwind-merge:
`type-role` (every `type-*` utility, which also replaces any `text-<size>` or
`leading-*` before it) and `type-weight` (`weight-*`, which conflicts with
Tailwind's `font-<weight>`). The lists come from `TYPE_UTILITIES` and
`TYPE_WEIGHTS` in `lib/type-scale.ts`. `bun run parity:twmerge` asserts they
match the `@utility type-*` and `@utility weight-*` blocks in `theme.css`.

## Verification Commands

```sh
bun run lint:typography     # forbidden patterns across the seven UI roots
bun run parity:typography   # apps import theme.css and define no tokens
bun run parity:twmerge      # cn() registers every type-* and weight-* utility
bun run check               # the full chain
```

## When in Doubt

1. Look at the component in `packages/ui` that already solves the same
   context, or at `apps/design`.
2. Pick the role by purpose (the Use column above), not by pixel size.
3. If nothing fits, propose a change to `DESIGN.md` first. Never add an
   arbitrary value.
