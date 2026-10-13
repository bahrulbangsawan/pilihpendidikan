# Change: Add stable user ids and the Job Tracker database to the api Worker

## Why

The api Worker identifies people only by their normalized email
(`apps/api/src/auth.ts`, `00` §3): there is no user table and no user id, so
every Job Tracker row would carry an email (PII) and an email change would
break ownership (C-03). The Job Tracker also needs relational storage with
transactions, revisions and per-user queries, which `JOBS_KV` cannot give
(D-04), and its data must be restorable without rolling back credentials
(D-02). Milestone M0 (13 §2, deliverables ④–⑥) lays this foundation.

## What Changes

- `DB` migration `0002_users_devices_oauth.sql`: `users` (`usr_` ids, email
  as the login key, `deleted_at` tombstone), `mcp_tokens` rebuilt with
  `user_id`, `scopes`, `grant_id`, `device_id` and `kind ∈ personal/session/
  oauth`, the OAuth grant / refresh-token / device tables, `feature_flags`
  seeded dark (D-33) and the append-only `support_access_log` (D-26).
  Migration `0003_seed_cli_client.sql` pre-registers the first-party
  `pilih-jobs-cli` client and gives DCR clients the `mcp` scope ceiling.
- Caller resolution creates the `users` row lazily and returns the extended
  caller (`userId`, OAuth `scopes`, `credentialKind`, `deviceId`, `grantId`,
  `tokenId`, `userDeletedAt`) with the 05 §1.2 credential → scope map; the
  legacy `{email, isAdmin, scope}` fields stay for existing routes.
- New D1 database `pilihpendidikan-jobs` (binding `JOBS_DB`) with
  `migrations-jobs/0001_jobs_core.sql` (04 §2 verbatim), plus the
  `JOBS_FILES` R2 bucket, `jobs-ai` queue + DLQ and the 5-minute cron
  declared in `wrangler.jsonc` and `Env`.
- Isolation enforced in code: only `src/jobs/repo/**` touches `JOBS_DB`, and
  every statement on a user-scoped table carries a `user_id` predicate
  (static tests).
- Scripts: `migrate-jobs-kv-to-d1.ts` (gated legacy migration, dry run by
  default), `support-access.ts` (break-glass, logged), `seed-local.ts`
  (local flags only).

Implemented in the working tree (uncommitted, undeployed). Creating the
remote database, bucket and queues, applying remote migrations and running
the legacy migration with `--execute` are owner actions that were **not**
performed.

## Impact

- Affected specs: `api-backend` (ADDED: caller identity, scope map, flags,
  break-glass), `jobs-data` (ADDED: the databases, migrations, isolation,
  legacy migration script).
- Affected code: `apps/api/migrations/0002_*.sql`, `0003_*.sql`,
  `apps/api/migrations-jobs/0001_jobs_core.sql`, `apps/api/src/auth.ts`,
  `apps/api/src/env.ts`, `apps/api/wrangler.jsonc`, `apps/api/package.json`,
  `apps/api/src/jobs/core/{scopes,scope,flags}.ts`,
  `apps/api/src/jobs/repo/core/{db,users}.ts`, `apps/api/src/jobs/isolation.test.ts`,
  `apps/api/scripts/{migrate-jobs-kv-to-d1,support-access,seed-local}.ts`,
  `apps/api/test/fakes.ts`.
- Sources: `job-tracker-spec/03` §1–§2, `04` §1, §2, §4, §5, `05` §1.1–§1.3,
  `06` §12.4, `11` §6, `14` §3, §8, `17` §3.2; decisions D-02, D-03, D-04,
  D-06, D-26, D-33.
- Interaction with pending changes: the `api-backend` requirements of
  `api-add-backend-worker` are not modified here; `jobs-add-dashboard`
  modifies CORS and document ownership, `api-extend-oauth-for-cli` the OAuth
  requirement.
