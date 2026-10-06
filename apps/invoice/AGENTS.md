# Agent notes — apps/invoice

Read the root `AGENTS.md` and `CLAUDE.md` first, then this app's `CLAUDE.md`.
Proposals for this app go in the root `openspec/changes/` with an `invoice-` prefix.

## Design system — Warp ("moonlit terminal")

`apps/cv`, `apps/invoice` and `apps/portfolio` share one dark, warm-neutral design system (root `DESIGN.md`, rules in `TYPOGRAPHY.md`). Rules an agent must follow:

- **Tokens are the single source of truth.** They live in `src/styles.css` `@theme inline`; the typography block is byte-identical across the three apps (`bun run parity:typography`). Never hardcode hex or `text-[Npx]` in chrome — add or extend a token in every app.
- **Themes.** Light and dark via next-themes; dark is canonical. Canvas `#121212`, text warm off-white `#faf9f6` (never `#fff`). Surfaces: canvas `#121212` → card `#2f2f2f` → control `#383838` → floating `#40403f` (`--popover`).
- **Type scale.** Named tokens `text-display` … `text-caption-tracked` … `text-micro` bake size, leading and tracking; `text-xs` is the chrome default. Weights **400/500 only**; `font-bold`/`font-semibold` are forbidden in chrome.
- **Radius / spacing.** buttons/nav `4px`, cards/icons/panels `8px`, images `20px`; buttons are never pill-shaped (`rounded-full` = true circles only). Spacing uses Tailwind's native 4-pt scale.
- **Accent discipline.** `--color-gold-leaf` / `--color-muted-cobalt` only in code/syntax and section headings — never on buttons, tags or badges. No shadows.
- **Document accent colour.** The per-invoice `accentColor` (default `#f48120`) and its swatch presets are document content, not chrome — leave them as raw hex.
- **Re-skin shared primitives once** in `packages/ui` (then rebuild) — never fork per app.
- **Print-template exception:** `src/components/{invoice-preview,invoice-pdf}.tsx` and `.invoice-page` stay light and print-faithful. Do NOT apply the dark palette to the rendered invoice.

## Backend

Cloud save and loading go to `apps/api` through `MCP_API` (`http://localhost:8788` in dev, `https://api.pilihpendidikan.com` in prod). Never point the app back at the bahrul services; OG images are the one exception (`og.bahrul.me`, public).
