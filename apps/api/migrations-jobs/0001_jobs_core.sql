-- apps/api JOBS_DB schema (database `pilihpendidikan-jobs`, binding JOBS_DB).
--
-- Every Job Tracker record (D-02). This file is job-tracker-spec/04 §2
-- verbatim: the DDL of §2.1–§2.7 in order, with only these header comments
-- added (the `-- 2.x …` lines name the spec subsection each block comes from).
-- `src/jobs/core/migrations.test.ts` (TCORE-JOBS-SCHEMA) fails if this file and
-- the spec drift apart, or if a column disagrees with the contracts' records.
--
-- Rules (04 header, 04 §5):
--   - timestamps are INTEGER epoch milliseconds; JSON columns are TEXT
--     validated by Zod on write (packages/jobs-contracts);
--   - `user_id` is a logical reference to DB.users(id), enforced in code;
--   - only apps/api/src/jobs/repo/** queries this database, and every
--     statement on a user-scoped table carries a `user_id` predicate.

-- 2.1 Postings and tracking
CREATE TABLE job_postings (
  id                 TEXT PRIMARY KEY,             -- pst_<ULID>
  fingerprint        TEXT NOT NULL,                -- fp1:<sha256>
  visibility         TEXT NOT NULL CHECK (visibility IN ('public','private')),
  owner_user_id      TEXT,                         -- NOT NULL iff private
  source_kind        TEXT NOT NULL CHECK (source_kind IN
                       ('greenhouse','lever','ashby','smartrecruiters','workable','workday',
                        'career_page','generic_listing','custom_url','manual','email','legacy')),
  source_org         TEXT,                         -- board token / company slug / tenant
  source_job_ref     TEXT,                         -- ATS job id when available
  canonical_url      TEXT,
  apply_url          TEXT,
  apply_domain       TEXT,                         -- registrable domain of apply_url (agent allowlist seed)
  company_name       TEXT NOT NULL,
  company_domain     TEXT,
  title              TEXT NOT NULL,
  department         TEXT,
  locations          TEXT NOT NULL DEFAULT '[]',   -- JSON [{raw, city?, region?, country_code?}]
  workplace_type     TEXT CHECK (workplace_type IN ('onsite','hybrid','remote','unknown')),
  employment_type    TEXT CHECK (employment_type IN
                       ('full_time','part_time','contract','temporary','internship','volunteer','unknown')),
  seniority          TEXT,
  salary             TEXT,                         -- JSON {min?, max?, currency?, period?, raw?}
  description_text   TEXT NOT NULL DEFAULT '',     -- plain text, ≤ 64 KB (truncated, flag below)
  description_truncated INTEGER NOT NULL DEFAULT 0,
  requirements       TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  content_hash       TEXT NOT NULL,
  dedupe_group       TEXT,                         -- cross-source duplicate key (15 §11): sha256(company_domain|norm title|primary location)
  posted_at          INTEGER,
  first_seen_at      INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL,
  last_checked_at    INTEGER,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','unknown')),
  closed_at          INTEGER,
  missed_runs        INTEGER NOT NULL DEFAULT 0,   -- consecutive complete runs without this posting
  extraction         TEXT NOT NULL DEFAULT '{}',   -- JSON provenance (15 §11): adapter, version, method, selectors, confidence
  application_support TEXT NOT NULL DEFAULT 'unknown' CHECK (application_support IN
                       ('browser_supported','browser_unsupported','email','external_redirect','prohibited','unknown')),
  revision           INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  CHECK ((visibility = 'private') = (owner_user_id IS NOT NULL))
);
-- Public postings are unique by fingerprint; private ones per owner.
CREATE UNIQUE INDEX ux_postings_public_fp  ON job_postings(fingerprint) WHERE visibility = 'public';
CREATE UNIQUE INDEX ux_postings_private_fp ON job_postings(owner_user_id, fingerprint) WHERE visibility = 'private';
CREATE INDEX ix_postings_source ON job_postings(source_kind, source_org, status);
CREATE INDEX ix_postings_last_seen ON job_postings(status, last_seen_at);
CREATE INDEX ix_postings_dedupe ON job_postings(dedupe_group);

CREATE TABLE user_jobs (
  id                 TEXT PRIMARY KEY,             -- ujb_<ULID>
  user_id            TEXT NOT NULL,
  posting_id         TEXT NOT NULL REFERENCES job_postings(id),
  origin             TEXT NOT NULL CHECK (origin IN ('discovered','manual','imported','legacy','mcp')),
  inbox_state        TEXT NOT NULL DEFAULT 'new' CHECK (inbox_state IN ('new','seen','dismissed','tracked')),
  first_run_id       TEXT,                         -- discovery run that first delivered it
  source_id          TEXT,                         -- job_sources.id
  user_notes         TEXT NOT NULL DEFAULT '',
  revision           INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  UNIQUE (user_id, posting_id)
);
CREATE INDEX ix_user_jobs_inbox ON user_jobs(user_id, inbox_state, created_at);

-- 2.2 Applications, history, interviews, offers
CREATE TABLE applications (
  id                   TEXT PRIMARY KEY,           -- app_<ULID>
  user_id              TEXT NOT NULL,
  user_job_id          TEXT NOT NULL UNIQUE REFERENCES user_jobs(id),
  legacy_job_id        TEXT,                       -- JOBS_KV id (D-04)
  stage                TEXT NOT NULL DEFAULT 'saved' CHECK (stage IN
                         ('saved','preparing','ready','applied','interviewing','offer','accepted','rejected','withdrawn')),
  stage_changed_at     INTEGER NOT NULL,
  submission_status    TEXT NOT NULL DEFAULT 'not_started' CHECK (submission_status IN
                         ('not_started','in_progress','submitted_verified','submitted_unverified','failed','outcome_unknown')),
  submitted_at         INTEGER,
  submission_method    TEXT CHECK (submission_method IN ('browser','email','ats_api','manual')),
  mode                 TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','assisted','approval','auto')),
  automation_rule_id   TEXT,
  cv_variant_id        TEXT,                       -- currently attached tailored CV
  base_cv_id           TEXT,                       -- apps/cv slug used as base
  priority             INTEGER NOT NULL DEFAULT 0, -- 0 normal, 1 high, -1 low
  board_rank           TEXT NOT NULL,              -- fractional index (LexoRank-style) within stage column
  archived             INTEGER NOT NULL DEFAULT 0,
  follow_up_at         INTEGER,
  sections             TEXT NOT NULL DEFAULT '[]', -- legacy JobSection[] checklist (kept for MCP compat)
  last_change_source   TEXT NOT NULL CHECK (last_change_source IN ('web','cli','mcp','system','legacy_migration')),
  revision             INTEGER NOT NULL DEFAULT 1,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX ix_apps_board ON applications(user_id, archived, stage, board_rank);
CREATE INDEX ix_apps_updated ON applications(user_id, updated_at);
CREATE UNIQUE INDEX ux_apps_legacy ON applications(user_id, legacy_job_id) WHERE legacy_job_id IS NOT NULL;

CREATE TABLE application_events (
  id                 TEXT PRIMARY KEY,             -- evt_<ULID>
  user_id            TEXT NOT NULL,
  application_id     TEXT NOT NULL REFERENCES applications(id),
  type               TEXT NOT NULL,                -- see 03 §6
  from_value         TEXT,
  to_value           TEXT,
  payload            TEXT NOT NULL DEFAULT '{}',
  actor_kind         TEXT NOT NULL CHECK (actor_kind IN ('user','automation','system','mcp','legacy_migration')),
  actor_device_id    TEXT,
  task_id            TEXT,
  attempt_id         TEXT,
  applied_to_state   INTEGER NOT NULL DEFAULT 1,   -- 0 = recorded but rejected as stale/conflicting
  occurred_at        INTEGER NOT NULL,             -- client clock (informational)
  recorded_at        INTEGER NOT NULL,             -- server clock (authoritative order)
  idempotency_key    TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX ix_events_app ON application_events(application_id, recorded_at);
CREATE INDEX ix_events_user_type ON application_events(user_id, type, recorded_at);

CREATE TABLE interviews (
  id               TEXT PRIMARY KEY,               -- ivw_<ULID>
  user_id          TEXT NOT NULL,
  application_id   TEXT NOT NULL REFERENCES applications(id),
  round            INTEGER NOT NULL DEFAULT 1,
  kind             TEXT NOT NULL CHECK (kind IN ('phone_screen','technical','take_home','onsite','behavioral','final','other')),
  scheduled_at     INTEGER,
  duration_min     INTEGER,
  timezone         TEXT,
  location         TEXT,                           -- address or meeting URL
  interviewers     TEXT NOT NULL DEFAULT '[]',
  outcome          TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','passed','failed','cancelled','no_show')),
  notes            TEXT NOT NULL DEFAULT '',
  revision         INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX ix_interviews_user_time ON interviews(user_id, scheduled_at);

CREATE TABLE offers (
  id               TEXT PRIMARY KEY,               -- ofr_<ULID>
  user_id          TEXT NOT NULL,
  application_id   TEXT NOT NULL REFERENCES applications(id),
  received_at      INTEGER NOT NULL,
  compensation     TEXT NOT NULL DEFAULT '{}',     -- JSON {base, currency, period, bonus?, equity?, raw?}
  deadline_at      INTEGER,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','declined','expired','rescinded')),
  notes            TEXT NOT NULL DEFAULT '',
  revision         INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX ix_offers_app ON offers(application_id);

-- 2.3 Profile, answers, scoring, rules
CREATE TABLE applicant_facts (
  id            TEXT PRIMARY KEY,                  -- fct_<ULID>
  user_id       TEXT NOT NULL,
  key           TEXT NOT NULL,                     -- e.g. contact.phone, work_auth.ID, links.github
  value         TEXT NOT NULL,                     -- JSON scalar or object
  source        TEXT NOT NULL CHECK (source IN ('user_entered','cv_import','verified_document')),
  cv_id         TEXT,
  cv_entry_id   TEXT,
  revision      INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (user_id, key)
);

CREATE TABLE screening_answers (
  id              TEXT PRIMARY KEY,                -- ans_<ULID>
  user_id         TEXT NOT NULL,
  question_key    TEXT NOT NULL,
  match_patterns  TEXT NOT NULL DEFAULT '[]',      -- JSON string[] (normalized phrasings)
  answer          TEXT NOT NULL,
  answer_kind     TEXT NOT NULL CHECK (answer_kind IN ('text','choice','number','boolean','date')),
  sensitivity     TEXT NOT NULL CHECK (sensitivity IN ('none','personal','protected')),
  auto_use        TEXT NOT NULL CHECK (auto_use IN ('never','approval','always')),
  revision        INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (user_id, question_key),
  CHECK (NOT (sensitivity = 'protected' AND auto_use = 'always'))   -- protected answers can never be "always"
);

CREATE TABLE match_scores (
  id                TEXT PRIMARY KEY,              -- scr_<ULID>
  user_id           TEXT NOT NULL,
  posting_id        TEXT NOT NULL,
  profile_version   INTEGER NOT NULL,
  rubric_version    TEXT NOT NULL,                 -- e.g. "r1"
  model             TEXT NOT NULL,                 -- e.g. "gpt-6-luna" or "deterministic-only"
  score             INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence        REAL,
  components        TEXT NOT NULL,                 -- JSON per-dimension scores and gates (07 §3)
  explanation       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('queued','ready','failed')),
  created_at        INTEGER NOT NULL,
  UNIQUE (user_id, posting_id, profile_version, rubric_version)
);
CREATE INDEX ix_scores_user_score ON match_scores(user_id, score);

CREATE TABLE automation_rules (
  id               TEXT PRIMARY KEY,               -- rul_<ULID>
  user_id          TEXT NOT NULL,
  name             TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 0,
  mode             TEXT NOT NULL CHECK (mode IN ('assisted','approval','auto')),
  criteria         TEXT NOT NULL,                  -- JSON (19 §8): min_score, keywords, locations, sources, workplace types…
  limits           TEXT NOT NULL,                  -- JSON: max_per_day, max_per_company_per_30d, active_hours, expires_at
  allowed_domains  TEXT NOT NULL DEFAULT '[]',     -- JSON registrable domains (auto mode requires non-empty)
  cv_policy        TEXT NOT NULL DEFAULT '{}',     -- JSON: base_cv_id, tailor (bool), require_cv_approval (bool)
  activated_approval_id TEXT,                      -- approvals.id of kind rule_activation (auto mode)
  revision         INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX ix_rules_user ON automation_rules(user_id, enabled);

-- 2.4 Discovery
CREATE TABLE job_sources (
  id               TEXT PRIMARY KEY,               -- src_<ULID>
  user_id          TEXT NOT NULL,
  adapter          TEXT NOT NULL,                  -- adapter id (15 §14)
  label            TEXT NOT NULL,
  config           TEXT NOT NULL,                  -- JSON validated by adapter schema (board token, URL, filters)
  enabled          INTEGER NOT NULL DEFAULT 1,
  schedule         TEXT,                           -- optional cron-like hint for CLI scheduler ("daily@08:00")
  last_run_id      TEXT,
  last_success_at  INTEGER,
  cursor_state     TEXT NOT NULL DEFAULT '{}',     -- JSON incremental crawl state (15 §9)
  revision         INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX ix_sources_user ON job_sources(user_id, enabled);

CREATE TABLE discovery_runs (
  id               TEXT PRIMARY KEY,               -- run_<ULID> (client-generated allowed)
  user_id          TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  task_id          TEXT,                           -- if started remotely
  sources          TEXT NOT NULL,                  -- JSON [{source_id?, adapter, label}]
  status           TEXT NOT NULL CHECK (status IN ('running','completed','partial','failed','cancelled')),
  started_at       INTEGER NOT NULL,
  finished_at      INTEGER,
  stats            TEXT NOT NULL DEFAULT '{}',     -- JSON: pages, postings_found, new, updated, duplicates, invalid, errors_by_class
  errors           TEXT NOT NULL DEFAULT '[]',     -- JSON (capped at 50 entries)
  engine_version   TEXT NOT NULL,                  -- pilih-jobs + scrapling versions
  revision         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_runs_user ON discovery_runs(user_id, started_at);

CREATE TABLE discovery_run_items (                  -- which postings a run saw (for expiry + provenance); retained 90 d
  run_id           TEXT NOT NULL,
  posting_id       TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('new','updated','unchanged','invalid')),
  PRIMARY KEY (run_id, posting_id)
);

-- 2.5 CV variants, files, email applications
CREATE TABLE files (
  id               TEXT PRIMARY KEY,               -- fil_<ULID>
  user_id          TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('cv_pdf','cover_letter','attachment','evidence_screenshot','run_log')),
  r2_key           TEXT NOT NULL UNIQUE,           -- u/{user_id}/{kind}/{fil_id}{ext}
  content_type     TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL,
  sha256           TEXT NOT NULL,
  original_name    TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','deleted')),
  retention_until  INTEGER,                        -- NULL = keep while referenced
  created_at       INTEGER NOT NULL
);
CREATE INDEX ix_files_user ON files(user_id, kind, created_at);

CREATE TABLE cv_variants (
  id               TEXT PRIMARY KEY,               -- cvv_<ULID>
  user_id          TEXT NOT NULL,
  application_id   TEXT,                           -- NULL = general-purpose variant
  base_cv_id       TEXT NOT NULL,                  -- apps/cv slug (CV_KV cv:{id})
  tailored_cv_id   TEXT,                           -- apps/cv slug of the generated variant document
  template         TEXT NOT NULL CHECK (template IN ('basic','harvard','simple','standard')),
  status           TEXT NOT NULL CHECK (status IN ('generating','draft','approved','rejected','failed')),
  file_id          TEXT,                           -- rendered PDF (files.id), required for 'approved'
  diff             TEXT NOT NULL DEFAULT '{}',     -- JSON change summary + provenance map (08 §4.5)
  model            TEXT,
  approved_at      INTEGER,
  revision         INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX ix_cvv_app ON cv_variants(user_id, application_id);

CREATE TABLE email_applications (
  id               TEXT PRIMARY KEY,               -- eml_<ULID>
  user_id          TEXT NOT NULL,
  application_id   TEXT NOT NULL REFERENCES applications(id),
  to_address       TEXT NOT NULL,
  subject          TEXT NOT NULL,
  body_text        TEXT NOT NULL,
  attachment_file_ids TEXT NOT NULL DEFAULT '[]',
  delivery         TEXT NOT NULL CHECK (delivery IN ('local_handoff','server_send')),
  status           TEXT NOT NULL CHECK (status IN ('draft','approved','sent','failed','handed_off')),
  provider_message_id TEXT,
  approved_at      INTEGER,
  sent_at          INTEGER,
  revision         INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

-- 2.6 Automation execution
CREATE TABLE automation_tasks (
  id                 TEXT PRIMARY KEY,             -- tsk_<ULID>
  user_id            TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('apply','discover','render_cv')),
  application_id     TEXT,                         -- required for apply
  cv_variant_id      TEXT,                         -- required for render_cv
  payload            TEXT NOT NULL DEFAULT '{}',   -- JSON task parameters (mode, source ids, …)
  state              TEXT NOT NULL CHECK (state IN
                       ('queued','claimed','running','paused','awaiting_approval',
                        'submitted','succeeded','failed','cancelled','outcome_unknown','expired')),
  target_device_id   TEXT,                         -- NULL = any eligible device of this user
  required_capabilities TEXT NOT NULL DEFAULT '[]',
  priority           INTEGER NOT NULL DEFAULT 0,
  not_before         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,             -- queued tasks expire (default +72 h)
  lease_id           TEXT,                         -- current fencing token
  lease_device_id    TEXT,
  lease_expires_at   INTEGER,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  max_attempts       INTEGER NOT NULL DEFAULT 3,
  submit_intent_at   INTEGER,                      -- set by the synchronous submit-intent call (D-19, D-28)
  pause_reason       TEXT,                         -- canonical PauseReason (03 §7.2)
  resume_requested   INTEGER NOT NULL DEFAULT 0,   -- web "Resume" (05 §8), delivered via heartbeat
  retry_of           TEXT,                         -- automation_tasks.id this task retries
  cancel_requested   INTEGER NOT NULL DEFAULT 0,
  progress           TEXT NOT NULL DEFAULT '{}',   -- JSON {stage, step, message, percent?}
  local_state        TEXT,                         -- last reported CLI-local state (e.g. sync_pending)
  error_class        TEXT,
  error_message      TEXT,
  created_by         TEXT NOT NULL CHECK (created_by IN ('web','cli','rule','mcp','system')),
  idempotency_key    TEXT NOT NULL,
  revision           INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  finished_at        INTEGER,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX ix_tasks_claim ON automation_tasks(user_id, state, priority DESC, not_before, created_at);
CREATE INDEX ix_tasks_lease ON automation_tasks(state, lease_expires_at);
-- At most one live apply task per application (duplicate-execution guard).
CREATE UNIQUE INDEX ux_tasks_live_apply ON automation_tasks(application_id)
  WHERE kind = 'apply' AND state IN ('queued','claimed','running','paused','awaiting_approval');

CREATE TABLE automation_attempts (
  id               TEXT PRIMARY KEY,               -- att_<ULID>
  task_id          TEXT NOT NULL REFERENCES automation_tasks(id),
  user_id          TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  lease_id         TEXT NOT NULL UNIQUE,
  attempt_no       INTEGER NOT NULL,
  started_at       INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  ended_at         INTEGER,
  outcome          TEXT CHECK (outcome IN ('submitted','succeeded','failed','cancelled','lease_expired','outcome_unknown','paused')),
  error_class      TEXT,
  steps_count      INTEGER NOT NULL DEFAULT 0,
  ai_calls         INTEGER NOT NULL DEFAULT 0,
  log_file_id      TEXT,                           -- files.id of the redacted JSONL step log (run_log)
  cli_version      TEXT NOT NULL,
  UNIQUE (task_id, attempt_no)
);

CREATE TABLE approvals (
  id               TEXT PRIMARY KEY,               -- apr_<ULID>
  user_id          TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('submit','answer','cv_variant','rule_activation')),
  task_id          TEXT,
  application_id   TEXT,
  payload          TEXT NOT NULL,                  -- JSON summary shown to the user (03 §8)
  payload_hash     TEXT NOT NULL,                  -- binds the decision to exactly this content
  state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','expired')),
  response         TEXT,                           -- JSON (e.g. the answer the user typed)
  decided_via      TEXT CHECK (decided_via IN ('web','cli','mcp')),
  decided_by_user_id TEXT,
  decided_at       INTEGER,
  expires_at       INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  revision         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_approvals_pending ON approvals(user_id, state, created_at);

CREATE TABLE submission_evidence (
  id               TEXT PRIMARY KEY,               -- evd_<ULID>
  user_id          TEXT NOT NULL,
  application_id   TEXT NOT NULL,
  task_id          TEXT,
  attempt_id       TEXT,
  kind             TEXT NOT NULL CHECK (kind IN ('browser_confirmation','ats_api_response','email_sent','user_attestation','confirmation_email')),
  verdict          TEXT NOT NULL CHECK (verdict IN ('verified','unverified','negative')),
  signals          TEXT NOT NULL,                  -- JSON (19 §9): url_match, text_match, ai_probability, http_status…
  final_url        TEXT,
  page_title       TEXT,
  text_excerpt     TEXT,                           -- ≤ 2 KB, redacted
  screenshot_file_id TEXT,
  form_hash        TEXT,                           -- matches submit_intent / approval payload_hash
  captured_at      INTEGER NOT NULL,
  recorded_at      INTEGER NOT NULL
);
CREATE INDEX ix_evidence_app ON submission_evidence(application_id);

-- 2.7 Sync infrastructure
CREATE TABLE change_log (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL,
  entity           TEXT NOT NULL,                  -- 'application','user_job','posting','task','approval',…
  entity_id        TEXT NOT NULL,
  revision         INTEGER NOT NULL,
  op               TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  changed_at       INTEGER NOT NULL
);
CREATE INDEX ix_change_user_seq ON change_log(user_id, seq);

CREATE TABLE idempotency_keys (
  user_id          TEXT NOT NULL,
  key              TEXT NOT NULL,
  request_hash     TEXT NOT NULL,                  -- SHA-256 of method+path+body
  status_code      INTEGER NOT NULL,
  response_body    TEXT NOT NULL,                  -- ≤ 64 KB; larger responses store a pointer
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,               -- +7 days (longer than max outbox age)
  PRIMARY KEY (user_id, key)
);
CREATE INDEX ix_idem_expiry ON idempotency_keys(expires_at);

CREATE TABLE user_settings (                      -- one row per user, created lazily with defaults
  user_id                 TEXT PRIMARY KEY,
  locale                  TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','id')),
  timezone                TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  default_mode            TEXT NOT NULL DEFAULT 'approval' CHECK (default_mode IN ('manual','assisted','approval','auto')),
  automation_paused       INTEGER NOT NULL DEFAULT 0,      -- user kill switch: no claims, running tasks pause
  generated_text_allowed  INTEGER NOT NULL DEFAULT 0,      -- AI-drafted free text (cover-letter fields), always approval-gated
  allow_mcp_approvals     INTEGER NOT NULL DEFAULT 0,      -- MCP may decide answer/cv_variant approvals (never submit)
  ai_consent_at           INTEGER,                         -- NULL = AI features off for this user
  ai_scoring_sensitive    INTEGER NOT NULL DEFAULT 1,      -- 0 = exclude sensitive profile fields from AI scoring (07)
  evidence_screenshots    TEXT NOT NULL DEFAULT 'on_submit' CHECK (evidence_screenshots IN ('off','on_submit','all_steps')),
  evidence_retention_days INTEGER NOT NULL DEFAULT 180,
  revision                INTEGER NOT NULL DEFAULT 1,
  updated_at              INTEGER NOT NULL
);

CREATE TABLE ai_usage (                            -- exact AI budget enforcement (D-34, 07 §9)
  user_id          TEXT NOT NULL,
  month            TEXT NOT NULL,                  -- YYYY-MM (UTC)
  purpose          TEXT NOT NULL CHECK (purpose IN ('score','tailor_cv','agent','email_draft')),
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd   INTEGER NOT NULL DEFAULT 0,
  calls            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month, purpose)
);
-- Budget check: SUM(cost_micro_usd) for the month (and today's share via analytics_daily.metrics.ai_cost_micro_usd)
-- before each call; increment with UPDATE … SET calls = calls + 1, … in the same batch as the result write.

CREATE TABLE telemetry_daily (                     -- opt-in anonymous CLI telemetry (22 §8); no user_id
  day              TEXT NOT NULL,
  install_hash     TEXT NOT NULL,                  -- random per-install id, not linked to devices.id
  cli_version      TEXT NOT NULL,
  platform         TEXT NOT NULL,
  counters         TEXT NOT NULL,                  -- JSON {commands:{…}, error_classes:{…}}
  PRIMARY KEY (day, install_hash)
);

CREATE TABLE analytics_daily (                     -- rollup (10 §4)
  user_id          TEXT NOT NULL,
  day              TEXT NOT NULL,                  -- YYYY-MM-DD in the user's timezone
  metrics          TEXT NOT NULL,                  -- JSON counters
  PRIMARY KEY (user_id, day)
);
