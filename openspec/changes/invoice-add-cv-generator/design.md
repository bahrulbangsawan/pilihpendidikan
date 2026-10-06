## Context

Single-page CV generator with a form-preview split layout. The project uses TanStack Start + shadcn/ui (radix-mira style) + Tailwind CSS v4 with OKLCH tokens, Space Grotesk font, and `--radius: 0` (sharp corners).

## Goals / Non-Goals

- Goals: Realtime form-to-preview binding, ATS-friendly semantic HTML output, responsive layout, clean minimalist design
- Non-Goals: PDF export (future phase), multi-page CV support, backend persistence, dark mode toggle (inherits system preference)

## Decisions

- **State management**: React `useState` — no external state library needed for a single-page form. All state lives in `index.tsx` and flows down to form and preview components via props.
  - Alternatives considered: TanStack Form (overkill for realtime preview binding), Zustand (adds dependency for single-component state)

- **Component structure**: Three components — `CVForm` (form panel), `CVPreview` (preview panel), orchestrated from `index.tsx`
  - Why: Clean separation of concerns; form handles input, preview handles rendering, route component manages state and layout

- **CV preview HTML**: Semantic tags only (`<h1>`, `<h2>`, `<section>`, `<ul>`, `<li>`, `<p>`) — NO `<table>`, NO `<div>` where semantic tags belong. CSS Grid/Flexbox for layout within the preview.
  - Why: ATS (Applicant Tracking Systems) parse semantic HTML reliably. Tables and decorative divs confuse parsers.

- **Repeatable groups** (experience, education): Array state with add/remove operations. Each entry has a unique `id` field (crypto.randomUUID) for stable React keys.
  - Alternatives considered: Index-based keys (causes re-render issues on delete), nanoid (unnecessary dependency)

- **Skills input**: Tag-style — type a skill, press Enter to add. Click to remove. Stored as `string[]`.

- **shadcn/ui components needed**: Input, Textarea, Card, Separator, Badge, Label — all standard shadcn/ui registry components compatible with radix-mira style.

## Risks / Trade-offs

- Risk: Preview may not perfectly match printed output → Mitigation: Use A4-proportioned card with `aspect-[210/297]` or fixed width, white background, subtle shadow
- Risk: Long forms may push preview off-screen on mobile → Mitigation: Stacked layout on mobile with preview below form; consider sticky preview in future

## Open Questions

- None — scope is well-defined for phase 1
