-- apps/api D1 data, step 3 (database `pilihpendidikan`, binding DB).
-- job-tracker-spec/17 §3.2: the pre-registered first-party public client of
-- the `pilih-jobs` CLI, plus the `mcp` scope ceiling for every client that
-- registered itself through RFC 7591 DCR before this migration.
--
-- `first_party` and `allowed_scopes` are only ever set by migrations; DCR
-- (`/oauth/register`) refuses client ids starting with `pilih-`.

INSERT OR IGNORE INTO oauth_clients (
  client_id,
  client_secret_hash,
  client_name,
  redirect_uris,
  token_endpoint_auth_method,
  created_at,
  first_party,
  allowed_scopes,
  loopback_any_port
) VALUES (
  'pilih-jobs-cli',
  '',
  'pilih-jobs CLI',
  '["http://127.0.0.1/callback", "http://[::1]/callback"]',
  'none',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  1,
  'jobs:read jobs:write discovery:write automation:execute automation:manage cv:read cv:write files:read files:write ai:invoke devices:manage offline_access',
  1
);

-- DCR clients keep their legacy behaviour: the `mcp` ceiling maps to the
-- personal `write` scope set (05 §1.2).
UPDATE oauth_clients
SET allowed_scopes = 'mcp'
WHERE allowed_scopes IS NULL AND first_party = 0;
