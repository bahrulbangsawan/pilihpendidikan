# 03 — Domain Model

This document is the **canonical vocabulary**. Table names, enum values,
identifier formats and state machines defined here are binding for every other
document, for `packages/jobs-contracts`, and for the CLI's Pydantic models.

Legend: see `00-README.md` §2.

---

## 1. Identifiers

**[DECISION D-03]** All new records use **prefixed ULIDs**: `<prefix>_<26-char Crockford ULID>`,
e.g. `app_01JA6V8M3W8Z1T6Q4Y2B7K9C0D`.

- Time-sortable (good for cursors and B-tree locality in D1).
- Prefixes make logs and support tickets unambiguous.
- Generated **server-side** for every record created by the server. The CLI may
  generate ids **only** for client-originated records that are created offline
  (`evt_`, `run_`, `att_` step logs, outbox `idempotency_key`s); the server
  validates the prefix and the ULID timestamp is within ±24 h of `now`.

| Prefix | Entity | Table | Database |
|---|---|---|---|
| `usr_` | User | `users` | `DB` |
| `grt_` | OAuth grant | `oauth_grants` | `DB` |
| `dev_` | Device (CLI installation) | `devices` | `DB` |
| `pst_` | Job posting | `job_postings` | `JOBS_DB` |
| `ujb_` | Tracked job (user ↔ posting) | `user_jobs` | `JOBS_DB` |
| `app_` | Application (Kanban card) | `applications` | `JOBS_DB` |
| `evt_` | Application event | `application_events` | `JOBS_DB` |
| `ivw_` | Interview | `interviews` | `JOBS_DB` |
| `ofr_` | Offer | `offers` | `JOBS_DB` |
| `scr_` | Match score | `match_scores` | `JOBS_DB` |
| `src_` | Job source (user-configured) | `job_sources` | `JOBS_DB` |
| `run_` | Discovery run | `discovery_runs` | `JOBS_DB` |
| `rul_` | Automation rule | `automation_rules` | `JOBS_DB` |
| `tsk_` | Automation task | `automation_tasks` | `JOBS_DB` |
| `att_` | Automation attempt | `automation_attempts` | `JOBS_DB` |
| `obs_` | Page observation (CLI-local only, referenced in step logs and AI proxy calls; never a table) | — | CLI |
| `lse_` | Lease (fencing token, `automation_tasks.lease_id` / `automation_attempts.lease_id`) | — | `JOBS_DB` |
| `rft_` | OAuth refresh token | `oauth_refresh_tokens` | `DB` |
| `sal_` | Support access log entry | `support_access_log` | `DB` |
| `apr_` | Approval request | `approvals` | `JOBS_DB` |
| `evd_` | Submission evidence | `submission_evidence` | `JOBS_DB` |
| `fil_` | Stored file (R2 object) | `files` | `JOBS_DB` |
| `cvv_` | CV variant (tailored CV) | `cv_variants` | `JOBS_DB` |
| `fct_` | Applicant fact | `applicant_facts` | `JOBS_DB` |
| `ans_` | Screening answer | `screening_answers` | `JOBS_DB` |
| `eml_` | Email application | `email_applications` | `JOBS_DB` |

**[VERIFIED]** Legacy job ids (`JOBS_KV` `job:{id}`) are client-chosen UUIDs or
slugs (`apps/api/src/tools/jobs-management.ts:115-181`). They are preserved in
`applications.legacy_job_id` (unique per user) so `/api/jobs/:id` keeps working
(see 06 §12).

---

## 2. Identity

**[VERIFIED]** Today the canonical identity is the normalized email
(`apps/api/src/auth.ts:59-61`), and `Caller = {email, isAdmin, scope}`.

**[NEW]** `users` table in `DB`:

- `users.id` (`usr_…`) becomes the canonical, immutable user id.
- `users.email` (unique, normalized) remains the **login key** (magic link,
  OAuth consent).
- `resolveCaller` is extended to return `Caller = {userId, email, isAdmin, scope, scopes[], deviceId?, grantId?, credentialKind}`;
  the user row is created lazily (`INSERT … ON CONFLICT(email) DO NOTHING RETURNING`)
  the first time an email authenticates. This is idempotent and requires no
  backfill job.
- Every Job Tracker row stores `user_id`. Email never appears in `JOBS_DB`
  except inside encrypted-at-rest applicant facts that the user typed
  themselves (contact email for applications).
- Email change (future feature) updates `users.email` only.

---

## 3. Entity overview

```text
users (DB) ──1:N── devices (DB) ──1:1── oauth_grants (DB)
   │
   │ user_id (logical FK across databases; enforced in code)
   ▼
job_sources ──1:N── discovery_runs ──N:M── job_postings (shared, public)
                                         │
user_jobs (user ↔ posting) ──────────────┘
   │ 1:1 (when tracked)
   ▼
applications ──1:N── application_events (append-only)
   │          ──1:N── interviews, offers
   │          ──1:N── cv_variants ──1:1── files (R2: cv_pdf)
   │          ──1:N── automation_tasks ──1:N── automation_attempts
   │                         │                      └─1:N── submission_evidence
   │                         └─1:N── approvals
   │          ──1:N── email_applications
   ▼
match_scores (user × posting × profile_version × rubric_version)

applicant_facts, screening_answers, automation_rules  (per user)
change_log (per user ordered feed of every change above)
idempotency_keys (per user/device request dedupe)
```

---

## 4. Job postings and fingerprints

### 4.1 Posting visibility

**[DECISION]** Postings from **public sources** (an ATS public board API or a
publicly reachable careers page) are stored once in `job_postings` with
`visibility = 'public'` and shared across users. Postings from **private
sources** (a URL the user marks private, a referral link, an emailed job, or
anything fetched with the user's logged-in browser session) are stored with
`visibility = 'private'` and `owner_user_id` set; only that user can link to
them.

Rationale: public postings are identical for everyone (storage efficiency, one
expiry check for all), while private postings may contain information the user
is not entitled to share.

Isolation rule: there is **no endpoint that lists or searches `job_postings`
directly**. A user reaches a posting only through their own `user_jobs` row.
The sync endpoint returns a posting id to a user only after creating that
user's `user_jobs` link.

### 4.2 Fingerprint algorithm (`fp1`)

Computed identically by the CLI (Python) and the server (TypeScript); golden
test vectors live in `packages/jobs-contracts/test-vectors/fingerprint.json`.

```text
normalize(s) = NFKC → lowercase → trim → collapse internal whitespace to " "
               → strip punctuation except [+#./-] (keeps "c++", "c#", ".net")

if source has a stable job id (greenhouse, lever, ashby, smartrecruiters, workable, workday):
    key = "src|" + source_kind + "|" + normalize(source_org) + "|" + source_job_ref
else:
    key = "gen|" + registrable_domain(company_domain or apply_url host)
              + "|" + normalize(title)
              + "|" + normalize(location_primary or "")
              + "|" + canonical_url(apply_url or canonical_url)

fingerprint = "fp1:" + hex(sha256(utf8(key)))
```

`canonical_url`: lowercase scheme and host, drop default port, drop fragment,
drop tracking query parameters (`utm_*`, `gh_src`, `lever-source`, `ref`,
`source`, `fbclid`, `gclid`), sort remaining query parameters.

A **content hash** (`content_hash = sha256(normalize(title) + "\n" + normalize(description_text))`)
detects edits to an existing posting (same fingerprint, new content →
`posting.updated` change and `revision + 1`).

### 4.3 Posting lifecycle

```text
          seen in discovery                 not seen for N runs / 404 / "closed" marker
 (none) ──────────────────▶ open ─────────────────────────────────────────▶ closed
                              ▲  │ status check fails (network, 5xx)
                              │  ▼
                              └─ unknown ─── confirmed open ──▶ open
```

- `open` → `closed` when (a) the source API no longer lists it in two
  consecutive complete runs of that source, (b) the detail page returns 404/410,
  or (c) the adapter detects an explicit closed marker. `closed_at` is set.
- Applications whose posting closes are **not** moved on the board; the card
  shows a "posting closed" badge.

---

## 5. Tracked jobs and applications

- `user_jobs` is created for every posting a discovery run delivers to a user
  (the **Discovery inbox**), for every manual add, and for every migrated legacy
  job. `inbox_state ∈ {new, seen, dismissed, tracked}`.
- An `applications` row exists **iff** the user tracks the job (save, bulk save,
  automation rule match, or legacy migration). It is the Kanban card. One
  application per `user_job` (unique constraint); re-applying after withdrawal
  reopens the same application with a new event.

### 5.1 Application stage machine (Kanban columns)

**[VERIFIED]** Legacy statuses: `saved, applied, interviewing, offer, rejected, accepted`
(`apps/api/src/types.ts:317`).

**[NEW]** Stages (superset; legacy values map 1:1):

| Stage | Column | Meaning |
|---|---|---|
| `saved` | Saved | Tracked, no work started |
| `preparing` | Preparing | CV variant / answers being prepared |
| `ready` | Ready | Materials approved; waiting to apply (manually or by automation) |
| `applied` | Applied | Submission recorded (see submission status for certainty) |
| `interviewing` | Interviewing | At least one interview scheduled or completed |
| `offer` | Offer | Offer received |
| `accepted` | Accepted | Offer accepted (terminal-success) |
| `rejected` | Rejected | Employer declined at any point (terminal) |
| `withdrawn` | Withdrawn | User withdrew (terminal) |

Allowed transitions (anything else → `422 invalid_transition`):

```text
saved ──▶ preparing ──▶ ready ──▶ applied ──▶ interviewing ──▶ offer ──▶ accepted
  │           │           │          │             │             │
  │           ▼           ▼          ▼             ▼             ▼
  └────────▶ ready     preparing   rejected      rejected      rejected
  any non-terminal ──▶ withdrawn
  any non-terminal ──▶ rejected
  applied ──▶ offer            (offer without interviews)
  saved/preparing/ready ──▶ applied   (manual "I applied elsewhere")
  rejected/withdrawn ──▶ saved        (reopen; user only, records evt reopen)
  accepted ──▶ (none; reopen requires explicit user action → saved)
```

Who may move a card:

| Actor | Allowed stage changes |
|---|---|
| User (web, CLI interactive, MCP) | Any allowed transition |
| Automation (CLI device under a lease) | `saved/preparing/ready → applied`, only together with submission evidence (`submitted_verified` or `submitted_unverified`); `saved/preparing → ready` when its own CV/answers prep finishes |
| System (server) | `saved → preparing` when a CV variant is requested for the application; `preparing → ready` when the attached CV variant is approved and the application's rule (or the user's default mode) says so; nothing else |

**Stale-write protection** (D-21): a stage change carries `base_revision`. The
server applies it only if `applications.revision = base_revision`, or—for
automation results—if the transition is still legal from the *current* stage
**and** the current stage is not one the user set after the task was created
(see 20 §6 conflict matrix). Otherwise the event is recorded with
`applied_to_state = 0` and the user sees a conflict notice.

### 5.2 Submission status machine

Independent of the stage; describes how certain we are that an application was
actually submitted.

```text
not_started ──▶ in_progress ──▶ submitted_verified
                     │      ├──▶ submitted_unverified ──(user confirms)──▶ submitted_verified
                     │      │                         └─(user denies)────▶ failed
                     │      ├──▶ failed  ──(retry)──▶ in_progress
                     │      └──▶ outcome_unknown ──(user confirms)──▶ submitted_verified | failed
                     └──(cancel before submit_intent)──▶ not_started
manual "I applied" ─────────────────────────────────────▶ submitted_verified (actor=user, evidence kind=user_attestation)
```

Rules (D-18):
- `submitted_verified` requires a `submission_evidence` row whose `verdict = 'verified'`
  (machine) or `kind = 'user_attestation'`.
- Stage `applied` is set automatically only together with
  `submitted_verified` or `submitted_unverified`. With `submitted_unverified`
  the card shows "Unconfirmed" until the user confirms.

### 5.3 Application modes

Stored per application (`applications.mode`), defaulting from the matching
automation rule or the user's default.

| Mode | Who acts in the browser | Submit | Typical use |
|---|---|---|---|
| `manual` | User, outside the system | User | Tracking only; user records "I applied" |
| `assisted` | Agent fills; user watches a headed browser and clicks Submit | User | First applications on a new ATS |
| `approval` | Agent fills and stops at the final review step; a pending `approvals` row is created; submits after the user approves (CLI prompt or web Approval queue) | Agent, after explicit per-application approval | Default for automation |
| `auto` | Agent fills and submits | Agent, under a pre-approved, narrowly scoped rule (19 §8) | Repetitive applications on supported ATS |

---

## 6. Events (append-only history)

`application_events` is the audit trail and the analytics source. Events are
never updated or deleted (except by account deletion).

| `type` | Payload (JSON) | Actor |
|---|---|---|
| `created` | `{origin}` | user/system/legacy_migration |
| `stage_changed` | `{from, to, reason?}` | user/automation/system |
| `submission_status_changed` | `{from, to, evidence_id?, via?: "assisted_user_click" \| "late_evidence"}` — also used when the user clicks Submit themselves in `assisted` mode | automation/user |
| `note_added` | `{text}` | user |
| `note_deleted` | `{note_event_id}` (the original event stays; readers hide it) | user |
| `cv_variant_attached` | `{cv_variant_id, file_id}` | user/system |
| `automation_task_created` / `_claimed` / `_progress` / `_paused` / `_finished` | `{task_id, attempt_id?, state, step?, message?}` | system/automation |
| `approval_requested` / `approval_decided` | `{approval_id, decision?}` | system/user |
| `submit_intent` | `{task_id, attempt_id, form_hash}` | automation |
| `interview_scheduled` / `interview_updated` | `{interview_id, …}` | user/mcp |
| `offer_recorded` | `{offer_id}` | user |
| `email_sent` | `{email_application_id, message_id}` | system/user |
| `conflict_recorded` | `{attempted, current, reason}` | system |
| `legacy_imported` | `{legacy_job_id}` | legacy_migration |

Each event carries `actor_kind ∈ {user, automation, system, mcp, legacy_migration}`,
`actor_device_id?`, `occurred_at` (client clock, informational), `recorded_at`
(server clock, authoritative for ordering), and a unique `idempotency_key`.

---

## 7. Automation tasks

### 7.1 Task kinds

| `kind` | Executed by | Purpose |
|---|---|---|
| `apply` | CLI | Run the browser agent for one application |
| `discover` | CLI | Run discovery for configured sources (scheduled from the web) |
| `render_cv` | CLI | Render a CV variant PDF headlessly when no web session rendered it |

### 7.2 Task state machine (cloud-authoritative)

```text
            create (web / CLI / rule)
                    │
                    ▼
     ┌────────── queued ◀──────────────── retry (attempts < max, no submit_intent)
     │              │ claim (atomic, fenced lease)
 cancel             ▼
     │           claimed ──(lease expires before start)──▶ queued
     │              │ start (heartbeat #1)
     │              ▼
     ├────────── running ◀────────────┐
     │           │  │  │              │ resume / approve
     │           │  │  └─▶ paused ────┤ (human input needed: login, CAPTCHA, unknown question)
     │           │  └────▶ awaiting_approval ──(approved)──┘
     │           │                 └──(rejected / expired)──▶ cancelled
     │           ▼
     │      (terminal reports)
     │      ├─▶ submitted        (apply: evidence attached; app submission_status = submitted_*)
     │      ├─▶ succeeded        (discover / render_cv)
     │      ├─▶ failed           (error_class set; retryable flag)
     │      └─▶ outcome_unknown  (lease lost or crash after submit_intent; D-19)
     └─▶ cancelled
```

- `sync_pending` is a **CLI-local** state (the executor finished but the result
  is still in the outbox). It is reported through heartbeats as
  `local_state = 'sync_pending'` and shown on the dashboard as "Finished on
  device — waiting to sync"; the cloud task stays `running` until the terminal
  report arrives or the lease expires (then `outcome_unknown` if
  `submit_intent` was recorded, else `queued`/`failed`).
- Terminal states: `submitted`, `succeeded`, `failed`, `cancelled`, `outcome_unknown`, `expired` (queued longer than `expires_at`).
- Two transitions are allowed out of otherwise-terminal or lease-holding states (21 §12):
  - `outcome_unknown → submitted` when late evidence arrives (e.g. a result
    from the outbox after the lease expired, or the user confirms with
    evidence). Never `outcome_unknown → queued` without the user's explicit
    `confirm_not_submitted: true` retry (21 §8), which creates a **new** task
    with `retry_of` set.
  - `outcome_unknown → failed` when the user states nothing was submitted
    (application `submission_status` `outcome_unknown → failed`, §5.2). A retry
    is then a new task as above.
  - `awaiting_approval` may exist **without a lease**: a worker that has waited
    30 min releases the lease (`release` with `reason: awaiting_approval`). When
    the approval is decided `approved`, the task returns to `queued` with
    `payload.resume_from_approval = <apr_id>`; the next claimant re-fills the
    form and, if the new `form_hash` equals the approved `payload_hash`, submits
    without asking again.
- `paused` tasks carry `pause_reason`, one of the canonical **PauseReason**
  values (the single list; 04, 12, 18, 19 and 21 use exactly these):
  `captcha_or_challenge`, `login_required`, `account_creation_required`,
  `mfa_required`, `credential_field`, `missing_information`,
  `protected_question`, `unknown_question`, `unsupported_form`, `unclear_page`,
  `off_domain_navigation`, `validation_unresolved`, `stuck_loop`,
  `needs_headed_restart`, `payment_requested`, `network_offline`,
  `resource_exhausted`, `low_confidence`, `injection_suspected`,
  `ai_unavailable`, `user_requested`.
  (`external_redirect` is a *page kind* in 19 §4; the pause it causes is
  `off_domain_navigation`.) The web "Resume" button sets
  `resume_requested`, delivered to the device in the next heartbeat response.
- The submit gate is the synchronous `submit-intent` call (D-28): the CLI may
  click the final Submit only after the server has durably recorded
  `submit_intent_at` and answered `200`.

### 7.3 Attempts

Each claim creates an `automation_attempts` row with a monotonically increasing
`attempt_no` per task. The pair `(task_id, lease_id)` is the **fencing token**:
every progress/heartbeat/result call must present the current `lease_id`; a
stale lease gets `409 lease_lost` and the CLI must stop acting in the browser
immediately.

---

## 8. Approvals

`approvals` rows are created when a task reaches a gate:

| `kind` | Gate | Payload shown to user |
|---|---|---|
| `submit` | Final submission (mode `approval`) | Filled-field summary (label → value, value source), attachments with SHA-256, final URL, screenshot thumbnail |
| `answer` | A screening question with no allowed answer (sensitive or unknown) | Question text, options, suggested answer (if any) with provenance |
| `cv_variant` | Tailored CV ready for review | Diff vs. base CV, PDF preview |
| `rule_activation` | Enabling an `auto` rule | Rule criteria, limits, domains |

States: `pending → approved | rejected | expired`. Default expiry 24 h for
`submit`/`answer` (the browser session may not survive longer), 7 days for
`cv_variant`. Decisions record `decided_by_user_id`, `decided_via ∈ {web, cli, mcp}`
and `decided_at`. **An approval is bound to a `payload_hash`**; if the form
changes after approval (hash mismatch), the agent must request a new approval.

---

## 9. Applicant facts and answer bank

- **`applicant_facts`**: typed key/value facts with provenance:
  `key` (e.g. `contact.email`, `contact.phone`, `work_auth.id`, `education[0].degree`),
  `value`, `source ∈ {user_entered, cv_import, verified_document}`,
  `cv_id?` + `cv_entry_id?` (links to the CV entry it came from), `updated_at`.
  The fact sheet is versioned (`profile_version` = max revision) for score caching.
- **`screening_answers`**: `question_key` (normalized canonical question, e.g.
  `requires_sponsorship`, `years_experience.python`, `salary_expectation`),
  `match_patterns[]`, `answer`, `answer_kind ∈ {text, choice, number, boolean, date}`,
  `sensitivity ∈ {none, personal, protected}`, `auto_use ∈ {never, approval, always}`.

Canonical fact keys (extend only through `packages/jobs-contracts/src/facts.ts`):

| Key | Type | Notes |
|---|---|---|
| `contact.full_name`, `contact.email`, `contact.phone`, `contact.location` | string | Seeded from the base CV's `personalInfo` (`cv_import`) |
| `links.linkedin`, `links.github`, `links.portfolio`, `links.website` | URL | |
| `work_auth.<country_code>` | `{status: citizen\|permanent_resident\|work_visa\|needs_sponsorship\|none}` | Treated as `protected` when asked as citizenship/visa status (§ below) |
| `education[<cv_entry_id>]`, `experience[<cv_entry_id>]` | references | Always resolved from the CV entry, never copied |
| `profile.primary_cv_id` | apps/cv slug | Base CV for tailoring and scoring |
| `prefs.target_titles`, `prefs.locations`, `prefs.workplace_types`, `prefs.min_salary` | arrays / object | Used by scoring (07) and rules |
| `prefs.timezone` | IANA zone | Mirrors `user_settings.timezone` |
| `prefs.ai_scoring_sensitive` | boolean | Mirrors `user_settings.ai_scoring_sensitive` |

Settings that are not applicant facts (locale, default mode, kill switch, AI
consent, evidence retention) live in `user_settings` (04 §2.7).

Sensitivity classes (19 §6):

| Class | Examples | Agent behaviour |
|---|---|---|
| `none` | Notice period, years of experience with X, portfolio URL | May auto-fill from the answer bank |
| `personal` | Salary expectation, current salary, relocation, start date | Auto-fill only if `auto_use = always`; else approval |
| `protected` | Gender, race/ethnicity, disability, veteran status, sexual orientation, criminal history, age/date of birth, religion, health, union membership, visa/citizenship status where not legally required | **Never** answered automatically. Use the user's stored answer only with `auto_use = approval` and an explicit approval per application; if a "Decline to self-identify" option exists and no stored answer exists, the agent still pauses — it never picks a value on the user's behalf. |

---

## 10. Revisions and change log

- Every mutable row has `revision INTEGER NOT NULL DEFAULT 1`, incremented on
  every update in the same statement (`SET revision = revision + 1 … WHERE revision = ?`).
- Every insert/update/delete of a user-scoped row appends to `change_log`
  (`seq` autoincrement, `user_id`, `entity`, `entity_id`, `revision`, `op`) in
  the same `db.batch()` (D1 batches are transactional — [VERIFIED]
  https://developers.cloudflare.com/d1/worker-api/d1-database/).
- Clients read `GET /api/v1/changes?cursor=<seq>` to sync incrementally (20 §4).
