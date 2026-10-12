# 22 — CLI Distribution and Operations

This document covers how `pilih-jobs` reaches users' machines, how it stays
current, how it is removed, and how it is operated once released: telemetry,
crash reports, support bundles, fleet observability and incident runbooks.
The package architecture is in 16.

Legend: see `00-README.md` §2.

---

## 1. Supported platforms

| OS | Versions | Arch | Status | Notes |
|---|---|---|---|---|
| macOS | 13 Ventura+ | arm64, x64 | **Supported** | Keychain backend. Chromium ≈ 359 MB + headless shell ≈ 195 MB **[VERIFIED (local measurement on macOS, 2026-10-11)]** |
| Windows | 11 (and 10 22H2, best-effort) | x64 | **Supported** | Credential Locker; `ProactorEventLoop` (16 §13) |
| Windows | 11 | arm64 | Best-effort | Depends on Playwright Chromium arm64 availability **[ASSUMPTION]** |
| Ubuntu | 22.04, 24.04 | x64, arm64 | **Supported** | `browser install` runs `install-deps` (sudo) |
| Debian | 12 | x64 | Supported | |
| Fedora | 40+ | x64 | Best-effort | Playwright officially targets Debian/Ubuntu for `install-deps` **[ASSUMPTION]**. Fedora needs manual packages listed by `doctor` |
| WSL2 | Ubuntu on WSL2 | x64 | Best-effort | Headed browsers need WSLg. The **loopback redirect works** because the system browser on Windows reaches WSL2 `localhost` forwarding on recent WSL **[ASSUMPTION]**. Otherwise `login --no-browser` prints the URL. Keyring needs Secret Service inside WSL (16 §11) |
| Containers / CI | Linux | x64 | Unattended worker only | Requires the encrypted file credential store (16 §11) and `--headless`. Assisted mode unavailable |

Python: 3.11–3.13 are supported, and 3.12 is recommended and pinned by uv
installs (`uv tool install --python 3.12`). This is driven by Scrapling
(≥ 3.10) and our `requires-python`.

**[ASSUMPTION A-04]** The whole matrix is validated by the CI matrix (§9)
before M2 exits.

---

## 2. Installation channels

**[DECISION]** v1 ships as a **Python package on PyPI** (`pilih-jobs`),
installed into an isolated environment by a tool installer. No single-file
binary.

| Channel | Command | Status | Notes |
|---|---|---|---|
| **uv (primary)** | `uv tool install pilih-jobs` | v1 | Isolated env with the executable on PATH. Upgrade with `uv tool upgrade pilih-jobs` **[VERIFIED]** https://docs.astral.sh/uv/guides/tools/. Run `uv tool update-shell` if PATH is not set |
| uvx (try it) | `uvx pilih-jobs doctor` | v1 | Temporary environment, good for a first look. Not suited to the worker (no stable path for `--detach` services) |
| pipx | `pipx install pilih-jobs` | v1 | **[VERIFIED]** https://pipx.pypa.io/stable/ |
| Homebrew tap | `brew install pilihpendidikan/tap/pilih-jobs` | M7 | Tap repo `pilihpendidikan/homebrew-tap` **[VERIFIED]** naming rule https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap. Formula uses `Language::Python::Virtualenv` with `python@3.12` and the resources generated from `uv.lock` |
| Scoop | `scoop bucket add pilihpendidikan <url>; scoop install pilih-jobs` | M7+ | Manifest installs uv then `uv tool install` **[VERIFIED]** bucket model https://github.com/ScoopInstaller/Scoop/wiki/Buckets |
| winget | `winget install PilihPendidikan.PilihJobs` | Later | Needs an installer artifact (MSI/EXE) and a PR to `microsoft/winget-pkgs` **[VERIFIED]** https://learn.microsoft.com/en-us/windows/package-manager/package/ |
| Install script | `curl -LsSf https://pilihpendidikan.com/install-cli.sh \| sh` / PowerShell equivalent | M7 | Installs uv if missing (official uv installer), then `uv tool install pilih-jobs` and `pilih-jobs browser install`. Script is versioned in the repo and checksummed |

### 2.1 Why no PyInstaller/Nuitka single binary in v1

| Issue | Detail |
|---|---|
| Browsers outside the bundle | Playwright browsers are not bundled by default. Bundling with `PLAYWRIGHT_BROWSERS_PATH=0` makes "bigger binaries" **[VERIFIED]** https://playwright.dev/python/docs/library. Chromium alone is ~359 MB on macOS |
| Node driver | Playwright (and patchright, which `scrapling[fetchers]` pulls in) ship a Node driver that must be collected as data files per OS |
| Scrapling writes into its package dir | The `scrapling install` marker and the default adaptive DB live inside the package directory **[VERIFIED]**, which is read-only when frozen. This is solvable (we override storage, 15 §6) but fragile across upgrades |
| Lazy imports | `scrapling.fetchers` resolves classes via `__getattr__`, so it needs hidden imports |
| Nuitka | No official Playwright guidance. The upstream PR could not be confirmed merged **[ASSUMPTION]** |
| Per-OS builds | Platform-specific browser binaries mean three or more signed builds per release |

**Revisit when** (any one is enough): non-technical users fail installation in
more than 10 % of support tickets; Windows users need an MSI for winget; or
Playwright publishes official freezing guidance. The candidate then is
PyInstaller onedir plus a separate first-run browser download.

---

## 3. Package metadata

`pyproject.toml` essentials:

```toml
[project]
name = "pilih-jobs"
requires-python = ">=3.11,<3.14"
license = "MIT"                         # [ASSUMPTION] owner to confirm project license
dependencies = [
  "scrapling[fetchers]==0.4.15",
  "playwright>=1.63,<1.64",
  "typer>=0.27,<0.28", "rich>=15,<16", "httpx>=0.28,<1",
  "pydantic>=2.9,<3", "keyring>=25.7,<26", "platformdirs>=4,<5",
  "zstandard>=0.23", "cryptography>=43",   # encrypted credential file (opt-in), Ed25519 device key
]
[project.scripts]
pilih-jobs = "pilih_jobs.cli.app:main"
pj = "pilih_jobs.cli.app:main"
```

`THIRD_PARTY_NOTICES` lists Scrapling (BSD-3-Clause **[VERIFIED]**),
Playwright (Apache-2.0), patchright (transitive; Apache-2.0
**[ASSUMPTION]**), curl_cffi and the others. It is generated from the lockfile
at build time (`pip-licenses`).

---

## 4. First-run setup

```text
$ uv tool install pilih-jobs
$ pilih-jobs doctor            # checks below; prints the exact fix for each failure
$ pilih-jobs browser install   # ≈ 550 MB download on macOS (Chromium + headless shell + ffmpeg)
$ pilih-jobs login             # opens the system browser (17)
$ pilih-jobs discover --source greenhouse:acme --dry-run
```

`browser install` runs `python -m playwright install chromium` with the same
interpreter. On Linux it adds `--with-deps` after an explicit sudo prompt (it is
skipped with `--no-deps`, and `doctor` then lists the missing packages).
`--channel chrome|msedge` sets the config to a branded browser that is already
installed and downloads nothing. Browser locations follow Playwright defaults
**[VERIFIED]** https://playwright.dev/python/docs/browsers:
`~/Library/Caches/ms-playwright`, `%USERPROFILE%\AppData\Local\ms-playwright`,
`~/.cache/ms-playwright`. `PLAYWRIGHT_BROWSERS_PATH` is respected. **We never
call `scrapling install`**, because it writes into the package directory.

`doctor` checks:

| Check | Pass criteria |
|---|---|
| Python | 3.11–3.13; 64-bit |
| Installer | Detects uv / pipx / brew / pip (§5) |
| Disk | ≥ 1.5 GB free in the Playwright browsers path, ≥ 500 MB in data dir |
| Browser | Chromium revision expected by the installed Playwright is present and launches headless (`about:blank` in < 10 s) |
| System deps (Linux) | `ldd` of Chromium has no missing libs |
| Keyring | A secure backend is available, or the encrypted file store is configured (16 §11) |
| API | `GET /api/v1/meta` reachable; TLS valid; version ≥ min |
| Auth | Token valid (`/api/v1/me`), device not revoked |
| Clock | Skew vs. server `Date` < 2 min (leases and ULIDs depend on it) |
| Mode B (if configured) | CDP endpoint is loopback and answers `/json/version` |
| Policy | Import guard active; no forbidden modules importable in-process |

`doctor --bundle` writes a support bundle (§8.3).

---

## 5. Updates

- `pilih-jobs update --check` compares the version with PyPI (JSON API,
  cached 24 h) and with the server `meta` (`recommended_cli_version`,
  `min_cli_version`).
- `pilih-jobs update` detects how it was installed (by the `sys.prefix`
  path pattern and the presence of uv/pipx/brew receipts) and runs:

| Detected | Command executed |
|---|---|
| uv tool | `uv tool upgrade pilih-jobs` |
| pipx | `pipx upgrade pilih-jobs` |
| Homebrew | `brew upgrade pilih-jobs` |
| Scoop | `scoop update pilih-jobs` |
| plain pip / unknown | Prints the command; does not modify the environment |

- After an upgrade, if the new version needs a different Chromium revision,
  the CLI prints a prompt to run `pilih-jobs browser install` (the worker
  refuses browser tasks until it is done; `doctor` reports it).
- The worker never upgrades itself while holding a lease. It upgrades between
  tasks only when `worker.auto_update = true` (default `false`).
- **Server-driven minimum** (16 §12): `min_cli_version` in `/api/v1/meta`
  is the kill switch for a bad release (§10.4).

---

## 6. Dependency pinning policy

| Dependency | Policy | Reason |
|---|---|---|
| `scrapling[fetchers]` | **Exact pin** (`==0.4.15`) | Beta, frequent breaking changes **[VERIFIED]**. A bump requires the adapter fixture suite plus the live canary green (15 §16) |
| `playwright` | Minor pin (`>=1.63,<1.64`) | Each minor maps to a specific Chromium revision. The browser revision must match |
| `patchright` | Transitive via Scrapling; never imported (15 §13) | |
| Others | Compatible-release ranges, locked in `uv.lock` | |

The tested matrix (Python × OS × Playwright revision) is recorded per release
in the GitHub release notes. Dependabot/Renovate PRs for Scrapling and
Playwright are labelled `needs-canary`.

---

## 7. Release pipeline

```text
tag cli-vX.Y.Z (or cli-vX.Y.Z-beta.N)
   │
   ▼  GitHub Actions (workflow: release-cli.yml)
1. uv sync --frozen; ruff; pyright; pytest (unit+component+policy)
2. platform matrix smoke (§9) incl. browser install + headless launch + discover --dry-run against fixtures
3. contract check: generated models == packages/jobs-contracts at the tagged commit
4. uv build → sdist + wheel (pure Python)
5. SBOM (CycloneDX from uv.lock) + THIRD_PARTY_NOTICES regenerated
6. Publish to PyPI via Trusted Publishing (OIDC; no API token stored)
   + PEP 740 attestations (Sigstore) generated by pypa/gh-action-pypi-publish
7. GitHub Release with SBOM, checksums, changelog, tested matrix
8. Bump Homebrew formula / Scoop manifest (bot PR) — stable channel only
9. Ops step (manual, owner approval): update recommended_cli_version (and, if needed, min_cli_version) in apps/api config
```

- **Versioning:** SemVer. Breaking CLI flag or exit-code changes require a
  major bump. Contract-incompatible changes are coordinated with the API
  `meta.min_cli_version`.
- **Channels:** `stable` (default) and `beta` (`uv tool install --prerelease allow pilih-jobs`
  or `pipx install --pip-args=--pre`). Beta builds report `channel=beta` in
  the User-Agent, and the server may route experimental features by it.
- Tags are prefixed `cli-` so they do not collide with Worker deploy tags.
  Deploys of apps/api remain owner-approved (root `CLAUDE.md`).

---

## 8. Telemetry, crash reports and support bundles

### 8.1 Telemetry (opt-in, default off)

`pilih-jobs config set privacy.telemetry true`. The first interactive run asks
once.

| Sent (aggregated, anonymous) | Never sent |
|---|---|
| CLI/Python/Playwright/Scrapling versions, OS, arch | Email, user id, device name, IP (the server does not store IPs for this endpoint) |
| Command name, duration bucket, exit code | Command arguments, URLs, company names, job titles |
| Adapter id + error_class counts per run | Page content, form fields, answers, CV content, tokens |
| Agent step counts, outcome class (no ids) | Screenshots, DOM, cookies, profile data |
| Install channel | Hostnames, file paths |

Transport: `POST /api/v1/telemetry` (unauthenticated, rate-limited by IP hash)
with a random install id that rotates every 30 days. Data is stored as
Analytics-style daily counters in D1 `JOBS_DB.telemetry_daily` **[NEW]**,
retained 90 days (04 §4). **[DECISION]** No third-party telemetry SDK.

### 8.2 Crash reports

Unhandled exceptions write `<logs>/crash-<ts>.json` (the redacted traceback
with frame **file and line only**, no locals). With telemetry on, the CLI asks
"Send crash report? [y/N]" (TTY only) and posts it to
`POST /api/v1/telemetry/crash`. Otherwise the file stays local for support
bundles.

### 8.3 Support bundle

`pilih-jobs doctor --bundle` produces `pilih-jobs-support-<ts>.zip` that
contains:

- the `doctor` output;
- versions;
- the redacted config (API url, modes, no secrets);
- the last 1,000 log lines (already redacted, 16 §10);
- the outbox summary (counts, error classes, paths; **no bodies**);
- the `local_tasks` states;
- the lists of installed browsers and profile **names**.

It never includes `state.db`, profiles, run staging files, tokens or
screenshots. The user reviews the file list before the zip is written.

---

## 9. CI matrix (CLI)

| Job | Runners | Steps |
|---|---|---|
| `cli-lint` | ubuntu-24.04 | ruff, pyright, import-linter, policy tests |
| `cli-test` | ubuntu-24.04 (py3.11, 3.12, 3.13) | unit + component + contract |
| `cli-platform` | macos-14 (arm64), macos-13 (x64), windows-2022, ubuntu-22.04, ubuntu-24.04-arm | `uv tool install ./dist/*.whl` → `pilih-jobs doctor --json` → `browser install` → agent fixture test (headless) → discover against fixture server |
| `cli-e2e` | ubuntu-24.04 | `apps/api` via `wrangler dev` + local D1 migrations → login (scripted PKCE with a test-only auto-consent flag available **only** under `wrangler dev`) → register device → claim/heartbeat/result → sync |
| `cli-canary` (nightly, opt-in secret) | ubuntu-24.04 | Live adapters (15 §16) |

These jobs run in the monorepo's CI next to `bun run check`. The turbo
`test`/`lint`/`typecheck` scripts of `apps/jobs-cli` call the same commands
locally (16 §1).

---

## 10. Operations and incident runbooks

### 10.1 Fleet observability (server side)

From the API (no new product, D1 + Workers observability, which is enabled
**[VERIFIED]** `apps/api/wrangler.jsonc:21-23`):

- **Device fleet:** counts by `cli_version`, platform, `last_seen_at` buckets
  (`devices` table, 04 §1).
- **Task health:** `automation_tasks` by state and `error_class`,
  `outcome_unknown` rate, median claim latency, lease expiries per version.
- **Discovery health:** `discovery_runs.errors` by adapter and error_class
  (`selector_drift`, `schema_invalid`, `access_denied`).
- **AI:** calls, latency and spend per day (07, 19). Upstream error rate.
- Alerts (cron every 5 min, 14) post to the owner's email via the existing
  `EMAIL` binding when:
  - `outcome_unknown` > 5 % of apply attempts in 24 h;
  - an adapter's `schema_invalid` rate > 20 % in 24 h;
  - AI upstream error rate > 10 % for 15 min;
  - D1 `JOBS_DB` size > 6 GB (04 §4).

### 10.2 Runbook — OpenAI outage / degradation

1. **Detect:** AI proxy 5xx/timeout rate alert; `/api/v1/ai/*` returns
   `503 upstream_unavailable`.
2. **Automatic behaviour:**
   - The scoring queue retries with backoff (Queue retries; the DLQ after max).
   - The agent **pauses** an apply task when a decision call fails. It never
     guesses actions without AI. The pause reason is `ai_unavailable`, and
     the task resumes when the user resumes it or the worker retries after
     10 min.
   - Deterministic scoring components (07) still populate the inbox, marked
     "AI score pending".
3. **Operator:** set the feature flag `AI_DISABLED=true` in `DB.feature_flags` (D-33; no redeploy) to fail fast and stop
   charging retries. Post a status notice in apps/jobs (a `meta.features`
   flag the UI reads). Re-enable and drain the DLQ (`wrangler queues`
   consumer re-run) after recovery.
4. **Fallback provider** (only if configured behind the `AiProvider`
   interface, 19): switch `AI_PROVIDER=anthropic` for the structured-output
   calls. Decisions-type calls have no equivalent, so classification falls
   back to strict JSON-schema enum outputs. This needs owner approval
   (cost/privacy).

### 10.3 Runbook — adapter breakage

1. **Detect:** canary failure, an `adapter-drift` issue, or the
   `schema_invalid` alert.
2. **Mitigate:** mark the adapter `status: "beta"` with a notice, or
   `disabled` in `adapters.json` served by `/api/v1/sources/adapters`. CLIs
   refresh manifests via `meta` (≤ 6 h) and stop using a disabled adapter.
   The server rejects batches whose `extraction.adapter_version` is listed as
   broken.
3. **Fix:** update the fixtures plus the adapter, release a CLI patch, and
   raise `recommended_cli_version`. Raise `min_cli_version` only if the broken
   adapter writes bad data.

### 10.4 Runbook — bad CLI release

1. Raise `min_cli_version` above the bad version in the apps/api config (an
   owner-approved deploy). Old CLIs get `426` on their next request. Workers
   finish or pause their current task and exit.
2. `pip yank` / `uv` yanking of the bad version on PyPI. Publish the fix.
3. Review the `outcome_unknown` and `failed` tasks created by the bad version
   (query by `automation_attempts.cli_version`). Notify the affected users
   through the dashboard's approvals/attention queue.

### 10.5 Runbook — leaked or stolen token / device

1. The user (web *Devices* page or `pilih-jobs devices revoke`) or an admin
   revokes the device. This revokes the grant, the refresh family and all
   access tokens (D-10). Live leases follow 21 §10.
2. Refresh-token reuse detection (17 §7.2) revokes the grant family
   automatically and emails the user.
3. Audit: the `application_events` and `automation_attempts` for that
   `device_id` since the suspected time are listed in the device page's
   activity view.
4. **Personal token leak:** revoke at `/connect` (existing **[VERIFIED]**
   `apps/api/src/personal-tokens.ts:139-154`).

### 10.6 Runbook — user reports duplicate application

Check the `ux_tasks_live_apply` invariant and the attempts for that
application. Check `submit_intent` and the evidence timeline. If a duplicate
submission happened through a manual retry after `outcome_unknown`, record it
as a user-visible incident on the application timeline. Tighten the UI copy on
the retry confirmation.

---

## 11. Uninstall and data removal

```text
pilih-jobs uninstall --purge-data
  1. worker stop (release leases)
  2. logout (revoke refresh token; deregister device = revoke)
  3. delete keyring entries
  4. delete data dir (profiles, state.db, adaptive store, runs), cache dir, logs  [confirm; lists sizes]
  5. print the installer command to remove the package (uv tool uninstall / pipx uninstall / brew uninstall)
     and how to remove Playwright browsers (`python -m playwright uninstall --all` within the tool env)
```

Without `--purge-data`, only steps 1–3 run. Cloud data is **not** deleted by
the CLI. Account deletion is a web action (11).

---

## 12. "Connect CLI" page in `apps/jobs`

Route `/cli` (12 §2). Content, top to bottom:

1. **Install:** a tabbed command block (macOS/Linux · Windows) showing
   `uv tool install pilih-jobs`, with a link to install uv. The alternative
   is pipx. Each block has a copy button with a `C` kbd hint (Zedative).
2. **Install browser:** `pilih-jobs browser install` plus a disk-space note
   (≈ 550 MB).
3. **Sign in:** `pilih-jobs login`. The page explains that a browser window
   will ask the user to approve the device "<hostname> (<os>)" on
   `api.pilihpendidikan.com`.
4. **Verify:** the page polls `GET /api/v1/devices` every 3 s and shows the
   new device appearing ("Connected · <name> · just now").
5. **Next steps:** add sources, run `pilih-jobs discover --all`, and start the
   worker (`pilih-jobs worker start --detach`).
6. **Troubleshooting:** a `pilih-jobs doctor` hint, headless Linux keyring
   notes, a WSL note, and a link to the support-bundle instructions.

The commands shown are rendered from one source
(`packages/jobs-contracts/cli-commands.json`) so the docs never drift from the
CLI help.
