# Typography System — Strict Rules

This document is the authoritative spec for typography **enforcement** across
the workspace's UI apps. The typographic **scale** itself is defined by the Warp
("moonlit terminal") design system in `DESIGN.md`. Where this document and
`DESIGN.md` conflict, `DESIGN.md` wins for visual values and this document wins
for the utility / lint rules.

All four apps — **`apps/cv`, `apps/invoice`, `apps/portfolio` and `apps/home`** — share
**one** typography scale (the Warp scale) and one `cn()` helper from
`@rulisme/ui` (`packages/ui`).

## Token Source of Truth

The Warp `@theme inline { … }` typography tokens are **byte-identical** across:

| App | File | Role |
| --- | ---- | ---- |
| `apps/cv` | `src/styles.css` | Canonical reference |
| `apps/invoice` | `src/styles.css` | Must match `apps/cv` |
| `apps/portfolio` | `src/styles.css` | Must match `apps/cv` |
| `apps/home` | `src/styles.css` | Must match `apps/cv` |

`scripts/check-typography-parity.ts` (`bun run parity:typography`) diffs the
typography tokens (font sizes, line heights, tracking, leading, font families,
font weights) of all four and fails on any drift.

## Token Inventory — the Warp scale

Every size token bakes its line-height **and** its (negative-at-display,
positive-for-eyebrows) letter-spacing, so a single utility carries the
engineered look. There are **no standalone `tracking-*` utilities**.

### Font Size + Line Height + Tracking (all baked into the size token)

| Utility | Size | Line-height | Tracking | Use case |
| ------- | ---- | ----------- | -------- | -------- |
| `text-display` | `68px` | `1` | `-2.04px` | Marketing hero headline |
| `text-heading-lg` | `48px` | `1.1` | `-1.44px` | Section opener / large feature headline |
| `text-heading` | `32px` | `1.19` | `-0.64px` | Page / section heading |
| `text-heading-sm` | `24px` | `1.2` | `-0.48px` | Sub-section heading |
| `text-subheading` | `20px` | `1.3` | `-0.2px` | Card / panel heading, page H1 in compact UI |
| `text-body` | `16px` | `1.38` | `0.16px` | Default body / paragraph |
| `text-body-sm` | `14px` | `1.38` | `0.14px` | Secondary body, compact copy, dialog titles |
| `text-caption-tracked` | `11px` | `1.2` | `2.2px` | Uppercase eyebrow / tracked small-caps label |
| `text-micro` | `10px` | `1.2` | `0.2px` | Status dots, supplementary metadata (size floor) |

`text-xs` (Tailwind built-in, `0.75rem` / 12px) is the **compact-chrome default**
— buttons, tabs, nav links, form inputs, dense controls. It is the single allowed
generic Tailwind text utility.

### Font Weight

Weights are **400 / 500 only**. `font-bold` (700) **and** `font-semibold` (600)
are both forbidden in chrome — Warp's hierarchy comes from size + tracking +
colour, not weight.

| Utility | Value | Use case |
| ------- | ----- | -------- |
| `font-regular` | `400` | Default body copy |
| `font-medium` | `500` | Headings, emphasis, button labels, nav links |

If a headline genuinely needs 600/700, add a `--font-weight-*` token to every
`@theme inline` block first and add an Exceptions row below.

## Utility Mapping (migration table)

When replacing generic Tailwind utilities with Warp tokens:

| Generic | Replace with |
| ------- | ------------ |
| `text-xs` on label / eyebrow (uppercase) | `text-caption-tracked` (+ `uppercase`) |
| `text-xs` on button / tab / nav / input | keep `text-xs` (chrome default) |
| `text-sm` | `text-body-sm` |
| `text-base` | `text-body` |
| `text-lg` / `text-xl` | `text-subheading` |
| `text-2xl` | `text-heading-sm` |
| `text-3xl` | `text-heading` |
| `text-4xl` / `text-5xl` | `text-heading-lg` |
| `text-6xl` | `text-display` |
| `font-bold` / `font-semibold` | `font-medium` |
| `font-normal` | `font-regular` |

## Forbidden Patterns

`scripts/lint-typography.sh` (`bun run lint:typography`) checks each pattern in
`apps/home/src`, `apps/cv/src`, `apps/invoice/src`, `apps/portfolio/src` and `packages/ui/src`
and fails CI on a match. Inline font properties are checked as TypeScript/JSX
syntax by `scripts/check-inline-typography.ts`, including quoted keys and
render-prop objects.

| Pattern | Why |
| ------- | --- |
| `text-[…]` (e.g. `text-[11px]`) | Bypasses the size scale. Use a named token. |
| `leading-[…]` | Line-height is baked into the size token. |
| `font-[…]` | Bypasses the font-family token (`font-sans` / `font-mono`). |
| `tracking-[…]` | Tracking is baked into the size token; there are no `tracking-*` utilities. |
| Inline `style={{ fontSize / fontFamily / fontWeight }}` | Bypasses the system; can't be themed; defeats lint. |
| `font-bold`, `font-semibold` | Warp is 400/500 only. Use `font-medium`. |
| `text-sm` … `text-6xl` | Generic utilities bypass the named scale. Migrate per the table. |
| `font-normal` | Use the `font-regular` token. |

## Exceptions

New exceptions require a PR that updates this section, citing the component, the
reason no token works, and the alternative considered.

| Component | Pattern | Reason | Alternative considered |
| --------- | ------- | ------ | ---------------------- |
| `@react-pdf` renderers (`apps/cv/src/components/templates/*-pdf.tsx`, `apps/invoice/src/components/invoice-pdf.tsx`, `apps/portfolio/src/components/portfolio-pdf.tsx`) | `StyleSheet` `fontSize` / `fontFamily` / `fontWeight` | react-pdf has no `className` or Tailwind; StyleSheet props are the only way to set type in the exported PDF. `check-inline-typography.ts` skips `*-pdf.tsx` files that import `@react-pdf/renderer` | None — the PDF renderer cannot read CSS tokens |
| On-screen print documents (`apps/cv/src/components/templates/*-preview.tsx`, `templates/preview-entries.tsx`, `apps/invoice/src/components/invoice-preview.tsx`) | Generic sizes, `font-semibold` / `font-bold`, `text-[…rem]` | Ink-on-paper "light islands" that mirror their PDF twin (Helvetica, print sizes, bold labels) so preview and download match. `lint-typography.sh` skips exactly these files via `PRINT_GLOBS` | Warp tokens — rejected: the printed CV/invoice would stop matching the preview |
| Print / PDF colours (`*-pdf.tsx`, `.cv-page`, `.invoice-page`, `.pf-*`) | `#ffffff` background, ink colours | Print artifact — ink on white paper | None — print must be print-faithful |
| Flag SVGs, social-platform logos | brand / `#fff` colours | Third-party brand marks, not app chrome | None — brand recognition requires accurate colour |

The portfolio preview (`portfolio-preview.tsx`) styles its deck through the
scoped `.pf-*` CSS in `apps/portfolio/src/styles.css`, so it needs no lint
exemption; its empty state is chrome and uses Warp tokens.

## Per-Component Usage Guide (Warp)

- **Buttons / tabs / nav / inputs (chrome):** `text-xs font-medium`; 4px radius
  (`rounded-md`), never pill. Inline icons `size-3.5`, outlined.
- **Eyebrow / section label:** `text-caption-tracked uppercase font-medium`.
- **Page / section heading:** `text-heading font-medium` (or `text-heading-lg` /
  `text-display` for hero openers).
- **Card / panel heading:** `text-subheading font-medium`.
- **Dialog / popover / card title (`@rulisme/ui`):** `text-body-sm font-medium`;
  description `text-xs text-muted-foreground`.
- **Body paragraphs:** `text-body font-regular` (long-form) / `text-body-sm` (compact).
- **Labels / helper / metadata:** `text-xs text-muted-foreground` or
  `text-caption-tracked` for tracked eyebrows.
- **Code / terminal:** `font-mono`; gold (`--color-gold-leaf`) / cobalt
  (`--color-muted-cobalt`) syntax accents appear **only** here (and in section
  headings), never on buttons, badges, or body.

## tailwind-merge Configuration (critical)

`cn()` in `packages/ui/src/lib/utils.ts` (imported by every app as
`@rulisme/ui/lib/utils`) runs classes through `tailwind-merge`, which doesn't
know our custom `text-*` utilities live in the `font-size` group — without
registration it reads `text-body-sm` as a colour and silently strips it when it
meets `text-muted-foreground`. `cn()` registers the **9 Warp font-size tokens**
(`display`, `heading-lg`, `heading`, `heading-sm`, `subheading`, `body`,
`body-sm`, `caption-tracked`, `micro`) in `extendTailwindMerge({ extend: {
classGroups: { "font-size": [{ text: [...] }] } } })`. The scale bakes
letter-spacing, so there is **no `tracking` group** to register.

`bun run parity:twmerge` asserts the registration matches every app's
`@theme inline`. An app that adds its own `src/lib/utils.ts` is checked against
that file instead.

## Verification Commands

```sh
# Forbidden-pattern lint (home + cv + invoice + portfolio + packages/ui)
bun run lint:typography

# Parity — typography tokens byte-identical across cv / invoice / portfolio / home
bun run parity:typography

# tailwind-merge config parity (cn() registers the 9 font-size tokens)
bun run parity:twmerge

# Full chain
bun run check
```

## When in Doubt

1. Look at a canonical reference for the same context (`button-variants.ts` in
   `packages/ui` for chrome).
2. Pick the closest Warp token from the scale above.
3. If nothing fits, propose a new token in a PR that adds it to **every** app's
   `@theme inline` block (parity), updates the `cn()` twMerge config in
   `packages/ui`, and updates this document + the Exceptions list. Never use
   arbitrary values.
