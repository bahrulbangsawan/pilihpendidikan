-- apps/api D1 schema, step 2 (database `pilihpendidikan`, binding DB).
-- job-tracker-spec/04 §1: canonical users (D-03), structured token scopes,
-- OAuth grants + refresh tokens (17), CLI devices (D-10), feature flags
-- (D-33) and the break-glass support access log (D-26).
--
-- users                 one row per normalized email, created lazily by
--                       resolveCaller (src/auth.ts); `id` = usr_<ULID>
-- mcp_tokens            + user_id, scopes, grant_id, device_id; `kind` widened
--                       to ('personal','session','oauth')
-- oauth_clients         + first_party, allowed_scopes, loopback_any_port
-- oauth_grants          one consent by one user to one client on one device
-- oauth_refresh_tokens  rotation + reuse detection (RFC 9700 §2.2.2)
-- devices               registered CLI installations
-- feature_flags         kill switches / rollout flags, read through a 30 s
--                       isolate cache (src/jobs/core/flags.ts); seeded dark
-- support_access_log    append-only break-glass access records

-- Canonical user identity (D-03). Created lazily by resolveCaller.
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,                    -- usr_<ULID>
  email       TEXT NOT NULL UNIQUE,                -- normalized login key
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER                              -- soft-delete marker during account deletion
);

-- Existing table: add structured scopes and links (ALTER is additive; old rows keep working).
ALTER TABLE mcp_tokens ADD COLUMN user_id   TEXT;      -- backfilled lazily on next use
ALTER TABLE mcp_tokens ADD COLUMN scopes    TEXT;      -- space-delimited OAuth scopes; NULL = legacy write/read
ALTER TABLE mcp_tokens ADD COLUMN grant_id  TEXT;      -- set for OAuth access tokens
ALTER TABLE mcp_tokens ADD COLUMN device_id TEXT;      -- set for CLI access tokens

-- kind gains 'oauth' (access tokens minted by /oauth/token from now on).
-- SQLite cannot alter a CHECK, so the table is rebuilt: create the widened
-- table, copy every row and column, drop the old table, rename. The migration
-- runs as one transaction, so no row can be lost between the copy and the drop.
CREATE TABLE mcp_tokens_new (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  kind TEXT NOT NULL DEFAULT 'personal'
    CHECK (kind IN ('personal', 'session', 'oauth')),
  scope TEXT NOT NULL DEFAULT 'write'
    CHECK (scope IN ('write', 'read')),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER,
  expires_at INTEGER,
  user_id TEXT,
  scopes TEXT,
  grant_id TEXT,
  device_id TEXT
);

INSERT INTO mcp_tokens_new (
  id, user_email, token_hash, label, status, kind, scope,
  created_at, revoked_at, last_used_at, expires_at,
  user_id, scopes, grant_id, device_id
)
SELECT
  id, user_email, token_hash, label, status, kind, scope,
  created_at, revoked_at, last_used_at, expires_at,
  user_id, scopes, grant_id, device_id
FROM mcp_tokens;

DROP TABLE mcp_tokens;

ALTER TABLE mcp_tokens_new RENAME TO mcp_tokens;

-- The 0001 index went with the old table; recreate it on the rebuilt one.
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user_kind
  ON mcp_tokens(user_email, kind, created_at);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_grant ON mcp_tokens(grant_id);

-- First-party clients are pre-registered rows (client_id 'pilih-jobs-cli').
ALTER TABLE oauth_clients ADD COLUMN first_party        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_clients ADD COLUMN allowed_scopes     TEXT;    -- space-delimited ceiling
ALTER TABLE oauth_clients ADD COLUMN loopback_any_port  INTEGER NOT NULL DEFAULT 0; -- RFC 8252 §7.3

-- One grant = one consent by one user to one client on one device.
CREATE TABLE IF NOT EXISTS oauth_grants (
  id             TEXT PRIMARY KEY,                 -- grt_<ULID>
  user_id        TEXT NOT NULL REFERENCES users(id),
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id),
  device_id      TEXT,                             -- devices.id once registered
  scopes         TEXT NOT NULL,                    -- granted scopes
  created_at     INTEGER NOT NULL,
  last_used_at   INTEGER,
  revoked_at     INTEGER,
  revoked_reason TEXT CHECK (revoked_reason IN
                  ('user','device_revoked','refresh_reuse','admin','account_deleted'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_user ON oauth_grants(user_id, created_at);

-- Refresh tokens with rotation + reuse detection (RFC 9700 §2.2.2).
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id            TEXT PRIMARY KEY,                  -- rft_<ULID>
  grant_id      TEXT NOT NULL REFERENCES oauth_grants(id),
  token_hash    TEXT NOT NULL UNIQUE,              -- SHA-256 hex
  parent_id     TEXT,                              -- previous token in the family
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,                  -- absolute (grant created_at + 90 d) or idle (+30 d), whichever first
  used_at       INTEGER,                           -- set when exchanged; a second use = reuse
  revoked_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_refresh_grant ON oauth_refresh_tokens(grant_id);

-- Registered CLI installations (D-10).
CREATE TABLE IF NOT EXISTS devices (
  id              TEXT PRIMARY KEY,                -- dev_<ULID>
  user_id         TEXT NOT NULL REFERENCES users(id),
  grant_id        TEXT NOT NULL UNIQUE REFERENCES oauth_grants(id),
  name            TEXT NOT NULL,                   -- user-editable, default "<hostname> (<os>)"
  platform        TEXT NOT NULL CHECK (platform IN ('macos','windows','linux')),
  arch            TEXT NOT NULL,
  cli_version     TEXT NOT NULL,
  public_key      TEXT,                            -- Ed25519 SPKI base64url; reserved for DPoP (17 §11)
  capabilities    TEXT NOT NULL DEFAULT '[]',      -- JSON: ["discover","apply","render_cv","headed_browser"]
  accepts_tasks   INTEGER NOT NULL DEFAULT 1,      -- user toggle: may this device claim remote tasks
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER,
  last_ip_hash    TEXT,                            -- first 16 hex of SHA-256(ip); no raw IPs
  revoked_at      INTEGER,
  revision        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, revoked_at);

-- Kill switches and rollout flags (D-33), read through a 30 s isolate cache.
CREATE TABLE IF NOT EXISTS feature_flags (
  key         TEXT PRIMARY KEY,                    -- canonical keys (D-33): JOBS_V1_ENABLED, JOBS_CLI_LOGIN_ENABLED,
                                                   -- JOBS_AUTOMATION_ENABLED, JOBS_AUTO_MODE_ENABLED,
                                                   -- JOBS_EMAIL_SERVER_SEND_ENABLED, AI_DISABLED, JOBS_LEGACY_BACKEND
  value       TEXT NOT NULL,                       -- JSON scalar
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL                        -- operator email (admin script only)
);

-- Dark launch (02 §7, 14 §3): every Job Tracker surface starts off. The
-- owner's admin script flips them; local dev uses `bun run db:seed:local`.
INSERT OR IGNORE INTO feature_flags (key, value, updated_at, updated_by) VALUES
  ('JOBS_V1_ENABLED',                'false', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'migration:0002'),
  ('JOBS_CLI_LOGIN_ENABLED',         'false', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'migration:0002'),
  ('JOBS_AUTOMATION_ENABLED',        'false', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'migration:0002'),
  ('JOBS_AUTO_MODE_ENABLED',         'false', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'migration:0002'),
  ('JOBS_EMAIL_SERVER_SEND_ENABLED', 'false', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'migration:0002'),
  ('AI_DISABLED',                    'false', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'migration:0002'),
  ('JOBS_LEGACY_BACKEND',            '"kv"',  CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'migration:0002');

-- Break-glass support access to another user's jobs data (D-26). Append-only.
CREATE TABLE IF NOT EXISTS support_access_log (
  id              TEXT PRIMARY KEY,                -- sal_<ULID>
  operator_email  TEXT NOT NULL,
  subject_user_id TEXT NOT NULL,
  reason          TEXT NOT NULL,
  ticket_ref      TEXT,
  scope           TEXT NOT NULL,                   -- e.g. "read:applications"
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_access_subject ON support_access_log(subject_user_id, created_at);
