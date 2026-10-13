-- state.db schema version 1 — exactly the canonical schema of
-- job-tracker-spec/20-LOCAL-CLOUD-SYNCHRONIZATION.md §3.
-- Forward-only: never edit a shipped migration; add NNN_<name>.sql instead.

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
