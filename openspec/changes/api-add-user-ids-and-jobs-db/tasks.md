## 1. Identity database (`DB`)

- [x] 1.1 `apps/api/migrations/0002_users_devices_oauth.sql`: `users`, `mcp_tokens` rebuild (`kind` + `user_id`, `scopes`, `grant_id`, `device_id`), `oauth_clients` columns, `oauth_grants`, `oauth_refresh_tokens`, `devices`, `feature_flags` seeded dark, `support_access_log` (TCORE-MIGRATION)
- [x] 1.2 `apps/api/migrations/0003_seed_cli_client.sql`: `pilih-jobs-cli` first-party client; `mcp` ceiling for earlier DCR clients
- [x] 1.3 Lazy `users` row (`apps/api/src/jobs/repo/core/users.ts`: `ensureUser`, `backfillTokenUserId`)

## 2. Caller resolution

- [x] 2.1 `resolveCaller` / `resolveBearer` return `userId`, `scopes`, `credentialKind`, `deviceId`, `grantId`, `tokenId`, `userDeletedAt` (`apps/api/src/auth.ts`; TCORE-CALLER)
- [x] 2.2 Credential → scope map of 05 §1.2 (`apps/api/src/jobs/core/scopes.ts`; TCORE-SCOPES)
- [x] 2.3 Tombstoned users refused with 401 `revoked_token` by the `/api/v1` router (`apps/api/src/jobs/core/router.ts`; TCORE-ROUTER)
- [x] 2.4 Feature flags from `DB.feature_flags` with a 30 s cache (`apps/api/src/jobs/core/flags.ts`, `FLAG_CACHE_TTL_MS`; TCORE-FLAGS)

## 3. Jobs database (`JOBS_DB`) and bindings

- [x] 3.1 `apps/api/migrations-jobs/0001_jobs_core.sql` (04 §2 verbatim; TCORE-JOBS-SCHEMA); `db:migrate:jobs:local` script (`apps/api/package.json`)
- [x] 3.2 `wrangler.jsonc` + `src/env.ts`: `JOBS_DB` (placeholder id), `JOBS_FILES`, `JOBS_AI_QUEUE` + consumers and DLQ, 5-minute cron, the Job Tracker vars
- [x] 3.3 Test fakes: second real SQLite database with real migrations, transactional batch, R2 and Queue fakes (`apps/api/test/fakes.ts`)
- [x] 3.4 `.dev.vars.example` and `scripts/seed-local.ts` (`db:seed:local`, local only)

## 4. Isolation

- [x] 4.1 `JobsDb` opaque handle and repo-only SQL helpers (`apps/api/src/jobs/repo/core/db.ts`)
- [x] 4.2 Static tests `T11-JOBSDB` and `T11-SQL` (`apps/api/src/jobs/isolation.test.ts`) with the `sql-allow` marker convention

## 5. Scripts

- [x] 5.1 `scripts/migrate-jobs-kv-to-d1.ts` (dry run default, inventory past 1,000 keys, classify, plan, idempotent execute, checkpoint, verify, Time Travel bookmark; T6-10, S-02 with `scripts/fixtures/` — leaf-2.10 gate G1 verified)
- [x] 5.2 `scripts/support-access.ts` (ticket/reason/operator required, log before read, SELECT-only; TL-BREAKGLASS)

## 6. Verification

- [x] 6.1 Scoped api tests (`auth.test.ts`, `jobs/isolation.test.ts`, `jobs/core/migrations.test.ts`, `jobs/core/router.test.ts`, both script tests, `cv-engine-boundary.test.ts`): 81 pass, 0 fail; leaf-2.1 gate G1 verified (status.log)
- [x] 6.2 Handoff recorded (NOT executed — owner action): create D1 `pilihpendidikan-jobs`, R2 `pilihpendidikan-jobs-files`, queues `jobs-ai` / `jobs-ai-dlq`, and fill `REPLACE_WITH_JOBS_DB_ID` (14 §8, `DEPLOY.md`). No Cloudflare resource was created
- [x] 6.3 Handoff recorded (NOT executed — owner action): apply `migrations/0002`, `0003` and `migrations-jobs/0001` to the remote databases; only local and in-memory migrations were run
- [x] 6.4 Handoff recorded (NOT executed — owner action): run `migrate-jobs-kv-to-d1.ts` against production `JOBS_KV` as a dry run, review the report, then `--execute` and `--verify`. The script ran only against local fixtures
- [x] 6.5 Handoff recorded (NOT executed — owner action): `bunx wrangler secret put OPENAI_API_KEY` and deploying `apps/api` with `JOBS_V1_ENABLED = false`
