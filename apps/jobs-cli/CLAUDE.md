# apps/jobs-cli — `pilih-jobs` (Python CLI)

The local execution engine of the Job Tracker (spec `job-tracker-spec/16`–`22`): discovery,
browser automation and sync with `apps/api`. Python 3.12 via **uv** (`.python-version`),
hatchling, `uv.lock` committed. Dist `pilih-jobs`, import package `pilih_jobs`,
executables `pilih-jobs` and `pj` (`pilih_jobs.cli.app:main`). `package.json` is only a
Turborepo shim; every script calls `../../scripts/require-uv.sh` first.

## Commands (run in this directory)

- `uv sync` — create `.venv` with runtime + dev dependencies (only leaf 4.1 / the owner adds deps)
- `bun run test` — `pytest -m "not e2e and not live and not browser"`; `test:browser`, `test:e2e`
  (browser tests need `uv run playwright install chromium` once). The whole non-e2e suite:
  `uv run pytest -m 'not e2e and not live'` (about 10 minutes, real headless Chromium)
- `bun run lint` — `ruff check` + `ruff format --check` (src, tests, scripts) + `lint-imports`
- `bun run typecheck` — `pyright` (strict on `src/`, generated models excluded)
- `bun run contracts` / `contracts:check` — `scripts/gen_contracts.py` (needs Bun for the route index)
- `bun run build` — `uv build` (wheel + sdist into `dist/`)
- `uv run python scripts/gen_notices.py` — regenerate `THIRD_PARTY_NOTICES`
- From the repo root: `bun run check` runs this package's `lint` and `test` through turbo, `bun run contracts:check` its `contracts:check`, `bun run check-types` its `typecheck`, and `bun run audit:python` runs `pip-audit --strict` over `uv export` of `uv.lock` (this package's own `bun run audit` audits the editable project itself, which `--strict` refuses)
- `uv run pilih-jobs --api-url http://localhost:8788 …` — against the local api (`bun run dev:api` at the root, Job Tracker migrated and seeded in `apps/api`); the full-stack scenarios are `bun run e2e` at the root

## Layout (16 §2)

| Path | What | Owner |
|---|---|---|
| `src/pilih_jobs/version.py` | `__version__` (keep equal to `pyproject.toml`), UA, `X-Pilih-Client`, semver compare | 4.1 |
| `paths.py`, `config.py`, `errors.py`, `logging.py`, `clock.py`, `environment.py`, `runtime.py` | platformdirs layout (`PILIH_JOBS_HOME` override), TOML config + precedence, exit codes, JSONL logs + redaction, clock offset, machine facts, the `Runtime` wiring object | 4.1 |
| `contracts/` | `_generated/` Pydantic models + route `index.json`, `data/` copies (never hand-edited); `ids`, `fingerprint`, `url` (WHATWG subset), `psl`, `stage` ports; `index` (route table, `model(name)`); `adapters` (manifest, D-17 exclusions) | 4.1 |
| `storage/` | `state.db` (20 §3 exactly; `migrations/NNN_*.sql`, `PRAGMA user_version`), `locks.FileLock` (`state.lock`, `auth.lock`, `worker.lock`) | 4.1 |
| `api/` | `ApiClient` (httpx, idempotency keys, 401 → one refresh, 426, meta gate), `errors` (envelope → typed exceptions → exit codes) | 4.1 |
| `auth/` | PKCE, RFC 8414 metadata, loopback listener, keyring / encrypted-file stores, `TokenManager` (refresh under `auth.lock`), `flow.login/logout` | 4.1 |
| `sync/` | `Outbox`, `OutboxFlusher` (+ `FlushHooks`), `ChangeFeedPuller`, `EntityCache`, `SyncEngine` | 4.1 |
| `telemetry/` | opt-in counters, crash reports | 4.1 |
| `cli/app.py`, `context.py`, `output.py`, `auth.py`, `status.py`, `sync.py`, `config.py`, `devices.py`, `system.py` | root app, global flags, envelopes/NDJSON, this leaf's commands | 4.1 |
| `discovery/` (+ `discovery/engine/`), `adapters/`, `cli/discover.py` | discovery (15); `run_discovery()` | 4.2 |
| `browser/`, `agent/`, `policy/`, `cli/browser.py` | browser + agent (18, 19); `run_attempt()`, `render_cv_page()`. Tests: `tests/fixtures/ats_server/` (fixture ATS on a random loopback port, reached through Chromium `--host-resolver-rules`; `FakeChannel` + `FakeAi`; prompt-injection corpus) | 4.3 |
| `tasks/`, `cv/`, `email/`, `cli/{apply,worker,cv,email,board,inbox,approvals,rules,logs}.py` | worker, leases, LeaseChannel, remaining commands | 4.4 |
| `tests/integration/` | cross-leaf tests: `sync` hooks, headless config, the worker with the real agent (`CloudFake` + fixture ATS), terminal hooks | 4.5 |
| `packaging/` | Distribution templates (22 §2): `homebrew/pilih-jobs.rb` (`Language::Python::Virtualenv`, `python@3.12`), `scoop/pilih-jobs.json` (installs uv, then `uv tool install`s the wheel into the app dir) and `render.py`, which fills both for one release from `dist/` and `uv.lock` (`uv run python packaging/render.py --dist dist --out <dir>`). Nothing is published from here | 5.3 |

## Distribution and CI

- Install channels (22 §2): `uv tool install pilih-jobs` (primary), `pipx`, `uvx pilih-jobs doctor`, the hub's install scripts (`apps/home/public/install-cli.sh` / `.ps1`: uv via Astral's installer if missing, `uv tool install --python 3.12 pilih-jobs`, `pilih-jobs browser install`), later Homebrew and Scoop. `cli-commands.json` in `packages/jobs-contracts` is what the dashboard's `/cli` page shows; flip `available` there when a channel exists.
- CI (`.github/workflows/`): `ci.yml` runs the root `check` / `check-types` / `build` (this package included); `cli-matrix.yml` runs `cli-lint`, `cli-test` (Python 3.11–3.13), and `cli-platform` (macOS arm64 / x64, Windows, Ubuntu x64 / arm64: install script with the built wheel → `doctor --json` → `browser install` → `tests/browser/test_fixture_scenarios.py` headless → `discover --dry-run` against `.github/scripts/fixture-boards.py`); `nightly-live.yml` runs `tests/discovery/test_live_canary.py` when the owner opts in.
- Releases (22 §7): bump `__version__` and the `pyproject.toml` version together (`0.2.0-beta.1` ↔ `0.2.0b1`), then a `cli-vX.Y.Z` tag runs `release-cli.yml` (TestPyPI → PyPI via Trusted Publishing, owner-approved; `DEPLOY.md` § pilih-jobs CLI releases).

## Cross-leaf interfaces (PLAN C6 — keep the signatures)

- `pilih_jobs.agent.types`: `LeaseChannel` (Protocol: `events`, `create_approval`,
  `poll_approval`, `submit_intent` (raises unless 200), `ai`, `upload_file`, `download_file`;
  events `lost`, `cancel_requested`, `resume_requested`), `AttemptContext`, `AttemptResult`;
  `pilih_jobs.agent.run_attempt(ctx)`. Conventions are in the `agent/types.py` docstring.
  The runner (`tasks.runner`) builds `AttemptContext.options` from the caller's
  `AttemptOptions` template (`ExecutionOptions.attempt`, `WorkerOptions.attempt`,
  `ApplyOrchestrator(attempt=…)`; the interactive `apply` adds the terminal hooks) plus
  `data_dir`, the configured browser and an `on_event` relay; `headed` comes from
  `decide_headed()` (18 §5: assisted headed; flags win; approval headless only with
  `apply.headless_approval`; auto per adapter `headless_ok`). An `AttemptResult` with
  `details.lease_lost` (or `error_class = "lease_lost"`) fences the lease: nothing is
  reported under it again (21 §5.3).
- `pilih_jobs.browser.headless.render_cv_page(url, *, timeout_s=60) -> dict`.
- `pilih_jobs.discovery.run_discovery(options: DiscoveryOptions, *, ctx: DiscoveryRuntime)
  -> DiscoveryRunResult` (`DiscoveryRuntime(outbox, api, emit, cancel, runtime)`).
- Core services for everyone: `Runtime` (`rt.db`, `rt.clock`, `rt.config`, `rt.paths`,
  `async with rt.api_client() as api`), `Outbox.enqueue(...)` inside `rt.db.transaction()`
  with the matching checkpoint (20 §3), `FlushHooks.on_success/on_dead/resolve_conflicts`
  (regex on the path, `re.search`; every process that flushes — `sync`, the worker, `apply`,
  `discover` — uses `tasks.hooks.task_hooks(db, issuer)`, which also registers the discovery
  hooks), `SyncEngine`, `EntityCache`, `contracts.index.model(name)`,
  `pilih_jobs.logging.{get_logger, log_event, bind, StepLog, field_value_log, redact}`,
  `clock.ClockSync.observe(server_time)` / `lease_deadline(...)`, `storage.locks.FileLock`.

## Adding commands

Each `cli/<group>.py` exposes `register(app: typer.Typer) -> None` and is listed in
`cli/app.py` (already done for every C6 group; owners replace the placeholder body).
Inside a command: `st = state(ctx)`, `rt = st.runtime()`, `st.run(coro)` for async work,
`st.out.result(data, human=renderer)` for output, `st.out.event(type, **fields)` for NDJSON
progress (16 §5), `st.confirm(...)` (never `--yes` for submissions: `submission=True`).
Raise `PilihError` subclasses (`errors.py`) — never `sys.exit` — so the JSON envelope and
exit code (16 §3.2) stay consistent. **Import heavy subsystems (discovery, browser, agent,
tasks) inside the command function**, not at module top level: `--help` must stay fast and
`cli` must never import playwright/scrapling (import-linter). Commands exempt from the
version gate (version/update/logout/doctor) use `version_gate=False`.

## Tests

- Package-style test tree: every test directory has an `__init__.py` (add one to yours).
- Name spec-numbered tests with their id (`test_T20_01_…`, `test_TCLI_FP_…`).
- Markers: `e2e`, `live`, `browser` (excluded from `bun run test`).
- Fixtures (`tests/conftest.py`): `home` (isolated `PILIH_JOBS_HOME`), `fake_api`,
  `user_id`, `keyring_backend` (in-memory), `runtime`, `signed_in`, `cli` /
  `cli_signed_in` (run the app in-process → `CliResult(code, stdout, stderr).json`).
- `tests/support/fake_api.py` — `FakeApi`: contract-validated fake of `apps/api` (OAuth +
  `/api/v1` kernel). Use `fake.transport` (fault injection: `fake.offline`,
  `fake.fault_plan`), `fake.fail_next(...)`, `fake.route(method, template)` to add routes,
  `fake.serve()` for a real port, `fake_browser(fake, user_id)` for login. Responses are
  validated against the generated models; any violation fails the test at teardown.
- Golden vectors are read from `packages/jobs-contracts/test-vectors/` (never copied).

## Configuration keys

`config.py` mirrors 16 §9 plus `[apply] headless_approval = false` (18 §5): approval-mode
apply runs headless only when it is true (`PILIH_JOBS_APPLY_HEADLESS_APPROVAL`); the
`apply --headed/--headless` flags win and assisted mode is always headed. `browser.headless_for`
containing `apply` asks for headless approval and auto runs (auto stays headed for adapters
without `headless_ok`; the agent enforces it). A new key is a field on its
section model; `config get/set/list/unset` and the env mapping pick it up automatically.

## Clock and outbox

`ClockSync` follows the server time (heartbeat `server_time`, HTTP `Date`); a `Date` header
the corrected clock is already consistent with keeps the offset. `Outbox.ready()` treats
never-attempted entries as due within `CLOCK_STEP_TOLERANCE_MS` (2 s), so a step back of the
corrected clock never strands a just-queued entry; retries keep their exact backoff.

## Rules

- Never hand-edit `contracts/_generated/` or `contracts/data/`; change the Zod contract,
  `bun run build` in `packages/jobs-contracts`, then `bun run contracts` here.
- `state.db` schema changes are new forward-only migrations; never edit `001_initial.sql`.
- Tokens never touch disk in plaintext, `state.db`, logs or terminal output; log through
  `pilih_jobs.logging` (the redaction filter is attached to every handler).
- No plaintext keyring backends; the null backend makes `login` refuse.
- `scrapling` only in `discovery.engine`, `playwright` only in `browser` and
  `agent.executor`; `api` never imports `browser` (`lint-imports`).
- Serialise contract request models with `contracts.wire.to_wire` (never
  `model_dump(exclude_none=False)`): Zod refuses `null` for an `.optional()` member, the
  Pydantic models cannot tell; clip text to contract limits with `clip_utf16` / `clip`
  (Zod counts UTF-16 units). FakeApi and FakeChannel answer such bodies `400
  invalid_request` (`tests/support/contract_schema.py` checks the contract JSON Schema).
- A refused refresh signs the account out (20 §5.3: `credentials.json` entry and secrets
  go; outbox `pending`, cache and binding stay — `Runtime.mark_signed_out`). Only a
  deleted account (`401` with `details.revoked_reason = "account_deleted"`, also read by
  probing `/api/v1/me` with a locally expired token) wipes the issuer's local data and
  credentials (`Runtime.forget_deleted_account`, 11 §10 step 6). Network failures change
  nothing.
