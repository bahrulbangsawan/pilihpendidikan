## ADDED Requirements

### Requirement: Dashboard app and platform
The system SHALL provide `apps/jobs`, a TanStack Start (SSR) app on Cloudflare Workers deployed as Worker `jobs-pilihpendidikan` on `jobs.pilihpendidikan.com`, served on dev port 4007, typed against `@pilihpendidikan/jobs-contracts` and calling `apps/api` only server-side through the `API` service binding. (Source: 12 §1; 00 §7; D-15, D-20)

#### Scenario: Local development
- **WHEN** a developer runs `bun run dev` in `apps/jobs`
- **THEN** the dashboard is served on `http://localhost:4007`

#### Scenario: Production binding
- **WHEN** the Worker is built from `apps/jobs/wrangler.jsonc`
- **THEN** it is bound to the custom domain `jobs.pilihpendidikan.com` and to the `api-pilihpendidikan` service as `API`

### Requirement: BFF session cookie
The dashboard MUST keep the API bearer only server-side, sealed in an `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` cookie named `__Host-jobs-session` (`jobs-session` on plain-http localhost) with AES-256-GCM under a key derived from the `BFF_COOKIE_KEY` secret, and MUST treat a tampered, expired or foreign cookie as signed out and clear it. (Source: 12 §1; 11 §4.1; D-15)

#### Scenario: Bearer never reaches JavaScript
- **WHEN** a signed-in page is rendered and any server function answers
- **THEN** neither the HTML, the dehydrated state nor any server-function result contains the bearer, and `document.cookie` cannot read the session cookie

#### Scenario: Tampered cookie
- **WHEN** a request carries a session cookie whose ciphertext was altered
- **THEN** the request is treated as signed out and the cookie is cleared

#### Scenario: API rejects the bearer
- **WHEN** a proxied API call answers 401
- **THEN** the BFF clears the session cookie and the client returns to the sign-in band

### Requirement: Single proxied API entry point
Every dashboard call to `/api/v1` SHALL go through the one `bffRequest` server function keyed by a route of `WEB_ROUTE_KEYS`, which MUST validate path params (plain ids only), query and body against `API_ROUTE_SCHEMAS` before calling the API, attach `Authorization: Bearer` server-side and scrub the bearer from whatever it returns; device-bound, `automation:execute`, `ai:invoke` and `discovery:write` routes MUST NOT be web routes. (Source: 12 §1; 11 §4.1; D-15)

#### Scenario: Invalid body never leaves the BFF
- **WHEN** the client asks `bffRequest` to call a route with a body that fails the route's contract schema
- **THEN** the BFF answers with a validation error and makes no API request

#### Scenario: Route exhaustiveness
- **WHEN** a contract route is neither in `WEB_ROUTE_KEYS` nor in `NON_WEB_ROUTE_KEYS`
- **THEN** the `apps/jobs` test suite fails

### Requirement: Magic-link sign-in
A signed-out visitor SHALL see a sign-in band with an email field; submitting it MUST call `POST /auth/request` with `returnTo` set to the dashboard origin, show a "check your inbox" state, and on return with `?code=` the BFF MUST call `/auth/exchange`, set the session cookie and redirect to `/board`. Sign-out MUST call `/auth/logout` with the bearer and then clear the cookie. (Source: 12 §1.1; 05 §1.8)

#### Scenario: Completing sign-in
- **WHEN** the user opens `/?code=<one-time code>` from the emailed link
- **THEN** the BFF exchanges the code, sets `__Host-jobs-session` and redirects to `/board`

#### Scenario: Signed-out board request
- **WHEN** a visitor without a session opens `/board`
- **THEN** the sign-in band is shown instead of the board

### Requirement: Edge security policy
Every dashboard response SHALL carry a per-response CSP nonce with `frame-ancestors 'none'` (except responses explicitly marked frameable for same-origin PDF previews), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store` on HTML, and the edge MUST refuse any server-function POST whose `Origin` is not the dashboard origin. (Source: 12 §1; 11 §4.1)

#### Scenario: Cross-site server-function call
- **WHEN** a POST to a server function arrives with `Origin: https://evil.example`
- **THEN** the edge refuses it with 403 before the handler runs

#### Scenario: Page headers
- **WHEN** `/board` is served
- **THEN** the response carries the CSP with a fresh nonce, `noindex` and `private, no-store`

### Requirement: Untrusted text rendering
The dashboard MUST render untrusted text (postings, notes, interview locations, scraped content) as plain text or the Markdown-lite renderer only, MUST NOT use `dangerouslySetInnerHTML`, and MUST emit links only for `http`, `https` and `mailto` URLs with `rel="noopener noreferrer"`. (Source: 11 §4.1; 06 §5; 12 §5.1)

#### Scenario: Script in a note
- **WHEN** a note contains `<script>alert(1)</script>` or a `javascript:` link
- **THEN** it is shown as text and no script or `javascript:` href is rendered

### Requirement: Locale without a route tree
The dashboard SHALL choose its language (`en` | `id`) from the `jobs-lang` cookie, else `Accept-Language`, SHALL keep the choice in that cookie and the user's settings, SHALL have no `/id/*` route tree, and `/id` MUST only set `id` and redirect to `/board`; both catalogues MUST have the same keys. (Source: 12 §1.2, §13; D-27)

#### Scenario: Link from the Indonesian hub
- **WHEN** a visitor opens `/id`
- **THEN** the `jobs-lang=id` cookie is set and the response redirects to `/board`

#### Scenario: Catalogue drift
- **WHEN** a key exists in `en.json` but not in `id.json`, or a static `t("…")` key is missing
- **THEN** the `apps/jobs` i18n test fails

### Requirement: Zedative design compliance
The dashboard SHALL use only the shared Zedative theme and `@rulisme/ui` components: `apps/jobs/src/styles.css` MUST import `@rulisme/ui/styles/theme.css` and define no tokens, `apps/jobs/src` MUST be covered by `lint:typography` and the typography parity checks, light MUST be the default with Night Desk as a toggle, and every primary action MUST pair a `<Kbd>` hint with a registered `useShortcut`. (Source: 12 §1, §14; D-24)

#### Scenario: Token defined in the app
- **WHEN** `apps/jobs/src/styles.css` declares a token of its own
- **THEN** `bun run parity:typography` fails

#### Scenario: Hint without a handler
- **WHEN** a component renders a `<Kbd>` hint for a key that no `useShortcut` registers
- **THEN** the `TW-SHORTCUTS` test fails

### Requirement: Global chrome and shortcuts
The signed-in shell SHALL show a nav band (wordmark, primary links, ⌘K command palette, device status chip, the one primary **New** button with `N`), a sidebar with counters from `GET /api/v1/board` `counts` that collapses to a sheet on phones, a `?` shortcut sheet, and the single-key shortcuts `B`/`I`/`A`/`R`, `N`, `/`, `J`/`K`, `Enter`, `M`, `?`, `Esc` that are ignored while focus is in an editable field. (Source: 12 §2.1, §2.2)

#### Scenario: Shortcut in a text field
- **WHEN** focus is in a text input and the user types `B`
- **THEN** the character is typed and no navigation happens

#### Scenario: New job by URL
- **WHEN** the user presses `N` on any signed-in screen
- **THEN** the New-by-URL dialog opens

### Requirement: Kanban board
The `/board` screen SHALL show one column per stage `saved, preparing, ready, applied, interviewing, offer, accepted` plus a collapsed Closed lane for `rejected` and `withdrawn`, ordered by the server's `board_rank`, with cards showing company, title, location, score, source, mode, CV state, submission, live-task, posting-closed and follow-up markers; archived applications MUST be hidden unless "Show archived" is on, and status MUST never be conveyed by colour alone. (Source: 06 §1.1, §1.3; 12 §3, §12)

#### Scenario: Empty board
- **WHEN** the user has no applications
- **THEN** the Saved column shows the empty panel with Inbox `I` and New `N` actions

#### Scenario: Unconfirmed submission badge
- **WHEN** a card's `submission_status` is `submitted_unverified`
- **THEN** the card shows the text badge "Unconfirmed", never "Submitted"

### Requirement: Moving cards
The board SHALL move cards by pointer, touch and keyboard (dnd-kit sensors; Space to lift, arrows to move, Space to drop, Esc to cancel) and by the `M` stage picker, MUST validate each move locally with the contracts' `canTransition(from, to, "user")` before sending `POST /api/v1/applications/{id}/move` with `base_revision`, `before_id`/`after_id` and one `Idempotency-Key` per intent, MUST update optimistically, retry network errors with the same key (1 s, 2 s, 4 s), roll back on 409, 422 or give-up, ask the 06 §2.2 confirmation questions, and announce moves in an `aria-live="assertive"` region. (Source: 06 §2, §10; 12 §3, §12; D-21)

#### Scenario: Illegal move
- **WHEN** the user drops an Applied card on Preparing
- **THEN** no request is sent, the card snaps back and the caption "Can't move from Applied to Preparing" is shown

#### Scenario: Network failure
- **WHEN** the move request fails with a network error three times
- **THEN** every retry reused the same `Idempotency-Key` and the card rolls back with a toast

#### Scenario: Move to Applied without a submission
- **WHEN** a card with `submission_status = not_started` is dropped on Applied
- **THEN** the "Did you submit this application?" dialog offers "Yes, I applied" (`mark_applied`) or "Just move it"

### Requirement: Phone board and bulk actions
Below 640 px the board SHALL become a stage switcher with a vertical card list and no drag-and-drop (moves via `M` / the Move menu); multi-select (Shift/Cmd-click or `x`) SHALL run bulk actions as per-card requests with concurrency 4, each with its own `base_revision` and `Idempotency-Key`, and report per-card success, skips and conflicts. (Source: 06 §9; 12 §3)

#### Scenario: Mixed bulk move
- **WHEN** the user bulk-moves three cards where one transition is illegal and one is stale
- **THEN** one card moves, the illegal one is skipped and the stale one is reported as a conflict

### Requirement: Application detail
`/applications/$appId` SHALL show a header (company, title, stage and mode selects), a Next-step rail with exactly one recommended action as the page's only primary button, and the tabs Overview (description, requirements, salary, notes with autosave under `base_revision`, follow-up), Timeline (`application_events` newest first, 50 per page, actor chips, conflict events with `applied_to_state = 0` in destructive style), Interviews, Offers and Checklists (the legacy `sections` JSON), where deleting a note appends `note_deleted`. (Source: 06 §4, §5, §6; 12 §5.1)

#### Scenario: Conflict event in the timeline
- **WHEN** the timeline contains a `stage_changed` event with `applied_to_state = 0`
- **THEN** it is rendered in the destructive style with the "Not applied" explanation

#### Scenario: Deleting a note
- **WHEN** the user deletes a note
- **THEN** a `note_deleted` event is appended and the original is hidden from the default view

### Requirement: Follow-ups
The dashboard SHALL let the user set `follow_up_at` manually (presets 3 days, 1 week, 2 weeks), SHALL only suggest follow-ups (after applied +7 d, after an interview +3 d, before an offer deadline −48 h) and MUST NOT write a suggestion without the user's acceptance; completing a follow-up MUST clear `follow_up_at` and add a `note_added` event with `payload.kind = "follow_up_done"`. (Source: 06 §7)

#### Scenario: Suggestion not accepted
- **WHEN** an application reaches Applied and the user ignores the suggested follow-up
- **THEN** `follow_up_at` stays unchanged

### Requirement: Profile facts and answers
`/profile` SHALL provide a Facts tab (grouped form with a source chip per fact, saved with per-fact `base_revision`) and an Answers tab whose sensitivity select defaults to `protected` for known protected keys and disables "Always" for protected answers. (Source: 12 §9; 05 §10; 11 §4)

#### Scenario: Protected answer
- **WHEN** the user creates an answer for a protected key
- **THEN** the sensitivity defaults to `protected` and the "Always" auto-use option is disabled

### Requirement: Settings
`/settings` SHALL let the user see the account email and sign out, set the AI consent switch, evidence retention, `allow_mcp_approvals` (default off), the default application mode, locale and theme, and SHALL place Export data and Delete account in a destructive band at the bottom. (Source: 12 §9; 05 §10a; 11 §10)

#### Scenario: Changing locale
- **WHEN** the user switches the language to Indonesian in Settings
- **THEN** the setting is saved and the `jobs-lang` cookie is set to `id`

### Requirement: Polling
The dashboard SHALL poll without WebSockets using these intervals: board 15 s (paused when hidden), application detail 15 s and 2 s while a task is live (10 s hidden), with 2× backoff per failure up to 60 s, and after three consecutive failures MUST show the stale notice "Offline — showing data from …"; the board query MUST send `If-None-Match` so an unchanged board costs a 304. (Source: 12 §10; 06 §1.4; D-11)

#### Scenario: Hidden tab
- **WHEN** the board tab is hidden
- **THEN** board polling pauses until the tab is visible again

#### Scenario: Repeated failures
- **WHEN** three polls in a row fail
- **THEN** the toolbar shows the stale-data caption with the time of the last good data

### Requirement: Revision conflict handling
On `409 revision_conflict` the dashboard SHALL use `details.current`: non-overlapping changes MUST auto-merge and re-send once with the new revision and a toast naming the other source; overlapping changes MUST NOT auto-retry, MUST revert the optimistic update and MUST offer "Apply mine anyway" and "Keep theirs"; notes MUST be three-way merged when possible, else both versions are shown. (Source: 12 §11; D-21)

#### Scenario: Both changed the stage
- **WHEN** the user's stage change conflicts with a stage change made by the CLI
- **THEN** nothing is re-sent automatically and the toast offers "Apply mine anyway" and "Keep theirs"

#### Scenario: Notes edited while the CLI moved the card
- **WHEN** the user's notes edit conflicts only with a stage change
- **THEN** the notes are re-sent once with the new revision and a merge toast is shown
