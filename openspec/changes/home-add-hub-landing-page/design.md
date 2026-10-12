## Context

> **Superseded design wording.** This change built the hub on the Warp design system. `update-zedative-design-system` has since replaced Warp with Zedative across the workspace, the hub included; the Warp references below are historical.

The apex `pilihpendidikan.com` has to resolve before any of the builders are
deployed, and has to stay correct while they go live one at a time. The apps
are TanStack Start SSR Workers with en/id i18n, Warp tokens and `@rulisme/ui`.
Their typography is enforced by scripts that list each app explicitly.

## Goals / Non-Goals

- Goals: a fast, honest single page that can never link to an undeployed
  subdomain; going live is one config line plus a redeploy; the page passes the
  same lint, typography and parity gates as the other apps.
- Non-Goals: forms, newsletter or waitlist capture, analytics, a theme toggle,
  backporting security headers to the other three apps (a separate change),
  automatic health-checking of subdomains.

## Decisions

### D1. TanStack Start SSR, not a static-assets Worker

- **Decision:** `apps/home` is a TanStack Start app with the same toolchain as
  `apps/cv` (Vite 8, `@cloudflare/vite-plugin`, Tailwind 4, `@rulisme/ui`).
- **Why:**
  - It renders `@rulisme/ui` React components (`buttonVariants`,
    `badgeVariants`, `Card`) and reuses the apps' `headForLocale` / i18n
    pattern unchanged.
  - The existing `build`, `typecheck`, `test`, `deploy` and typography scripts
    apply as-is, and the deploy path is already proven by the other apps'
    `wrangler deploy --dry-run`.
  - SSR sends complete HTML, so the page paints and its links work before
    any JS runs.
  - The server entry gives one place for the www redirect and the security
    headers, and a server route can generate `llms.txt` from the config.
- **Alternative considered: static-assets Worker.** It ships no hydration
  JS, but the page would be either hand-written HTML that can't use
  `@rulisme/ui` components and needs its own typography lint path, or a custom
  React-to-HTML prerender pipeline that only this app has. It also still needs
  a Worker script for the host redirect. More bespoke tooling for a page that
  is meant to be temporary.
- **Cost:** the client bundle (React + router) still hydrates: about 122 KB
  gzip of JS, measured on the production build, plus a 30 KB gzip stylesheet.
  I left out next-themes, sonner, tooltip, devtools and agentation. If the size matters later,
  TanStack Start's static prerender can be switched on without changing the
  page code.

### D2. One typed service config drives every status-dependent output

```ts
// apps/home/src/config/services.ts
export type ServiceStatus = "soon" | "live";
export type ServiceId = "cv" | "invoice" | "portfolio" | "api";
export interface Service { status: ServiceStatus; url: string }
export const SERVICES = {
  cv:        { status: "soon", url: "https://cv.pilihpendidikan.com" },
  invoice:   { status: "soon", url: "https://invoice.pilihpendidikan.com" },
  portfolio: { status: "soon", url: "https://portfolio.pilihpendidikan.com" },
  api:       { status: "soon", url: "https://api.pilihpendidikan.com" },
} as const satisfies Record<ServiceId, Service>;
```

The page, the JSON-LD and `llms.txt` all read `SERVICES`. Components take the
services as a prop (the page passes `SERVICES`), so tests can render every
status combination. The MCP item is the `api` entry. When it is live, it shows
the endpoint `<api url>/mcp` and links to `<api url>/connect` to mint a token.
Copy (names, one-liners) lives in the locale JSON, not in the config. On the
Indonesian page a live builder links to its own `/id` page.

### D3. www → apex in the Worker, both hosts as custom domains

`wrangler.jsonc` routes: `pilihpendidikan.com` and `www.pilihpendidikan.com`,
both `custom_domain: true`. Wrangler creates both DNS records and certificates
on deploy, which needs the owner's approval. `src/server.ts` wraps the default
TanStack handler. A request whose host is `www.pilihpendidikan.com` gets
`301 Location: https://pilihpendidikan.com<path><query>`.

- **Alternative:** a proxied `www` DNS record plus a zone Redirect Rule. That
  is two dashboard resources outside version control.
- **Caveat:** Workers static assets are matched before the Worker runs, so a
  hashed asset path requested on `www` (e.g. `/assets/x.js`) is served rather
  than redirected. Nothing links there. Every page, `llms.txt` and 404 goes
  through the Worker and redirects. `robots.txt` and `sitemap.xml` are static
  and name only apex URLs.

### D4. Security headers

The cv/invoice/portfolio Workers set no security headers (checked: no
`X-Frame-Options` / CSP / HSTS anywhere under `apps/{cv,invoice,portfolio}`).
The only set in the repo is `apps/api/src/html.ts`. The hub adapts it for a
public, indexable page:

| Header | Value | vs api `html.ts` |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | same |
| `X-Frame-Options` | `DENY` | same |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | api uses `same-origin` for its CSRF check; the hub has no forms, and outbound clicks to the subdomains keep the origin |
| `Content-Security-Policy` | `frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'` | api also locks `script-src` with a nonce; TanStack Start emits inline hydration scripts, so `script-src` is left out rather than weakened with `'unsafe-inline'` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | new |
| `Strict-Transport-Security` | `max-age=31536000` | new; no `includeSubDomains` / `preload` (both hard to undo) |

The api's `Cache-Control: no-store` and `X-Robots-Tag: noindex` are left out
because the hub must be indexable. HTML gets `Cache-Control: public,
max-age=300`, so a redeploy shows up within five minutes. The SSR response
sets these headers in `src/server.ts`; `public/_headers` applies them to
static assets.

### D5. Bilingual, dark only

The apps ship English at `/` and Indonesian at `/id`, so the hub does the
same, with hreflang alternates and `x-default` → `/`. Warp is dark-canonical,
so `<html class="dark">` is set on the server and there is no theme toggle and
no next-themes. The language switch is a plain link.

### D6. Copy honesty

The description and one-liners only state what the repo shows: browser-based
builders, live preview, PDF export, English/Indonesian, local drafts, MCP
editing. No user counts, "free forever", ratings or testimonials. Anything
only the owner can supply is written as `[PLACEHOLDER: …]` in the locale JSON
and must be filled before shipping: a test fails while any placeholder is
left. With the footer credit settled (below), the shipped copy has none.

## Risks / Trade-offs

- Status drift: the config says `live` but the subdomain is down. → The Going
  live checklist puts the smoke test before the flip; the hub only ever links
  to a URL that someone has opened and checked.
- HSTS on the apex is sticky for a year. → No `includeSubDomains` / `preload`;
  the zone is HTTPS-only through Workers custom domains anyway.
- OG images depend on `og.bahrul.me`, as the other apps do. An outage only
  affects social previews.

## Migration Plan

1. Owner approves → `cd apps/home && bun run deploy`. This creates the Worker
   `home-pilihpendidikan` and custom domains `pilihpendidikan.com` +
   `www.pilihpendidikan.com` (DNS records and certificates).
2. Smoke-test: `curl -sI https://pilihpendidikan.com` (200 + headers),
   `curl -sI https://www.pilihpendidikan.com/id` (301 → apex `/id`), and
   check `/robots.txt`, `/sitemap.xml` and `/llms.txt`.
3. Rollback: `bunx wrangler rollback` in `apps/home`, or remove the custom
   domains (the apex then stops resolving again, which is today's state).

## Open Questions

- Footer attribution: resolved by the owner (2026-10-06): "Built by Bahrul
  Bangsawan", linking to bahrul.me, matching the other apps' JSON-LD.
