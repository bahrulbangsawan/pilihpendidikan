## 1. CLI foundation (`apps/jobs-cli`, leaf-4.1)

- [x] 1.1 uv project, `pyproject.toml` (dist `pilih-jobs`, scripts `pilih-jobs` / `pj`), `uv.lock`, `.python-version`, Turborepo shim `package.json`, `scripts/require-uv.sh`, README, `THIRD_PARTY_NOTICES`
- [x] 1.2 Generated contracts and ports (`src/pilih_jobs/contracts/`, `scripts/gen_contracts.py --check`); T16-CONTRACT, TCLI-FP, TCLI-URL, TCLI-PSL, TCLI-STAGE, TCLI-IDS
- [x] 1.3 Typer app, global flags, envelopes / NDJSON / exit codes (`cli/app.py`, `cli/context.py`, `cli/output.py`, `errors.py`); T16-UNIT, TCLI-EXIT
- [x] 1.4 Config TOML + precedence, platformdirs paths (`config.py`, `paths.py`); TCLI-CONFIG
- [x] 1.5 Logging with the redaction filter (`logging.py`); T11-REDACT, T17-13
- [x] 1.6 API client: UA / `X-Pilih-Client`, idempotency keys, 401 → one refresh, 426 → exit 10 (`api/`); T16-COMPONENT, TCLI-426
- [x] 1.7 Login (PKCE, loopback, metadata, device registration), credential stores, refresh under `auth.lock`, logout (`auth/`, `cli/auth.py`); T17-09, T17-10, T17-11, T17-12, TCLI-KEYRING
- [x] 1.8 `status`, `config`, `version`, `doctor` (+ `--bundle`), `update`, `uninstall`, `devices` (`cli/status.py`, `cli/config.py`, `cli/system.py`, `cli/devices.py`)
- [x] 1.9 Opt-in telemetry and crash reports (`telemetry/__init__.py`); TCLI-TELEMETRY; server routes `POST /api/v1/telemetry[/crash]` (`apps/api/src/jobs/routes/account`, TP-TELEMETRY, TP-CRASH)
- [x] 1.10 leaf-4.1 gates G1–G8 verified (`.unlazy/jobs/status.log`: "leaf-4.1 VERIFIED"): pytest, ruff + import-linter, pyright 0 errors, fresh contracts, `--help` flags, wheel install, files

## 2. Sync (`apps/jobs-cli/src/pilih_jobs/{storage,sync}`, `apps/api` sync routes)

- [x] 2.1 `state.db` per 20 §3 (`storage/migrations/001_initial.sql`); TCLI-STATEDB
- [x] 2.2 Outbox ordering, priority, `depends_on`, quarantine (`sync/outbox.py`); T20-01
- [x] 2.3 Flusher retry / dead letters / 426 pause (`sync/flusher.py`, `sync/backoff.py`); T20-02
- [x] 2.4 Coalescing with `sha256(sorted child keys)`; T20-03
- [x] 2.5 Change-feed puller, entity cache, snapshot (`sync/puller.py`, `sync/cache.py`, `sync/engine.py`); T20-04, T20-12
- [x] 2.6 Clock offset and monotonic lease deadlines (`clock.py`); T20-05
- [x] 2.7 `GET /api/v1/changes` and `GET /api/v1/snapshot` with 410 `cursor_expired` (`apps/api/src/jobs/{routes,services,repo}/sync`); TS-CHANGES, TS-SNAPSHOT, TS-CURSOR-EXPIRED (leaf-2.8 VERIFIED)
- [x] 2.8 Idempotency replay / mismatch and revision conflicts in the router kernel (`apps/api/src/jobs/core/{router,revision}.ts`, `repo/core/idempotency.ts`); TCORE-IDEMPOTENCY, TCORE-REVISION (leaf-2.1 VERIFIED)

## 3. Discovery (`apps/jobs-cli`, leaf-4.2)

- [x] 3.1 `ScraplingJobEngine` and the three-layer guard (`discovery/engine/`); T15-ENGINE, T15-POLICY, T11-STEALTH (`tests/discovery/test_policy.py`)
- [x] 3.2 Robots gate, politeness scheduler, wrapper retries, error taxonomy (`discovery/{robots,politeness,retry,errors,classify}.py`); TDISC-ROBOTS, TDISC-BACKOFF, T15-UNIT
- [x] 3.3 Normalization, validation, fingerprints, provenance, dedupe and `seen_postings` (`discovery/{normalize,items,seen}.py`); T15-UNIT
- [x] 3.4 Incremental cursors and expiry checks (`discovery/{cursor,expiry}.py`); TDISC-INCREMENTAL, TDISC-EXPIRY
- [x] 3.5 Greenhouse, Lever, Ashby adapters with recorded fixtures (`adapters/{greenhouse,lever,ashby}.py`); T15-ADAPTER-GREENHOUSE, T15-ADAPTER-LEVER, T15-ADAPTER-ASHBY (the other six adapters are recorded in `jobs-add-auto-apply`)
- [x] 3.6 D-17 exclusions before any request (`contracts/adapters.py`, `discovery/sources.py`); T15-EXCLUSION, S-29 (CLI half)
- [x] 3.7 DiscoveryManager → outbox and the `discover` command with NDJSON / Rich progress (`discovery/{manager,runner,sync}.py`, `cli/discover.py`); T15-SYNC, S-07 (CLI half)
- [x] 3.8 leaf-4.2 gates G1–G5 verified (`.unlazy/jobs/status.log`: "leaf-4.2 VERIFIED")

## 4. Discovery API (`apps/api/src/jobs/{routes,services,repo}/discovery`, leaf-2.4)

- [x] 4.1 Sources CRUD + `GET /sources/adapters`, D-17 → 422; TD-SOURCES, TD-ADAPTERS, S-29 (API half)
- [x] 4.2 Runs, `postings:batch` limits, unchanged-only items, private postings, dedupe groups, close hints, `complete`; TD-RUN, TD-BATCH-LIMITS, TD-UNCHANGED, TD-PRIVATE, TD-DEDUPE, TD-CLOSE-HINT, T20-09, T20-10, T20-11, S-07 (API half)
- [x] 4.3 Inbox, `inbox:bulk`, manual user-jobs; TD-INBOX, TD-BULK, TD-MANUAL-URL
- [x] 4.4 leaf-2.4 gates G1–G5 verified (`.unlazy/jobs/status.log`: "leaf-2.4 VERIFIED"); every route in the S-31 isolation sweep (leaf-2.11 VERIFIED)

## 5. Dashboard screens (`apps/jobs`, leaf-3.2)

- [x] 5.1 Inbox and tracked job (`src/routes/inbox.tsx`, `src/routes/jobs.$ujbId.tsx`, `src/components/inbox/**`); TW-INBOX
- [x] 5.2 Sources (`src/routes/sources.tsx`, `src/components/sources/**`); TW-SOURCES
- [x] 5.3 CLI & devices page from `cli-commands.json` with 3 s device polling (`src/routes/cli.tsx`, `src/components/cli/**`, `src/lib/polling.ts`); TW-DEVICES
- [x] 5.4 leaf-3.2 gates G1–G7 verified (`.unlazy/jobs/status.log`: "leaf-3.2 VERIFIED")

## 6. Handoffs

- [x] 6.1 Handoff recorded (NOT executed here — e2e suite / owner): the full-stack scenarios now exist in `e2e/` against real local processes (`wrangler dev`, the CLI through `uv run`, Chromium): `e2e/auth.test.ts` covers S-04, S-05, S-32, T17-14 and T17-15, `e2e/discovery.test.ts` covers S-06, S-07 and S-08 (`bun run e2e`; nightly `.github/workflows/e2e.yml`; what stays unautomated is in `e2e/HANDOFF.md`). This change does not claim them passing: the e2e suite's own gate reports the result. Component-level S-07, S-29 and the 426 gate (TCLI-426, the api router's S-32 case) pass
- [x] 6.2 Handoff recorded (NOT executed — owner action): the CI OS matrix for A-04 is defined in `.github/workflows/cli-matrix.yml` (`cli-platform`: macOS arm64 / x64, Windows, Ubuntu x64 / arm64; wheel install through the hub's install script, `doctor --json`, `browser install`, headless agent fixtures, `discover --dry-run` against recorded boards) next to `cli-test` on Python 3.11–3.13; no run has happened yet (it needs the repository's GitHub Actions)
- [x] 6.3 Handoff recorded (NOT executed — owner action): publishing `pilih-jobs` to TestPyPI and PyPI, and the Homebrew tap, Scoop bucket and winget channels (22 §2, §7). The pipeline exists — `.github/workflows/release-cli.yml` (Trusted Publishing with attestations, SBOM, checksums, owner-gated environments), the Homebrew / Scoop templates and `render.py` in `apps/jobs-cli/packaging/`, the install scripts `apps/home/public/install-cli.{sh,ps1}` — and `DEPLOY.md` § pilih-jobs CLI releases lists the owner's one-time setup; nothing was published
- [x] 6.4 Handoff recorded (NOT executed — owner decision): A-06 (Python + uv in the workspace) and A-11 (MIT licence) remain open owner decisions
- [x] 6.5 Handoff recorded (NOT executed — owner action): deploying `apps/api` and `apps/jobs` and turning on `JOBS_V1_ENABLED` / `JOBS_CLI_LOGIN_ENABLED` remotely
