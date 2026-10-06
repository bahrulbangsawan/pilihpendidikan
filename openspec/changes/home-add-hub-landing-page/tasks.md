## 1. Scaffold apps/home

- [x] 1.1 `package.json` (dev port 4002, scripts like `apps/portfolio`), `tsconfig.json`, `vite.config.ts`, `components.json`, `.gitignore`, `wrangler.jsonc` (`home-pilihpendidikan`, custom domains apex + www, `main: src/server.ts`)
- [x] 1.2 `src/styles.css` with the Warp `@theme inline` block byte-identical to `apps/cv` for typography
- [x] 1.3 Root route (`<html class="dark">`), router, not-found, favicons, i18n module + `en.json` / `id.json`
- [x] 1.4 Root `package.json` `dev:home`; `bun install`

## 2. Page and config

- [x] 2.1 `src/config/services.ts` (typed `SERVICES`)
- [x] 2.2 Hub page components: header with language link, intro, service cards, MCP item, footer
- [x] 2.3 Routes `/` and `/id` with `headForLocale` (title, description, canonical, hreflang, OG, Twitter) and JSON-LD from `SERVICES`

## 3. Worker behaviour and discovery files

- [x] 3.1 `src/server.ts`: www → apex 301, security headers, HTML cache policy
- [x] 3.2 `public/_headers`, `public/robots.txt`, `public/sitemap.xml`
- [x] 3.3 `/llms.txt` server route generated from `SERVICES`

## 4. Tests

- [x] 4.1 Link guard: every service × status × locale (soon → no link, live → one link to its URL), plus the shipped config
- [x] 4.2 MCP gate, no forms, placeholder inventory
- [x] 4.3 `llms.txt` lists live services only; www redirect; security headers

## 5. Tooling coverage

- [x] 5.1 Add `apps/home/src` to `lint-typography.sh` and `check-inline-typography.ts`
- [x] 5.2 Add `apps/home` to `check-typography-parity.ts` and `check-twmerge-typography-config.ts`

## 6. Docs

- [x] 6.1 README, CLAUDE.md, AGENTS.md, TYPOGRAPHY.md, `openspec/project.md`
- [x] 6.2 DEPLOY.md: hub deploy step and the **Going live** checklist

## 7. Verification

- [x] 7.1 `bun x ultracite fix && bun run check && bun run build`
- [x] 7.2 `bunx wrangler deploy --dry-run` in `apps/home`
- [x] 7.3 agent-browser screenshots at 1440px and 390px (all `soon`, then one `live`), horizontal-scroll check, saved in `apps/home/verification/`
- [x] 7.4 Revert the temporary `live` flip; confirm `SERVICES` ships all `soon`

## 8. Deploy (owner-approved, 2026-10-06)

- [x] 8.1 `wrangler deploy` of `home-pilihpendidikan` to bisa.digital (version `9a35adaf`): custom domains `pilihpendidikan.com` + `www.pilihpendidikan.com`
- [x] 8.2 Production smoke checks and screenshots (`apps/home/verification/production-*.png`)
- [x] 8.3 Zone setting Always Use HTTPS turned on (plain-HTTP apex served 200 before)
