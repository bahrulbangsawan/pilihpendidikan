# Change: Add the pilihpendidikan.com hub landing page (apps/home)

## Why

`https://pilihpendidikan.com` resolves to nothing: the zone has no DNS records
and no Worker custom domains, yet the bahrul.me admin already links to it. The
three builders (`cv.`, `invoice.`, `portfolio.pilihpendidikan.com`) and the
api are not deployed yet. They will go live one at a time, and the apex needs
an honest page in the meantime that never links to a subdomain that isn't
serving.

## What Changes

- New app `apps/home` (Worker `home-pilihpendidikan`, dev port `4002`): a
  TanStack Start SSR app like the other three, on Warp + `@rulisme/ui`.
- One page, bilingual like the other apps: English at `/`, Indonesian at
  `/id`. It has:
  - a 1–2 sentence plain description of Pilih Pendidikan, written only from
    facts in this repo;
  - the CV, Invoice and Portfolio builders with one-line descriptions, each
    shown as **Coming soon** (no link) or **Open** (a link to its subdomain);
  - an "Use it from an AI assistant (MCP)" item, gated on the `api` status.
    While the api is `soon` it shows no endpoint and no link.
  - no forms, no email capture, no analytics.
- One typed config, `apps/home/src/config/services.ts`, keyed by
  `cv | invoice | portfolio | api`, each `{ status: "soon" | "live", url }`.
  Going live is a one-line status change plus a redeploy.
- Custom domains `pilihpendidikan.com` and `www.pilihpendidikan.com` on the
  same Worker; a custom server entry answers every `www.` request with a 301
  to the apex (same path and query).
- SEO: per-locale title, description, canonical, hreflang, Open Graph and
  Twitter tags (OG image from `og.bahrul.me`, like the other apps), static
  `robots.txt` and `sitemap.xml` (hub URLs only), and `llms.txt` generated
  from the config at request time so it lists live services only.
- Security headers on every response (SSR HTML through the server entry,
  static assets through `public/_headers`). The other three apps send none
  today (only `apps/api/src/html.ts` does), so this follows the api's set,
  adapted for a public, indexable page (see design D4).
- Tests (Vitest): a "soon" service renders no link and a "live" one renders
  exactly one link to its URL, for every service and both locales; `llms.txt`
  lists live services only; www redirect and security headers.
- Typography tooling covers the new app: `lint-typography.sh`,
  `check-inline-typography.ts`, `parity:typography` (byte-identical Warp tokens
  with `apps/cv`) and `parity:twmerge`.
- Docs: README, CLAUDE.md, AGENTS.md, `openspec/project.md`, TYPOGRAPHY.md and
  DEPLOY.md (a hub deploy step that does not depend on the api, plus a
  **Going live** checklist: deploy the subdomain → smoke-test → flip its hub
  status → redeploy the hub).
- Verification screenshots in `apps/home/verification/` at 1440px and 390px,
  all services `soon` and then one `live`, with a horizontal-scroll check.

Nothing is deployed, and no DNS record or Cloudflare resource is created, by
this change. The first `wrangler deploy` of `apps/home` creates the two custom
domains, along with their DNS records and certificates. It runs only after
the owner approves.

## Impact

- Affected specs: new capability `home-hub`
- Affected code: new `apps/home/**`; `scripts/lint-typography.sh`,
  `scripts/check-inline-typography.ts`, `scripts/check-typography-parity.ts`,
  `scripts/check-twmerge-typography-config.ts`; root `package.json`
  (`dev:home`); `bun.lock`; README.md, CLAUDE.md, AGENTS.md, DEPLOY.md,
  TYPOGRAPHY.md, `openspec/project.md`
- No change to `apps/cv`, `apps/invoice`, `apps/portfolio`, `apps/api` or
  `packages/ui`
