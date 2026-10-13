## Context

`apps/api` has one D1 database (`DB`: `mcp_tokens`, `oauth_clients`,
`request_log`), six KV namespaces and resolves callers to
`{email, isAdmin, scope}`. Legacy jobs live in `JOBS_KV` as whole JSON blobs
with email owner stamps. The Job Tracker adds per-user relational data,
devices, OAuth grants and refresh tokens.

## Goals / Non-Goals

- Goals: a stable, non-PII user key for every new row; a separate jobs
  database; additive identity migrations that keep every existing token,
  MCP client and document working; isolation that is checked by tests, not
  by review; a legacy migration that cannot write by accident.
- Non-Goals: changing existing document ownership (CV/invoice/portfolio keep
  email stamps), email-change UX, the `/api/v1` routes themselves (later
  changes), executing any remote migration.

## Decisions

- Decision: `users.id` (`usr_`) is created lazily by caller resolution —
  read first, then `INSERT … ON CONFLICT(email) DO NOTHING RETURNING`, then a
  re-read if a concurrent request won — so no backfill job exists (D-03).
  `mcp_tokens.user_id` is backfilled on the token's next use.
- Decision: a separate `JOBS_DB` (`pilihpendidikan-jobs`) because Time
  Travel restores a whole database and each database has its own size cap
  (D-02). Cross-database `user_id` / `device_id` references are logical and
  enforced in the repository layer.
- Decision: `mcp_tokens.kind` gains `oauth`; SQLite cannot alter a CHECK, so
  `0002` rebuilds the table (create new / copy / drop / rename) in the same
  migration.
- Decision: credential → scope map (05 §1.2): browser sessions get every
  scope except `automation:execute`; `write` personal tokens and MCP OAuth
  tokens (`mcp` ceiling) every scope except `automation:execute`,
  `ai:invoke` and `automation:manage`; `read` personal tokens
  `jobs:read cv:read files:read`; `oauth` rows exactly their stored scopes.
- Decision: kill switches live in `DB.feature_flags`, seeded dark by `0002`
  and read through a 30 s isolate cache; only CLI versions are vars (D-33).
- Decision: isolation is enforced by static tests rather than a lint rule:
  `T11-JOBSDB` fails on any `JOBS_DB` reference outside `repo/**`/`env.ts`
  and on importing the SQL helpers outside `repo/**`; `T11-SQL` parses every
  SQL string in `repo/**` and fails when a statement on a user-scoped table
  lacks a `user_id` predicate, unless it carries an explicit
  `// sql-allow: system | public-posting | anonymous — <why>` marker.
- Decision: the legacy KV → D1 migration is a script, dry run by default,
  that never writes or deletes KV, executes one idempotent batch per job,
  checkpoints, verifies counts plus a 2 % field sample through the facade
  mapping, and records the Time Travel bookmark taken before execution (D-04,
  06 §12.4).
- Alternatives considered: keep email as the key (PII in every row, email
  change breaks ownership); one database (restores roll back credentials);
  a Biome `noRestrictedImports` rule for `JOBS_DB` (04 §5 option 1) —
  replaced by the static test because the binding is a property access, not
  an import.

## Divergences from the spec text (code is authoritative)

- 04 §5 enforcement item 1 (Biome `noRestrictedImports`) is implemented as
  the `T11-JOBSDB` test instead.
- `0002` seeds `JOBS_LEGACY_BACKEND = "kv"` alongside the boolean flags.
- `0003` sets `allowed_scopes = 'mcp'` for every pre-existing DCR client so
  they keep their legacy behaviour.

## Risks / Trade-offs

- Lazy user creation adds a `DB` read on each authenticated call → one
  indexed lookup by unique email; inserts happen once per person.
- Cross-database consistency is not enforced by SQL → account deletion and
  device revocation run explicit multi-database phases (later changes).
- The `mcp_tokens` rebuild is a one-time table copy → done inside the
  migration, verified by `TCORE-MIGRATION` against real SQLite.

## Migration Plan

1. Owner creates `pilihpendidikan-jobs`, the R2 bucket and the queues and
   fills `REPLACE_WITH_JOBS_DB_ID` (14 §8, `DEPLOY.md`).
2. Apply `migrations/0002`, `0003` to `DB` and `migrations-jobs/0001` to
   `JOBS_DB`; deploy with `JOBS_V1_ENABLED = false`.
3. Legacy migration: dry run → owner review → `--execute` → `--verify`.
Rollback: the identity migration is additive (old code ignores the new
columns and tables); `JOBS_DB` can be restored from the recorded Time Travel
bookmark without touching `DB`.

## Open Questions

- None blocking for this change; the remote steps await the owner's go-ahead.
