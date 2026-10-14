-- Cloud discovery flags (job-tracker-spec/24, D-33, D-41). Dark by default:
-- JOBS_CLOUD_DISCOVERY_ENABLED gates the hourly cron, the jobs-scrape queue
-- work and manual runs; JOBS_CLOUD_AI_ENABLED gates the AI fallback and the
-- AI directory classification (AI_DISABLED still wins).
INSERT OR IGNORE INTO feature_flags (key, value, updated_at, updated_by) VALUES
  ('JOBS_CLOUD_DISCOVERY_ENABLED', 'false', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'migration:0004'),
  ('JOBS_CLOUD_AI_ENABLED',        'false', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'migration:0004');
