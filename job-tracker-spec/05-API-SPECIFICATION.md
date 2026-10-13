# 05 — API Specification (`apps/api`, `/api/v1/*`)

**[DECISION D-01]** The Job Tracker API is added to the existing Worker
`api-pilihpendidikan` (`https://api.pilihpendidikan.com`, dev
`http://localhost:8788`). It reuses the existing router (`apps/api/src/app.ts`),
caller resolution (`src/auth.ts`), CORS (`src/cors.ts`), rate limiting
(`src/rate-limit.ts`) and HTML page helper. New code lives under
`apps/api/src/jobs/` (`routes/`, `repo/`, `services/`, `ai/`, `queue/`).

All request/response bodies are defined as Zod schemas in
`packages/jobs-contracts` (D-20); this document is the normative prose.

---

## 1. Conventions

### 1.1 Authentication

| Client | Credential | How |
|---|---|---|
| `apps/jobs` (web) | Browser session bearer held by the BFF | Server-to-server via service binding, `Authorization: Bearer` (D-15) |
| `pilih-jobs` CLI | OAuth access token (1 h) bound to a device | `Authorization: Bearer` (17) |
| MCP clients | Existing OAuth (MCP) or personal tokens | Existing `/mcp`; jobs tools proxied to the same services |
| Scripts | Personal token (`/connect`) | Read-only routes only unless the token has `write` (legacy scope map, §1.2) |

**[VERIFIED]** 401 responses carry `WWW-Authenticate: Bearer error="invalid_token"`
(`apps/api/src/http.ts:18-26`). New routes keep that.

### 1.2 Scopes

**[NEW]** OAuth scopes (space-delimited in tokens; 17 §5):

| Scope | Grants |
|---|---|
| `jobs:read` | Read postings (via own tracked jobs), applications, events, scores, rules, runs, analytics |
| `jobs:write` | Create/update tracked jobs, applications, notes, interviews, offers, sources, rules (non-auto), facts, answers |
| `discovery:write` | Submit discovery runs and posting batches |
| `automation:execute` | Claim tasks, heartbeat, report progress/results/evidence (device-bound tokens only) |
| `automation:manage` | Create/cancel tasks, decide approvals, enable `auto` rules (web and interactive CLI) |
| `cv:read` / `cv:write` | Read base CVs / create tailored CV variants |
| `files:read` / `files:write` | Download / upload files in R2 |
| `ai:invoke` | AI proxy endpoints (`/api/v1/ai/*`) |
| `devices:manage` | List/rename/revoke devices |
| `offline_access` | Receive a refresh token |

Legacy credential mapping:
- **Browser-session bearers** (the `apps/jobs` BFF and the other apps) ⇒ all
  scopes **except** `automation:execute` (device-bound only). They include
  `ai:invoke`, because the web triggers CV tailoring and scoring.
- **`write` personal tokens** ⇒ all scopes except `automation:execute`,
  `ai:invoke` (no AI spend from long-lived tokens) and `automation:manage`.
- **`read` personal tokens** ⇒ `jobs:read cv:read files:read`.
- **MCP OAuth tokens** (`allowed_scopes = 'mcp'`, 17 §3.2) ⇒ same as `write`
  personal tokens.

CLI tokens carry the base set from 17 §5.1; `automation:manage` and
`devices:manage` are step-up scopes (D-29).

Every handler declares its scope; missing scope ⇒ `403 {"error":"insufficient_scope","scope":"<needed>"}`
(matches the existing `insufficientScope()` shape, `apps/api/src/http.ts:28-38`).

### 1.3 Errors

```json
{ "error": "revision_conflict", "message": "Application changed since revision 7", "details": { "current": { … } }, "request_id": "…" }
```

| HTTP | `error` | When |
|---|---|---|
| 400 | `invalid_request` | Malformed JSON / schema failure (`details.issues` = Zod issues) |
| 401 | `invalid_token` (`reason`: `no_bearer`, `unknown_token`, `expired_token`, `revoked_token`) | Auth failure |
| 403 | `insufficient_scope`, `device_revoked`, `device_not_accepting_tasks`, `device_required` | Authorization failure. A revoked device's own tokens are revoked with it, so the CLI sees **`401 invalid_token` (`reason: revoked_token`)**; `403 device_revoked` is only returned when another valid credential (e.g. the web session) addresses a revoked device. `device_required`: route needs a device-bound token |
| 404 | `not_found` | Missing **or not owned** (ids never leak; matches jobs/MCP behaviour today) |
| 409 | `revision_conflict`, `lease_lost`, `idempotency_mismatch`, `duplicate`, `too_late` | Concurrency (`too_late`: cancel/release after `submit_intent`) |
| 410 | `approval_expired`, `task_expired`, `cursor_expired` | Expired resources |
| 413 | `payload_too_large` | Body > limit (1 MB JSON, 25 MB file) |
| 422 | `invalid_transition`, `policy_violation`, `unsupported_source`, `mode_not_allowed` | Domain rule failure |
| 426 | `cli_upgrade_required` | CLI below minimum version (§1.7) |
| 429 | `rate_limited` (`Retry-After`), `ai_budget_exhausted` | Limits; AI budget (D-34) |
| 503 | `upstream_unavailable` (AI provider) | Retryable |

### 1.4 Idempotency

All `POST`/`PATCH`/`DELETE` routes accept `Idempotency-Key: <≤ 128 chars>`;
it is **required** for CLI calls (outbox entries), for
`POST /api/v1/devices/{dev_id}/tasks:claim` and for every
`/api/v1/tasks/{tsk_id}/lease/{lease_id}/*` call. Semantics:

1. Lookup `(user_id, key)` in `idempotency_keys`.
2. Found with same `request_hash` ⇒ replay stored status + body, header `Idempotent-Replayed: true`.
3. Found with different hash ⇒ `409 idempotency_mismatch`.
4. Not found ⇒ execute; store result in the **same `batch()`** as the mutation.

### 1.5 Pagination and cursors

List endpoints: `?limit=` (1–200, default 50) and `?cursor=` (opaque base64url
of the last sort key). Response: `{ "items": [...], "next_cursor": "…" | null }`.

### 1.6 Revisions

Mutable resources return `revision`. Updates **must** send `base_revision` in
the body (or `If-Match: "<revision>"`). Mismatch ⇒ `409 revision_conflict`
with `details.current` (full current resource) so clients can merge.

### 1.7 Versioning and compatibility

- Path version `/api/v1`. Additive changes only within v1.
- CLI sends `User-Agent: pilih-jobs/<semver> (<os>; <arch>) python/<ver> playwright/<ver> scrapling/<ver>`
  and `X-Pilih-Client: cli/<semver>`.
- `GET /api/v1/meta` returns `{api_version, min_cli_version, recommended_cli_version, features[]}`;
  requests from a CLI below `min_cli_version` get `426 cli_upgrade_required`
  (except `/meta`, `/oauth/*`, logout and revocation).

### 1.8 CORS

**[NEW]** Add `https://jobs.pilihpendidikan.com` (and `http://localhost:4007`
while the Worker itself runs on localhost) to `APP_ORIGINS` / `DEV_APP_ORIGINS`
in `apps/api/src/origins.ts`, and `"jobs"` to `DocumentKind`. The BFF calls the
API server-to-server, but the origin is still needed for the magic-link
`returnTo` allowlist (`apps/api/src/sign-in.ts:48-57`). The CLI is not a
browser; CORS does not apply.

### 1.9 Rate limits (new rules in `src/rate-limit.ts`)

| Rule | Limit | Scope |
|---|---|---|
| `sync-batch` | 120 / min | per device |
| `task-poll` | 30 / min | per device |
| `ai-invoke` | 60 / min, plus daily AI budget (14 §9.4) | per user |
| `file-upload` | 60 / hour, 500 MB / day | per user |
| `task-create` | 200 / day | per user |

**[LIMITATION]** The existing limiter is a non-atomic KV fixed window
([VERIFIED] `apps/api/src/rate-limit.ts`). Acceptable for abuse damping; the
AI budget is enforced from D1 counters instead (exact).

---

## 2. Meta and identity

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/meta` | none | Version/compatibility (§1.7) |
| GET | `/api/v1/me` | any | `{user_id, email, is_admin, scopes[], device?: {id,name}, credential_kind}` |
| GET | `/api/whoami` | — | **[VERIFIED]** existing, unchanged |

---

## 3. Devices (17 §6, 21 §3)

| Method | Path | Scope | Description |
|---|---|---|---|
| POST | `/api/v1/devices` | `offline_access` + token from `pilih-jobs-cli` grant without device | Register this installation. Body `{name, platform, arch, cli_version, capabilities[], public_key?}` → `201 {device}`; binds `grant.device_id`. One device per grant (409 if already bound). |
| GET | `/api/v1/devices` | `devices:manage` | List with `online` (`last_seen_at` ≤ 6 min) and `active` (holds a lease with a heartbeat ≤ 90 s), per 04 §1 |
| PATCH | `/api/v1/devices/{dev_id}` | `devices:manage`; or `automation:execute` for the caller's own device (only `accepts_tasks`) | Rename, toggle `accepts_tasks` (`pilih-jobs worker enable/disable`) |
| POST | `/api/v1/devices/{dev_id}/revoke` | `devices:manage` | Revoke device ⇒ revoke grant + refresh family + access tokens; live leases ⇒ `outcome_unknown` if past `submit_intent`, else `queued` |
| POST | `/api/v1/devices/{dev_id}/heartbeat` | `automation:execute` (own device) | `{cli_version, local_state_summary, active_lease_ids[], outbox_depth, browser: {mode, status}}` → `{server_time, poll_interval_ms, cancel_lease_ids[], min_cli_version}` |

---

## 4. Discovery and postings (15, 20)

| Method | Path | Scope | Description |
|---|---|---|---|
| GET/POST | `/api/v1/sources` | `jobs:read` / `jobs:write` | List/create user job sources. Create validates `adapter` + `config` against the adapter registry manifest (`GET /api/v1/sources/adapters`). Rejects `linkedin`, `indeed` (`422 unsupported_source`, D-17). |
| PATCH/DELETE | `/api/v1/sources/{src_id}` | `jobs:write` | Update (with `base_revision`) / delete |
| GET | `/api/v1/sources/adapters` | `jobs:read` | Adapter manifests (capabilities, config schema, restrictions, and the automation flags `headless_ok`, `auto_ok`, `confirmation_url_patterns`, `confirmation_selectors`; 15 §14) — served from `packages/jobs-contracts/adapters.json` so web and CLI agree |
| POST | `/api/v1/discovery/runs` | `discovery:write` | Start a run record `{id (run_…), sources[], device_id, task_id?, engine_version}` (idempotent by id) |
| POST | `/api/v1/discovery/runs/{run_id}/postings:batch` | `discovery:write` | Upsert ≤ 100 normalized postings (body ≤ 1 MB). Per item, either a full item `{client_ref, fingerprint, visibility, source_kind, source_org?, source_job_ref?, …posting fields, content_hash, dedupe_group?, observed_at, extraction, status_hint?: open|closed, status_evidence?}` or an **unchanged-only** item `{client_ref, fingerprint, content_hash, observed_at}` (bumps `last_seen_at`, no body). Server recomputes the fingerprint (mismatch ⇒ item `invalid`), upserts `job_postings`, creates `user_jobs` (origin `discovered`), records `discovery_run_items`, enqueues scoring. Response per item: `{client_ref, outcome: new|updated|unchanged|invalid, posting_id?, user_job_id?, errors?}`. |
| POST | `/api/v1/discovery/runs/{run_id}/complete` | `discovery:write` | `{status, stats, errors[], complete_sources[]}` — for each source listed as complete, increments `missed_runs` of that source's postings not seen in this run and closes those reaching 2 (03 §4.3). |
| GET | `/api/v1/discovery/runs?limit&cursor` | `jobs:read` | History |
| GET | `/api/v1/inbox?state=new&min_score&source&q&cursor` | `jobs:read` | Discovery results joined with scores and provenance |
| POST | `/api/v1/inbox:bulk` | `jobs:write` | `{user_job_ids[] (≤ 200), action: track|dismiss|seen|score|restore}` ⇒ per-id results |
| POST | `/api/v1/user-jobs` | `jobs:write` | Manual add: `{url}` (server stores a `custom_url` stub posting; the CLI or web enriches it) or full posting fields |
| GET | `/api/v1/user-jobs/{ujb_id}` | `jobs:read` | Tracked job + posting + latest score |

---

## 5. Applications (Kanban) (06)

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/board?include_archived=0` (supports `ETag` / `If-None-Match` → `304`) | `jobs:read` | All non-archived applications grouped by stage, ordered by `board_rank`, with posting summary, latest score, submission status, live task summary |
| GET | `/api/v1/applications?stage&q&cursor` | `jobs:read` | List |
| POST | `/api/v1/applications` | `jobs:write` | Track a job: `{user_job_id, stage?='saved', mode?}` |
| GET | `/api/v1/applications/{app_id}` | `jobs:read` | Full detail incl. posting, CV variants, interviews, offers, open approvals, tasks |
| GET | `/api/v1/applications/{app_id}/interviews/{ivw_id}.ics` | `jobs:read` | iCalendar export of one interview (06 §6) |
| PATCH | `/api/v1/applications/{app_id}` | `jobs:write` | `{base_revision, stage?, board_rank?, mode?, priority?, archived?, follow_up_at?, base_cv_id?}` — stage changes validated by 03 §5.1; writes an event |
| POST | `/api/v1/applications/{app_id}/move` | `jobs:write` | Drag-and-drop: `{base_revision, stage, before_id?, after_id?}` → server computes `board_rank` |
| POST | `/api/v1/applications/{app_id}/submission` | `jobs:write` | User attestation/confirmation: `{base_revision, action: confirm|deny|mark_applied, applied_at?, method?, note?}` |
| GET | `/api/v1/applications/{app_id}/events?cursor` | `jobs:read` | Timeline |
| POST | `/api/v1/applications/{app_id}/events` | `jobs:write` | Add note-type events `{type: note_added, payload, idempotency_key}` |
| CRUD | `/api/v1/applications/{app_id}/interviews[/{ivw_id}]` | `jobs:read`/`jobs:write` | Interviews (creating the first moves `applied → interviewing` if the user opts in, default on) |
| CRUD | `/api/v1/applications/{app_id}/offers[/{ofr_id}]` | `jobs:read`/`jobs:write` | Offers |
| DELETE | `/api/v1/applications/{app_id}` | `jobs:write` | Soft delete = archive; hard delete only via account deletion or `?purge=1` with confirmation |

---

## 6. Scoring (07)

| Method | Path | Scope | Description |
|---|---|---|---|
| POST | `/api/v1/scores:request` | `jobs:write` | `{posting_ids[] (≤ 500) | user_job_ids[]}` ⇒ enqueue to `jobs-ai`; returns `{queued, cached}` |
| GET | `/api/v1/scores/{posting_id}` | `jobs:read` | Latest score for the caller's current `profile_version` |

---

## 7. CV variants and files (08)

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/cvs` | `cv:read` | Caller's base CVs (proxy of `/api/cv` owner list) |
| POST | `/api/v1/applications/{app_id}/cv-variants` | `cv:write` + `ai:invoke` | `{base_cv_id, template, tailor: true}` ⇒ `202 {cv_variant}` (status `generating`, queue job) |
| GET | `/api/v1/cv-variants/{cvv_id}` | `cv:read` | Variant, diff, tailored CVData, file status |
| POST | `/api/v1/cv-variants/{cvv_id}/render-ticket` | `cv:write` (web) or lease-bound `automation:execute` (CLI `render_cv` task) | Single-use render ticket for `/render/cv/$cvvId` (KV `jobs:render-ticket:<sha256>`, TTL 120 s); the render page uploads the PDF with it (08 §6.4) |
| POST | `/api/v1/cv-variants/{cvv_id}/approve` | `cv:write` | `{base_revision}`; requires a `ready` PDF file; ⇒ attaches to application |
| POST | `/api/v1/cv-variants/{cvv_id}/reject` | `cv:write` | |
| POST | `/api/v1/files` | `files:write` | `multipart/form-data` (`meta` JSON `{kind, sha256, content_type, size_bytes, links: {cv_variant_id?}}` + `file`), ≤ 25 MB; server streams to R2, verifies SHA-256 and magic bytes (PDF `%PDF-`, PNG, JPEG, DOCX) ⇒ `201 {file}` |
| GET | `/api/v1/files/{fil_id}` | `files:read` | Metadata |
| GET | `/api/v1/files/{fil_id}/content` | `files:read` | Streams the object (`Content-Disposition: attachment`, `ETag` = sha256, `Cache-Control: private, no-store`) |
| DELETE | `/api/v1/files/{fil_id}` | `files:write` | Marks deleted; R2 delete if unreferenced |

---

## 8. Automation (19, 21)

| Method | Path | Scope | Description |
|---|---|---|---|
| CRUD | `/api/v1/rules[/{rul_id}]` | `jobs:read` / `jobs:write`; enabling `auto` needs `automation:manage` + a `rule_activation` approval | Automation rules |
| POST | `/api/v1/tasks` | `automation:manage`; **or** `automation:execute` when `target_device_id` = the calling device and the mode is `assisted`/`approval` (local `pilih-jobs apply`) | `{kind, application_id?, cv_variant_id?, payload, target_device_id?, not_before?, idempotency_key}`; validates policy (mode, rule limits, device capabilities, `user_settings.automation_paused`) ⇒ `201 {task}` or `409 duplicate` if a live apply task exists. `auto`-mode tasks always need `automation:manage` |
| GET | `/api/v1/tasks?state&application_id&cursor` | `jobs:read` | List |
| GET | `/api/v1/tasks/{tsk_id}` | `jobs:read` | Detail incl. attempts, progress, approvals |
| POST | `/api/v1/tasks/{tsk_id}/cancel` | `automation:manage` | Sets `cancel_requested`; queued ⇒ `cancelled` immediately; running ⇒ delivered via heartbeat |
| POST | `/api/v1/tasks/{tsk_id}/retry` | `automation:manage` | Only from `failed`/`outcome_unknown`; from `outcome_unknown` the body must carry `confirm_not_submitted: true`. Creates a new task with `retry_of` |
| POST | `/api/v1/tasks/{tsk_id}/resume` | `automation:manage` | Web "Resume" for a `paused` task: sets `resume_requested`, delivered in the device's next heartbeat response |
| POST | `/api/v1/devices/{dev_id}/tasks:claim` | `automation:execute` | `{capabilities[], max: 1}` ⇒ `200 {task, lease: {lease_id, expires_at, heartbeat_interval_ms}}` or `204` (no work) |
| POST | `/api/v1/tasks/{tsk_id}/lease/{lease_id}/heartbeat` | `automation:execute` | `{progress, local_state}` ⇒ `{lease_expires_at, cancel_requested}`; `409 lease_lost` if fenced out |
| POST | `/api/v1/tasks/{tsk_id}/lease/{lease_id}/events` | `automation:execute` | Batched step events `{events: [{type: started|progress|paused|resumed|submit_intent|approval_requested|log, …, idempotency_key}]}` |
| POST | `/api/v1/tasks/{tsk_id}/lease/{lease_id}/submit-intent` | `automation:execute` | **Synchronous, never queued offline** (D-28). `{form_hash, approval_id?, rule_id?}` ⇒ `200 {submit_intent_at}` only if the lease is current, the approval (or the `auto` rule and its limits) matches `form_hash`, and the application isn't already submitted or claimed by another intent. The CLI clicks Submit only after this `200` |
| POST | `/api/v1/tasks/{tsk_id}/lease/{lease_id}/result` | `automation:execute` | Terminal report `{outcome, error_class?, evidence?, application_update?: {base_revision, submission_status, stage?}, log_file_id?}` |
| POST | `/api/v1/tasks/{tsk_id}/lease/{lease_id}/release` | `automation:execute` | `{reason: user_quit|awaiting_approval|needs_headed|shutdown}`: give the task back before `submit_intent` (`409 too_late` after). `awaiting_approval` keeps the task in that state without a lease (03 §7.2) |
| POST | `/api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence` | `automation:execute` (only the device that held that attempt's lease) | Evidence or a result that arrives after the lease was lost (20 §6.3 A). Append-only: records `submission_evidence` and a `submission_status_changed` event (`via: late_evidence`); submission status only moves forward, the stage never changes against a user decision, and the task may move `outcome_unknown → submitted`. Conflicts raise a notice |
| GET | `/api/v1/approvals?state=pending` | `jobs:read` | Approval queue |
| POST | `/api/v1/approvals/{apr_id}/decide` | `automation:manage` | `{decision: approve|reject, payload_hash, response?}`; hash must match |
| POST | `/api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals` | `automation:execute` | Create an approval from the device (`submit`/`answer`) |
| GET | `/api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals/{apr_id}` | `automation:execute` | Poll decision |

---

## 9. AI proxy (07, 19) — `ai:invoke`

All AI calls go through `apps/api` (D-12). Requests are bound to a task lease
when made by the agent, so usage is attributable and budgeted.

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/ai/page-classify` | Decisions API `choice` (page kind) + predicates. Body: `{lease_ref, observation}` (19 §4) |
| POST | `/api/v1/ai/next-action` | Decisions API `choice` among executor-enumerated candidate action ids (19 §5) |
| POST | `/api/v1/ai/field-plan` | Responses API Structured Outputs: field → fact mapping (19 §6) |
| POST | `/api/v1/ai/verify-submission` | Decisions API predicate on confirmation evidence (19 §9) |

Server responsibilities: inject the user's fact sheet server-side (the CLI
sends only fact **keys** it wants considered, never raw facts it cached — the
server is the authority); strip/limit DOM text (≤ 24 KB) and screenshots
(≤ 1 image, ≤ 1.5 MB, base64 data URL as required by Decisions [VERIFIED]
https://developers.openai.com/api/docs/guides/decisions); always send `store: false` to
the Responses API [VERIFIED] https://developers.openai.com/api/docs/guides/your-data;
validate model output with Zod before returning; record usage in
`automation_attempts.ai_calls` and the user's budget counter.

---

## 10. Profile

| Method | Path | Scope | Description |
|---|---|---|---|
| GET/PUT | `/api/v1/profile/facts` | `jobs:read`/`jobs:write` | Fact sheet (bulk upsert with per-fact `base_revision`) |
| POST | `/api/v1/profile/facts:import-cv` | `jobs:write` | Derive facts from a base CV (`source = cv_import`), returns proposals for user review |
| CRUD | `/api/v1/profile/answers[/{ans_id}]` | `jobs:read`/`jobs:write` | Answer bank; `protected` + `always` rejected (`422 policy_violation`) |

---

## 10a. Settings and account

| Method | Path | Scope | Description |
|---|---|---|---|
| GET/PATCH | `/api/v1/settings` | `jobs:read` / `jobs:write` | `user_settings` (04 §2.7) with `base_revision`; turning on `automation_paused` makes running workers pause at the next heartbeat |
| POST | `/api/v1/account/export` | `jobs:write` (browser session only) | Async export; emailed link valid 24 h (11 §10) |
| POST | `/api/v1/account/delete` | `jobs:write` (browser session only) | Starts deletion after email confirmation; enqueues `purge_user` phases (14 §6) |
| POST | `/api/v1/telemetry` | none (anonymous, rate-limited per IP) | Opt-in CLI counters (22 §8) into `telemetry_daily` |
| POST | `/api/v1/telemetry/crash` | none (anonymous, rate-limited per IP) | Opt-in redacted crash report (22 §8); stored in R2 under `telemetry/crash/`, 30 d retention, no user or device id |

## 11. Sync (20)

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/changes?cursor=<seq>&limit=500&entities=` | `jobs:read` | `{changes: [{seq, entity, entity_id, revision, op, data?}], next_cursor, has_more}`; `410 cursor_expired` if `seq` older than retention ⇒ full resync |
| GET | `/api/v1/snapshot?entities=applications,rules,sources,facts,answers` | `jobs:read` | Full state + `cursor` for initial/full sync |

---

## 12. Analytics (10)

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/analytics/summary?from&to&tz` | `jobs:read` | Funnel counts, conversion rates, response times |
| GET | `/api/v1/analytics/timeseries?metric&interval=week` | `jobs:read` | From `analytics_daily` |
| GET | `/api/v1/analytics/breakdown?by=source|company|mode|cv_variant` | `jobs:read` | |

---

## 13. Email applications (09)

| Method | Path | Scope | Description |
|---|---|---|---|
| POST | `/api/v1/applications/{app_id}/emails` | `jobs:write` | Create draft `{to, subject, body_text, attachment_file_ids[], delivery}` |
| POST | `/api/v1/emails/{eml_id}/approve` | `automation:manage` | Explicit approval; `server_send` sends immediately |
| POST | `/api/v1/emails/{eml_id}/handed-off` | `jobs:write` | CLI reports a local hand-off (user sends from own mail client) |

---

## 14. Legacy compatibility (D-04)

| Existing surface | After migration |
|---|---|
| `GET/POST /api/jobs`, `GET/PUT/DELETE /api/jobs/:id` **[VERIFIED]** | Same request/response shapes, served from `JOBS_DB` via an adapter (`legacy_job_id`). `PUT` maps to application + posting updates and **requires no revision** (legacy clients) but is rejected with `409` if the application changed in the last 5 s from another source (best-effort stale guard). |
| MCP `jobs_list/get/create/update/delete`, `jobs_section_*`, `jobs_item_*` **[VERIFIED]** | Same tool names and schemas; backed by the adapter; `jobs_list` paginates fully (fixes the 1,000-key cap); `jobs_update` gains `follow_up_at`. New MCP tools: `jobs_board`, `jobs_move`, `jobs_note_add`, `jobs_interview_add`, `jobs_offer_add`, `jobs_approvals_list`, `jobs_approval_decide` (read/write scope split per existing filter). `jobs_approval_decide` works only when `user_settings.allow_mcp_approvals = 1`, only for `answer` and `cv_variant` approvals (never `submit` or `rule_activation`), and is the one MCP exception to the `automation:manage` requirement of `/approvals/{id}/decide` (checked in the tool, not by scope). MCP cannot create automation tasks in v1 (no `jobs_apply_request`). |
| Admin bypass (`ADMIN_EMAILS`, `?mine=0`) **[VERIFIED]** `apps/api/src/ownership.ts:69-79` | **BREAKING (D-26):** ignored for jobs. Admins see only their own jobs; support access uses the logged break-glass script (11 §6.2). |
