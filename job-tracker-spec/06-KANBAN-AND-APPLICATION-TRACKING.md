# 06 — Kanban and Application Tracking

This document specifies the Kanban board in `apps/jobs`, the application
lifecycle around it (timeline, notes, checklists, interviews, offers,
follow-ups, archive, bulk actions), parity across web, CLI and MCP, and the
migration of the existing KV-backed jobs tracker into D1 (D-04).

Legend: see `00-README.md` §2. Vocabulary: `03-DOMAIN-MODEL.md`. Tables:
`04-DATABASE-SCHEMA.md` §2.2. Endpoints: `05-API-SPECIFICATION.md` §5, §14.

---

## 1. Board model

### 1.1 Columns

**[NEW]** One column per stage (03 §5.1), in this order:

| Order | Column | Stage | Notes |
|---|---|---|---|
| 1 | Saved | `saved` | Default landing column for tracked jobs |
| 2 | Preparing | `preparing` | A CV variant is generating or awaiting approval, or answers are being collected |
| 3 | Ready | `ready` | Materials approved; waiting for the user or for automation |
| 4 | Applied | `applied` | Submission recorded; certainty shown by the submission badge |
| 5 | Interviewing | `interviewing` | At least one interview |
| 6 | Offer | `offer` | Offer recorded |
| 7 | Accepted | `accepted` | Terminal success |
| — | Closed lane | `rejected`, `withdrawn` | Collapsed by default into one "Closed" column with a segmented filter (Rejected / Withdrawn). Expanding it shows both. |

Archived applications (`applications.archived = 1`) are hidden from the board
and shown under **Archive** (§8).

**[DECISION]** `rejected` and `withdrawn` share one collapsed lane rather than
two full columns. Reason: on a 1120 px Zedative column (12 §2) nine columns do
not fit, and terminal cards are rarely acted on. Keyboard and drag targets still
distinguish the two stages.

### 1.2 Ordering

**[NEW]** Cards are ordered within a column by `applications.board_rank`, a
fractional index string. The ranking scheme:

- Alphabet `0-9a-z` (base 36). Ranks compare as plain strings, so the
  `ix_apps_board(user_id, archived, stage, board_rank)` index (04 §2.2) returns
  a column in display order.
- New cards get a rank after the current last card in their column (append).
- To place a card between neighbours, the server computes the midpoint string of
  their ranks (`rankBetween(before, after)`). If the midpoint would exceed
  32 characters, the server **rebalances the column**: it rewrites every rank in
  the column to evenly spaced 6-character ranks in one `db.batch()`. Each
  rewritten row gets `revision + 1` and a `change_log` entry.
- Clients never compute ranks. They send `before_id` / `after_id` to
  `POST /api/v1/applications/{app_id}/move` (05 §5). This avoids two devices
  generating colliding ranks.

### 1.3 Card anatomy

**[NEW]** Every card shows the following, top to bottom. Visual rules are in
12 §5.

| Element | Source | Rule |
|---|---|---|
| Company + title | `job_postings.company_name`, `title` | Title on one line with truncation; company in the caption role |
| Location / workplace | `job_postings.locations[0].raw`, `workplace_type` | e.g. "Jakarta · Hybrid" |
| **Score badge** | `match_scores.score` for the current `profile_version` | `≥ 80` accent outline, `60–79` neutral, `< 60` muted. Hidden while `status = queued`; spinner glyph while scoring. "AI off" marker when the score is deterministic-only (07 §9). |
| **Submission badge** | `applications.submission_status` | Shown only when not `not_started`: `in_progress` "Applying…", `submitted_verified` "Submitted ✓", `submitted_unverified` "Unconfirmed", `failed` "Failed", `outcome_unknown` "Check status". The last two are actionable (open the detail with the confirm/deny dialog). |
| **Live task badge** | Live `automation_tasks` row for this application (unique index `ux_tasks_live_apply`, 04 §2.6) | State plus device name, e.g. "Running on MacBook", "Paused — needs you", "Awaiting approval", "Queued". Clicking opens the task monitor (12 §8). |
| **Posting closed** | `job_postings.status = 'closed'` | "Posting closed" marker. The card does **not** move (03 §4.3). |
| **Follow-up due** | `applications.follow_up_at ≤ now` | "Follow up" marker plus a relative date. Overdue items also appear in the board header counter. |
| Interview date | Next `interviews.scheduled_at` with `outcome = pending` | In the user's timezone |
| Mode | `applications.mode` | Small glyph for `assisted` / `approval` / `auto`; none for `manual` |
| Priority | `applications.priority` | `1` raised marker, `-1` muted card |

### 1.4 Board query and refresh

- **[NEW]** `GET /api/v1/board` returns all non-archived applications for the
  caller in one response. It is grouped by stage, carries the denormalized card
  fields above, and includes `cursor` (the current `change_log.seq`).
- The web app refetches the board every 15 s with TanStack Query and pulls
  `GET /api/v1/changes?cursor=` in between (20 §4). No WebSockets in v1 (D-11).
- **[LIMITATION]** A board above roughly 1,500 cards exceeds a reasonable single
  response size. The board endpoint caps each closed lane at 200 most-recent
  cards and paginates the rest with `GET /api/v1/applications?stage=…&cursor=`.

---

## 2. Drag-and-drop semantics

**[NEW]** Implemented with `@dnd-kit` (already in the workspace dependency tree
through `@rulisme/ui` `section-list`, see the apps/cv audit). Pointer, touch and
keyboard sensors are all enabled (§10).

### 2.1 Flow

```text
user drops card C between A and B in column S
  │
  ├─ 1. validate locally: is (C.stage → S) allowed for actor=user? (03 §5.1 table compiled
  │     into packages/jobs-contracts `stageTransitions`) — if not: snap back + toast
  │
  ├─ 2. optimistic update: move C in the TanStack Query cache, mark "pending"
  │
  ├─ 3. POST /api/v1/applications/{C}/move
  │        { base_revision: C.revision, stage: S, before_id: A?, after_id: B? }
  │        Idempotency-Key: <ulid>
  │
  ├─ 200 { application }        → replace cache entry (new revision, server rank)
  ├─ 409 revision_conflict      → roll back to details.current; toast
  │                                "Changed on <source> just now — board refreshed"
  ├─ 422 invalid_transition     → roll back; toast with the reason
  └─ network error              → keep pending marker, retry with the SAME key
                                  (3 tries, 1 s/2 s/4 s), then roll back + toast
```

- Moving within a column (rank only) also sends `base_revision`. A rank-only
  conflict is **auto-resolved** by the server: if the stage is unchanged, it
  recomputes the rank against the current neighbours and returns `200`, because
  re-ordering is not a meaningful conflict. Only a stage conflict returns `409`.
- A stage change appends `application_events(type = stage_changed,
  actor_kind = user)` in the same `batch()` as the update (03 §6).

### 2.2 Drops that need confirmation

Some drops open a dialog before the request is sent:

| Drop | Dialog |
|---|---|
| Any → `applied` while `submission_status = not_started` | "Did you submit this application?" with **Yes, I applied** (sends `POST …/submission {action: mark_applied}`, evidence kind `user_attestation`, method selector), or **Just move it** (stage only, submission stays `not_started`) |
| Any → `rejected` / `withdrawn` while a live task exists | "Cancel the running automation first?" Confirming cancels the task (`POST /api/v1/tasks/{id}/cancel`) and then moves the card |
| `ready` → `saved` / `preparing` while an approval is pending | "Discard the pending approval?" |
| Any → `accepted` while other applications are in `offer` | Informational only; no blocking |

### 2.3 Drops that are refused

- Moving a card whose live task is past `submit_intent`
  (`automation_tasks.submit_intent_at IS NOT NULL`). Response: `422
  invalid_transition` with `details.reason = "submission_in_flight"`.
- Any transition missing from 03 §5.1 (e.g. `accepted` → `interviewing`).

---

## 3. Stage transitions

The transition graph and the actor permissions are canonical in
**03 §5.1**. This section only lists the **automatic** transitions and who
triggers them.

| Trigger | Transition | Actor | Condition |
|---|---|---|---|
| CV variant generation starts for a `saved` application | `saved → preparing` | system | Only if the user started it or a rule's `cv_policy.tailor = true` |
| CV variant approved + no unanswered `answer` approvals | `preparing → ready` | system | Only when the rule says so (03 §5.1); the user can always move it manually |
| Apply task reports `submitted` with evidence | `ready → applied` (also from `saved` / `preparing` when the user started the task from there) | automation | `submission_status ∈ {submitted_verified, submitted_unverified}` (03 §5.2); conflict rules in 20 §6 |
| User confirms "I applied" | current → `applied` | user | Via §2.2 dialog or `POST …/submission` |
| First interview created | `applied → interviewing` | user (implicit) | Opt-out toggle "Move to Interviewing" in the interview form, default on |
| Offer recorded | `applied` / `interviewing` → `offer` | user (implicit) | Same toggle pattern |
| Offer marked `accepted` | `offer → accepted` | user (implicit) | Toggle default on |
| Email sent (server_send) or handed off and confirmed | `ready → applied` | user (the email approval or hand-off confirmation is the user's act; the system only applies it) | 09 §6 |

No transition is ever made because a posting closed, a score changed, or time
passed. **[DECISION]** Rejections are never inferred from silence. The board
offers a **"No response in N days"** filter (default 21) instead.

---

## 4. Timeline (application history)

**[NEW]** The application detail (12 §6) shows `application_events` in
`recorded_at` order (03 §6). Each row shows:

- an icon by `type`, actor (`You`, `MacBook (CLI)`, `Automation`, `System`,
  `Claude via MCP`), relative time with an absolute tooltip, and a short sentence;
- for `conflict_recorded` and events with `applied_to_state = 0`, a warning
  style: "Automation reported *Submitted* but you had moved this to *Withdrawn*
  — review";
- expandable details for `automation_task_*` events (step, message, attempt
  link) and `submission_status_changed` events (evidence summary, 19 §9).

Paged by `GET /api/v1/applications/{id}/events?cursor=` with 50 per page,
newest first in the UI.

**[DECISION]** Events are immutable. "Delete note" is implemented as a
`note_deleted` event that hides the original from the default view. The original
stays in the audit trail until account deletion (11 §8).

---

## 5. Notes and checklists (legacy sections / items)

**[VERIFIED]** The legacy tracker models free-form structure as ordered
`sections` of `items {id, title, notes, url, done}`
(`apps/api/src/types.ts:337-349`, design comment at `:319-326`). MCP clients use
it through `jobs_section_*` / `jobs_item_*` (`apps/api/src/tools/jobs-sections.ts:11-81`,
`apps/api/src/tools/jobs-items.ts:18-131`).

**[DECISION]** Keep the structure unchanged in `applications.sections` (JSON,
04 §2.2) instead of normalizing it into tables:
- MCP compatibility is byte-for-byte (§12.6).
- The UI renders it as **Checklists** on the detail page (12 §6). Each section
  is a collapsible list, items have a checkbox, title, optional URL and notes.
- Edits go through `PATCH /api/v1/applications/{id}` with `base_revision`, so
  the whole JSON array is replaced under optimistic concurrency (D-21). This
  closes the lost-update gap of the KV read-modify-write
  (`apps/api/src/tools/jobs-items.ts`; no versioning today).
- Size cap: 200 items total and 64 KB serialized → `413 payload_too_large`.

**Notes** are a separate feature: free-text `note_added` events (05 §5) with
Markdown-lite rendering (bold, italic, links, lists) and no HTML. Notes are
timestamped and attributed, which suits a journal of recruiter conversations.
`user_jobs.user_notes` holds one pinned note that also shows in the Discovery
inbox.

---

## 6. Interviews and offers

### 6.1 Interviews

**[NEW]** Table `interviews` (04 §2.2), CRUD at
`/api/v1/applications/{id}/interviews` (05 §5).

| Field | UI | Rules |
|---|---|---|
| `round` | Number stepper | Auto-increments from the last round |
| `kind` | Select | Enum in 04 |
| `scheduled_at`, `duration_min`, `timezone` | Date-time picker; timezone defaults to the browser's | Stored UTC ms plus the IANA zone for display |
| `location` | Text / URL | URLs rendered as links (`rel="noopener"`) |
| `interviewers` | Tag input | Free text names; not linked to contacts |
| `outcome` | Segmented control | `pending → passed / failed / cancelled / no_show` |
| `notes` | Textarea | |

- Creating the first interview of an `applied` application moves it to
  `interviewing` (toggle, §3). Setting an interview `outcome = failed` does
  **not** reject the application. The form offers "Mark application rejected?"
  as an explicit second step.
- **[VERIFIED]** The legacy `interviewDate` ("YYYY-MM-DD" or "",
  `apps/api/src/types.ts:362-365`) migrates to one `interviews` row (§12.2). The
  legacy facade derives `interviewDate` from the earliest pending interview
  (§12.6).
- Calendar export: `GET /api/v1/applications/{id}/interviews/{ivw_id}.ics`
  **[NEW]** (single VEVENT, no attendee emails). No calendar sync in v1.

### 6.2 Offers

**[NEW]** Table `offers` (04 §2.2). One application may have several offers
(e.g. a revised offer). The latest `open` offer shows on the card. Compensation
is structured `{base, currency, period, bonus?, equity?, raw?}`. `deadline_at`
creates a follow-up reminder 48 h before (§7). Marking an offer `accepted` moves
the application to `accepted` (toggle). Marking it `declined` shows "Withdraw
application?" as a separate choice.

---

## 7. Follow-ups and reminders

**[NEW]**
- `applications.follow_up_at` is set manually (date picker, presets: 3 days,
  1 week, 2 weeks) or suggested automatically:
  - after `applied`: `submitted_at + 7 d`, shown as a suggestion until accepted
    (not written silently);
  - after an interview: `scheduled_at + 3 d`;
  - an offer deadline: `deadline_at − 48 h`.
- Delivery in v1 is **in-app only**: board header counter, card marker, and a
  "Due" filter. The CLI shows due follow-ups in `pilih-jobs status`.
- **[DECISION]** No reminder emails in v1. They would require per-user email
  opt-in and unsubscribe handling, and the existing sender is reserved for
  sign-in links (`apps/api/src/email.ts:1-8`). Revisit in M6 together with
  09 §8 limits.
- Completing a follow-up clears `follow_up_at` and writes `note_added` with
  `payload.kind = "follow_up_done"`.

---

## 8. Archive

- **[NEW]** `archived = 1` hides a card from the board without changing its
  stage. Archived applications stay in analytics (10 §2).
- Archive is the default for `DELETE /api/v1/applications/{id}` (05 §5). Hard
  delete needs `?purge=1` plus a typed confirmation in the UI. It removes the
  application, its events, interviews, offers, CV variants, files (R2 objects)
  and tasks, appends `change_log op=delete`, and keeps the `user_jobs` row with
  `inbox_state = dismissed` so rediscovery does not resurrect it.
- **Auto-archive suggestion**: `rejected` / `withdrawn` cards older than 30 days
  are offered for bulk archive (§9), never archived silently.

---

## 9. Bulk actions

**[NEW]** Multi-select on the board (Shift/Cmd-click, or `x` on the focused
card) and in list view. A bulk action is a series of single-application
requests run client-side with a concurrency of 4. Each request carries its own
`base_revision` and `Idempotency-Key`, and the result summary lists per-card
success and conflicts. **[DECISION]** No server-side bulk endpoint for
applications in v1. Board selections are small (≤ 100), and per-card revisions
keep conflict handling exact. The Discovery inbox *does* have a bulk endpoint
(`POST /api/v1/inbox:bulk`, 05 §4) because selections there can be large.

| Bulk action | Notes |
|---|---|
| Move to stage | Each card validated against 03 §5.1; invalid ones skipped and reported |
| Archive / unarchive | |
| Set priority, set follow-up | |
| Set mode | `auto` is offered only for cards matched by an enabled `auto` rule (19 §8) |
| Request scoring | `POST /api/v1/scores:request` with the posting ids (one request) |
| Generate CV variants | Creates one `cv_variants` per card (queue). Capped at 20 per action. |
| Queue apply tasks | `POST /api/v1/tasks` per card. Requires mode ≠ `manual`. Policy-checked per card (21 §2). |

---

## 10. Keyboard support

**[NEW]** Uses `use-shortcut` and `Kbd` from `@rulisme/ui` (apps/cv audit §7).
Single-key shortcuts are active only when focus is not in a text field.

| Key | Action |
|---|---|
| `←` `→` | Focus the previous/next column |
| `↑` `↓` | Focus the previous/next card |
| `Space` | Pick up / drop the focused card (dnd-kit keyboard sensor); arrows move it while picked up; `Esc` cancels |
| `Enter` | Open the card detail |
| `1`–`7` | Move the focused card to Saved…Accepted (validated) |
| `r` / `w` | Move to Rejected / Withdrawn (with confirm) |
| `e` | Archive |
| `x` | Toggle selection |
| `f` | Set follow-up |
| `n` | New tracked job (paste URL) |
| `/` | Focus search |
| `?` | Shortcut sheet |

The dnd-kit keyboard sensor announces moves through an `aria-live` region:
"Moved *Backend Engineer at Acme* to Applied, position 3 of 8".

---

## 11. Parity: web, CLI, MCP

Every board action is available on all three surfaces and calls the same
services in `apps/api/src/jobs/services/`. Web and CLI go through `/api/v1/*`.
MCP tools call the services directly inside the Worker.

| Action | Web (`apps/jobs`) | CLI (`pilih-jobs`, 16 §3) | MCP tool |
|---|---|---|---|
| View board | Board screen | `pilih-jobs board [--stage S] [--json]` | `jobs_board` **[NEW]** |
| List applications | List view | `pilih-jobs list [--stage] [--q]` | `jobs_list` **[VERIFIED]** (facade) |
| Show detail | Detail page | `pilih-jobs show <app_id\|legacy_id>` | `jobs_get` **[VERIFIED]** (facade) |
| Track a job | Inbox → Track / `n` | `pilih-jobs track <ujb_id\|url>` | `jobs_create` **[VERIFIED]** tool; **[NEW]** facade behaviour (creates a manual posting + application) |
| Move stage / reorder | Drag, keys `1`–`7` | `pilih-jobs move <app_id> <stage> [--before ID]` | `jobs_move` **[NEW]**; `jobs_update {status}` **[VERIFIED]** (facade) |
| Confirm submission | Dialog | `pilih-jobs applied <app_id> [--method] [--date]` / `pilih-jobs confirm <app_id> --yes\|--no` | `jobs_update {status:"applied"}` maps to `mark_applied` |
| Edit fields | Detail form | `pilih-jobs edit <app_id> --priority --follow-up --mode` | `jobs_update` |
| Notes | Timeline composer | `pilih-jobs note <app_id> "text"` | `jobs_item_add` into a "Notes" section (legacy) or `jobs_note_add` **[NEW]** |
| Checklists | Checklists panel | `pilih-jobs checklist …` (add/done/rm) | `jobs_section_*`, `jobs_item_*` **[VERIFIED]** |
| Interviews | Interview form | `pilih-jobs interview add <app_id> --at … --kind …` | `jobs_update {interview_date}` (facade) + `jobs_interview_add` **[NEW]** |
| Offers | Offer form | `pilih-jobs offer add <app_id> …` | `jobs_offer_add` **[NEW]** |
| Follow-ups | Date picker | `pilih-jobs follow-up <app_id> 7d` | `jobs_update {follow_up_at}` **[NEW]** field |
| Archive / delete | Menu, `e` | `pilih-jobs archive <app_id>`, `pilih-jobs rm <app_id> --purge` | `jobs_delete` **[VERIFIED]** tool; **[NEW]** facade behaviour (= archive; purge not exposed via MCP) |
| Approvals | Approval queue | `pilih-jobs approvals [--decide]` | `jobs_approvals_list`, `jobs_approval_decide` **[NEW]** (05 §14) |

**[DECISION]** MCP cannot purge, cannot enable `auto` rules, cannot create
automation tasks, and cannot decide any `submit` or `rule_activation`
approval. With `user_settings.allow_mcp_approvals = 1` it may decide only
`answer` and `cv_variant` approvals (05 §14). Everything else needs
`automation:manage` from the web or a step-up CLI session (D-29). Reason: an MCP client is an AI agent acting on
untrusted content, so irreversible or policy-widening actions stay with the
human (11 §5).

---

## 12. Legacy migration (D-04)

### 12.1 Source of truth today

**[VERIFIED]**
- Blob `job:{id}` in `JOBS_KV`, shape `JobData` (`apps/api/src/types.ts:351-367`),
  normalized on read by `normalizeJobData` (`:397-413`).
- KV metadata `JobMetadata {title, status, updatedAt, interviewDate, company, owner}`
  (`apps/api/src/helpers.ts:26-33`). `metadata.owner` is only a display hint:
  `""` for MCP writes.
- **Authoritative owner** is the stamp `owner:job:{id}` → email
  (`apps/api/src/ownership.ts:19-24,39-58`).
- `normalizeJobBody` keeps only known fields (`apps/api/src/documents/jobs.ts:131-150`).
  No data exists outside the `JobData` fields.

### 12.2 Field mapping

| `JobData` field (types.ts line) | Target | Transformation |
|---|---|---|
| `id` (:352) | `applications.legacy_job_id` | Verbatim. New `app_` id generated. |
| owner stamp `owner:job:{id}` | `applications.user_id`, `user_jobs.user_id` | email → `users.id` (create the user row if missing, 03 §2). **Blob without a stamp: skipped and reported** (orphan). |
| `title` (:353) | `job_postings.title` | Verbatim (`""` → "Untitled role") |
| `status` (:354) | `applications.stage` | 1:1 (§12.3) |
| `company` (:357) | `job_postings.company_name` | `""` → "Unknown company" |
| `companyUrl` (:358) | `job_postings.company_domain` (registrable domain), `job_postings.canonical_url` | `""` → NULL |
| `salaryRange` (:359) | `job_postings.salary` | `{raw: salaryRange}`. Best-effort parse of min/max/currency is **not** attempted (keeps it lossless). |
| `jobDescription[]` (:362) | `job_postings.description_text` | `join("\n")`, truncated to 64 KB (`description_truncated = 1`) |
| `requirements[]` (:363) | `job_postings.requirements` | JSON array verbatim |
| `interviewDate` (:367) | `interviews` row | If it matches `^\d{4}-\d{2}-\d{2}$`: one row `{round:1, kind:'other', scheduled_at: <date 09:00 UTC>, timezone: NULL, outcome:'pending'}`. **[DECISION]** The outcome is always `pending`, because the legacy data does not say. Invalid strings are kept as a `note_added` event "Legacy interview date: …". |
| `sections[]` (:368) | `applications.sections` | JSON verbatim (ids preserved) |
| `createdAt` (:369) | `applications.created_at`, `user_jobs.created_at` | ISO → epoch ms |
| `updatedAt` (:370) | `applications.updated_at` | ISO → epoch ms |
| — | `job_postings` | `visibility = 'private'`, `owner_user_id = user`, `source_kind = 'legacy'`, fingerprint `fp1:` over `"legacy|" + user_id + "|" + legacy id` (keeps legacy jobs private and never merged with public postings) |
| — | `user_jobs` | `origin = 'legacy'`, `inbox_state = 'tracked'` |
| — | `applications` | `mode = 'manual'`, `submission_status` per §12.3, `board_rank` = rank by `updatedAt` desc within stage, `last_change_source = 'legacy_migration'` |
| — | `application_events` | `created` and `legacy_imported`, `actor_kind = 'legacy_migration'`, with distinct keys `idempotency_key = "legacy:" + legacy id + ":created"` and `"legacy:" + legacy id + ":imported"` (`UNIQUE (user_id, idempotency_key)`, 04 §2.2) |

### 12.3 Status mapping

| Legacy `status` | `stage` | `submission_status` | Note |
|---|---|---|---|
| `saved` | `saved` | `not_started` | |
| `applied` | `applied` | `submitted_verified` | Evidence row `kind = user_attestation`, `signals = {"source":"legacy_status"}`, `captured_at = updatedAt` — the user set this status themselves |
| `interviewing` | `interviewing` | `submitted_verified` | same attestation |
| `offer` | `offer` | `submitted_verified` | same |
| `rejected` | `rejected` | `submitted_verified` | **[ASSUMPTION]** a rejected legacy job was applied to; the attestation `signals.inferred = true` marks it |
| `accepted` | `accepted` | `submitted_verified` | same |

### 12.4 Migration script

**[NEW]** `apps/api/scripts/migrate-jobs-kv-to-d1.ts`, modelled on the existing
gated scripts (`apps/api/scripts/migrate-cv-kv.ts`, `migrate-tokens.ts`). It
uses the Cloudflare REST API with `CLOUDFLARE_ACCOUNT_ID` /
`CLOUDFLARE_API_TOKEN` and is **dry run unless `--execute`** (`apps/api/CLAUDE.md`
rules). Running it with `--execute` against production needs the owner's
go-ahead (root `CLAUDE.md` § Deploy).

Steps:
1. **Inventory**: list all `job:` and `owner:job:` keys (paginate the cursor
   fully, no 1,000 cap). Build `id → {blob, ownerEmail}`.
2. **Classify**: `ok`, `orphan` (no stamp), `invalid` (unparseable JSON),
   `already_migrated` (`applications.legacy_job_id` exists for that user).
3. **Plan**: for each `ok` item, build the row set in §12.2. The dry run prints
   counts per class and status, the first 20 planned rows (redacted: titles
   kept, emails hashed), and writes `migration-plan.jsonl` locally.
4. **Execute** (`--execute`): one D1 `batch()` per legacy job (users upsert in
   `DB`, then a `JOBS_DB` batch with postings, user_jobs, applications, events,
   interviews, evidence, change_log). This is idempotent: `ux_apps_legacy`
   (04 §2.2) plus `INSERT … ON CONFLICT DO NOTHING` make re-runs no-ops. The
   script is resumable from its checkpoint file.
5. **Verify** (both modes after execute): for each user,
   `count(KV owned jobs) == count(applications WHERE legacy_job_id IS NOT NULL)`;
   per-status counts match; a 2 % random sample is compared field by field via
   the facade (`GET /api/jobs/:id` before vs. after shapes equal, ignoring
   `updatedAt` formatting). Exit code ≠ 0 on any mismatch.
6. **Record**: prints the D1 Time Travel bookmark taken **before** execute
   (`wrangler d1 time-travel info pilihpendidikan-jobs`), for rollback.

Rollback: `wrangler d1 time-travel restore pilihpendidikan-jobs --bookmark=<pre>`
**[VERIFIED]** restore is in place, with an undo bookmark
(https://developers.cloudflare.com/d1/reference/time-travel/). KV is untouched
by the migration, so rolling back D1 plus re-pointing the facade to KV (feature
flag `JOBS_LEGACY_BACKEND=kv|d1`) restores the old behaviour exactly.

### 12.5 Cut-over and grace period

| Phase | Duration | Reads | Writes |
|---|---|---|---|
| P0 — before | — | KV | KV |
| P1 — shadow | ≥ 3 days | KV (served), D1 compared in background (`waitUntil`, mismatches logged by id hash) | KV, then the script re-runs nightly in `--execute` mode (idempotent) |
| P2 — cut-over | instant flag flip `JOBS_LEGACY_BACKEND=d1` | D1 via facade | D1 only. KV writes stop. |
| P3 — grace | 30 days | D1; on a D1 miss for a legacy id, fall back to a KV read + on-the-fly migration of that one job | D1 |
| P4 — retire | after 30 days with zero fallbacks | D1 | D1. Export `JOBS_KV` to a private archive file (owner-held), then remove the binding from `apps/api/wrangler.jsonc`. Deleting the namespace needs a separate owner go-ahead. |

### 12.6 Compatibility facade

**[NEW]** `apps/api/src/jobs/legacy/facade.ts` implements the existing REST
handlers (`apps/api/src/documents/jobs.ts:152-299`) and MCP tools over D1:

- `toJobData(application, posting, interviews)` returns exactly the legacy
  shape (stage → status: `preparing`/`ready` → `saved`, `withdrawn` →
  `rejected`; this is a lossy read, documented in the tool descriptions).
- `fromJobData(body)` maps a legacy `PUT`/`jobs_update` body to a posting
  update. Private postings are updated in place. **[DECISION]** A legacy edit
  to the title, company or description of a **public** posting forks it: the
  facade creates a private copy (`visibility = private`,
  `source_kind = manual`) and re-points the user's `user_jobs`. One user can
  never mutate shared public data.
- Status writes map to the stage-change service with `actor_kind = mcp` or
  `user`, so transition validation (03 §5.1) applies. A legacy write of an
  illegal transition (e.g. `accepted` → `saved`) returns the legacy error text
  `Invalid status` with HTTP 422.
- Legacy ids stay the URL key; new applications created through the facade get
  `legacy_job_id = <client-chosen id>` so legacy clients can address them.
- Ownership semantics stay the same: not-found and not-owned both answer 404
  (`apps/api/src/documents/jobs.ts:1-7`).

---

## 13. Test plan

| # | Test | Level |
|---|---|---|
| T6-01 | Transition table: every (from, to, actor) pair accepted or rejected exactly as 03 §5.1 (generated from `stageTransitions`) | unit (contracts + api) |
| T6-02 | `rankBetween` property tests: strictly between, stable string order, rebalance triggers at 32 chars and preserves order | unit |
| T6-03 | Concurrent moves from two sessions with the same `base_revision`: one 200, one 409 with `details.current` | api (bun test, real SQLite) |
| T6-04 | Rank-only conflict auto-resolves (200) while a stage conflict returns 409 | api |
| T6-05 | Optimistic UI rollback on 409/422/network failure; retry reuses the same Idempotency-Key | web (Vitest + MSW) |
| T6-06 | Move refused while `submit_intent_at` is set | api |
| T6-07 | Keyboard DnD: pick up, move, drop, cancel; aria-live text | web (agent-browser) |
| T6-08 | Bulk move with mixed valid/invalid/conflicting cards reports per-card results | web |
| T6-09 | Cross-user isolation on every board/application/interview/offer route returns 404 | api (13 §5 matrix) |
| T6-10 | Migration dry run on a fixture KV export: counts per class/status, orphan and invalid reporting, no writes | script |
| T6-11 | Migration execute twice: second run is a no-op (row counts unchanged) | script |
| T6-12 | Field mapping golden tests for every `JobData` field incl. `interviewDate` invalid string and empty strings | script |
| T6-13 | Facade parity: the existing `src/documents/jobs.test.ts` and `src/tools/jobs.test.ts` suites pass unchanged against `JOBS_LEGACY_BACKEND=d1` | api |
| T6-14 | `jobs_list` returns > 1,000 jobs (fixes the single-`kv.list` cap at `apps/api/src/tools/jobs-management.ts:58-95`) | api |
| T6-15 | Facade edit of a public posting forks a private copy; other users' view unchanged | api |
| T6-16 | Archive hides from board but stays in analytics; purge removes R2 objects | api |
| T6-17 | Follow-up suggestions never write `follow_up_at` without user acceptance | web |
