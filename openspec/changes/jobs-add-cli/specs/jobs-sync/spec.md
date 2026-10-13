## ADDED Requirements

### Requirement: Local state database is a cache and a queue
The CLI SHALL keep one SQLite file `state.db` (WAL) with exactly the 20 §3
tables `account`, `outbox`, `entity_cache`, `sync_state`, `seen_postings`,
`checkpoints`, `local_tasks`, `runs` and `kv`, migrated forward-only by
numbered SQL files and `PRAGMA user_version`; nothing in it is authoritative,
it MUST hold no token, and `sync --force` MUST be able to rebuild everything
except unsynced outbox entries. (Source: 20 §1, §3; 16 §8)

#### Scenario: Fresh install
- **WHEN** the CLI opens a new data directory
- **THEN** `state.db` is created with the 20 §3 tables at the latest `user_version`

#### Scenario: Lost cache
- **WHEN** `entity_cache` is deleted and `pilih-jobs sync --force` runs
- **THEN** the cache is rebuilt from a snapshot and pending outbox entries are untouched

### Requirement: Idempotent outbox writes
Every CLI write to the cloud SHALL be an outbox entry with a stable
`Idempotency-Key`, enqueued in the same local transaction as its checkpoint,
so that retries any number of times converge; the server SHALL replay a
repeated key with the stored response and `Idempotent-Replayed: true`, and
answer `409 idempotency_mismatch` for the same key with a different body.
(Source: 20 §1, §5.5; 05 §1.4)

#### Scenario: Crash after commit
- **WHEN** the CLI crashes after the server committed a write but before marking the entry done
- **THEN** the next flush receives the stored response and nothing is applied twice

### Requirement: Outbox ordering and priority
The flusher SHALL send entries with the same `ordering_key` strictly in id
order (an entry waits while an earlier one of its key is pending, inflight or
in conflict), flush different keys concurrently, honour `depends_on` across
keys (a dead dependency kills its dependents), and send `lease_report`
entries before everything else, then by priority and age. (Source: 20 §5.2)

#### Scenario: Batches depend on the run
- **WHEN** a discovery run's batches are queued before its run-create entry is sent
- **THEN** no batch is sent until the run create is done

### Requirement: Outbox retry, dead letters and quarantine
The flusher SHALL retry network errors, timeouts, 5xx and 503 with full-jitter
backoff `random(0, min(5 min, 1 s · 2^attempts))`, wait `max(Retry-After,
backoff)` on 429, refresh once on `401 expired_token`, stop flushing and keep
entries on `revoked_token` / `invalid_grant` (re-sending them after login only
for the same user id), pause on 426, move non-retryable 4xx and entries older
than 7 days to `dead`, and expose dead letters through `sync --status`,
`--show`, `--retry` (fresh key, conditional mutations re-based) and
`--discard`. (Source: 20 §5.1, §5.3)

#### Scenario: Entry older than seven days
- **WHEN** an entry is still not done 7 days after creation
- **THEN** it becomes `dead` and is not sent again

#### Scenario: Different user signs in
- **WHEN** another account logs in while entries of the previous user are pending
- **THEN** those entries are quarantined and never replayed under the new user

### Requirement: Batch coalescing
The flusher SHALL coalesce compatible consecutive entries of a batchable kind
(postings ≤ 100 items and ≤ 1 MB, inbox actions ≤ 200 ids, lease events ≤ 50)
into one request whose idempotency key is `sha256` of the sorted child keys,
with every child reaching `done` together. (Source: 20 §5.4)

#### Scenario: Same children after a failure
- **WHEN** a coalesced batch fails and is retried with the same children
- **THEN** it is sent with the same derived key

### Requirement: Change feed
`GET /api/v1/changes?cursor&limit&entities` (`jobs:read`) SHALL return the
caller's `change_log` entries after the cursor (≤ 500 per page) with
`{seq, entity, entity_id, revision, op, data?}`, collapsing several changes of
one entity to its latest revision, plus `next_cursor` and `has_more`, and MUST
answer `410 cursor_expired` for a cursor older than the 30-day retention; the
CLI SHALL apply each page in one local transaction keeping the higher
revision and then store the cursor. (Source: 20 §4.1, §4.3; 05 §11)

#### Scenario: Out-of-order duplicate
- **WHEN** a page carries a lower revision than the cached row
- **THEN** the cached row is kept

#### Scenario: Expired cursor
- **WHEN** the CLI pulls with a cursor older than retention
- **THEN** the server answers 410 `cursor_expired` and the CLI performs a snapshot resync

### Requirement: Snapshot
`GET /api/v1/snapshot?entities=…` (`jobs:read`) SHALL return the caller's
current rows for the requested entities plus a cursor taken at the start of
the read, and the CLI SHALL replace `entity_cache` for those entities and pull
changes from that cursor. (Source: 20 §4.2; 05 §11)

#### Scenario: Initial sync
- **WHEN** a newly logged-in CLI runs `pilih-jobs sync`
- **THEN** it loads a snapshot and then the changes recorded during the snapshot read

### Requirement: Optimistic concurrency for synced writes
Conditional mutations from the CLI SHALL carry `base_revision` (body or
`If-Match`) and the server SHALL answer `409 revision_conflict` with
`details.current` when stale, while append-only records (events, evidence,
run items, step logs) never carry a revision; on a conflict of
`job_sources.cursor_state` the CLI MUST keep the server value, and
discovery MUST never downgrade a tracked or dismissed `user_jobs.inbox_state`.
(Source: 20 §6.1, §6.2; D-21)

#### Scenario: Stale stage change from the CLI
- **WHEN** the CLI moves an application with an old `base_revision`
- **THEN** the server answers 409 with the current application and nothing changes

### Requirement: Clock offset
The CLI SHALL record the server time from `/meta` and heartbeats with the
local monotonic time, correct every `occurred_at` / `observed_at` and every
generated ULID by the offset, and evaluate lease deadlines on the monotonic
clock; the server MUST reject client ids outside ±24 h and treat client
timestamps as informational. (Source: 20 §9)

#### Scenario: Skewed laptop clock
- **WHEN** the local clock is 2 hours fast
- **THEN** timestamps and run ids sent to the server are corrected by the measured offset

### Requirement: Sync command
`pilih-jobs sync` SHALL flush the outbox and then pull changes, reporting
`{pushed, pulled, conflicts, outbox_depth, cursor}`, with `--force` (full
snapshot), `--status` (works offline), `--push-only` and `--pull-only`.
(Source: 16 §3.3; 20 §10)

#### Scenario: Status offline
- **WHEN** `pilih-jobs sync --status` runs without network
- **THEN** it reports the outbox depth and dead letters from `state.db`
