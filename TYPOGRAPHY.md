# Typography and Style Rules — Enforcement

This document is the authoritative spec for **enforcing** the Zedative design
system (`DESIGN.md`) in code. `DESIGN.md` owns the visual values; this file
owns the utilities, the lint rules and their exceptions. Where they conflict,
`DESIGN.md` wins on values and this file wins on rules.

Every UI surface in the workspace shares one type scale and one `cn()`:
**`apps/home`, `apps/cv`, `apps/invoice`, `apps/portfolio`, `apps/design`**
and **`packages/ui`**.

## Single Source of Truth

All tokens and type utilities live in **`packages/ui/src/styles/theme.css`**
(`@rulisme/ui/styles/theme.css`). Each app's `src/styles.css` imports it and
defines no tokens of its own.

`scripts/check-typography-parity.ts` (`bun run parity:typography`) fails when
an app's `styles.css` does not import the theme, or declares any typography or
colour token (`--font-*`, `--text-*`, `--leading-*`, `--tracking-*`,
`--font-weight-*`, `--color-*`), any `@theme` block or any `type-*` /
`weight-*` utility.

## The Scale — six roles

One family, Inter Variable (every `font-*` family token resolves to it). Each
role bakes size, whole-pixel line height, weight and optical size. Compact
steps are for dense regions: toolbars, filter bars, sidebars.

| Utility | Size / line | Weight | Compact | Use |
| ------- | ----------- | ------ | ------- | --- |
| `type-display` | 28 / 34 | 700, opsz 25 | `type-display-compact` 24 / 30 | the page title (hero h1) only |
| `type-title` | 16 / 22 | 550, opsz 18 | `type-title-compact` 15 / 20 | section headings, dialog and sheet titles |
| `type-subtitle` | 14 / 20 | 400, opsz 14 | `type-subtitle-compact` 13 / 18 | card titles, leads, quotes, chat bubbles |
| `type-body` | 13 / 20 | 400, opsz 14 | `type-body-compact` 12 / 18 | body copy, control labels, menu rows (the `body` default) |
| `type-caption` | 12 / 16 | 400, opsz 14 | `type-caption-compact` 11 / 14 | descriptions, meta, errors, group labels, tooltips |
| `type-micro` | 11 / 14 | 400, opsz 14 | `type-micro-compact` 10 / 12 | kbd caps, counters, tiny badges; single line |

In TypeScript, `typeClass(role, variant)` from `@rulisme/ui/lib/type-scale`
returns the same class names.

### Weights

Three weights, each paired with an optical size. A role carries its default;
override it with:

| Utility | Value | Use |
| ------- | ----- | --- |
| `weight-normal` | 400, opsz 14 | text (reset) |
| `weight-semibold` | 550, opsz 18 | headings, card titles, names, selected items |
| `weight-bold` | 700, opsz 25 | the display role only |

`weight-*` always wins over the role on the same element (Tailwind sorts
font-weight utilities after font-size ones). `<b>` / `<strong>` render at 550.

### Fields

Editable fields (`Input`, `Textarea`, the field part of `InputGroup`, `Select`
triggers that take text) add `field-touch`, which sets 16px on coarse pointers
so iOS Safari does not zoom on focus.

### Colour of text

- Running text inherits `ink` from `body`; never set paragraphs in
  `text-foreground` or black.
- Headings, labels, buttons, inputs, menu rows: `text-foreground`.
- Descriptions, meta, timestamps, counts: `text-muted-foreground`.
- Links and the hero headline: `text-primary` (the hero is also `italic`).
- `text-syn-*` only inside an editor mock.

## Forbidden Patterns

`scripts/lint-typography.sh` (`bun run lint:typography`) checks
`apps/home/src`, `apps/cv/src`, `apps/invoice/src`, `apps/portfolio/src`,
`apps/design/src` and `packages/ui/src`, and fails on any match. Inline style
font properties are checked as TypeScript/JSX syntax by
`scripts/check-inline-typography.ts`.

| Pattern | Why | Use instead |
| ------- | --- | ----------- |
| `text-xs`, `text-sm`, `text-base`, `text-lg` … `text-9xl` | Sizes off the six roles | a `type-*` role |
| `text-[…]` arbitrary size | Bypasses the scale | a `type-*` role |
| `leading-*` | Line height is baked into the role | the role |
| `tracking-*` | No letter-spacing | nothing |
| `uppercase`, `capitalize` | No uppercase | sentence case |
| `font-thin` … `font-black`, `font-normal`, `font-medium`, `font-semibold`, `font-bold` | Three weights, paired with opsz | `weight-normal` / `weight-semibold` / `weight-bold` |
| `font-[…]` arbitrary family | One family | `font-sans` (rarely needed) |
| Inline `style={{ fontSize / fontFamily / fontWeight }}` | Bypasses the system | a role class |
| `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-4xl` (and side variants) | Cards and sections are square | `rounded-none` / `-sm` / `-md` / `-lg` (see DESIGN.md § Radius) |
| `bg-gradient-*`, `bg-linear-*`, `bg-radial-*`, `bg-conic-*` | No gradients | flat token fills, `graph-paper` |
| `backdrop-blur*` | No glass | an opaque surface |
| `-[#…]` hex in a class | Raw colour | a token |
| `animate-in`, `animate-out`, `fade-in-*`, `zoom-in-*`, `slide-in-*` (and `-out`) | Nothing enters; overlays open instantly | nothing |
| `text-syn-*` / `bg-syn-*` outside an editor mock | Syntax colours stay in the editor | `text-primary`, `text-muted-foreground` |

Editor mocks are files named `*editor-mock*.tsx` and `apps/design/src`.

## Exceptions

New exceptions need a change that updates this section, naming the file, the
reason no token works and the alternative considered.

| Component | Pattern | Reason | Alternative considered |
| --------- | ------- | ------ | ---------------------- |
| `@react-pdf` renderers (`apps/cv/src/components/templates/*-pdf.tsx`, `apps/invoice/src/components/invoice-pdf.tsx`, `apps/portfolio/src/components/portfolio-pdf.tsx`) | `StyleSheet` `fontSize` / `fontWeight` (and `fontFamily: PDF_FONT_FAMILY`, the shared print family) | react-pdf has no `className`; StyleSheet props are the only way to set type in the exported PDF. `check-inline-typography.ts` skips `*-pdf.tsx` files that import `@react-pdf/renderer`, and the shared `packages/ui/src/print/pdf-fonts.ts` (its cut list names the embedded weights). Lint rule 17 still holds them, the print module and every app's `src/styles.css` to one family (Inter: no other family in a StyleSheet, a fallback list or `Font.register`, no built-in PDF font, no literal family in print CSS); rule 18 to no uppercase or letter-spacing | None — the PDF renderer cannot read CSS tokens |
| On-screen print documents (`apps/cv/src/components/templates/*-preview.tsx`, `templates/preview-entries.tsx`, `apps/invoice/src/components/invoice-preview.tsx`) | Print sizes (`text-[…rem]`, generic sizes), `leading-*`, and the static Inter weights 400 / 600 / 700 | The paper mirrors its PDF twin, which embeds static Inter cuts (react-pdf cannot use the variable `wght` / `opsz` axes) at print sizes. Only the size, leading and weight checks skip these files (`PRINT_GLOBS`); one family, no uppercase, no letter-spacing, tokens instead of hex and every other rule apply | The six screen roles — rejected: the printed CV and invoice would stop matching their PDFs |
| Print / PDF colours (`*-pdf.tsx`, `.cv-page`, `.invoice-page`, `.pf-*`) | Literal Zedative values on white paper (`#000000` headings, `#393d45` ink, `#5a6170` muted, `#cbcfd4` rules, `#1348dc` links); the user's own invoice accent | A print artifact must not change with Night Desk, so the paper re-scopes the token variables to these literals | None — print must look the same in every scheme |
| Flag SVGs, social-platform logos | Brand / `#fff` colours | Third-party marks, not chrome | None — recognition requires accurate colour |

The portfolio deck (`portfolio-preview.tsx`) styles its pages through the
scoped `.pf-*` CSS in `apps/portfolio/src/styles.css`, so the component itself
needs no exemption; its empty state is chrome and uses the roles. Lint rules
17 and 18 cover that CSS (and every app's `src/styles.css`): Inter only, no
`text-transform: uppercase`, no `letter-spacing`.

## Per-Component Guide

- **Buttons, nav links, tabs, toggles, inputs, menu rows:** `type-body`
  (components set it; don't restate it).
- **Page title (hero):** `type-display italic text-primary`, once per page.
- **Section heading, dialog / sheet title:** `type-title`.
- **Card title, lead paragraph:** `type-subtitle` (`weight-semibold` for card
  titles and names).
- **Descriptions, helper text, errors, meta, group labels:** `type-caption`
  in `text-muted-foreground` (errors: `text-destructive`).
- **Counters, kbd, tiny badges, status text:** `type-micro`.
- **Numbers that line up:** add `tabular-nums`.
- **Code / commands:** same family; set them in a `Kbd` or a `bg-muted`
  chip with `type-caption`.

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
bun run lint:typography     # forbidden patterns across the six UI roots
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
