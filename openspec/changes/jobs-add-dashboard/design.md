## Context

The Job Tracker (job-tracker-spec 00–22) needs a primary web UI and a typed
API before the CLI, scoring or automation can build on it (13 §1 "cloud
first, then local"). `apps/api` already authenticates users, mints bearers
and serves the legacy KV jobs tracker to REST and MCP clients. This change
adds `apps/jobs`, the `/api/v1` kernel with the tracker routes it needs in
M1, and moves the legacy surface onto `JOBS_DB` without breaking it.

Stakeholders: the owner (deploys, migration go-ahead), existing MCP clients
of `jobs_*`, admin tooling that relied on `?mine=0`.

## Goals / Non-Goals

- Goals:
  - A dashboard that never exposes the API bearer to browser JavaScript.
  - One `/api/v1` kernel every later area (discovery, scoring, CV, automation,
    email, analytics) plugs into with a declared scope and an isolation case.
  - Byte-compatible legacy REST and MCP behaviour served from D1, with a
    reversible flag.
- Non-Goals:
  - Inbox, Sources, `/cli` (jobs-add-cli), CV tab and `/render` (jobs-add-cv-variants),
    Apply/automation screens (jobs-add-browser-agent), email composer
    (jobs-add-email-applications), Stats (jobs-add-analytics) — the shell
    links them, their changes specify them.
  - WebSockets (D-11), reminder emails (06 §7), server-side bulk application
    endpoint (06 §9).

## Decisions

- **D-15 BFF session.** TanStack Start server functions hold the bearer in a
  sealed `HttpOnly` `__Host-jobs-session` cookie (AES-256-GCM, key =
  SHA-256(`BFF_COOKIE_KEY`), AAD = version + cookie name) and call
  `apps/api` through the `API` service binding. Every API call is the single
  `bffRequest` server function keyed by `WEB_ROUTE_KEYS`; params, query and
  body are validated against `API_ROUTE_SCHEMAS` before the call, and the
  bearer is scrubbed from every answer. Rejected: bearer in `localStorage`
  (the builders' pattern) for an app that can trigger submissions.
- **CSRF in two layers.** The Worker edge refuses any server-function POST
  whose `Origin` is not the app origin; TanStack's CSRF middleware is the
  second line (11 §4.1).
- **D-27 locale.** `jobs-lang` cookie, then `Accept-Language`; `/id` only
  sets `id` and redirects to `/board`.
- **D-24 Zedative.** `apps/jobs/src/styles.css` imports the shared theme and
  defines no tokens; `apps/jobs/src` is a typography-lint and parity root.
- **D-01 kernel inside `apps/api`.** Dispatch order: auth (bearer only, cookies
  ignored) → `JOBS_V1_ENABLED` → CLI 426 gate → scope → device → presence →
  rate limit → body ≤ 1 MB → idempotency → validation → handler. Routes are
  declared with `fromContract("<METHOD> <05 path>")` so scopes and schemas
  come from `packages/jobs-contracts`.
- **D-21 optimistic concurrency + one batch per write.** Mutation,
  `change_log` and the idempotency row are committed in one D1 `batch()`
  (`c.commit`). Rank-only move conflicts auto-resolve; stage conflicts 409.
- **Ranks are server-computed** (06 §1.2): clients send `before_id` /
  `after_id`; the server rebalances a column past 32 characters.
- **D-26 no admin bypass on jobs.** `JOBS_DB` access goes only through
  `repo/**` with a `user_id` predicate (T11-SQL, T11-JOBSDB); not owned = 404
  for everyone. Support uses `scripts/support-access.ts` (read-only, ticket
  id, `support_access_log`).
- **D-04 legacy facade behind a flag.** `JOBS_LEGACY_BACKEND` (`kv` default,
  `d1`) in `DB.feature_flags` (D-33) selects the backend per call, so the
  cut-over and its rollback are flag flips (06 §12.5).

### Divergences from the spec text (code wins; recorded here)

- 06 §1.4 says the web pulls `GET /api/v1/changes` between board refetches;
  the dashboard instead refetches `GET /api/v1/board` every 15 s with
  `If-None-Match`, so an unchanged board costs a 304 (`src/hooks/use-board.ts`).
- 12 §11 names diff-match-patch for notes; the code uses a hand-rolled
  token-level three-way merge (`src/lib/text-merge.ts`) that falls back to a
  side-by-side dialog, with no new dependency.
- 12 §1 lists `@source` for `@rulisme/ui/dist`; per the repo convention the
  app compiles `@rulisme/ui` from source.
- On plain-http localhost the session cookie is `jobs-session` (browsers
  refuse `__Host-` without `Secure`).
- The MCP surface is 89 tools (cv 30, invoice 22, portfolio 19, jobs 18) with
  18 read-only tools; the earlier `api-add-backend-worker` record said 82 / 16.

## Risks / Trade-offs

- MCP clients and admin tooling that used the admin bypass break (D-26) →
  release note; break-glass script.
- `change_log` write amplification on rebalances → measured; rebalances are
  rare (32-character threshold).
- The KV fixed-window limiter is non-atomic (05 §1.9) → acceptable for abuse
  damping; budgets that must be exact live in D1.
- The legacy facade's status view is lossy (`preparing`/`ready` → `saved`,
  `withdrawn` → `rejected`) → documented in the MCP tool descriptions.

## Migration Plan

1. Owner: create `pilihpendidikan-jobs`, apply migrations remotely, deploy
   `apps/api` with `JOBS_V1_ENABLED` and `JOBS_LEGACY_BACKEND=kv` (P0).
2. Owner: run `migrate-jobs-kv-to-d1.ts` as a dry run against production,
   review the report, then `--execute` (P1, nightly re-runs are idempotent).
3. Owner: flip `JOBS_LEGACY_BACKEND=d1` (P2); keep the KV fallback 30 days (P3);
   archive and unbind `JOBS_KV` only after zero fallbacks (P4).
4. Owner: deploy `apps/jobs` with `BFF_COOKIE_KEY`; hub stays `soon` until
   the Going-live checklist passes.

Archive order: the MODIFIED `api-backend` and `home-hub` requirements copy
their targets from the unarchived `api-add-backend-worker` and
`home-add-hub-landing-page` changes; archive those first so the targets exist
in `openspec/specs/` (the validator notes this as INFO today).

Rollback: flag back to `kv` (KV is untouched by the migration); D1 Time
Travel restore to the bookmark the script prints before `--execute`.

## Open Questions

- A-08: the Zedative change must land before the dashboard ships (it is
  complete in the working tree; it is not yet archived).
- A-09: the account export/deletion design is subject to the UU PDP / GDPR
  legal review (release gate G6).
