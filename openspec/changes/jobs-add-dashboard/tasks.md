Evidence: the ledger gates `.unlazy/jobs/gates/leaf-2.1.md`, `leaf-2.3.md`,
`leaf-2.8.md`, `leaf-2.10.md`, `leaf-2.11.md`, `leaf-3.1.md` and `leaf-3.2.md`
(all `[x]`, VERIFIED in `.unlazy/jobs/status.log`). Items marked "Handoff
recorded" were NOT executed and are listed only so the owner can act on them.

## 1. `/api/v1` kernel (`apps/api/src/jobs/core`, `repo/core`)

- [x] 1.1 Router with the dispatch order auth → `JOBS_V1_ENABLED` → 426 gate → scope → device → presence → rate limit → body → idempotency → validation (`core/router.ts`, `core/flags.ts`, `core/version.ts`; tests TCORE-ROUTER, TCORE-FLAGS, S-32 in `core/router.test.ts`)
- [x] 1.2 Error envelope and helpers (`core/http.ts`), `X-Request-Id`, `private, no-store`
- [x] 1.3 Scope map per credential kind (`core/scopes.ts`, `src/auth.ts`; TCORE-SCOPES in `src/auth.test.ts`)
- [x] 1.4 05 §1.9 rate-limit rules (`src/rate-limit.ts`: sync-batch, task-poll, ai-invoke, file-upload, file-upload-bytes, task-create)
- [x] 1.5 Idempotency keys in the same batch, replay header, mismatch 409 (`repo/core/idempotency.ts`, `core/context.ts` `c.commit`; TCORE-IDEMPOTENCY)
- [x] 1.6 Revisions and `If-Match` (`core/revision.ts`; TCORE-REVISION), keyset pagination (`core/pagination.ts`), ETag/304 (`core/etag.ts`)
- [x] 1.7 `GET /api/v1/meta` and `GET /api/v1/me` (`routes/meta/index.ts`)
- [x] 1.8 Static `JOBS_DB` access and SQL-predicate lints (T11-JOBSDB, T11-SQL in `src/jobs/isolation.test.ts`)

## 2. Tracker routes (`apps/api/src/jobs/{routes,services,repo}/applications`, `profile`, `account`)

- [x] 2.1 Board with counts, cursor, closed-lane cap 200 and ETag (`services/applications/board.ts`; TB-ETAG, TB-CLOSED-CAP in `board.test.ts`)
- [x] 2.2 Track, detail, PATCH incl. checklist cap 413 (`track.ts`, `detail.ts`, `update.ts`; TB-CHECKLIST, TB-TRACK)
- [x] 2.3 Move with server ranks, rank-only auto-resolve, `submission_in_flight` refusal (`placement.ts`, `stage.ts`, `core/rank.ts`; T6-02, T6-03, T6-04, T6-06)
- [x] 2.4 Submission confirm / deny / mark_applied with `user_attestation` (`submission.ts`; TB-SUBMISSION)
- [x] 2.5 Events timeline, `note_added` / `note_deleted` (`events.ts`; TB-NOTES in `timeline.test.ts`)
- [x] 2.6 Interviews and offers CRUD with `move_application` toggles, `.ics` export (`interviews.ts`, `offers.ts`, `ics.ts`; TB-INTERVIEW-AUTOMOVE, TB-OFFER, TB-ICS)
- [x] 2.7 Archive and `?purge=1` (refused to MCP) incl. R2 objects (`purge.ts`; T6-16, TB-PURGE)
- [x] 2.8 Profile facts, `facts:import-cv`, answers with the protected + always 422 (`routes/profile`; TP-FACTS, TP-IMPORT-CV, TP-ANSWERS)
- [x] 2.9 Settings with lazy row and effects (`routes/account`; TP-SETTINGS)
- [x] 2.10 Account export and deletion, browser session only (`services/account/export.ts`, `delete.ts`; TP-EXPORT, TP-DELETE, S-33 in `routes/account/delete.test.ts`)
- [x] 2.11 Cross-user isolation sweep over `listRouteTable()` and MCP `jobs_*` tools, as user and admin (`src/jobs/isolation-sweep.test.ts`; S-31, T11-ISO, T11-ADMIN-SWEEP, T6-09)

## 3. Legacy surface (`apps/api/src/jobs/legacy`, `repo/legacy`, `documents/jobs.ts`, `tools/jobs*.ts`)

- [x] 3.1 Facade with the `JOBS_LEGACY_BACKEND` flag, KV and D1 backends (`legacy/facade.ts`, `kv.ts`, `d1.ts`; TL-FLAG)
- [x] 3.2 Stage ↔ status mapping, `Invalid status` 422, 5 s stale guard, P3 KV fallback (`legacy/mapping.ts`, `d1.ts`; T6-12, TL-STALE-GUARD, TL-FALLBACK)
- [x] 3.3 Public-posting fork on legacy edits (`repo/legacy/write.ts`; T6-15)
- [x] 3.4 Existing `/api/jobs` and MCP suites pass on `d1`; `jobs_list` beyond 1,000 (T6-13, T6-14 in `documents/jobs.test.ts`, `tools/jobs.test.ts`)
- [x] 3.5 D-26: admin bypass removed for jobs, `?mine=0` ignored (T11-ADMIN)
- [x] 3.6 New MCP tools `jobs_board`, `jobs_move`, `jobs_note_add`, `jobs_interview_add`, `jobs_offer_add`, `jobs_approvals_list`, `jobs_approval_decide` with the read/write split and the `allow_mcp_approvals` rule (`tools/jobs-board.ts`, `tools/jobs-approvals.ts`; TL-MCP-NEW, TL-MCP-APPROVALS; 89 tools in `tool-surface.test.ts`)
- [x] 3.7 Gated migration script, dry run by default, checkpoint, verify (`scripts/migrate-jobs-kv-to-d1.ts`; T6-10, T6-11, S-02 in `migrate-jobs-kv-to-d1.test.ts`) — its requirement is specified in `api-add-user-ids-and-jobs-db` (`jobs-data`: Gated legacy jobs migration script)
- [x] 3.8 Break-glass `scripts/support-access.ts` logging `support_access_log` (TL-BREAKGLASS) — its requirement is specified in `api-add-user-ids-and-jobs-db` (`api-backend`: Logged break-glass support access)
- [x] 3.9 Jobs origin and localhost 4007 in CORS and the `returnTo` allowlist (`src/origins.ts`)

## 4. Dashboard platform (`apps/jobs`)

- [x] 4.1 TanStack Start app on Workers, port 4007, Worker `jobs-pilihpendidikan`, `API` service binding (`apps/jobs/wrangler.jsonc`, `vite.config.ts`, `package.json`)
- [x] 4.2 Sealed session cookie (`src/lib/session-crypto.ts`, `cookies.ts`; TW-SESSION)
- [x] 4.3 `bffRequest` proxy with contract validation and bearer scrubbing (`src/functions/api.functions.ts`, `src/lib/bff.ts`, `api-routes.ts`; TW-BFF)
- [x] 4.4 Magic-link sign-in and sign-out (`src/functions/session.functions.ts`, `src/components/sign-in/`)
- [x] 4.5 Edge policy: CSP nonce, Origin gate, noindex, no-store (`src/server.ts`, `src/lib/edge-policy.ts`, `src/start.ts`; T11-CSRF)
- [x] 4.6 Safe rendering of untrusted text (`src/components/rich-text.tsx`, `src/lib/safe-url.ts`; T11-XSS)
- [x] 4.7 Locale cookie, `/id` redirect, en/id catalogues (`src/lib/locale.ts`, `src/routes/id.tsx`, `src/i18n/`; TW-LOCALE, TW-I18N)
- [x] 4.8 Zedative theme import and lint roots (`apps/jobs/src/styles.css`; `scripts/lint-typography.sh` and the parity scripts include `apps/jobs/src`)

## 5. Dashboard screens

- [x] 5.1 Shell: nav band, sidebar, ⌘K palette, `?` sheet, New-by-URL (`src/components/shell/`); shortcuts with `Kbd` hints (`src/lib/shortcuts.ts`; TW-SHORTCUTS)
- [x] 5.2 Board: columns, Closed lane, cards, toolbar, phone switcher (`src/components/board/`, `src/lib/board-model.ts`)
- [x] 5.3 Moves: dnd-kit sensors, `M` picker, local validation, optimistic overlay, same-key retries, rollback, 06 §2.2 dialogs, aria-live (`use-move-card.tsx`, `board-dnd.tsx`, `src/lib/board-move.ts`; T6-05, TW-TRANSITION)
- [x] 5.4 Bulk actions with concurrency 4 and per-card results (`src/lib/bulk.ts`, `bulk-bar.tsx`; T6-08)
- [x] 5.5 Application detail: header, Next-step rail, Overview, Timeline, Interviews, Offers, Checklists, Notes (`src/components/application/`)
- [x] 5.6 Follow-ups: presets, suggestions never written silently, `follow_up_done` note (`src/lib/follow-up.ts`, `follow-up-dialog.tsx`; T6-17)
- [x] 5.7 Profile Facts and Answers (`src/components/profile/facts-tab.tsx`, `answers-tab.tsx`, `src/lib/facts-form.ts`)
- [x] 5.8 Settings (`src/components/settings/settings-page.tsx`)
- [x] 5.9 Polling policies with backoff and stale notice (`src/lib/polling.ts`, `src/hooks/use-polling-query.ts`, `use-board.ts`; TW-POLL)
- [x] 5.10 Conflict UX: auto-merge, Apply mine / Keep theirs, three-way note merge (`src/lib/conflict.ts`, `text-merge.ts`, `src/hooks/use-conflict-write.ts`; TW-CONFLICT)

## 6. Hub

- [x] 6.1 `jobs` in `SERVICES` with status `soon`, `TOOL_IDS`, en/id copy (`apps/home/src/config/services.ts`, `apps/home/src/i18n/locales/{en,id}.json`)
- [x] 6.2 Hub tests: the `soon` jobs card renders and links nowhere (`apps/home/src/components/hub-page.test.tsx`)

## 7. Owner actions and open verification (not executed here)

- [x] 7.1 Handoff recorded (NOT executed — owner action): create the `jobs-pilihpendidikan` Worker and set the `BFF_COOKIE_KEY` secret; deploy `apps/jobs` and the extended `apps/api`
- [x] 7.2 Handoff recorded (NOT executed — owner action): run `migrate-jobs-kv-to-d1.ts` as a dry run against production `JOBS_KV`, review the report, then `--execute`; flip `JOBS_LEGACY_BACKEND` to `d1`; retire `JOBS_KV` after the 30-day grace (06 §12.5)
- [x] 7.3 Handoff recorded (NOT executed — owner action): turn on `JOBS_V1_ENABLED` in the production `DB.feature_flags`
- [x] 7.4 Handoff recorded (NOT executed — owner action): flip `SERVICES.jobs.status` to `live` and redeploy the hub after the Going-live checklist (12 §15 step 5)
- [x] 7.5 Handoff recorded (NOT executed — owner action): M1 exit criteria — Lighthouse accessibility ≥ 95 on Board, the 12 §14 checklist review with `agent-browser` screenshots at 375/1280 in light and Night Desk, and one week of owner dogfood
- [x] 7.6 Handoff recorded (NOT executed here — e2e suite / owner): S-01 (sign-in, no bearer in `document.cookie`) and S-03 (web drag and drop with an illegal move) are automated in `e2e/web.test.ts` against the real api and dashboard (`bun run e2e`; nightly `.github/workflows/e2e.yml`); this change does not claim them passing, the e2e suite's own gate reports the result. T6-07 (keyboard drag and drop via `agent-browser`) stays a manual `agent-browser` check (`e2e/HANDOFF.md`: visual flows are owned by `apps/jobs`)
- [x] 7.7 Handoff recorded (NOT executed — owner action): tell MCP / admin-tooling users about the D-26 admin-bypass removal before the api deploy; the release note is written in `DEPLOY.md` § Release notes
