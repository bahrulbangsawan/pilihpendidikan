# Change: Add the pilih-jobs CLI, local discovery and sync

## Why

The Job Tracker runs discovery and browser automation on the user's own
machine (job-tracker-spec 01, 02): Scrapling is Python-only (D-07), browser
profiles and cookies must never leave the machine, and the cloud
(`apps/api` + `JOBS_DB`) stays the single source of truth. That needs a local
CLI that signs in with the OAuth extension of `api-extend-oauth-for-cli`,
discovers postings politely from official ATS APIs, and synchronises through
an idempotent outbox and a change feed — plus the dashboard screens that show
what it found (Inbox, Sources) and how to connect it (`/cli`).

## What Changes

- New Python 3.12 project `apps/jobs-cli` (uv, hatchling, `uv.lock`; PyPI
  dist `pilih-jobs`, package `pilih_jobs`, executables `pilih-jobs` and `pj`,
  D-07/D-08), a Turborepo shim `package.json` guarded by
  `scripts/require-uv.sh`, Typer command tree of 16 §3.3 with global flags,
  JSON envelopes / NDJSON events and the stable exit codes of 16 §3.2.
- Pydantic v2 models generated from `packages/jobs-contracts` JSON Schema
  (D-20) with a freshness check; Python ports of ids, fingerprint, canonical
  URL, PSL and the stage machine that reproduce the contract golden vectors.
- OAuth PKCE loopback login, device registration, keyring / opt-in encrypted
  file credential store (never plaintext), refresh under `auth.lock`,
  logout with RFC 7009 revocation; config TOML with flags > env > file >
  defaults; JSONL logs with a mandatory redaction filter; opt-in anonymous
  telemetry and crash reports (`POST /api/v1/telemetry[/crash]`); version
  gate (`/meta`, 426 → exit 10); `doctor`, `update`, `uninstall`,
  `version`, `devices`.
- Discovery (15): `ScraplingJobEngine` as the only Scrapling importer, the
  three-layer forbidden-feature guard (D-16, D-36), robots.txt always obeyed,
  politeness scheduler, wrapper-owned backoff with jitter and `Retry-After`,
  the error taxonomy, normalization / validation / fingerprinting,
  provenance, incremental cursors, expiry checks, the Greenhouse, Lever and
  Ashby official-API adapters and D-17 exclusions; `pilih-jobs discover`.
  (The other six adapters are recorded by `jobs-add-auto-apply`.)
- Server side (05 §4, §11): sources CRUD validated against `adapters.json`,
  `GET /sources/adapters`, discovery runs, `postings:batch` (≤ 100 items,
  ≤ 1 MB), `complete` with closure after two missed complete runs, inbox,
  `inbox:bulk` (≤ 200), manual user-jobs, change feed `GET /changes` and
  `GET /snapshot` with `410 cursor_expired`.
- Sync (20): `state.db` per 20 §3, outbox ordering / priority / `depends_on`
  / coalescing / full-jitter backoff / 7-day dead letters, change-feed pull
  into `entity_cache`, snapshot recovery, clock offset.
- `apps/jobs`: Inbox (`/inbox`, `/jobs/$ujbId`), Sources (`/sources`) and the
  CLI & devices page (`/cli`, 22 §12).

Implemented in the working tree (uncommitted). Nothing is published to
TestPyPI/PyPI, no Homebrew/Scoop/winget channel exists, nothing is deployed.

## Impact

- Affected specs: `jobs-cli` (new), `jobs-discovery` (new), `jobs-sync`
  (new).
- Affected code: `apps/jobs-cli/**` (except `browser/`, `agent/`, `policy/`,
  `tasks/`, `cv/`, `email/` and their commands, recorded by the
  browser-agent, CV-variant and email changes), `scripts/require-uv.sh`,
  `apps/api/src/jobs/{routes,services,repo}/{discovery,sync}/**`,
  `apps/api/src/jobs/routes/account` (telemetry routes),
  `apps/jobs/src/routes/{inbox,jobs.$ujbId,sources,cli}.tsx`,
  `apps/jobs/src/components/{inbox,sources,cli}/**`,
  `packages/jobs-contracts/{adapters.json,cli-commands.json}`.
- Sources: job-tracker-spec 15, 16, 20, 22, 05 §1.4–§1.7, §2–§4, §10a
  (telemetry), §11, 12 §4, §7, §8, 03 §4; decisions D-07, D-08, D-16, D-17,
  D-20, D-21, D-22, D-36; assumptions A-04, A-06, A-11.
- Depends on `jobs-add-contracts-and-schema`, `api-add-user-ids-and-jobs-db`,
  `api-extend-oauth-for-cli` and `jobs-add-dashboard`.
