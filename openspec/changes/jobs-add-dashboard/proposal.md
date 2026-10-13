# Change: Add the Job Tracker dashboard (`apps/jobs`), the `/api/v1` tracker API and the legacy jobs facade

## Why

The workspace has a headless jobs tracker only: KV blobs behind `/api/jobs`
and nine MCP `jobs_*` tools, with no revisions, no queries, an email-keyed
owner stamp, an admin bypass and a 1,000-key list cap (job-tracker-spec 00 §3,
06 §12.1). Milestone M1 (13 §2) gives users a primary interface — a Kanban
board with application detail, timeline, interviews, offers, checklists,
facts, answers and settings — on a real `/api/v1` API over `JOBS_DB`, and
keeps every legacy REST and MCP client working through a compatibility facade
(D-04).

## What Changes

- New app `apps/jobs` (TanStack Start SSR on Workers, Worker
  `jobs-pilihpendidikan`, dev port **4007**, `jobs.pilihpendidikan.com`):
  BFF session (D-15) with the bearer sealed in `__Host-jobs-session`
  (AES-256-GCM under `BFF_COOKIE_KEY`), magic-link sign-in through
  `/auth/request` + `/auth/exchange`, edge policy (CSP nonce, CSRF Origin
  gate on server functions, noindex, `private, no-store`), locale by setting
  and `jobs-lang` cookie with no `/id/*` tree (D-27), Zedative only (D-24),
  global chrome (nav band, sidebar, ⌘K palette, shortcut sheet), Board
  (columns, Closed lane, DnD with pointer/touch/keyboard sensors, `M` stage
  picker, phone stage switcher, bulk actions, follow-ups), Application detail
  (header, Next-step rail, Overview, Timeline, Interviews, Offers,
  Checklists, Notes), Profile (Facts, Answers) and Settings; the 12 §10
  polling policies and the 12 §11 conflict UX.
- New `/api/v1` kernel in `apps/api/src/jobs/` (D-01): bearer-only auth,
  the 05 §1.3 error envelope, `JOBS_V1_ENABLED` (D-33), the 426 CLI version
  gate, declared scopes (05 §1.2), the 05 §1.9 rate limits, `Idempotency-Key`
  replay, `base_revision` / `If-Match` with `409 revision_conflict` (D-21),
  keyset pagination, ETag/304, `GET /api/v1/meta` and `/api/v1/me`.
- New tracker routes: board, applications (track, detail, patch, move,
  submission, archive, purge), events (notes, `note_deleted`), interviews
  (with `.ics`), offers, profile facts and answers, settings, account export
  and deletion; the S-31 cross-user isolation sweep over every route.
- **BREAKING (D-26)**: `/api/jobs` and the MCP `jobs_*` tools give admins no
  bypass; `?mine=0` is ignored for jobs. Break-glass support access is the
  logged, read-only `scripts/support-access.ts`.
- Legacy facade (06 §12.6, 05 §14): `/api/jobs` and the MCP `jobs_*` tools
  served from `JOBS_KV` or `JOBS_DB` by `JOBS_LEGACY_BACKEND` (`kv` | `d1`),
  with the P3 KV fallback, the 5 s stale guard, `Invalid status` 422, full
  pagination beyond 1,000, `follow_up_at`, public-posting forks, and seven
  new MCP tools (`jobs_board`, `jobs_move`, `jobs_note_add`,
  `jobs_interview_add`, `jobs_offer_add`, `jobs_approvals_list`,
  `jobs_approval_decide`). The gated KV → D1 migration script ships with it.
- CORS and the magic-link `returnTo` allowlist gain the jobs origin
  (`https://jobs.pilihpendidikan.com`, `http://localhost:4007` while the
  Worker runs locally).
- Hub: `jobs` added to `SERVICES` with status `soon` (12 §15).

## Impact

- Affected specs: `jobs-dashboard` (new), `jobs-tracker-api` (new),
  `api-backend` (MODIFIED: CORS, Document storage and ownership, MCP server;
  ADDED: legacy jobs facade; the gated KV → D1 migration script and the
  break-glass support access are specified in `api-add-user-ids-and-jobs-db`),
  `home-hub` (MODIFIED: Service status config; ADDED: Job tracker
  card).
- Affected code: `apps/jobs/**`; `apps/api/src/jobs/{core,repo/core,routes,services,repo}/{meta,applications,profile,account}`,
  `apps/api/src/jobs/legacy/**`, `apps/api/src/jobs/repo/legacy/**`,
  `apps/api/src/documents/jobs.ts`, `apps/api/src/tools/jobs*.ts`,
  `apps/api/src/mcp-tools.ts`, `apps/api/src/origins.ts`,
  `apps/api/src/rate-limit.ts`, `apps/api/scripts/migrate-jobs-kv-to-d1.ts`,
  `apps/api/scripts/support-access.ts`, `apps/home/src/config/services.ts`,
  `apps/home/src/i18n/locales/{en,id}.json`, `scripts/lint-typography.sh`
  and the parity scripts (lint roots).
- Depends on: `jobs-add-contracts-and-schema` (contracts),
  `api-add-user-ids-and-jobs-db` (users, `JOBS_DB`, flags), and the
  `update-zedative-design-system` change (A-08).
- Sources: job-tracker-spec 05 §1–§2, §5, §10, §10a, §14; 06 (all); 10 §2
  (archived stays in analytics); 11 §4.1, §6, §10; 12 §1–§3, §5, §9 (Profile,
  Settings), §10–§15; 13 §2 M1, §5 S-01–S-03, S-31; decisions D-01, D-04,
  D-15, D-21, D-24, D-26, D-27, D-33; assumption A-08.
- Status: implemented in the working tree; **uncommitted and undeployed**.
  Creating the Worker, the `BFF_COOKIE_KEY` secret, the production
  migration and flipping the hub entry to `live` are owner actions (see
  `tasks.md` §7).
