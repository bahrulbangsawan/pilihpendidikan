-- apps/api D1 schema (database `pilihpendidikan`, binding DB).
--
-- mcp_tokens     every bearer this Worker accepts, stored as SHA-256 only:
--                personal tokens (minted at /connect, no expiry until revoked)
--                and session rows (browser sign-ins and OAuth access tokens,
--                which expire). `scope` limits what the bearer may do.
-- oauth_clients  RFC 7591 dynamically registered MCP clients.
-- request_log    one row per MCP tool call, purged after retention_until.

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  kind TEXT NOT NULL DEFAULT 'personal'
    CHECK (kind IN ('personal', 'session')),
  scope TEXT NOT NULL DEFAULT 'write'
    CHECK (scope IN ('write', 'read')),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user_kind
  ON mcp_tokens(user_email, kind, created_at);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  -- Empty for public clients (token_endpoint_auth_method = 'none').
  client_secret_hash TEXT NOT NULL,
  client_name TEXT,
  -- JSON array of registered redirect URIs.
  redirect_uris TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_basic'
    CHECK (token_endpoint_auth_method IN
      ('client_secret_basic', 'client_secret_post', 'none')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_created_at
  ON oauth_clients(created_at);

CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  caller_email TEXT NOT NULL,
  -- First 16 hex chars of SHA-256(caller_email), for analytics that must
  -- survive redacting caller_email.
  caller_email_hash TEXT,
  tool TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('cv', 'invoice', 'portfolio', 'jobs')),
  resource_id TEXT,
  status TEXT NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'error')),
  duration_ms INTEGER,
  params TEXT,
  retention_until INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_log_ts
  ON request_log(ts);
CREATE INDEX IF NOT EXISTS idx_request_log_caller_ts
  ON request_log(caller_email, ts);
CREATE INDEX IF NOT EXISTS idx_request_log_resource_id
  ON request_log(resource_id);
CREATE INDEX IF NOT EXISTS idx_request_log_retention_until
  ON request_log(retention_until);
