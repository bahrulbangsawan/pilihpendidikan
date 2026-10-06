# apps/cv — CV Builder

TanStack Start (SSR) app that builds CVs and exports them as PDF or JSON.
Consumes the shared `@rulisme/ui` library. Deployed to Cloudflare Workers via
`@cloudflare/vite-plugin` as `cv-pilihpendidikan` on `cv.pilihpendidikan.com`.

Workspace-wide rules (commands, conventions, typography) live in the root
`CLAUDE.md`, `TYPOGRAPHY.md` and `DESIGN.md`; proposals go in the root
`openspec/` (prefix change ids with `cv-`).

## Commands

- `bun dev` — Vite dev server on port **4003**
- `bun run build` — `wrangler types` + `vite build`; `bun run preview`
- `bun run test` — Vitest
- `bun run lint` — Biome (`biome check .`); `bun run format` — Biome autofix
- `bun run typecheck` — `wrangler types` + `tsc --noEmit`
- `bun run deploy` — `wrangler deploy` (owner approval required)

The root `bun run check` runs Biome, the typography lint and the parity checks
over this app too.

## Structure

- `src/router.tsx` — router setup; routes in `src/routes/`: `__root.tsx` (head, hreflang, preconnect to the API), `-root-components.tsx` (document shell, ThemeProvider, i18n), `-root-helpers.ts` (JSON-LD), `index.tsx` (EN), `id.tsx` (ID), `$.tsx` (catch-all 404). `routeTree.gen.ts` is generated — never edit it by hand.
- `src/components/cv-generator.tsx` — the editor shell: toolbar, MCP dialog, import/export, local draft, cloud load/save, and the `?print=1` print view.
- `src/components/cv-form.tsx` / `cv-preview.tsx` / `cv-pdf.tsx` — the form, live preview and `@react-pdf/renderer` entry point.
- `src/components/templates/` — one `*-preview.tsx` + `*-pdf.tsx` pair per template (`basic`, `harvard`, `simple`, `standard`), plus `preview-entries.tsx` and `template-utils.ts`. Add a template by creating both halves and wiring them into the picker. Preview and PDF are separate renderers; keep them in sync by hand.
- `src/lib/use-cloud-save.ts` — owner-authenticated optimistic cloud save (`PUT /api/cv/:id`, Bearer token, rollback).
- `src/lib/og-url.ts` — OG image URLs on the public `og.bahrul.me` renderer.
- `src/lib/cv-markdown.ts`, `src/lib/preprocess-image.ts` — Markdown export and client-side image normalisation for the PDF.
- `src/i18n/` — EN/ID copy (`locales/{en,id}.json`) and the language switcher.
- `src/data/sample-cv.json` — sample document (prefill).
- `public/` — `robots.txt`, `sitemap.xml`, `llms.txt`, favicons.

## Backend

`MCP_API` in `cv-generator.tsx` is `http://localhost:8788` in dev (`apps/api`
under `wrangler dev`) and `https://api.pilihpendidikan.com` in prod. Users mint
a personal token at `https://api.pilihpendidikan.com/connect` (`MCP_URL`) and
paste it into the MCP dialog to enable cloud save. `?cv=<slug>` loads a saved
CV; `/cv/<slug>.pdf` on the API redirects to `?cv=<slug>&print=1`.

## Shared UI

- Imports primitives from `@rulisme/ui` (e.g. `@rulisme/ui/ui/button`, `@rulisme/ui/form/form-field`, `@rulisme/ui/lib/utils`).
- At runtime `@rulisme/ui` resolves to its built `dist/` — run `bun run build` in `packages/ui` (or the root `bun dev`) first. TypeScript maps it to `packages/ui/src` through `tsconfig.json` paths.
- shadcn config in `components.json`. Tailwind 4 scans `node_modules/@rulisme/ui/dist` via `@source` in `src/styles.css`.

## Design system — Warp ("moonlit terminal")

This app, `apps/invoice` and `apps/portfolio` share one dark, warm-neutral design system (`DESIGN.md`). The `@theme inline` typography tokens in `src/styles.css` are byte-identical across the three apps (`bun run parity:typography`, with this app as the reference). Never hardcode hex or `text-[Npx]` in chrome; use tokens.

- **Themes.** Light and dark via next-themes (`.dark` class, system theme by default, `theme-toggle.tsx`); dark is canonical. `theme-color` is `#121212`.
- **Surfaces.** canvas `#121212` (`--background`) · banded `#1e1e1d` · card `#2f2f2f` (`--card`) · control `#383838` (`--secondary`/`--accent`) · floating `#40403f` (`--popover`). Text is warm off-white `#faf9f6` (`--foreground`) — never `#fff`; muted text is pale-stone `#b4b4b2`.
- **Type.** Named tokens (`text-display` … `text-body-sm`, `text-caption-tracked`, `text-micro`) bake size, line-height and tracking; `text-xs` is the chrome default. Weights are 400/500 only.
- **Radius.** buttons/nav `4px`, cards/panels `8px`, images `20px`. Buttons are never pill-shaped.
- **Accent discipline.** `--color-gold-leaf` and `--color-muted-cobalt` only in code/syntax and section headings. No shadows; focus rings are neutral.
- **Print exception.** The rendered CV is a print artifact: `templates/*-{preview,pdf}.tsx` and `.cv-page` stay light and print-faithful (ink on white, Helvetica). `.cv-page` re-scopes `--foreground`/`--border`/`--background`/`--card` locally. The typography lint skips these files (`TYPOGRAPHY.md` § Exceptions).
- **Fonts and scrollbars.** Inter 400/500 and Geist Mono 400 are bundled via `@fontsource`; editor panels use the `scrollbar-hide` utility from `src/styles.css`.

## Browser testing

Use `agent-browser` (not chrome-devtools/claude-in-chrome MCP): `agent-browser open http://localhost:4003 && agent-browser screenshot cv.png`.
