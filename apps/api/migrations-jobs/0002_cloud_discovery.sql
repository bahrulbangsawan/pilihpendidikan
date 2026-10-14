-- apps/api JOBS_DB migration 0002: cloud discovery (job-tracker-spec/24 §2).
--
-- The system catalog of remote-job boards, its runs, per-user follows and a
-- small key/value table for pipeline state, plus nullable / defaulted columns
-- on job_postings. ADD COLUMN only: no table rebuild, no CHECK change, so the
-- 0001 rows and constraints are untouched (D-41).
--
-- Catalog rows have no user_id (D-39): they are not user data. Follows are
-- user-scoped and every statement on them carries a user_id predicate.

-- 2.1 Catalog
CREATE TABLE cloud_sources (
  id                   TEXT PRIMARY KEY,           -- csr_<ULID>
  slug                 TEXT NOT NULL UNIQUE,       -- canonical key: registrable domain (+ path)
  name                 TEXT NOT NULL,
  homepage_url         TEXT NOT NULL,
  listing_url          TEXT,
  canonical_domain     TEXT NOT NULL,
  category             TEXT NOT NULL CHECK (category IN
                         ('job_board','aggregator','freelance_marketplace','talent_network',
                          'staffing_service','tutoring_platform','content_marketplace','community',
                          'directory','defunct','unknown')),
  origin               TEXT NOT NULL CHECK (origin IN ('default','directory','operator')),
  directory_ref        TEXT,                       -- entry anchor on the directory page
  description          TEXT,
  strategy             TEXT NOT NULL CHECK (strategy IN
                         ('json_api','rss','json_ld','embedded_json','html_selectors','browser','ai','none')),
  strategy_config      TEXT NOT NULL DEFAULT '{}', -- JSON validated per strategy (cloud-config.ts)
  health               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (health IN
                         ('ACTIVE','FAILED','BLOCKED','AUTH_REQUIRED','RATE_LIMITED','UNSUPPORTED')),
  status_reason        TEXT,                       -- actionable note shown with the status
  enabled              INTEGER NOT NULL DEFAULT 1,
  priority             INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  interval_minutes     INTEGER NOT NULL DEFAULT 60 CHECK (interval_minutes BETWEEN 60 AND 10080),
  rate_limit           TEXT NOT NULL DEFAULT '{}', -- JSON {min_delay_ms, max_pages, max_items, max_details}
  auth_required        INTEGER NOT NULL DEFAULT 0,
  auth_note            TEXT,
  terms_url            TEXT,
  terms_note           TEXT,
  ai_enabled           INTEGER NOT NULL DEFAULT 0,
  allow_browser        INTEGER NOT NULL DEFAULT 0,
  next_run_at          INTEGER,
  lease_id             TEXT,                       -- one run at a time (24 §6.2)
  lease_expires_at     INTEGER,
  last_run_id          TEXT,
  last_run_status      TEXT,
  last_run_at          INTEGER,
  last_success_at      INTEGER,
  last_error_class     TEXT,
  last_error_message   TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_open_until   INTEGER,
  cursor_state         TEXT NOT NULL DEFAULT '{}', -- JSON incremental state + checkpoint
  stats                TEXT NOT NULL DEFAULT '{}', -- JSON running counters
  user_modified        TEXT NOT NULL DEFAULT '[]', -- JSON: fields an operator edited
  revision             INTEGER NOT NULL DEFAULT 1,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX ix_cloud_sources_due ON cloud_sources(enabled, health, next_run_at);
CREATE INDEX ix_cloud_sources_domain ON cloud_sources(canonical_domain);

-- 2.2 Runs (execution history; retained 90 d)
CREATE TABLE cloud_runs (
  id                   TEXT PRIMARY KEY,           -- crn_<ULID>
  source_id            TEXT REFERENCES cloud_sources(id), -- NULL for directory refreshes
  kind                 TEXT NOT NULL CHECK (kind IN ('scrape','directory','probe')),
  trigger              TEXT NOT NULL CHECK (trigger IN ('schedule','manual','retry')),
  status               TEXT NOT NULL CHECK (status IN
                         ('queued','running','succeeded','partial','failed','blocked',
                          'auth_required','rate_limited','unsupported','skipped')),
  attempt              INTEGER NOT NULL DEFAULT 1,
  requested_by         TEXT,                       -- operator user id (manual / retry)
  queued_at            INTEGER NOT NULL,
  started_at           INTEGER,
  finished_at          INTEGER,
  duration_ms          INTEGER,
  strategy             TEXT,
  stats                TEXT NOT NULL DEFAULT '{}',
  error_class          TEXT,
  error_message        TEXT,
  http_status          INTEGER,
  warnings             TEXT NOT NULL DEFAULT '[]',
  log                  TEXT NOT NULL DEFAULT '[]',
  engine_version       TEXT,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX ix_cloud_runs_source ON cloud_runs(source_id, queued_at);
CREATE INDEX ix_cloud_runs_kind ON cloud_runs(kind, queued_at);
CREATE INDEX ix_cloud_runs_status ON cloud_runs(status, queued_at);

-- 2.3 Follows (user-scoped)
CREATE TABLE cloud_source_follows (
  user_id              TEXT NOT NULL,
  source_id            TEXT NOT NULL REFERENCES cloud_sources(id),
  created_at           INTEGER NOT NULL,
  PRIMARY KEY (user_id, source_id)
);
CREATE INDEX ix_cloud_follows_source ON cloud_source_follows(source_id);

-- 2.4 Pipeline state (directory refresh time, monthly AI spend)
CREATE TABLE cloud_state (
  key                  TEXT PRIMARY KEY,
  value                TEXT NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- 2.5 Posting columns of the cloud job model (24 §2.5)
ALTER TABLE job_postings ADD COLUMN cloud_source_id TEXT;
ALTER TABLE job_postings ADD COLUMN expires_at INTEGER;
ALTER TABLE job_postings ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
ALTER TABLE job_postings ADD COLUMN benefits TEXT NOT NULL DEFAULT '[]';
ALTER TABLE job_postings ADD COLUMN employment_detail TEXT;
ALTER TABLE job_postings ADD COLUMN application_method TEXT;
ALTER TABLE job_postings ADD COLUMN auth_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_postings ADD COLUMN raw_metadata TEXT NOT NULL DEFAULT '{}';
CREATE INDEX ix_postings_cloud_source ON job_postings(cloud_source_id, status, last_seen_at);
