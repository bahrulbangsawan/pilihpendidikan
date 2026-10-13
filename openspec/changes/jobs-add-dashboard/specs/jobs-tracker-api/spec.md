## ADDED Requirements

### Requirement: Versioned API inside the api Worker
The api Worker SHALL serve the Job Tracker API under `/api/v1/*` from `apps/api/src/jobs/`, authenticating only `Authorization: Bearer` (cookies are ignored on `/api/v1`), and every `/api/v1` route except `GET /api/v1/meta` MUST answer 404 while the `JOBS_V1_ENABLED` flag in `DB.feature_flags` is off. (Source: 05 §1.1, §2; 13 §9; D-01, D-33)

#### Scenario: API dark
- **WHEN** `JOBS_V1_ENABLED` is off and a signed-in caller requests `GET /api/v1/board`
- **THEN** the response is 404, while `GET /api/v1/meta` still answers 200

#### Scenario: Missing bearer
- **WHEN** a request to `/api/v1/me` carries only a session cookie
- **THEN** the response is 401 `invalid_token` with `reason: no_bearer` and a `WWW-Authenticate: Bearer` header

### Requirement: Error envelope
Every `/api/v1` error SHALL be JSON `{error, message, details?, request_id}` with the 05 §1.3 codes and statuses (400 `invalid_request` with `details.issues`, 401 `invalid_token` with `reason`, 403 `insufficient_scope` with `scope`, 404 `not_found`, 409 `revision_conflict` / `idempotency_mismatch` / `duplicate`, 413 `payload_too_large`, 422 `invalid_transition` / `policy_violation`, 426 `cli_upgrade_required`, 429 `rate_limited` with `Retry-After`, 503 `upstream_unavailable`), and every response MUST carry `X-Request-Id`; success responses MUST carry `Cache-Control: private, no-store`. (Source: 05 §1.3)

#### Scenario: Schema failure
- **WHEN** a `PATCH /api/v1/applications/{id}` body has a wrong type
- **THEN** the response is 400 `invalid_request` with the Zod issues in `details.issues` and a `request_id`

#### Scenario: Oversized JSON
- **WHEN** a JSON body larger than 1 MB is sent
- **THEN** the response is 413 `payload_too_large`

### Requirement: Declared scopes
Every `/api/v1` route SHALL declare the scope it needs (05 §1.2), the router MUST answer `403 {"error":"insufficient_scope","scope":"<needed>"}` when the credential lacks it, and credentials MUST map to scopes as follows: browser-session bearers get every scope except `automation:execute`; `write` personal tokens and MCP OAuth tokens get every scope except `automation:execute`, `ai:invoke` and `automation:manage`; `read` personal tokens get `jobs:read cv:read files:read`. (Source: 05 §1.2; D-29)

#### Scenario: Read token writes
- **WHEN** a `read` personal token sends `POST /api/v1/applications/{id}/move`
- **THEN** the response is 403 `insufficient_scope` naming `jobs:write`

#### Scenario: Undeclared route
- **WHEN** a route is added to the table without a scope or an unscoped allow-list entry
- **THEN** the api test suite fails (T11-SCOPES)

### Requirement: CLI version gate and meta
`GET /api/v1/meta` SHALL return `{api_version, min_cli_version, recommended_cli_version, features[]}` without authentication, and any other `/api/v1` request whose `X-Pilih-Client: cli/<semver>` is below `JOBS_MIN_CLI_VERSION` MUST be answered `426 cli_upgrade_required`; `GET /api/v1/me` SHALL return the caller's `user_id`, `email`, `is_admin`, `scopes`, `credential_kind` and bound device. (Source: 05 §1.7, §2; 13 §5 S-32; D-33)

#### Scenario: Old CLI
- **WHEN** a request carries `X-Pilih-Client: cli/0.0.9` and the minimum is `0.1.0`
- **THEN** the response is 426 `cli_upgrade_required`, except for `GET /api/v1/meta`

### Requirement: Rate limits
The router SHALL apply the 05 §1.9 rules by name — `sync-batch` 120/min per device, `task-poll` 30/min per device, `ai-invoke` 60/min per user, `file-upload` 60/hour and 500 MB/day per user, `task-create` 200/day per user — and MUST answer `429 rate_limited` with `Retry-After` when a rule is exceeded. (Source: 05 §1.9)

#### Scenario: Limit exceeded
- **WHEN** a device sends a 31st task poll within one minute
- **THEN** the response is 429 `rate_limited` with a `Retry-After` header

### Requirement: Idempotent writes
`POST`, `PATCH` and `DELETE` routes SHALL accept `Idempotency-Key` (≤ 128 characters, required where the route declares it): a repeat with the same request hash MUST replay the stored status and body with `Idempotent-Replayed: true`, a repeat with a different body MUST answer `409 idempotency_mismatch`, and the key row MUST be stored in the same D1 batch as the mutation. (Source: 05 §1.4; 20)

#### Scenario: Retried move
- **WHEN** the same move request is sent twice with the same `Idempotency-Key`
- **THEN** the second response replays the first with `Idempotent-Replayed: true` and the card moves once

#### Scenario: Reused key, new body
- **WHEN** a key is reused with a different body
- **THEN** the response is 409 `idempotency_mismatch`

### Requirement: Optimistic concurrency
Every mutable record SHALL carry an integer `revision`; updates MUST send `base_revision` in the body or `If-Match`, a stale value MUST be answered `409 revision_conflict` with the full current record in `details.current`, and each write MUST commit its mutation, `change_log` entry and idempotency row in one D1 batch. (Source: 05 §1.6; 06 §2.1; D-21)

#### Scenario: Concurrent moves
- **WHEN** two sessions move the same application with the same `base_revision`
- **THEN** one gets 200 and the other gets 409 with `details.current`

### Requirement: Pagination and ETags
List routes SHALL use keyset pagination with `?limit=` 1–200 (default 50) and an opaque `?cursor=`, answering `{items, next_cursor}` with `next_cursor = null` on the last page, and `GET /api/v1/board` MUST honour `If-None-Match` with `304 Not Modified`. (Source: 05 §1.5, §5; 12 §10)

#### Scenario: Unchanged board
- **WHEN** the dashboard repeats `GET /api/v1/board` with the previous `ETag`
- **THEN** the response is 304 with no body

### Requirement: Board
`GET /api/v1/board` SHALL return the caller's non-archived applications grouped by stage, ordered by `board_rank`, with denormalized card fields (posting summary, latest score, submission status, live task summary), `counts` for the shell, and `cursor` = the latest `change_log.seq`; each of the `rejected` and `withdrawn` lanes MUST be capped at the 200 most recent cards with the rest reachable through `GET /api/v1/applications?stage=…&cursor=`. (Source: 05 §5; 06 §1.3, §1.4)

#### Scenario: Large closed lane
- **WHEN** a user has 250 rejected applications
- **THEN** the board returns the 200 most recent and marks the lane as truncated

### Requirement: Application lifecycle
The API SHALL let a caller track a job (`POST /api/v1/applications`), read the full detail (posting, CV variants, interviews, offers, open approvals, live task), `PATCH` stage, rank, mode, priority, archived, follow-up, base CV and checklist `sections` under `base_revision` (checklists capped at 200 items and 64 KB → `413 payload_too_large`), and archive by default on `DELETE` while `?purge=1` removes the application, its events, interviews, offers, CV variants, files (R2 objects) and tasks, keeps the `user_jobs` row as dismissed, and is refused to MCP callers. Archived applications MUST stay in analytics. (Source: 05 §5; 06 §5, §8; 10 §2)

#### Scenario: Archive
- **WHEN** the owner sends `DELETE /api/v1/applications/{id}` without `purge`
- **THEN** the application is archived, hidden from the board and still counted by analytics

#### Scenario: Purge
- **WHEN** the owner sends `DELETE /api/v1/applications/{id}?purge=1`
- **THEN** the rows and their R2 objects are removed, a `change_log` delete is appended and the `user_jobs` row is kept with `inbox_state = dismissed`

### Requirement: Stage moves and submission confirmation
`POST /api/v1/applications/{id}/move` SHALL validate the stage change against the 03 §5.1 transition table for the actor (422 `invalid_transition` otherwise), compute `board_rank` on the server from `before_id`/`after_id` with column rebalancing past 32 characters, auto-resolve a rank-only conflict when the stage is unchanged, refuse any move of an application whose live task is past `submit_intent` with 422 `details.reason = "submission_in_flight"`, and append `stage_changed` in the same batch; `POST …/submission` SHALL accept `confirm`, `deny` and `mark_applied` (recording `user_attestation` evidence). (Source: 05 §5; 06 §1.2, §2, §3; 03 §5.1; D-18)

#### Scenario: Rank-only conflict
- **WHEN** a reorder within one column carries a stale `base_revision` and the stage did not change
- **THEN** the server recomputes the rank against the current neighbours and answers 200

#### Scenario: Submission in flight
- **WHEN** the user moves a card whose live apply task has `submit_intent_at` set
- **THEN** the response is 422 `invalid_transition` with `details.reason = "submission_in_flight"`

### Requirement: Timeline, interviews and offers
The API SHALL page `application_events` (`GET …/events?cursor`), accept note events (`note_added`, and `note_deleted` that hides a note without removing it), and provide CRUD for interviews and offers where, unless `move_application: false` is sent, creating the first interview moves `applied → interviewing`, recording an offer moves `applied`/`interviewing → offer` and marking an offer accepted moves `offer → accepted`; an interview outcome `failed` MUST NOT reject the application, and `GET …/interviews/{ivw_id}.ics` SHALL export one VEVENT without attendee emails. (Source: 05 §5; 06 §3, §4, §6)

#### Scenario: First interview
- **WHEN** an interview is created for an `applied` application without `move_application: false`
- **THEN** the application moves to `interviewing` and the response includes the updated application

#### Scenario: Calendar export
- **WHEN** the owner requests the `.ics` of an interview
- **THEN** the response is a `text/calendar` document with one VEVENT and no attendee email addresses

### Requirement: Profile facts and answers
The API SHALL provide `GET/PUT /api/v1/profile/facts` (bulk upsert with per-fact `base_revision`, canonical keys), `POST /api/v1/profile/facts:import-cv` (proposals for review, `source = cv_import`) and CRUD on `/api/v1/profile/answers`, and MUST reject an answer that is both `protected` and auto-use `always` with `422 policy_violation`. (Source: 05 §10; 03 §9; 11 §4)

#### Scenario: Protected and always
- **WHEN** an answer is saved with sensitivity `protected` and auto-use `always`
- **THEN** the response is 422 `policy_violation`

### Requirement: Settings
`GET/PATCH /api/v1/settings` SHALL read and update the lazily created `user_settings` row under `base_revision`; turning on `automation_paused` MUST make running workers pause at their next heartbeat and stop new apply claims, and a timezone change MUST queue an analytics rebuild. (Source: 05 §10a; 04 §2.7; 10 §5)

#### Scenario: First read
- **WHEN** a new user reads `/api/v1/settings`
- **THEN** a row with the 04 §2.7 defaults is created and returned with `revision`

### Requirement: Account export and deletion
`POST /api/v1/account/export` and `POST /api/v1/account/delete` SHALL be available only to browser-session credentials: export MUST build an asynchronous zip of the user's data and email a link valid 24 h, and deletion MUST start only after an emailed one-time confirmation, then revoke grants, devices and tokens, delete the user's `JOBS_DB` rows and R2 objects and tombstone the user. (Source: 05 §10a; 11 §10; 13 §5 S-33)

#### Scenario: Export from a personal token
- **WHEN** a `write` personal token calls `POST /api/v1/account/export`
- **THEN** the request is refused and no export starts

#### Scenario: Confirmed deletion
- **WHEN** the user confirms the emailed deletion link
- **THEN** the purge runs and the user's grants are revoked and Job Tracker rows and files are gone

### Requirement: Tenant isolation
Only `apps/api/src/jobs/repo/**` SHALL access `JOBS_DB`, every statement on a user-scoped table MUST carry a `user_id` predicate, a missing or not-owned record MUST be answered 404 for every caller including admins (no admin bypass on Job Tracker data), and the S-31 sweep MUST call every route of `listRouteTable()` and every MCP `jobs_*` tool as another user and as an admin and fail when a route has no sweep case. (Source: 11 §6, §13; 13 §5 S-31; D-26)

#### Scenario: Other user's id
- **WHEN** user B requests `GET /api/v1/applications/<A's app id>`
- **THEN** the response is 404 `not_found`, also when B is an admin

#### Scenario: New route without a sweep case
- **WHEN** a route is added to the route table without an isolation-sweep case
- **THEN** `src/jobs/isolation-sweep.test.ts` fails
