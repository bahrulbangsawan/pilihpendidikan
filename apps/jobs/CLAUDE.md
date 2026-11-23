# apps/jobs — Pilih Jobs dashboard (`jobs.pilihpendidikan.com`)

The web UI of the Job Tracker (`job-tracker-spec/12`, `06`). TanStack Start
(SSR) on Cloudflare Workers, Worker `jobs-pilihpendidikan`, dev port **4007**.
`@rulisme/ui` only (tokens in `packages/ui/src/styles/theme.css`, rules in
`TYPOGRAPHY.md`), typed against `@pilihpendidikan/jobs-contracts` (D-20).

Scope: a **manual** job tracker — Board (kanban / list / table), application
details, Stats, Profile, Settings. The automation surfaces (inbox, approvals,
runs and the run monitor, rules, sources and the cloud catalog, CLI &
devices, `/jobs/$ujbId`) were removed from the dashboard (round 3); their old
URLs fall through to `$.tsx` and show the 404 page. The api, CLI and mock api
still serve them.

The look is Zedative (cursor.com's dark system) with reui.io's application
layouts, **dark only**: next-themes pins `.dark` (`forcedTheme="dark"` in
`-root-components.tsx`); there is no theme switch anywhere. The shell
(reui app-shell): a 240px sidebar on `bg-sidebar` with a right rule — brand
row (20px mark, "Pilih Jobs", collapse toggle; collapsed it is a 56px icon
rail, remembered in localStorage), a search field that opens ⌘K, the
"Workspace" group (Board, Stats), the bottom group (Profile, Settings) and
the user footer that opens the profile dropdown (Profile, Settings, Language
submenu, Keyboard shortcuts, Sign out). Rows are 32px `rounded-md`, hover
`bg-pane`, current `bg-pane-2 text-foreground`. The content column has a
48px top bar (breadcrumb left, page-actions slot right; on phones a menu
button opens the sidebar in a Sheet). Headings are weight 400. Cards are
`rounded-lg border border-border bg-card`; settings-style cards are one
bordered card of hairline-divided rows in a 640px column
(`@rulisme/ui/blocks/settings`). Every control is an
`@rulisme/ui` component (no raw `<button>` / `<input>` / `<select>`), and
select / menu options carry a lucide icon.

## Commands (run here)

- `bun run dev` — Vite + workerd on :4007 (from the root: `bun run dev:jobs`). Needs `.dev.vars` (copy `.dev.vars.example`) and the api on :8788 with the Job Tracker on locally (`apps/api`: `bun run db:migrate:local && bun run db:migrate:jobs:local && bun run db:seed:local`, then `bun run dev`; the root `bun run dev:api` runs the same Worker).
- `bun run dev:mock-api` — contract fixtures on :8790 (set `JOBS_API_FALLBACK_URL=http://localhost:8790`, then open `/?code=mock-sign-in-code` to sign in). Use it for screenshots before the real `/api/v1` routes exist. It still serves the removed automation routes; the dashboard no longer calls them.
- `bun run test` — Vitest (`vitest.config.ts`; DOM tests use `// @vitest-environment happy-dom` and `src/test/render.tsx`).
- `bun run typecheck`, `bun run build`, `bunx biome check .` (from the repo root: `bunx biome check apps/jobs`).
- `bun run deploy` — `wrangler deploy` (owner approval required; `DEPLOY.md` § Job Tracker J6).
- Full-stack flows against the real api, CLI and browser: `bun run e2e` at the root (`e2e/web.test.ts`: S-01 sign-in, S-03 drag and drop). Scenarios that used the removed approvals / Apply tab / CLI screens now drive those steps through `/api/v1` (`e2e/README.md` § The dashboard after round 3).

## Deploy

Worker `jobs-pilihpendidikan` on `jobs.pilihpendidikan.com` (`wrangler.jsonc`), deployed only after the api is live and `JOBS_V1_ENABLED` is on (`DEPLOY.md` § Job Tracker). It needs:

- the service binding `API` → `api-pilihpendidikan` (the BFF never calls the api over the public internet in production; `JOBS_API_FALLBACK_URL` is dev only);
- the secret `BFF_COOKIE_KEY` (`openssl rand -base64 32 | bunx wrangler secret put BFF_COOKIE_KEY`); rotating it signs everyone out;
- the vars `API_PUBLIC_ORIGIN` and `JOBS_APP_ORIGIN`. The api must list the dashboard origin in `APP_ORIGINS` (`apps/api/src/origins.ts`) for sign-in `returnTo` and CORS.

The hub links the dashboard only after `jobs` is flipped to `"live"` in `apps/home/src/config/services.ts` (Going live).

## Structure

| Path | What |
|---|---|
| `src/server.ts` | Worker entry: `applyEdgePolicy` (`src/lib/edge-policy.ts`) around the TanStack handler — Origin gate on `/_serverFn` (CSRF), per-response CSP nonce (`x-jobs-csp-nonce` → `router.tsx` `ssr.nonce`), noindex, `private, no-store` |
| `src/start.ts` | TanStack's CSRF middleware for server functions (second line of defence) |
| `src/router.tsx` | Router + a per-request `QueryClient` in router context; `dehydrate` / `hydrate` carry the session state (never the bearer) so the first client render matches the SSR shell |
| `src/routes/` | `__root.tsx` (session in `beforeLoad`, providers in `-root-components.tsx`), `index.tsx` (sign-in card, `?code=` exchange), `id.tsx` (locale redirect), `board.tsx`, `applications.$appId.tsx`, `stats.tsx` (range / metric / breakdown in the search), `profile.tsx` (`?tab=answers|cvs`), `settings.tsx` (`?section=language|ai|data`), `render.cv.$cvvId.tsx` (chrome-free), `download.$.ts` (server route: `.ics`, file content, BFF-built `.eml`), `$.tsx` (404, also for every removed automation URL). `-guards.ts`: `requireSignedIn`, `pageTitle` (titles under `pages.*`) |
| `src/functions/` | The only server functions: `session.functions.ts` (`getSessionState`, `requestSignIn`, `completeSignIn`, `signOut`, `setLocale`), `api.functions.ts` (`bffRequest`) and `render.functions.ts` (`readRenderVariant`, `uploadRenderedPdf`: the render-ticket calls) |
| `src/server/runtime.server.ts` | Server-only glue: Worker env, API fetcher (service binding / dev fallback), session + locale cookies, the per-isolate analytics cache. Never import it from client code |
| `src/lib/` | Pure modules (all unit-tested). Core: `bff.ts`, `api-routes.ts`, `api-client.ts`, `session-crypto.ts`, `cookies.ts`, `locale.ts`, `edge-policy.ts`, `polling.ts`, `conflict.ts`, `text-merge.ts`, `revisioned-write.ts`, `shortcuts.ts`, `labels.ts`, `format.ts`, `query.ts`, `download.ts`. Board / detail: `board-model.ts`, `board-move.ts`, `bulk.ts`, `follow-up.ts`, `next-step.ts`, `facts-form.ts`, `safe-url.ts`, `cv-diff.ts`, `email-recipient.ts`. Render: `render-bff.ts` (ticket mode), `render-cv.ts` (render + SHA-256 + upload), `pdf-fonts.ts`. Email: `eml.ts` (RFC 5322 builder, mailto), `eml-download.ts`. Stats: `stats-range.ts` (presets, `previousRange` for the delta chips), `stats-model.ts` (cells, `statDeltas`, chart / table models) |
| `src/hooks/` | `use-board.ts` (ETag board query + pending-move overlay), `use-polling-query.ts`, `use-application.ts`, `use-conflict-write.ts`, `use-session.ts`, `use-profile.ts`, `use-cvs.ts`, `use-cv-variant.ts` (variant detail + in-browser render), `use-analytics.ts`, `use-announcer.ts`, `use-media-query.ts`, `use-selection.ts`, `use-bulk-run.ts` |
| `src/components/shell/` | `app-shell.tsx` (layout, global keys), `sidebar-nav.tsx` + `nav-items.ts`, `user-menu.tsx` (footer + profile dropdown), `top-bar.tsx` (breadcrumb, actions slot), `use-change-locale.ts` (page frame and settings layout come from `@rulisme/ui/blocks/page` and `blocks/settings`), ⌘K palette, `?` sheet, New-by-URL dialog, `ShellActions` context |
| `src/components/board/`, `application/`, `bulk/`, `stats/`, `render/`, `profile/`, `settings/`, `sign-in/` | Screens. Shared: `rich-text.tsx`, `app-link.tsx`, `not-found.tsx` |
| `src/i18n/` | `getT`, `useTranslation`; catalogues `locales/{en,id}.json` (same keys, tested) |
| `src/test/` | Contract-valid fixtures (parsed with the contract schemas): `fixtures.ts` (board, applications), `fixtures-rest.ts` (CV variants, files, emails, analytics, plus the automation records the mock api still serves), `fixtures-cv.ts` (a fictional tailored CVData), `fixtures-cloud.ts` (fictional cloud boards, kept for the mock api); `render.tsx` (DOM harness), `dom-harness.tsx` (fake BFF transport, providers, async helpers for DOM tests) |
| `scripts/mock-api.ts` + `scripts/mock/` | The dev mock api: shared state (`state.ts`: board, applications, devices, `detailExtras`, `extraEvents`, `fresh()` time shift), reply helpers (`types.ts`) and one module per area (`inbox`, `automation`, `devices`, `sources`, `cloud`, `analytics`, `cv`) |

## BFF rules (D-15, PLAN C7, 11 §4.1) — do not bend these

- The API bearer lives only in the sealed `__Host-jobs-session` cookie (`jobs-session` on http://localhost): AES-256-GCM, key = SHA-256(`BFF_COOKIE_KEY`), AAD = version + cookie name. Tampered, expired or foreign cookies read as signed out and are cleared.
- Every API call is the `bffRequest` server function: `{route, params, query, body, idempotency_key, if_none_match}` where `route` is a key of `WEB_ROUTE_KEYS` (`src/lib/api-routes.ts`). `proxyApiRequest` validates params (plain ids only), query and body against `API_ROUTE_SCHEMAS` **before** calling the API, attaches `Authorization: Bearer` server-side and scrubs the bearer from whatever comes back. A 401 clears the cookie and the client returns to the sign-in band.
- Nothing returned to the browser may contain the bearer (TW-BFF tests). Server functions return `BffResult` / `SessionState` only — never a raw `Response` from the API, never a token.
- A new API route for the web: add its key to `WEB_ROUTE_KEYS` (or, if the web must never call it, to `NON_WEB_ROUTE_KEYS` with the reason); the exhaustiveness test fails otherwise. Device-bound, `automation:execute`, `ai:invoke` and `discovery:write` routes are never web routes. Binary / calendar responses go through `/download/*` (`src/lib/download.ts` allowlist; `?inline=1` shows a PDF inline for an `<iframe>`).
- Mutating server functions are POST; the edge refuses any server-function POST whose `Origin` is not the app origin (T11-CSRF). Never add a GET server function that writes.
- Untrusted text (postings, notes, interview locations, anything scraped) renders through `PlainText` / `MarkdownLite` (`src/components/rich-text.tsx`) or plain `{text}`; links only via `safeHref` (http, https, mailto) with `rel="noopener noreferrer"`. No `dangerouslySetInnerHTML`.

## Data layer (for new screens)

```ts
import { api, apiCall, ApiError, isApiError } from "@/lib/api-client";
const board = await api("GET /api/v1/board", { query: { include_archived: "1" } });
await api("POST /api/v1/applications/{app_id}/move", {
  params: { app_id }, body: { base_revision, stage }, idempotencyKey,
});
```

- Inputs and results are typed from the contract (`ApiCallInput<K>`, `ApiResponse<K>`); `apiCall` also returns `etag`, `notModified`, `replayed`. Errors throw `ApiError` (`status`, `code`, `details`, `isRetryable`, `isRevisionConflict`, `current`).
- Queries: React Query with keys in `queryKeys` (`src/lib/query.ts`). Poll with `usePollingQuery({ queryKey, queryFn, policy: POLL_POLICIES.<screen> })` — the 12 §10 intervals, paused when hidden unless the policy has a hidden interval, 2× backoff per failure up to 60 s, `stale` after three failures ("Offline — showing data from …"). The shell keeps the board warm with `POLL_POLICIES.shell` for the ⌘K application search.
- Writes with `base_revision`: `useConflictWrite()` (any resource) or `useApplicationPatch()` (applications). They apply 12 §11: non-overlapping changes auto-merge and re-send once ("Updated with changes from the CLI"); overlapping ones never retry and show "Apply mine anyway" / "Keep theirs". Pass the resource's writable `fields` so view-only keys never count as conflicts.
- Idempotency: one `newIdempotencyKey()` per user intent; retries of the same intent reuse it (see `sendMoveWithRetry`). Never reuse a key with a different body.
- Moving an application from anywhere: `useMoveCard({ announce })` (`src/components/board/use-move-card.tsx`) → `requestMove({ card: moveSubject(card) | moveSubjectOf(detail), target, beforeId, afterId })`. It validates with the contracts' `canTransition(from, to, "user")`, asks the 06 §2.2 questions, keeps the optimistic overlay (`pendingMoves`) until the API answers, retries network errors with the same key (1 s / 2 s / 4 s) and rolls back on 409 / 422 / give-up. Render its `dialogs` and an `aria-live="assertive"` region (`useAnnouncer`).
- After a write that changes an application, call `commitApplicationToBoard(queryClient, application)` and invalidate `queryKeys.application(id)`.

## Shell API for new screens

- Link screens by path with `AppLink` / `useAppNavigate` (`/board`, `/applications/$appId`, `/stats`, `/profile`, `/settings`, `/render/cv/$cvvId`). `/` and `/render/*` render without the shell (`isBarePath` in `-root-components.tsx`).
- Page frame (`components/shell/page.tsx`, API documented at the top): `PageHeader({ title, description?, count?, actions?, children?, wide? })`, `PageContent`, `PageGutter`, `PageSection`; gutter `px-4 sm:px-6 lg:px-8`, reading pages held to `max-w-5xl`, dense screens `wide`.
- Top bar (`components/shell/top-bar.tsx`): `useBreadcrumbs([{ label, href? }, …])` replaces the URL-derived breadcrumb while a screen is mounted; `<TopBarActions>` portals buttons into its right slot.
- Account-style pages: `SubNavLayout` (title, description, left sub-nav / phone tab row) + `SettingsCard` (one border, header, rows divided by hairlines, optional Cancel / Save footer, `tone="destructive"`, 640px column) + `SettingsRow` (icon tile, label + badge + description; `control="fill"` full-width field or `"end"` switch/button at the right), all from `@rulisme/ui/blocks/settings`.
- Shortcuts: global ⌘K, `B` (board), `N` (new job by URL), `?` (sheet), Esc. One primary button per page; every primary action has a `<Kbd>` hint and a `useShortcut` (TW-SHORTCUTS scans for hints without handlers). Add new shortcuts to `SHORTCUTS` (`src/lib/shortcuts.ts`) so the `?` sheet lists them.
- Open shell dialogs with `useShellActions()` (`openNewJob`, `openPalette`, `openShortcuts`). Change the UI language with `useChangeLocale()` (Settings and the profile dropdown use it).
- CV tab (`application/cv-tab.tsx` → `cv-variant-panel.tsx` → `cv-diff-view.tsx`): pick a variant, read the side-by-side diff (`buildDiffModel`; sources marked on hover / focus / tap, rewritten lines highlighted, excluded entries struck through, `notes_for_user` as warnings), Approve `Y` (AlertDialog) / Reject (reason) / Regenerate / Download / Open in CV builder. While the tab shows an approvable draft it owns `Y` (`NextStepRail shortcutEnabled`). A `generating` variant with a `tailored_cv_id` and no file is rendered in this tab (`useInBrowserRender` → `renderCvVariantOnce`, 08 §6.2). The PDF preview is an **unsandboxed** same-origin iframe of `/download/files/{id}/content?inline=1`: Chromium refuses any PDF in a sandboxed frame, so containment is on the response (inline only for `application/pdf`, `nosniff`, `default-src 'none'`, `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` via the `x-jobs-frameable` marker the edge strips).
- Email drafts (`application/email-apply.tsx`, `email-drafts.tsx`, owned by the application details): recipient hints (`checkRecipient`), en / id template from the facts, ≤ 5 approved attachments, 20 KB body; approved `local_handoff` drafts offer the `.eml` download and a `mailto:` fallback. The browser-run Apply tab (devices, live monitor) was removed with the automation.

## Screens of 12 §4–§9 (contracts worth keeping)

- Stats (`components/stats/`): four stat cards (value, delta chip against the period of the same length before — counts in %, the response rate in points — and the previous value; all time has no delta), then every chart in `ChartFrame` (role="img" summary + a `aria-pressed` "Data table" toggle remembered per chart in localStorage); rates hidden for cohorts under 5; range, metric and breakdown in the URL. No automation metrics.
- Profile (`components/profile/`): Facts (one card of label / field rows per group, Save `S` in the work-authorization card's footer), Answers and CVs (tables inside cards).
- Settings (`components/settings/`): Account (email, sign out), Language & region (language saves at once; timezone with Cancel / Save), AI (consent, sensitive scoring), Your data (export, delete). The automation settings (default mode, pause all, MCP approvals, AI-drafted form text, evidence screenshots and retention) are no longer shown.

## Render ticket mode (08 §6, PLAN C8)

- `/render/cv/$cvvId` is chrome-free and open to signed-out visitors: the single-use ticket in `?ticket=` is the credential. `takeTicketFromUrl()` removes it with `history.replaceState` before anything else; without one, a signed-in visitor gets a ticket minted through the session (`POST …/render-ticket`). One run per variant per page (`startPageRender`), shared by re-mounts.
- `readRenderVariant` / `uploadRenderedPdf` call the api with `X-Render-Ticket` and **no** `Authorization` (`src/lib/render-bff.ts`): read `GET /cv-variants/{id}?include=cv_data` (validated: right variant, CVData present), then upload `POST /api/v1/files` multipart (`meta` then `file`, `kind: cv_pdf`, `links.cv_variant_id`) after checking `%PDF-`, ≤ 5 MB and the SHA-256 the page computed. The ticket is scrubbed from every answer.
- The page sets `window.__PILIH_RENDER__` to `{status: "done", file_id, sha256}` or `{status: "error", message}` only when finished (headless callers wait for it). Edge headers for `/render/*`: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, the strict `renderPageCsp` (`default-src 'none'`, no frames / forms / objects).
- Every page CSP allows `'wasm-unsafe-eval'` (the PDF engine's yoga layout is WebAssembly; client navigation keeps the first document's CSP). It permits no JavaScript eval.

## Other BFF extensions

- `.eml` (09 §6.1): `GET /download/applications/{app}/emails/{eml}.eml` → `buildEmlDownload` (approved / handed-off drafts only; From = facts `contact.email` else the session email; every attachment fetched server-side and checked against its SHA-256, ≤ 10 MB; `X-Unsent: 1`, RFC 2047 subjects, CRLF, base64 parts).
- Analytics answers are cached per user (SHA-256 of the bearer) and query for 60 s in the isolate (`CACHED_ROUTES`, 10 §6).

## Conventions

- Strings: add keys to both `en.json` and `id.json` with targeted edits (TW-I18N checks parity, placeholders and every static `t("…")`; add template-built key families to its `dynamicKeys`). Enum labels go through `src/lib/labels.ts`. Indonesian follows the 12 §13 glossary. The removed screens' namespaces are deleted; don't bring them back.
- Route files with `$param` need `// biome-ignore-all lint/style/useFilenamingConvention` at the top.
- Tests: name spec tests with their id (`T6-05 …`, `TW-POLL …`) and avoid the characters `×`, `✗` in titles (the gate parser reads them as failures).
- Screenshots for reviews go in `verification/` (390 px and 1440 px; the app is dark only) via `agent-browser`. With `bun run dev` + `bun run dev:mock-api`, `agent-browser errors` must stay empty.
- DOM tests that render an `<iframe>` add `// @vitest-environment-options {"settings": {"disableIframePageLoading": true}}`; components that import server functions are mocked (`vi.mock`) so tests never load the Worker glue.
