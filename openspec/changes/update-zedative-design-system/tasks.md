## 1. Foundations

- [x] 1.1 Scaffold a lyra / radix / lucide reference with the shadcn CLI (`init`, `add --all`: 61 components)
- [x] 1.2 `packages/ui/src/styles/theme.css`: tokens, Night Desk, type roles, weights, radius, elevation, rails, paper, grain, base layer
- [x] 1.3 `packages/config/motion.css`: Zedative curve and duration, `press`, `pulse-dot`, spinner; remove entrances, hover lift, route transitions, image fade
- [x] 1.4 `cn()` registers `type-*` / `weight-*`; `typeClass()` in `lib/type-scale.ts`
- [x] 1.5 Root `DESIGN.md` (Zedative + Implementation) and `TYPOGRAPHY.md`
- [x] 1.6 Rewrite `lint-typography.sh`, `check-typography-parity.ts`, `check-twmerge-typography-config.ts`
- [x] 1.7 Reference components: `Button`, `Kbd`, `Input`, `Card`, `Badge`, `Band` / `Rail` / `Diamond`

## 2. Components (`packages/ui`)

- [x] 2.1 Restyle the existing primitives in place, keeping their APIs
- [x] 2.2 Port the remaining CLI components with relative imports and lucide icons, then restyle
- [x] 2.3 Remove enter/exit animations; motion helpers `image-fade` and `use-first-paint-entrance` retired
- [x] 2.4 `biome check`, `tsc`, `lint:typography` and `bun run build` pass for `packages/ui`

## 3. Apps

- [x] 3.1 `apps/home`: shared theme, Zedative hub (bands, rails, italic cobalt hero, cobalt footer), light only
- [x] 3.2 `apps/cv`: shared theme, Zedative editor chrome, light default with Night Desk toggle
- [x] 3.3 `apps/invoice`: same
- [x] 3.4 `apps/portfolio`: same, plus Zedative colours in the deck preview and PDF
- [x] 3.5 Remove the Warp `DESIGN.md` copies and update every `CLAUDE.md` / `AGENTS.md` / README / `openspec/project.md`
- [x] 3.6 `apps/api` server-rendered pages (`/connect`, sign-in confirm, OAuth consent): the shared `PAGE_STYLES` shell moved from Warp to Zedative (paper, graph paper, band header with the diamond wordmark, ruled column with nodes, italic cobalt display headline, square cards, lipped buttons, one cobalt action per view); the sign-in email (`email.ts`) takes the same palette in email-safe inline styles
- [x] 3.7 Remaining Warp configuration: every `components.json` now `radix-lyra` / neutral / default menus, with the apps' `ui` and `utils` aliases on `@rulisme/ui` (plus `packages/ui/components.json`), so `shadcn add` lands in the shared library; web manifests' theme colour is paper `#f4f4f2`; the portfolio mock's build prompt is marked historical
- [x] 3.8 Print documents on Zedative: the four CV templates, the invoice and the portfolio deck in Inter with no uppercase or letter-spacing, Zedative ink colours on paper (re-scoped tokens in the previews, literals in the PDFs), 2px framed photos; print sizes, layouts and preview ↔ PDF parity kept. One shared print module, `packages/ui/src/print/`: merged Inter cuts per weight (latin + latin-ext + vietnamese, `scripts/build-print-fonts.sh`), a guarded repair of react-pdf's glyph cache (a letter built into a composite no longer vanishes from the next PDF of a session), the line-break policy (words whole; breaks after hyphens, dashes and slashes without an added hyphen; long URLs and emails at their separators; anywhere only as a last resort) and the text normaliser (NFC, separators, arrows, emoji, whitespace as the preview sets it); each builder registers it in `src/lib/pdf-fonts.ts`. The invoice writes the ordinary yen sign; browser print is always light and keeps the paper's colours
- [x] 3.9 Lint: rule 17 holds `*-pdf.tsx`, `*pdf*.ts`, `packages/ui/src/print` and every app's `src/styles.css` to Inter (no other family in a StyleSheet, a fallback list or `Font.register`, no built-in PDF font, no literal family in print CSS), rule 18 to no uppercase or letter-spacing; the on-screen print previews skip only the size, leading and weight checks

## 4. Design system page

- [x] 4.1 `apps/design` (Vite, port 4006) wired into the workspace, Turborepo and the lint roots
- [x] 4.2 Foundations, components with state matrices, do/don't, recipes, example screen
- [x] 4.3 Coverage script reports no unrendered component (`bun run parity:showcase`: 66/66)

## 5. Verification

- [x] 5.1 `bun run fix && bun run check` — exits 0 (Biome, lint, the 18-rule style lint, four parity checks with the design page at 66/66, 235 tests: api 83, home 34, ui 30, portfolio 64, cv 12, invoice 12; `bun audit`: no vulnerabilities). The audit had 3 high advisories that predate this change; they are fixed by root `overrides` (`@modelcontextprotocol/sdk` 1.32.1, `client` / `server` 2.3.1 — `agents` pins the vulnerable versions as exact peers — and `sharp` 0.35.5), verified by the api suite and a local MCP handshake (see `apps/api/CLAUDE.md`)
- [x] 5.2 `bun run check-types` and `bun run build` (7/7 tasks each)
- [x] 5.3 Browser review of every app and the design page at 375px and 1280px, light and Night Desk; no console errors
- [x] 5.4 Unit tests for the design system's logic in `packages/ui` (`cn()`, `typeClass()`, `useShortcut` guards, and the print module's line-break policy and text normaliser: 30 tests, run by `bun run test`)
- [x] 5.5 Remaining hard-coded English in the builders' chrome moved to i18n (invoice token dialog, status lines, toasts, item fallback; invoice and portfolio 404 pages; cloud-save errors in all three builders)
- [x] 5.6 Tests for every builder: translation-key tests in `apps/cv`, `apps/invoice`, `apps/portfolio` (English and Indonesian match; every static key the app uses exists in both) and a deck-palette test in `apps/portfolio` (both renderers carry the Zedative deck colours, none of Warp's)
- [x] 5.7 Print documents verified through each app's own Download PDF button and browser print: every PDF embeds only the merged Inter cuts (no Helvetica resource), page counts match the pre-conversion samples (CV 7/5/7/7, invoice 1, deck 4), a second PDF in one session keeps every letter, Latin Extended and Vietnamese names render, long emails and URLs break at their separators without a hyphen, long invoice labels and values wrap in their columns, and Night Desk prints white paper with the invoice's accent rule and the deck's cover
