# 20 — Local ↔ Cloud Synchronization

This document defines how the `pilih-jobs` CLI exchanges data with Cloudflare.
It covers what each side owns, the CLI's local SQLite store, the outbox
(push), the change feed (pull), the concurrency and conflict rules, and how
results survive offline periods and crashes without ever overwriting newer
cloud state.

Legend: see `00-README.md` §2. Server tables: `04-DATABASE-SCHEMA.md` §2.
Endpoints: `05-API-SPECIFICATION.md` §4, §8 and §11.

---

## 1. Principles

1. **The cloud is authoritative.** `JOBS_DB` (D1) and `JOBS_FILES` (R2) are
   the source of truth for postings, tracked jobs, applications, events,
   tasks, approvals, rules, facts and evidence (brief §1). The CLI database
   is a **cache plus a queue**; deleting it loses no committed data. **[DECISION]**
2. **Writes are intents, not overwrites.** The CLI sends either:
   - **append-only facts**: events, evidence, discovery observations, step
     logs. These are always accepted, deduplicated by idempotency key, and
     never conflict; or
   - **conditional mutations** carrying a `base_revision` (D-21). These are
     rejected when stale.
3. **Every write is idempotent.** Each outbox entry has a stable
   `Idempotency-Key`, so retries any number of times converge
   (05 §1.4, `idempotency_keys` table).
4. **Order comes from the server clock.** `recorded_at` (server) orders
   history. `occurred_at` (client) is informational only.
5. **Automation results never regress user decisions.** Section 6 encodes
   this as a precedence rule: a user decision recorded in the cloud after the
   automation task was created always wins over the automation's stage
   change. The *facts* the automation observed (evidence, submission status)
   are still recorded.

---

## 2. What synchronizes in which direction

| Data | CLI → Cloud | Cloud → CLI | Notes |
|---|---|---|---|
| Discovery runs and postings | ✓ (batch upsert, §5) | — | The CLI produces observations; the server dedupes and links them |
| User job sources (`job_sources`) | ✓ (create, edit via CLI config commands) | ✓ (change feed) | Mutable, revisioned |
| Source `cursor_state` (incremental crawl) | ✓ (`PATCH` with `base_revision`) | ✓ | Losing a cursor costs only a full re-crawl |
| Tracked jobs / inbox state | ✓ (`inbox:bulk`) | ✓ | Mutable, revisioned |
| Applications (stage, mode, rank) | ✓ (user-initiated only) | ✓ | Automation changes stage only through task results (§6) |
| Application events | ✓ (append) | ✓ (timeline reads) | Append-only |
| Automation tasks | create (✓), lease reports (✓, 21) | ✓ (claim, cancel flags) | Protocol in 21 |
| Approvals | create/decide (✓) | ✓ | Decisions are bound to `payload_hash` |
| Submission evidence | ✓ (append, within task result) | ✓ | Append-only |
| Files (CV PDF, step logs, screenshots) | ✓ (upload) | ✓ (download by id + sha256) | Content-addressed verification |
| Applicant facts, answer bank | ✓ (interactive edits) | ✓ (read on demand, cached) | The agent's fact values come from the server (05 §9) |
| Match scores | request (✓) | ✓ | Computed only by the server |
| Automation rules | ✓ (non-`auto` edits) | ✓ | `auto` activation needs an approval (05 §8) |
| Browser profiles, cookies, OS credentials | **never** | **never** | Local only (brief §1, D-23) |
| Raw scraped HTML, Scrapling adaptive store, spider checkpoints | **never** | — | Local only (15) |

---

## 3. CLI local database

**[NEW]** File: `<data>/state.db` (platformdirs data dir, 16 §8). This section is the **single canonical schema** of `state.db`; 16 §8 only summarizes it. SQLite 3 via
the stdlib `sqlite3` module, `PRAGMA journal_mode=WAL`,
`PRAGMA synchronous=NORMAL`, `PRAGMA foreign_keys=ON`, and `busy_timeout=5000`.
A process-wide advisory lock on `<data>/state.lock` serializes the outbox
**flusher**; readers do not take the lock. The schema is versioned with
`PRAGMA user_version` and forward-only migrations shipped in the wheel.

```sql
-- One row per API account/issuer the CLI is signed into (normally one).
CREATE TABLE account (
  issuer        TEXT PRIMARY KEY,           -- https://api.pilihpendidikan.com
  user_id       TEXT NOT NULL,
  device_id     TEXT,
  last_seen_server_time INTEGER
);

-- Outbox: pending writes, flushed in order.
CREATE TABLE outbox (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key  TEXT NOT NULL UNIQUE,     -- ULID; stable across retries
  issuer           TEXT NOT NULL,
  ordering_key     TEXT NOT NULL,            -- e.g. "app:app_01J…", "run:run_01J…", "task:tsk_…"
  method           TEXT NOT NULL,            -- POST/PATCH/DELETE
  path             TEXT NOT NULL,            -- /api/v1/...
  body             BLOB,                     -- JSON (or a multipart manifest pointing to a staged file)
  body_sha256      TEXT NOT NULL,
  kind             TEXT NOT NULL,            -- 'append' | 'conditional' | 'upload' | 'lease_report'
  priority         INTEGER NOT NULL DEFAULT 0, -- results/evidence > progress > discovery items (flush order across ordering keys)
  depends_on       TEXT,                     -- idempotency_key that must succeed first (e.g. run create → batches)
  created_at       INTEGER NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER NOT NULL,
  last_status      INTEGER,
  last_error       TEXT,                     -- redacted
  state            TEXT NOT NULL DEFAULT 'pending'
                   CHECK (state IN ('pending','inflight','done','conflict','dead'))
);
CREATE INDEX ix_outbox_ready ON outbox(state, next_attempt_at, id);
CREATE INDEX ix_outbox_order ON outbox(ordering_key, id);

-- Read-through cache of cloud entities (from change feed / snapshot / GETs).
CREATE TABLE entity_cache (
  issuer      TEXT NOT NULL,
  entity      TEXT NOT NULL,                 -- 'application','user_job','posting','task','approval','rule','source','fact','answer','score'
  entity_id   TEXT NOT NULL,
  revision    INTEGER NOT NULL,
  data        TEXT NOT NULL,                 -- JSON as returned by the API
  deleted     INTEGER NOT NULL DEFAULT 0,
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (issuer, entity, entity_id)
);

-- Change-feed checkpoint (acknowledged cursor).
CREATE TABLE sync_state (
  issuer          TEXT PRIMARY KEY,
  cursor          INTEGER NOT NULL DEFAULT 0, -- last fully applied change_log.seq
  last_pull_at    INTEGER,
  last_push_at    INTEGER,
  last_full_sync_at INTEGER
);

-- Local discovery bookkeeping (dedupe within/between runs before upload).
CREATE TABLE seen_postings (
  issuer       TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  posting_id   TEXT,                          -- server id once known
  last_uploaded_at INTEGER,
  PRIMARY KEY (issuer, fingerprint)
);

-- Checkpoints for long local operations (discovery runs, apply attempts).
CREATE TABLE checkpoints (
  key         TEXT PRIMARY KEY,               -- 'run:run_…', 'attempt:att_…'
  kind        TEXT NOT NULL,
  data        TEXT NOT NULL,                  -- JSON (e.g. {source_id, page, last_ref} or {step, submit_intent_at})
  updated_at  INTEGER NOT NULL
);

-- Local state of executions whose results are queued but not acknowledged.
CREATE TABLE local_tasks (            -- leases held by this device (21 §5)
  task_id     TEXT PRIMARY KEY,
  lease_id    TEXT,
  attempt_id  TEXT,
  kind        TEXT NOT NULL,           -- apply | discover | render_cv
  local_state TEXT NOT NULL CHECK (local_state IN
                ('claimed','running','paused','awaiting_approval','submit_intent','sync_pending','done','orphaned')),
  checkpoint  TEXT NOT NULL DEFAULT '{}', -- agent step index, form hash, staged file paths
  updated_at  INTEGER NOT NULL
);

-- Local index of discovery runs and apply attempts (last 50 of each), for `pilih-jobs logs`.
CREATE TABLE runs (
  id          TEXT PRIMARY KEY,        -- run_… or att_…
  kind        TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT,
  log_path    TEXT
);

-- Small key/value cache: /meta response, adapter manifest ETag, CDP endpoints.
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Durability rule: an outbox insert and its matching `checkpoints` /
`local_tasks` update happen in **one local transaction**. A crash therefore
leaves either both or neither.

---

## 4. Pull: change feed and snapshots

### 4.1 Incremental pull

```text
GET /api/v1/changes?cursor=<sync_state.cursor>&limit=500
→ { changes: [{seq, entity, entity_id, revision, op, data?}], next_cursor, has_more }
```

- The server reads `change_log WHERE user_id = ? AND seq > cursor ORDER BY seq LIMIT 500`
  and joins the current row for `data`. Several changes to one entity collapse
  into the latest revision.
- The CLI applies the page to `entity_cache` **in one local transaction**. It
  keeps the higher revision and ignores a lower one (an out-of-order duplicate
  is harmless), then sets `sync_state.cursor = next_cursor`. That is the
  **acknowledged checkpoint**.
- It repeats while `has_more`.
- When it runs:
  - before every command that reads cloud state (`list`, `show`, `status`);
  - after every successful outbox flush;
  - in the worker loop, every 60 s while idle.

### 4.2 Snapshot (initial and recovery)

`GET /api/v1/snapshot?entities=…` returns all current rows plus the `cursor`
taken at the snapshot's start. The CLI replaces `entity_cache` for those
entities and stores the cursor. Then it pulls changes from that cursor, which
covers writes that happened during the snapshot read.

### 4.3 Cursor expiry

`change_log` is retained for 30 days (04 §4). A cursor older than the oldest
retained `seq` gets `410 cursor_expired`, and the CLI performs §4.2
automatically. Cached data is never trusted across a 410.

---

## 5. Push: the outbox protocol

### 5.1 Lifecycle

```text
enqueue (pending) → inflight → done
                          ├─→ pending (retryable error; next_attempt_at = backoff)
                          ├─→ conflict (409 revision_conflict; resolution per §6)
                          └─→ dead (non-retryable 4xx, or age > 7 d) — visible in `sync --status`
```

### 5.2 Ordering

- Entries with the same `ordering_key` are sent **strictly in `id` order**.
  An entry is eligible only if no earlier entry with the same key is
  `pending`, `inflight` or `conflict`.
- Different keys flush concurrently (default 4 in flight).
- `depends_on` gives cross-key ordering. For example, the discovery batches of
  a run depend on the run-create entry, and a task result depends on the file
  upload of its step log.
- Lease reports (`kind='lease_report'`) are **prioritized**: they are flushed
  before everything else, because they keep the lease alive (21 §5).

### 5.3 Retry and backoff

| Response | Classification | Action |
|---|---|---|
| network error, timeout (connect 10 s, read 30 s), 5xx, 503 `upstream_unavailable` | retryable | `delay = random(0, min(cap, base · 2^attempts))`, with `base = 1 s` and `cap = 5 min` (**full jitter**) |
| 429 | retryable | wait `max(Retry-After, backoff)` |
| 401 `expired_token` | auth | refresh once (17 §7), then retry immediately |
| 401 `revoked_token` / refresh `invalid_grant` | fatal-auth | stop flushing; mark the account `signed_out`; entries stay `pending` and are re-sent after the next `login` **only if the user_id matches** |
| 409 `revision_conflict` | conflict | §6 |
| 409 `idempotency_mismatch` | bug | `dead`, with a diagnostic bundle (the same key was reused with a different body) |
| 409 `lease_lost` | fenced | `dead` for this lease's reports; the executor has already stopped (21 §5) |
| 400 / 403 / 404 / 422 | non-retryable | `dead`, surfaced to the user with the server `message` |
| 426 `cli_upgrade_required` | blocked | pause the flusher, prompt to upgrade, keep entries |

- **Max age:** an entry still not `done` 7 days after `created_at` becomes
  `dead`. This matches the `idempotency_keys` retention, which is also 7 days
  (04 §2.7). Beyond 7 days the server can no longer dedupe a replay, so the
  CLI must not send it.
- **Dead letters** are listed by `pilih-jobs sync --status`. They can be
  inspected (`sync --show <id>`), retried with a fresh key after the user
  confirms (`sync --retry <id>`, conditional mutations only, re-based on the
  current revision), or discarded (`sync --discard <id>`).

### 5.4 Batching

| Payload | Endpoint | Batch limit |
|---|---|---|
| Postings | `POST /discovery/runs/{run_id}/postings:batch` | ≤ 100 items, ≤ 1 MB |
| Step events of one lease | `POST /tasks/{t}/lease/{l}/events` | ≤ 50 events or every 5 s |
| Inbox actions | `POST /inbox:bulk` | ≤ 200 ids |

The outbox coalesces queued items of the same batchable kind and key at flush
time. The idempotency key of a coalesced batch is derived as
`sha256(sorted child keys)`, and child entries reach `done` together. This is
deterministic, so a retry after a partial failure re-derives the same key as
long as the set of children is unchanged. If a crash interrupts mid-batch, a
second flush with a different child set produces a new key. That is harmless,
because each item inside is idempotent server-side: the posting upsert is keyed
by fingerprint and events by their own `idempotency_key`.

### 5.5 Push sequence

```mermaid
sequenceDiagram
  autonumber
  participant EX as CLI producer (discovery/agent/command)
  participant DB as state.db
  participant FL as Outbox flusher
  participant API as apps/api
  participant D1 as JOBS_DB
  EX->>DB: BEGIN; INSERT outbox(idempotency_key=K, ...); UPDATE checkpoints; COMMIT
  FL->>DB: SELECT ready entries (ordering rules)
  FL->>API: POST ... Idempotency-Key: K
  API->>D1: lookup idempotency_keys(user,K)
  alt first time
    API->>D1: batch{ mutation; change_log; idempotency_keys(K, hash, response) }
    API-->>FL: 2xx body
  else replay (same hash)
    API-->>FL: stored 2xx body + Idempotent-Replayed: true
  end
  FL->>DB: UPDATE outbox SET state='done' WHERE idempotency_key=K
  FL->>API: GET /api/v1/changes?cursor=… (pull to refresh cache)
```

If the CLI crashes after the server committed but before it marked the entry
`done`, the next flush replays the entry and receives the stored response.
Nothing is applied twice.

---

## 6. Concurrency and conflict resolution

### 6.1 Revision rules (D-21)

- Every mutable row has a `revision`. A conditional write sends `base_revision`.
- The server applies the write only with `WHERE revision = base_revision`
  (04 §3). On a mismatch it returns `409 revision_conflict`, with the current
  row in `details.current`.
- **Append-only records never carry `base_revision`:** `application_events`,
  `submission_evidence`, `discovery_run_items` and step logs.

### 6.2 Conflict resolution matrix

"User-set" means an `application_events` row with `actor_kind IN ('user','mcp')`
and `recorded_at` later than `automation_tasks.created_at` of the task that
produced the result.

| Entity / field | Writers | Rule | Who resolves a 409 |
|---|---|---|---|
| `applications.stage` (user change) | web, CLI interactive, MCP | Strict `base_revision`. On 409 the CLI re-fetches, shows "changed on <source> to <stage>", and asks again (interactive) or drops the change (non-interactive, entry → `dead` with an explanation). | User |
| `applications.stage` (automation result `ready → applied`) | CLI under a lease, via task result | **Server-side precedence**: applied only if the current stage is in the task's expected set (`ready`, or `preparing`/`saved` when the task was created from those) **and** no user-set stage change has been recorded since task creation. Otherwise the stage is left unchanged, the event is stored with `applied_to_state = 0`, and a `conflict_recorded` event plus a dashboard notice are created. | Server (deterministic) |
| `applications.submission_status` | automation result, user confirm/deny | Facts win: evidence is always recorded. The status is updated **forward only**: `not_started < in_progress < {failed, outcome_unknown, submitted_unverified} < submitted_verified`. One exception: an explicit **retry** moves `failed → in_progress` (03 §5.2). User confirm/deny may move any value (an explicit decision, recorded with `actor_kind='user'`). | Server |
| `applications.board_rank`, `priority`, `follow_up_at`, `archived`, `mode` | web, CLI interactive | Strict `base_revision`. Rank uses `/move` with neighbour ids; on 409 the client recomputes from fresh neighbours and retries once automatically. | Client auto (rank), user (others) |
| Notes (`note_added` events) | any | Append-only. No conflict. | — |
| `user_jobs.inbox_state` | discovery (creates `new`), web/CLI | Discovery never downgrades: an existing `tracked`/`dismissed` is never reset to `new` by a re-run. User changes use `base_revision`; bulk actions apply per id and report conflicts per id. | Server / user |
| `job_postings` content | any user's discovery (shared public rows) | Server-side merge: `last_seen_at = max`; fields are updated only when `content_hash` changes **and** the observation's `observed_at` ≥ the stored `last_seen_at` (a stale observation cannot roll back content); `status` changes follow 03 §4.3. Clients never send `base_revision` for postings. | Server |
| `job_sources.config`, `enabled` | web, CLI | Strict `base_revision`. | User |
| `job_sources.cursor_state` | CLI discovery | `base_revision`; on 409 the CLI **keeps the server value** (another device crawled more recently) and its next run starts from it. | CLI auto |
| `automation_rules` | web, CLI | Strict `base_revision`. Enabling `auto` is a separate approval flow. | User |
| `applicant_facts`, `screening_answers` | web, CLI | Per-row `base_revision`. On 409 the CLI shows both values and asks. The agent reads facts server-side (05 §9), so a stale cache can never feed a form. | User |
| `approvals` decision | web, CLI, MCP | First decision wins: `UPDATE … WHERE state='pending'`. A later decision gets `409` with the decided state. **Approval is also bound to `payload_hash`** (03 §8). | Server |
| `automation_tasks` state | server (create/cancel/expiry), device (lease reports) | Lease fencing (21 §5); cancellation is a flag delivered by heartbeat; terminal states are final. | Server |
| `cv_variants.status` | server (generation), user (approve/reject) | `base_revision`; approve requires `file_id` with status `ready`. | User |

### 6.3 Worked examples

**Example A: the user rejects while the CLI is cut off after submitting.**

Setup: at 10:00 a task `tsk_1` for `app_1` (stage `ready`, revision 5) is
claimed by the laptop. The governing rule (21 §6.5): **the executor may click
the final Submit only after the server has acknowledged `submit_intent`
synchronously while the lease is valid.** `submit_intent` is never queued
offline, so the server always knows authoritatively whether a submission could
have happened.

1. At 10:02 `submit_intent` is acknowledged (`automation_tasks.submit_intent_at`
   is set). The agent clicks Submit, and then the network drops. The
   confirmation page is captured, and the evidence and result are queued in
   the outbox (`local_state = sync_pending`).
2. At 10:04 the lease expires (no heartbeat for 120 s). Because
   `submit_intent_at` is set, the reaper moves the task to `outcome_unknown`
   (D-19) and `applications.submission_status` to `outcome_unknown`. It is
   **never re-queued**.
3. At 10:30 the user sees "Outcome unknown" and drags the card to `rejected`
   (revision 6, `actor_kind = user`).
4. At 11:00 the laptop reconnects and flushes:
   - the task result with `lease_id` gets `409 lease_lost`, and the entry goes
     `dead`;
   - the CLI converts it to the **late-evidence path**:
     `POST /api/v1/tasks/tsk_4/attempts/att_7/late-evidence` (05 §8) with the
     evidence payload. Only the device that held that attempt's lease may call
     it; the server records a `submission_status_changed` event with
     `payload.via = "late_evidence"`.

   **[DECISION]** Evidence from a lost lease is accepted as an append-only
   fact when its `attempt_id` belongs to this user's task. Server outcome:
   - a `submission_evidence` row is inserted (`verdict` per 19 §9);
   - `submission_status` goes `outcome_unknown → submitted_verified`
     (forward-only rule; evidence is a fact);
   - **the stage stays `rejected`**, because a user-set change was recorded
     after task creation;
   - a `conflict_recorded` event is written: "Automation confirmed a
     submission at 10:03 after you marked this rejected at 10:30";
   - the dashboard shows a notice with *Move to Applied* / *Keep Rejected*;
   - the task moves `outcome_unknown → submitted` (the only exit allowed from
     `outcome_unknown` other than a user decision; 21 §12).

Counter-case: if the network drops **before** `submit_intent` is acknowledged,
the executor pauses and never submits. A lease that expires then returns the
task to `queued` (21 §7.1). A later claim restarts from a fresh browser page,
and nothing was submitted.

**Example B: two devices move the same card.** The web moves `app_2`
`saved → preparing` (revision 3 → 4). An offline CLI queued
`stage = withdrawn` with `base_revision = 3`. On reconnect it gets `409`; it
shows "Changed on web to Preparing at 14:05 — still withdraw? [y/N]" and, on
`y`, re-sends with `base_revision = 4` and a new idempotency key.

**Example C: a discovery re-run of a dismissed job.** A posting seen again
gives `user_jobs.inbox_state = dismissed`, unchanged. `discovery_run_items`
outcome is `unchanged`, `last_seen_at` is bumped, and the job does not
reappear in the inbox.

**Example D: a stale posting observation.** Device A (clock and data from
yesterday's offline run) uploads a posting with the old `content_hash` and
`observed_at` yesterday. The server already has today's content, so the fields
are not changed and `last_seen_at = max(...)`. The item outcome is
`unchanged`.

---

## 7. Discovery upload and deduplication across runs

1. `pilih-jobs discover` creates `run_<ULID>` locally and enqueues
   `POST /discovery/runs` as an outbox entry with key `run:<id>:create`.
2. For each normalized posting (15 §7) the CLI computes `fp1` (03 §4.2).
   - If `seen_postings` has the same fingerprint **and** `content_hash`, and
     `last_uploaded_at` is within 24 h, the posting is not re-uploaded in
     full. It is sent as an **unchanged-only item** `{client_ref, fingerprint, content_hash, observed_at}` (05 §4)
     so the run still records it, which expiry needs (03 §4.3).
   - Otherwise it is added to a batch.
3. Batches are outbox entries that `depends_on` run creation. Server item
   outcomes `new/updated/unchanged/invalid` update `seen_postings.posting_id`.
4. `complete` is sent last, listing **only sources that were fully enumerated**
   (no source-level errors or pagination aborts). This prevents false
   closures.
5. Deduplication works on three levels:
   - within a run (in-memory fingerprint set);
   - across runs on one device (`seen_postings`);
   - across devices and users (server unique index `ux_postings_public_fp` /
     `ux_postings_private_fp` and `UNIQUE (user_id, posting_id)` on
     `user_jobs`).
6. The server recomputes fingerprints. On a mismatch the item is `invalid`
   (`fingerprint_mismatch`), which catches normalizer drift between
   Python and TypeScript. The golden vectors in
   `packages/jobs-contracts/test-vectors/fingerprint.json` run in both test
   suites.

---

## 8. Status history preservation

- Every stage and submission-status change is an `application_events` row;
  rows are never updated (04 §2.2). Rejected or stale attempts are still
  stored with `applied_to_state = 0`, so the timeline shows exactly what each
  actor tried and when.
- `recorded_at` (server) defines order. The UI shows `occurred_at` as
  secondary text when it differs by more than 2 min (e.g. "observed 10:03 on
  laptop, synced 11:00").
- Task attempts, approvals and evidence keep their own immutable rows, linked
  through `task_id`, `attempt_id` and `evidence_id`.

---

## 9. Clock skew

- The server time in every heartbeat and `/meta` response is stored in
  `account.last_seen_server_time` together with the local monotonic time, and
  the CLI computes an `offset`.
- Every timestamp the CLI sends (`occurred_at`, `observed_at`) is **corrected
  by the offset** and is informational.
- The server rejects client timestamps more than 24 h in the future (clamped
  to `recorded_at`, flagged).
- Lease expiry is evaluated **only on the server**. The CLI treats its lease
  as expiring at `local_now + (lease_expires_at - server_time_at_grant) - 10 s`,
  using a monotonic clock, so wall-clock jumps cannot extend a lease locally.
- ULIDs generated by the CLI use the corrected time (03 §1 ±24 h validation).

---

## 10. Offline behaviour by command

| Command | Offline behaviour |
|---|---|
| `login`, `logout`, `whoami` (fresh) | Requires the network; `whoami --cached` shows the stored identity |
| `discover` | **Works**: scraping runs; results go to the outbox (§7). Scoring happens after sync. |
| `list`, `show` | From `entity_cache`, with a banner "offline — data as of <last_pull_at>" |
| `score` | Queues the request; the result appears after sync |
| `apply` (interactive/assisted) | **Refused** unless already holding a lease. Starting an application needs a fresh claim, a fresh fact sheet, AI calls through `apps/api` (05 §9) and possibly a CV download. **[DECISION]** No offline submissions are started. |
| In-flight `apply` when the network drops | Continues **only up to the next AI call, approval gate or the submit step**, then pauses and waits up to the lease's remaining time for connectivity. Submit requires a synchronously acknowledged `submit_intent` (21 §6.5). If the drop happens *after* the acknowledged submit, the result and evidence are queued (`sync_pending`). |
| `cv download` | From the local cache if the file is cached with matching sha256; otherwise needs the network |
| `sync`, `sync --status` | `sync` retries the flush; `--status` works offline |
| `worker start` | Keeps running; polls with backoff; no claims while offline |

---

## 11. Sequence: reconnect after offline discovery and an apply result

```mermaid
sequenceDiagram
  autonumber
  participant CLI as pilih-jobs
  participant API as apps/api
  Note over CLI: offline: run_9 discovered 230 postings; tsk_4 result sync_pending
  CLI->>API: GET /api/v1/meta (connectivity probe, server_time)
  CLI->>API: POST /tasks/tsk_4/lease/L/heartbeat (lease_report first)
  alt lease still valid
    API-->>CLI: 200 {lease_expires_at}
    CLI->>API: POST /tasks/tsk_4/lease/L/result (evidence, application_update base_revision=5)
    API-->>CLI: 200 {task: submitted, application: {stage: applied, revision: 6}}
  else lease expired
    API-->>CLI: 409 lease_lost
    CLI->>API: POST /tasks/tsk_4/attempts/att_7/late-evidence (§6.3 A)
  end
  CLI->>API: POST /discovery/runs (Idempotency-Key run:run_9:create) → 200 or replay
  loop 3 batches of ≤100
    CLI->>API: POST /discovery/runs/run_9/postings:batch
  end
  CLI->>API: POST /discovery/runs/run_9/complete
  CLI->>API: GET /api/v1/changes?cursor=… (until has_more=false)
```

---

## 12. Failure scenarios

| # | Scenario | Outcome |
|---|---|---|
| F1 | Crash after the server commit, before the local `done` | Replay returns the stored response (§5.5); no duplicate |
| F2 | Crash between the outbox insert and the local checkpoint | Impossible: same local transaction (§3) |
| F3 | `state.db` deleted or corrupted | Re-login if needed, snapshot pull; queued outbox entries are lost. **[LIMITATION]** Unsynced discovery is re-discovered on the next run. Unsynced apply results are lost locally, but the task becomes `outcome_unknown` on the server via lease expiry and is surfaced for human review (21 §7). |
| F4 | Same CLI data dir used by two processes | Flusher lock (`state.lock`) allows one flusher; the second process enqueues only |
| F5 | User signs into a different account | Entries keyed by `issuer` + `user_id` are never sent under another `user_id`; they remain `pending` (shown in `sync --status` as "belongs to alice@…") |
| F6 | API returns 5xx for hours | Backoff capped at 5 min; entries age out at 7 d; the user is warned at 24 h (`status` shows "N writes pending for >24 h") |
| F7 | Server-side idempotency key purged (>7 d) | Prevented by the 7 d max age (§5.3) |
| F8 | Large discovery (10k postings) | 100 batches × ≤100; flushed concurrently across sources; the server rate limit is 120/min/device (05 §1.9) → ~1 min |
| F9 | Change feed returns 410 | Automatic snapshot (§4.3) |
| F10 | Clock 2 h behind | Offset correction (§9); leases are unaffected (server-evaluated) |

---

## 13. Test plan

**Unit (pytest)**
1. Outbox ordering: same `ordering_key` is sequential; `depends_on` is
   respected; lease reports are prioritized.
2. Backoff: full-jitter bounds (`0 ≤ delay ≤ min(300, 2^n)`), `Retry-After`
   honoured, 7-day dead-lettering, 426 pauses.
3. Coalescing: a deterministic batch key from the same children; a partial
   batch after a crash yields a different key but idempotent items.
4. Entity cache: a lower revision never overwrites a higher one; tombstones
   apply.
5. Clock offset: computed timestamps; the lease deadline uses a monotonic
   clock.

**Server (`bun test`)**
6. Every conditional route returns 409 with `details.current` on a stale
   `base_revision`.
7. Precedence rule: an automation `ready → applied` result after a user
   `rejected` leaves the stage at `rejected`, sets `submission_status`
   forward, stores the event with `applied_to_state = 0`, and records
   `conflict_recorded`.
8. Forward-only submission status: `submitted_verified` cannot be lowered by
   automation; user deny can.
9. Posting merge: an older `observed_at` with a different `content_hash` does
   not change fields; `last_seen_at = max`.
10. Discovery never downgrades `inbox_state`.
11. Fingerprint golden vectors (shared with Python).

**Property-based convergence (Hypothesis, CLI ↔ in-process fake server built
from the real Zod/Pydantic contracts)**
12. Random interleavings of web edits, CLI offline edits, duplicated, dropped
    and reordered deliveries, and crashes at every step. Invariants:
    - (a) the final cloud state equals the state from applying each accepted
      intent exactly once;
    - (b) no stage change by automation is applied after a later user stage
      change;
    - (c) every event appears exactly once;
    - (d) the CLI cache converges to the cloud after a final pull.

**Fault injection (staging, `wrangler dev` + toxiproxy)**
13. Kill -9 the CLI at each point of §5.5 and §11. Expected: no duplicate
    events or postings, and no lost acknowledged writes.
14. A network partition for 2 h during discovery and during an apply after
    `submit_intent`. Expected outcomes: §6.3 A and §12 F6.
15. 10k-posting discovery: completes within the rate limits; server item
    outcomes sum to the uploaded total.
