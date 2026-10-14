# apps/jobs — Pilih Jobs dashboard (`jobs.pilihpendidikan.com`)

The web UI of the Job Tracker (`job-tracker-spec/12`, `06`). TanStack Start
(SSR) on Cloudflare Workers, Worker `jobs-pilihpendidikan`, dev port **4007**.
Zedative only (`DESIGN.md`, `TYPOGRAPHY.md`), `@rulisme/ui` only, typed against
`@pilihpendidikan/jobs-contracts` (D-20).

## Commands (run here)

- `bun run dev` — Vite + workerd on :4007 (from the root: `bun run dev:jobs`). Needs `.dev.vars` (copy `.dev.vars.example`) and the api on :8788 with the Job Tracker on locally (`apps/api`: `bun run db:migrate:local && bun run db:migrate:jobs:local && bun run db:seed:local`, then `bun run dev`; the root `bun run dev:api` runs the same Worker).
- `bun run dev:mock-api` — contract fixtures on :8790 (set `JOBS_API_FALLBACK_URL=http://localhost:8790`, then open `/?code=mock-sign-in-code` to sign in). Use it for screenshots before the real `/api/v1` routes exist. The cloud catalog mock makes the viewer an operator; start it with `MOCK_CLOUD_OPERATOR=0` for a plain user, `MOCK_CLOUD_PIPELINE=0` for the pipeline-off notice.
- `bun run test` — Vitest (`vitest.config.ts`; DOM tests use `// @vitest-environment happy-dom` and `src/test/render.tsx`).
- `bun run typecheck`, `bun run build`, `bunx biome check .` (from the repo root: `bunx biome check apps/jobs`).
- `bun run deploy` — `wrangler deploy` (owner approval required; `DEPLOY.md` § Job Tracker J6).
- Full-stack flows against the real api, CLI and browser: `bun run e2e` at the root (`e2e/web.test.ts`: S-01 sign-in, S-03 drag and drop; the CV tab, Apply tab and approvals appear in the other scenarios).

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
| `src/routes/` | `__root.tsx` (session in `beforeLoad`, providers in `-root-components.tsx`), `index.tsx` (sign-in band, `?code=` exchange), `id.tsx` (locale redirect), `board.tsx`, `inbox.tsx`, `jobs.$ujbId.tsx`, `applications.$appId.tsx`, `automation.tsx` (tabs layout) + `automation.index.tsx` (approvals) / `automation.rules.tsx` / `automation.runs.tsx`, `automation_.runs.$tskId.tsx` (live monitor, un-nested from the tabs), `cli.tsx`, `sources.tsx`, `stats.tsx`, `profile.tsx`, `settings.tsx`, `render.cv.$cvvId.tsx` (chrome-free), `download.$.ts` (server route: `.ics`, file content, BFF-built `.eml`), `$.tsx`. `-guards.ts`: `requireSignedIn`, `pageTitle` (titles under `pages.*`) |
| `src/functions/` | The only server functions: `session.functions.ts` (`getSessionState`, `requestSignIn`, `completeSignIn`, `signOut`, `setLocale`), `api.functions.ts` (`bffRequest`) and `render.functions.ts` (`readRenderVariant`, `uploadRenderedPdf`: the render-ticket calls) |
| `src/server/runtime.server.ts` | Server-only glue: Worker env, API fetcher (service binding / dev fallback), session + locale cookies, the per-isolate analytics cache. Never import it from client code |
| `src/lib/` | Pure modules (all unit-tested). Core: `bff.ts`, `api-routes.ts`, `api-client.ts`, `session-crypto.ts`, `cookies.ts`, `locale.ts`, `edge-policy.ts`, `polling.ts`, `conflict.ts`, `text-merge.ts`, `revisioned-write.ts`, `shortcuts.ts`, `labels.ts`, `format.ts`, `query.ts`, `download.ts`. Board / detail: `board-model.ts`, `board-move.ts`, `bulk.ts`, `follow-up.ts`, `next-step.ts`, `facts-form.ts`, `safe-url.ts`, `cv-diff.ts`, `email-recipient.ts`. Render: `render-bff.ts` (ticket mode), `render-cv.ts` (render + SHA-256 + upload), `pdf-fonts.ts`. Email: `eml.ts` (RFC 5322 builder, mailto), `eml-download.ts`. Inbox: `inbox-*.ts`, `score-explain.ts` (07 §5 templates). Automation: `approval-view.ts`, `rules-*.ts`, `runs-*.ts`, `monitor-*.ts`. CLI / sources: `devices-model.ts`, `devices-install.ts`, `semver.ts`, `sources-model.ts`, `json-schema-form.ts`, `cloud-sources-model.ts` (cloud catalog: status groups, sort, next run, diagnostics, operator editor diff, strategy-config check, board URL check). Stats: `stats-range.ts`, `stats-model.ts` |
| `src/hooks/` | `use-board.ts` (ETag board query + pending-move overlay), `use-polling-query.ts`, `use-application.ts`, `use-conflict-write.ts`, `use-session.ts`, `use-devices.ts`, `use-profile.ts`, `use-cvs.ts`, `use-cv-variant.ts` (variant detail + in-browser render), `use-inbox.ts`, `use-approvals.ts`, `use-rules.ts`, `use-tasks.ts`, `use-meta.ts`, `use-sources.ts`, `use-cloud-sources.ts` (cloud catalog list / detail / runs, follow, operator writes), `use-analytics.ts`, `use-announcer.ts`, `use-media-query.ts` |
| `src/components/shell/` | Nav band, sidebar (`nav-items.ts`), ⌘K palette, `?` sheet, New-by-URL dialog, `ShellActions` context |
| `src/components/board/`, `inbox/`, `application/`, `automation/`, `cli/`, `sources/`, `stats/`, `render/`, `profile/`, `settings/`, `sign-in/` | Screens. Shared: `copy-command.tsx` (copyable CLI command chip), `rich-text.tsx`, `app-link.tsx` |
| `src/i18n/` | `getT`, `useTranslation`; catalogues `locales/{en,id}.json` (same keys, tested) |
| `src/test/` | Contract-valid fixtures (parsed with the contract schemas): `fixtures.ts` (board, applications), `fixtures-rest.ts` (inbox, sources, runs, rules, tasks, approvals, CV variants, files, emails, analytics, meta), `fixtures-cv.ts` (a fictional tailored CVData), `fixtures-cli.ts`, `fixtures-cloud.ts` (fictional cloud boards, one per status, runs with logs); `render.tsx` (DOM harness) |
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
- Queries: React Query with keys in `queryKeys` (`src/lib/query.ts`). Poll with `usePollingQuery({ queryKey, queryFn, policy: POLL_POLICIES.<screen> })` — the 12 §10 intervals, paused when hidden unless the policy has a hidden interval, 2× backoff per failure up to 60 s, `stale` after three failures ("Offline — showing data from …"). Use `POLL_POLICIES.runMonitor` (2 s / 10 s hidden), `approvals` (10 s / 60 s), `inboxActive` (30 s only while a run is active), `devices` (10 s).
- Writes with `base_revision`: `useConflictWrite()` (any resource) or `useApplicationPatch()` (applications). They apply 12 §11: non-overlapping changes auto-merge and re-send once ("Updated with changes from the CLI"); overlapping ones never retry and show "Apply mine anyway" / "Keep theirs". Pass the resource's writable `fields` so view-only keys never count as conflicts.
- Idempotency: one `newIdempotencyKey()` per user intent; retries of the same intent reuse it (see `sendMoveWithRetry`). Never reuse a key with a different body.
- Moving an application from anywhere: `useMoveCard({ announce })` (`src/components/board/use-move-card.tsx`) → `requestMove({ card: moveSubject(card) | moveSubjectOf(detail), target, beforeId, afterId })`. It validates with the contracts' `canTransition(from, to, "user")`, asks the 06 §2.2 questions, keeps the optimistic overlay (`pendingMoves`) until the API answers, retries network errors with the same key (1 s / 2 s / 4 s) and rolls back on 409 / 422 / give-up. Render its `dialogs` and an `aria-live="assertive"` region (`useAnnouncer`).
- After a write that changes an application, call `commitApplicationToBoard(queryClient, application)` and invalidate `queryKeys.application(id)`.

## Shell API for new screens

- Link screens by path with `AppLink` / `useAppNavigate` (`/inbox`, `/jobs/$ujbId`, `/automation`, `/automation/rules`, `/automation/runs`, `/automation/runs/$tskId`, `/cli`, `/sources`, `/stats`, `/render/cv/$cvvId`). Sidebar entries, counters (`BoardResponse.counts`) and B / I / A / R shortcuts point there. `/render/*` renders without the shell (`isBarePath` in `-root-components.tsx`).
- Page layout: reading pages use `Band` + `Rail nodes={false}` with `px-4 sm:px-8`; dense screens use `band` toolbars with compact roles. One primary (blue) button per page besides the nav's New; every primary action has a `<Kbd>` hint and a `useShortcut` (TW-SHORTCUTS scans for hints without handlers). Add new shortcuts to `SHORTCUTS` (`src/lib/shortcuts.ts`) so the `?` sheet lists them.
- Open shell dialogs with `useShellActions()` (`openNewJob`, `openPalette`, `openShortcuts`).
- Pending approvals prefix the tab title `(n)` from `counts.approvals_pending` (shell).
- CV tab (`application/cv-tab.tsx` → `cv-variant-panel.tsx` → `cv-diff-view.tsx`): pick a variant, read the side-by-side diff (`buildDiffModel`; sources marked on hover / focus / tap, rewritten lines highlighted, excluded entries struck through, `notes_for_user` as warnings), Approve `Y` (AlertDialog) / Reject (reason) / Regenerate / Download / Open in CV builder. While the tab shows an approvable draft it owns `Y` (`NextStepRail shortcutEnabled`). A `generating` variant with a `tailored_cv_id` and no file is rendered in this tab (`useInBrowserRender` → `renderCvVariantOnce`, 08 §6.2). The PDF preview is an **unsandboxed** same-origin iframe of `/download/files/{id}/content?inline=1`: Chromium refuses any PDF in a sandboxed frame, so containment is on the response (inline only for `application/pdf`, `nosniff`, `default-src 'none'`, `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` via the `x-jobs-frameable` marker the edge strips).
- Apply tab (`application/apply-tab.tsx`): mode select (PATCH), browser runs on online devices that can `apply` and take tasks (or any), a link to the live monitor; email (`email-apply.tsx`, `email-drafts.tsx`): recipient hints (`checkRecipient`: employer domain / free-mail / other → tick), en / id template from the facts, ≤ 5 approved attachments, 20 KB body; drafts are approved with the pending `submit` approval's `payload_hash`; approved `local_handoff` drafts offer the `.eml` download and a `mailto:` fallback, then "I sent it" / "Not sent" (`handed-off`). Manual: "I applied".

## Screens of 12 §4–§9 (contracts worth keeping)

- Inbox (`components/inbox/`): filters live in the URL (`validateInboxSearch`); J / K / Enter / X / S / D / `/`; bulk via `inbox:bulk` in chunks (track ≤ 100, other actions ≤ 200), one idempotency key per chunk, one summary toast; polls 30 s only while a discovery run is `running`; score cell tooltip loads `GET /scores/{posting_id}` and renders `explainScoreLines`. `/jobs/$ujbId` redirects (replace) to the application once tracked.
- Automation (`components/automation/`): `/automation?approval=<apr_id>&view=decided` preselects; every decision goes through an AlertDialog and sends the approval's `payload_hash` (a 409 / mismatch says the form changed); answer approvals send `response.answers` (protected answers never `auto_use: always`); activating an `auto` rule needs the exact rule name typed before the `rule_activation` decide; `/automation/runs?state=`; the outcome_unknown retry asks "Did this go through?" (Submitted / Not submitted → `confirm_not_submitted` / Not sure). The monitor polls 2 s / 10 s hidden until terminal, one `aria-live` announcement per 5 s, one prompt per canonical PauseReason, Resume `Y`.
- CLI & devices (`components/cli/`): commands only from `cli-commands.json` (`C` copies the selected OS's install command); devices poll 3 s while none is connected or right after copying the login command, else 10 s; version badges compare against `meta` (`semver.ts`); outbox warning when `report.outbox_depth > 0` for > 1 h or `outbox_dead > 0`.
- Remote job boards (`components/sources/cloud-*.tsx`, 24 §5, 05 §15): the cloud catalog band above the CLI sources. Everyone filters (status group, following, search), follows / unfollows (optimistic, rolled back on failure; the toast says how many recent jobs were backfilled) and opens the detail sheet (diagnostics per error class, auth note, terms, stats, runs with expandable logs rendered as plain text, "Load older runs" through the runs cursor). Operators (`viewer.operator`) also get Refresh directory, Add board (URL checked client-side, the api re-validates) and the editor (PATCH under the 12 §11 conflict rules; the strategy config JSON is validated live with `parseStrategyConfig`; Retry asks first). The list polls `POLL_POLICIES.cloudSources` (30 s), `cloudSourcesActive` (5 s) while a board scrapes or a run the user queued is live. Followed boards join the inbox source filter (`useFollowedCloudSources`).
- Sources (`components/sources/`): the add / edit Sheet renders the adapter's config form from its manifest JSON Schema (`json-schema-form.ts`); excluded adapters are listed disabled with their reason; `opt_in` adapters (Workday) need the "I understand" tick; "Test" only shows `pilih-jobs discover --source <id> --dry-run`; "Run now" creates a `discover` task.
- Stats (`components/stats/`): every chart sits in `ChartFrame` (role="img" summary + a `aria-pressed` "Data table" toggle remembered per chart in localStorage); rates hidden for cohorts under 5; range, metric and breakdown in the URL.

## Render ticket mode (08 §6, PLAN C8)

- `/render/cv/$cvvId` is chrome-free and open to signed-out visitors: the single-use ticket in `?ticket=` is the credential. `takeTicketFromUrl()` removes it with `history.replaceState` before anything else; without one, a signed-in visitor gets a ticket minted through the session (`POST …/render-ticket`). One run per variant per page (`startPageRender`), shared by re-mounts.
- `readRenderVariant` / `uploadRenderedPdf` call the api with `X-Render-Ticket` and **no** `Authorization` (`src/lib/render-bff.ts`): read `GET /cv-variants/{id}?include=cv_data` (validated: right variant, CVData present), then upload `POST /api/v1/files` multipart (`meta` then `file`, `kind: cv_pdf`, `links.cv_variant_id`) after checking `%PDF-`, ≤ 5 MB and the SHA-256 the page computed. The ticket is scrubbed from every answer.
- The page sets `window.__PILIH_RENDER__` to `{status: "done", file_id, sha256}` or `{status: "error", message}` only when finished (headless callers wait for it). Edge headers for `/render/*`: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, the strict `renderPageCsp` (`default-src 'none'`, no frames / forms / objects).
- Every page CSP allows `'wasm-unsafe-eval'` (the PDF engine's yoga layout is WebAssembly; client navigation keeps the first document's CSP). It permits no JavaScript eval.

## Other BFF extensions

- `.eml` (09 §6.1): `GET /download/applications/{app}/emails/{eml}.eml` → `buildEmlDownload` (approved / handed-off drafts only; From = facts `contact.email` else the session email; every attachment fetched server-side and checked against its SHA-256, ≤ 10 MB; `X-Unsent: 1`, RFC 2047 subjects, CRLF, base64 parts).
- Analytics answers are cached per user (SHA-256 of the bearer) and query for 60 s in the isolate (`CACHED_ROUTES`, 10 §6).

## Conventions

- Strings: add keys to both `en.json` and `id.json` (TW-I18N checks parity, placeholders and every static `t("…")`; add template-built key families to its `dynamicKeys`). Enum labels go through `src/lib/labels.ts`. Indonesian follows the 12 §13 glossary. Score explanations mirror the api's templates under `score.explanation.*` (`score-explain.ts`, parity-tested against apps/api).
- Route files with `$param` need `// biome-ignore-all lint/style/useFilenamingConvention` at the top.
- Tests: name spec tests with their id (`T6-05 …`, `TW-POLL …`) and avoid the characters `×`, `✗` in titles (the gate parser reads them as failures).
- Screenshots for reviews go in `verification/` (375 px and 1280 px, light and Night Desk) via `agent-browser`. With `bun run dev` + `bun run dev:mock-api`, `agent-browser errors` must stay empty.
- DOM tests that render an `<iframe>` add `// @vitest-environment-options {"settings": {"disableIframePageLoading": true}}`; components that import server functions are mocked (`vi.mock`) so tests never load the Worker glue.
