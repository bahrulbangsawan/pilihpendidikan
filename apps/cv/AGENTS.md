<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Design system — Warp ("moonlit terminal")

cv-bahrul and invoice-bahrul share one dark, warm-neutral terminal design system (root `DESIGN.md`). Full reference: `CLAUDE.md` § Design system. Rules an agent must follow:

- **Tokens are the single source of truth.** They live in `src/styles.css` `@theme`; the block is **byte-identical** across both apps (parity-diffed). Never hardcode hex or `text-[Npx]` in components — add/extend a token.
- **Dark by default.** `<html class="dark">` (`src/routes/__root-components.tsx`), canvas `#121212`, text warm off-white `#faf9f6` (**never `#fff`**). Surfaces: canvas `#121212` → card `#2f2f2f` → control `#383838` → floating `#40403f` (dialogs/popovers/selects = `--popover`).
- **Type scale.** Matter stack (`--font-sans`); mono only for code chips. Named tokens `text-display … text-caption-tracked … text-micro` pair size+leading+tracking (negative tracking at display sizes; `text-caption-tracked uppercase` = the 11px `+2.2px` eyebrow). Weights **400/500 only**; `font-bold`/`font-semibold` are forbidden in chrome.
- **Radius / spacing.** buttons/nav `4px`, cards/icons/panels `8px`, images `20px`; buttons are **never pill-shaped** (`rounded-full` = true circles only). Spacing uses Tailwind's native 4-pt scale (DESIGN.md px values are NOT injected as `--spacing-N`).
- **Accent discipline.** `--color-gold-leaf` / `--color-muted-cobalt` only in code/syntax + section headings — never on buttons/tags/badges. **No shadows** (the system is flat).
- **Re-skin shared primitives once** in `packages/ui` (then rebuild) — never fork per app.
- **Print-template exception:** `src/components/templates/*-{preview,pdf}.tsx` and `.cv-page` stay **light/print-faithful**. `.cv-page` is a light island (local var re-scope + Helvetica) in `src/styles.css`. Do NOT apply the dark palette to the rendered CV.