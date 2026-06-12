# OG / HTML Metadata / JSON-LD Audit — Bahrul monorepo

**Date:** 2026-06-11
**Scope:** `apps/web`, `apps/mcp-ui`, `apps/cv-bahrul`, `apps/invoice-bahrul`, `apps/portfolio-bahrul`
**Goal:** every **public** page's `og:image` + `twitter:image` is served by the single **`apps/og`** Worker at `https://og.bahrul.me` — never a local static PNG, never a second hardcoded OG host.

---

## 1. Executive summary

| App | Host | Before | After | Status |
|---|---|---|---|---|
| `apps/web` | bahrul.me | `buildOgUrl()` → og.bahrul.me (+ CMS override) | unchanged (reference) | ✅ already correct |
| `apps/cv-bahrul` | cv.bahrul.me | `${baseUrl}/og-image.png` ❌ | `buildOgUrl()` → og.bahrul.me ✅ | **fixed** |
| `apps/invoice-bahrul` | invoice.bahrul.me | `${baseUrl}/og-image.png` ❌ | `buildOgUrl()` → og.bahrul.me ✅ | **fixed** |
| `apps/portfolio-bahrul` | portfolio.bahrul.me | `${baseUrl}/og-image.png` ❌ | `buildOgUrl()` → og.bahrul.me ✅ | **fixed** |
| `apps/mcp-ui` | mcp.bahrul.me (admin) | no `robots`, no public og:image | `noindex,nofollow` added; no public og:image | **fixed (noindex)** |

**The bug:** `apps/cv-bahrul`, `apps/invoice-bahrul`, and `apps/portfolio-bahrul` each set `og:image`/`twitter:image` to a **local static** `${baseUrl}/og-image.png` in `src/i18n/index.ts` (`headForLocale`). Social-share previews therefore bypassed the `apps/og` rendering service entirely. (Live `invoice.bahrul.me` was even worse — an old deploy still serves `/og-image.webp`.)

**The fix:** each of the three apps now builds `og:image` via a `buildOgUrl({ title, subtitle, theme:"dark" })` helper that resolves to `https://og.bahrul.me/?…`. `twitter:image` reads the same value. The dead `public/og-image.png` files were deleted.

**Single-OG-origin invariant (verified):** every public `og:image`/`twitter:image` across all 5 apps now resolves to `https://og.bahrul.me`, env-overridable **only** via `VITE_OG_ORIGIN`. The literal `"https://og.bahrul.me"` exists **only** inside the `buildOgUrl` helper files (one per app) + the `apps/mcp-ui` playground helper `og-render-client.ts` + one CSP `img-src` allowlist entry in `apps/web` (a security policy, not an image source). No second OG host is hardcoded anywhere.

---

## 2. Decisions & rationale (stated inline, as required)

### 2.1 Shared `packages/ui` helper vs per-app copy → **per-app copy**
The goal preferred a single shared `@rulisme/ui` helper. I chose a **per-app copy** of `src/lib/og-url.ts` (byte-identical to `apps/web/src/lib/og-url.ts`, reformatted to each app's Prettier no-semicolon style). Rationale:

- **`import.meta.env` resolution correctness.** `OG_ORIGIN` reads `import.meta.env.VITE_OG_ORIGIN`. `@rulisme/ui` is pre-built with **tsup (esbuild)**, which does **not** run Vite's `import.meta.env.VITE_*` define-replacement. Routing the helper through `packages/ui/dist` risks shipping an **unresolved** `import.meta.env` reference into the consumer bundle. A per-app copy lives in each app's own `src/`, so each app's **Vite** build performs the replacement — exactly as `apps/web` and `apps/mcp-ui` already do.
- **No stale-dist coupling.** `@rulisme/ui` resolves to its built `dist/`; a shared helper would force a `packages/ui` rebuild before any app picked up a change (the documented stale-dist footgun).
- **Consistency with the established convention.** The three apps already carry **byte-identical** `i18n/index.ts` by design (parity-by-diff). `apps/web` + `apps/mcp-ui` each already own a copy of `og-url.ts`. So the repo pattern is **5 apps, 5 copies** of the same helper — the per-app copy fits it exactly.

**Verified:** each production build bakes `https://og.bahrul.me` into both server and client bundles with **zero** `localhost:8788` leakage.

### 2.2 `apps/og` template `id` → **worker default renderer (no `id`)**
`buildOgUrl({title, subtitle, theme})` is called **without** a `template` id, so the worker uses its default `renderOg` path (`apps/og/src/index.ts` — confirmed it accepts `title` / `subtitle` / `theme`(alias of `mode`) / `id`). Rationale:

- Passing a builtin `id` (e.g. `welcome`/`talk`/`case-study`) requires that row to exist in the OG Worker's **D1 `og_templates`** table; a missing row returns **404 "Template not found"** → a broken OG image. The default renderer has **zero D1 dependency** and always renders.
- It matches `apps/web`'s primary share cards (`config/header.ts` calls `buildOgUrl({title, subtitle})` with no template).
- **Verified live:** `HEAD https://og.bahrul.me/?title=…&subtitle=…&theme=dark` → `HTTP/2 200`, `content-type: image/png` for all three apps' exact URLs.

### 2.3 `apps/mcp-ui` noindex → **`<meta name="robots" content="noindex, nofollow">` in `index.html`**
The audit found mcp-ui shipped **no** robots directive: it is a Vite SPA with a single `index.html` and no per-route head machinery, and the Worker's `X-Robots-Tag: noindex` header applies **only** to `/auth/verify` HTML (`apps/mcp/src/middleware/security-headers.ts`), not the SPA served via `ASSETS`. mcp.bahrul.me has no `robots.txt`/`sitemap.xml` — it is an internal console, not an SEO surface — so de-indexing the whole subdomain (which covers the `_admin/*` routes) is correct. One `<meta>` line in the SPA shell is the minimal fix; the playground helper `src/lib/og-url.ts` was **left intact**.

---

## 3. Changes applied

```
?? apps/cv-bahrul/src/lib/og-url.ts          (new — per-app buildOgUrl helper)
?? apps/invoice-bahrul/src/lib/og-url.ts     (new — byte-identical)
?? apps/portfolio-bahrul/src/lib/og-url.ts   (new — byte-identical)
 M apps/cv-bahrul/src/i18n/index.ts          (import buildOgUrl; ogImage = buildOgUrl(...))
 M apps/invoice-bahrul/src/i18n/index.ts     (same edit, byte-identical)
 M apps/portfolio-bahrul/src/i18n/index.ts   (same edit, byte-identical)
 D apps/cv-bahrul/public/og-image.png        (dead — no longer referenced)
 D apps/invoice-bahrul/public/og-image.png   (dead)
 D apps/portfolio-bahrul/public/og-image.png (dead)
 M apps/mcp-ui/index.html                    (+ <meta name="robots" content="noindex, nofollow">)
```

The new `ogImage` in each `headForLocale`:
```ts
const ogImage = buildOgUrl({
  title: t("meta.title"),       // per-app real title (en/id locale JSON)
  subtitle: t("meta.siteName"), // "CV Builder" / "Invoice Generator" / "Portfolio Builder" (localized)
  theme: "dark",
})
```
`og:image`, `og:image:width=1200`, `og:image:height=630`, `og:image:type=image/png`, `og:image:alt` (`meta.ogImageAlt`), `twitter:card=summary_large_image`, and `twitter:image` (= `ogImage`) were already present and are preserved.

---

## 4. Per-route audit

### 4.1 apps/cv-bahrul · apps/invoice-bahrul · apps/portfolio-bahrul (identical structure)
`headForLocale(locale, baseUrl)` in `src/i18n/index.ts` is **byte-identical across all three** (verified by `diff`). `baseUrl` = `https://cv.bahrul.me` / `https://invoice.bahrul.me` / `https://portfolio.bahrul.me`.

| Route | Owner | title | description | canonical | og:url | og:image / twitter:image | twitter:card | og:image:alt | JSON-LD |
|---|---|---|---|---|---|---|---|---|---|
| `/` (en) | `index.tsx` → `headForLocale("en", BASE)` | `meta.title` | `meta.description` | `BASE` ✅ abs | `BASE` ✅ abs | `buildOgUrl()` → **og.bahrul.me** ✅ (identical) | `summary_large_image` | `meta.ogImageAlt` ✅ | `SoftwareApplication` (root) |
| `/id` (id) | `id.tsx` → `headForLocale("id", BASE)` | `meta.title` (id) | `meta.description` (id) | `BASE/id` ✅ abs | `BASE/id` ✅ abs | `buildOgUrl()` → **og.bahrul.me** ✅ (id copy) | `summary_large_image` | `meta.ogImageAlt` (id) ✅ | `SoftwareApplication` (root) |
| `$` (404) | `$.tsx` (no `head()`) | inherits root | — | — (none; correct for 404) | — | **none** (correct — 404 is not shareable) | — | — | root `SoftwareApplication` only |
| root layer | `__root.tsx` + `__root-components.tsx` (invoice: `__root-shell.tsx`) | — | — | — (canonical is leaf-owned) | — | none at root | — | — | `SoftwareApplication` via `JSON.stringify(jsonLd)` |

- **Root head** (`__root.tsx`): charset, viewport, `theme-color`, **hreflang** `en=BASE` / `id=BASE/id` / `x-default=BASE` (all absolute ✅), favicons, manifest. No og:image at root (leaf-owned).
- **JSON-LD** (`__root-helpers.ts` → injected by `__root-components.tsx` / invoice `__root-shell.tsx`): `@type: SoftwareApplication`, injected as `JSON.stringify(jsonLd)` inside `<script type="application/ld+json">` → **parse-safe by construction**. All URLs absolute (`url: https://{app}.bahrul.me`, `author.url: https://bahrul.me`, `sameAs: [linkedin, github]`). Uses `url` (not `@id`) — valid for a single top-level node. Diff of the three `jsonLd` reduces to only `name`/`description`/`url`.
- **Live (agent-browser, EN + ID):**
  - cv `/`: `og:image == twitter:image == https://og.bahrul.me/?title=Bahrul+Bangsawan+%E2%80%94+CV+Builder+%26+Resume+Generator&subtitle=CV+Builder&theme=dark`
  - invoice `/`: `…title=Invoice+Generator+%E2%80%94+Bahrul+Bangsawan&subtitle=Invoice+Generator&theme=dark`; `/id`: `…title=Generator+Faktur…&subtitle=Generator+Faktur…`
  - portfolio `/`: `…title=Bahrul+Bangsawan+%E2%80%94+Portfolio+Builder&subtitle=Portfolio+Builder&theme=dark`; `/id`: `…title=…Pembuat+Portofolio&subtitle=Pembuat+Portofolio…`

### 4.2 apps/web (host: bahrul.me) — reference, unchanged
SEO ownership: `__root.tsx` emits site-wide meta + `WebSite`+`Person` `@graph` and **omits canonical** (each leaf owns its own absolute canonical + route-specific `og:image`/JSON-LD). `OG_ORIGIN` defaults to `https://og.bahrul.me` (`src/lib/og-url.ts`), overridable only by `VITE_OG_ORIGIN`.

| Route | og:image (via `buildOgUrl` template) | canonical/og:url abs | twitter:image == og | JSON-LD |
|---|---|---|---|---|
| `/` | `home-default` | ✅ | ✅ | `ProfilePage` (+ root `WebSite`/`Person`) |
| `/tools` | `project-list` | ✅ | ✅ | `CollectionPage`+`ItemList`+`BreadcrumbList` |
| `/projects` | `project-list` | ✅ | ✅ | `CollectionPage`+`ItemList`+`BreadcrumbList` |
| `/projects/$slug` | `project.ogImage ?? buildOgUrl(project-detail)` | ✅ | ✅ | dynamic `SoftwareApplication`/`Article`/`CreativeWork`/… + `BreadcrumbList` |
| `/cases` | `case-list` | ✅ | ✅ | `CollectionPage`+`ItemList`+`BreadcrumbList` |
| `/cases/$slug` | `caseStudy.ogImage ?? buildOgUrl(case-detail)` | ✅ | ✅ | `Article`+`BreadcrumbList` |
| `/blog` | `blog-list` | ✅ | ✅ | `Blog`+`CollectionPage`+`ItemList`+`BreadcrumbList` |
| `/blog/$slug` | `article.ogImage ?? buildOgUrl(blog-detail)` | ✅ | ✅ | `BlogPosting`+`BreadcrumbList` |
| `/book` | `book-default` | ✅ | ✅ | `ContactPage`+`Service`+`BreadcrumbList` |
| `/admin/see` | — | `robots: noindex,nofollow` | — | none (gated) |

- **CMS override precedence (preserved):** `SeoFieldsSchema.ogImage` is `z.url()` (forces absolute). Each detail route resolves `const ogImage = X.ogImage ?? buildOgUrl({…, template})` — the **CMS value wins** when present, `buildOgUrl` is the fallback. `og:image`, `twitter:image`, and JSON-LD `image` all read that one resolved const, so an override propagates in lockstep and `twitter:image == og:image` stays true.
- **Live verification:** `bahrul.me/` → `og:image == twitter:image == https://og.bahrul.me/?title=Bahrul+Bangsawan&subtitle=Growth+Hacker&theme=dark&id=home-default`; JSON-LD `WebSite`+`Person` and `ProfilePage` both `JSON.parse` OK, all URLs absolute. `bahrul.me/blog/seo-vs-geo-…` → `og:image` resolved via the `?? buildOgUrl(…id=blog-detail)` fallback to og.bahrul.me; `BlogPosting`+`BreadcrumbList` parse OK, absolute. **No issues / no regressions.**

### 4.3 apps/mcp-ui (host: mcp.bahrul.me — admin SPA)
- **noindex:** `index.html` now ships `<meta name="robots" content="noindex, nofollow">` (verified in raw HTML and live DOM). Covers all SPA routes incl. `_admin/*`.
- **No public og:image:** zero `og:*`/`twitter:*` `<meta>` tags in `index.html` or any route (verified — live DOM `ogImage: null`). The playground/CMS `buildOgUrl`/`og-render-client.ts` build preview URLs **in the UI** (all default to og.bahrul.me); they inject no `<head>` meta. **Left intact.**
- `.env.local` sets `VITE_OG_ORIGIN=http://localhost:8788` — git-ignored (`.env*.local`), dev-only, **low** leak risk (prod builds run in CI without the file; only affects the admin-only playground previews, no public head).

---

## 5. Verification results

| Check | Result |
|---|---|
| Grep all 5 apps for `/og-image.png` in `src` | **0** ✅ |
| `og.bahrul.me` literals outside helpers | only helper files + 1 CSP `img-src` allowlist (`apps/web/src/server/security-headers.ts`) + doc-comments ✅ |
| 3 apps `i18n/index.ts` byte-identical (`diff`) | identical ✅ |
| 3 apps `og-url.ts` byte-identical (`diff`) | identical ✅ |
| Per-app `prettier --check` (i18n + og-url) | clean ✅ |
| `bun run typecheck` (cv, invoice, portfolio) | clean ✅ |
| `bun run build` (cv, invoice, portfolio, mcp-ui) | clean; `og.bahrul.me` baked in; **0** `localhost:8788` leakage ✅ |
| `bun run check` (ultracite + typography lint + pairing + parity ×2 + audit) | **passes (exit 0)** ✅ |
| Live `apps/og` Worker `HEAD og.bahrul.me/?…` (×3 apps) | `HTTP/2 200`, `content-type: image/png` ✅ |
| Dev server + agent-browser `og:image`+`twitter:image` → og.bahrul.me | cv:4003, invoice:4004, portfolio:4005 (EN+ID) ✅ |
| mcp-ui:5173 robots noindex + no og:image | `robots: noindex,nofollow`, `ogImage: null` ✅ |
| JSON-LD `JSON.parse` + absolute URLs | web (WebSite/Person, ProfilePage, BlogPosting/BreadcrumbList) + cv/invoice (SoftwareApplication) all parse OK, absolute ✅ |
| web CMS-override precedence | `?? buildOgUrl` confirmed in code; live fallback → og.bahrul.me ✅ |

---

## 6. Notes (out of scope — no change made)

- **`<head>` rendering, dev vs prod.** These three apps **SSR the full head in production** (verified: live `cv.bahrul.me` raw HTML carries `og:image`/`twitter:image`/`canonical` server-side — currently the old static png on the live deploy). The **Vite dev server** injects the head **client-side** (raw dev HTML has no head meta; the JS-executing agent-browser / Googlebot DOM does). So once the fix is deployed, the og.bahrul.me URL is SSR'd and reaches non-JS crawlers too. This is pre-existing framework behavior, identical before/after this change.
- **Pre-existing WIP.** The three `i18n/index.ts` and several `apps/mcp`/`apps/mcp-ui` files already had uncommitted changes at session start (the SEO/GEO normalization). My edits build on the working-tree state; `bun run check` is green.
- **Deployment.** Live `cv.bahrul.me`/`invoice.bahrul.me` still serve the **old** static `/og-image.png` (`/og-image.webp` for invoice) because the fix is not yet deployed. Deploy the three apps to publish the og.bahrul.me URLs.
- **`bun audit` advisories** (48, in the `check` chain via `bun audit || true`) are pre-existing transitive-dependency CVEs (picomatch, path-to-regexp, etc.); `|| true` keeps them informational and they do not fail `check`.
