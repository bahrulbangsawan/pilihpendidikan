# pilih-jobs

`pilih-jobs` is the command-line companion of the pilihpendidikan Job Tracker
(<https://jobs.pilihpendidikan.com>). It runs on your machine and does three things:

- **discovers** job postings on public career sites;
- **applies** to jobs in a local browser, with your approval;
- **syncs** every result with your Job Tracker account.

The cloud stays the source of truth. The CLI keeps only caches and a queue of pending
changes, so deleting its local data never loses anything already synced.

## Install

`pilih-jobs` needs Python 3.11–3.13. Install it with [uv](https://docs.astral.sh/uv/) (recommended):

```sh
uv tool install pilih-jobs            # or: pipx install pilih-jobs
pilih-jobs doctor                     # checks your setup and prints the fix for each problem
pilih-jobs browser install            # Chromium for browser automation (≈ 550 MB on macOS)
```

To try it without installing, run `uvx pilih-jobs doctor`. The executable is also available
under the short alias `pj`. Pre-releases install with
`uv tool install --prerelease allow pilih-jobs`.

The install script does the three steps above for you, installing uv first if it is
missing (it uses Astral's official uv installer):

```sh
curl -LsSf https://pilihpendidikan.com/install-cli.sh | sh                                  # macOS, Linux
powershell -ExecutionPolicy ByPass -c "irm https://pilihpendidikan.com/install-cli.ps1 | iex"  # Windows
```

Both scripts are short and versioned in the pilihpendidikan repository; each release lists
their SHA-256 in `SHA256SUMS` on its GitHub release, so you can download, check and then run
them. Homebrew (`brew install pilihpendidikan/tap/pilih-jobs`) and Scoop packages are
planned; the Job Tracker's **CLI & devices** page shows which channels are available.

## Sign in

```sh
pilih-jobs login
```

This opens your system browser so you can approve this device, for example
*"Allow pilih-jobs CLI on rahma-mbp (macOS)"*. The CLI uses OAuth 2.0 with PKCE and a
one-time redirect to `127.0.0.1`, and it never embeds a browser for sign-in. Tokens are
stored in your OS keychain (macOS Keychain, Windows Credential Locker or Linux Secret
Service), never in plain-text files.

- **Remote host or SSH:** run `pilih-jobs login --no-browser --port 53127`, forward the
  port with `ssh -L 53127:127.0.0.1:53127 user@server`, then open the printed URL on your
  workstation.
- **Headless Linux without a keyring:** opt in to the encrypted credential file with
  `pilih-jobs login --credential-store encrypted-file`. The CLI asks for a passphrase once
  per process, or reads it from `PILIH_JOBS_KEYRING_PASSPHRASE`.
- **Extra permissions:** request them only when you need them, for example
  `pilih-jobs login --scope automation:manage` or `--scope devices:manage`.

## Everyday commands

```sh
pilih-jobs status                     # account, device, worker, queued changes, approvals
pilih-jobs sync                       # send queued changes, then pull the latest data
pilih-jobs sync --status              # queued, conflicting and failed changes (works offline)
pilih-jobs whoami
pilih-jobs devices list               # needs --scope devices:manage
pilih-jobs config list                # effective settings and where each value comes from
pilih-jobs config set browser.mode connected
pilih-jobs update --check
pilih-jobs logout
```

Add `--json` to any command for machine-readable output. A short command prints one
envelope, `{"ok": true, "data": …}`. A long-running command streams NDJSON events, one
JSON object per line, and ends with a `{"type": "result", …}` line. `--no-input` turns
off prompts. `-y` accepts ordinary confirmations, but it never approves a job
application. Exit codes are stable:

| Code | Meaning                     | Code | Meaning                             |
|------|-----------------------------|------|-------------------------------------|
| 0    | success                     | 6    | conflict that needs you             |
| 1    | failure                     | 7    | offline (changes stay queued)       |
| 2    | usage error                 | 8    | input or approval needed            |
| 3    | not signed in               | 9    | refused by policy                   |
| 4    | permission denied           | 10   | upgrade required                    |
| 5    | not found                   | 130  | interrupted                         |

## Configuration and local data

Settings are stored in `config.toml`, in the directory shown by `pilih-jobs config path`.
When the same setting is set in several places, a command-line flag wins over a
`PILIH_JOBS_<SECTION>_<KEY>` environment variable, which wins over the file. For example,
`PILIH_JOBS_API_URL=http://localhost:8788` sets the API URL for development; plain `http`
is allowed only for loopback addresses.

By default the browser window is shown when the agent applies for you in approval mode,
so you can watch it fill the form. To let approval-mode applications run without a
window, use `pilih-jobs config set apply.headless_approval true`; `apply --headed` or
`--headless` overrides it for one run. Assisted mode always shows the window.

Local data (`state.db`, browser profiles and run logs) lives in the platform data
directory, and logs live in the platform log directory. Logs are redacted: tokens,
authorization codes, cookies, email addresses and phone numbers are never written to
them. `pilih-jobs config purge` deletes caches, logs and staging files, but keeps
browser profiles unless you add `--profiles`. It never deletes data in your account.

Telemetry is **off** unless you turn it on with
`pilih-jobs config set privacy.telemetry true`. When on, the CLI sends only anonymous
daily counters, such as command names and exit codes. It never sends arguments, URLs or
any personal data.

## Remove

```sh
pilih-jobs uninstall --purge-data     # stops the worker, signs out, deletes local data
uv tool uninstall pilih-jobs          # the command printed by `uninstall` for your installer
```

`pilih-jobs update` upgrades through the installer it was installed with (uv, pipx,
Homebrew or Scoop).

Uninstalling never deletes your account data. To delete your account, use the Job
Tracker website.

## Development

This package lives in the pilihpendidikan monorepo at `apps/jobs-cli`. It uses `uv`;
`scripts/require-uv.sh` explains how to install it.

```sh
cd apps/jobs-cli
uv sync                               # Python 3.12 (.python-version) + dev tools
bun run test                          # pytest (not e2e/live/browser)
bun run test:browser                  # Playwright tests; once: uv run playwright install chromium
bun run lint                          # ruff check + format --check + import-linter
bun run typecheck                     # pyright (strict on src/)
bun run contracts                     # regenerate models from packages/jobs-contracts
uv run python scripts/gen_notices.py  # regenerate THIRD_PARTY_NOTICES
uv run pilih-jobs --api-url http://localhost:8788 login   # against a local apps/api
```

The repository's `bun run check` runs the lint, tests, contracts drift check and
`pip-audit` of this package along with the rest of the workspace, and `bun run e2e`
runs the full-stack scenarios (local api, dashboard, this CLI and Chromium). Releases
are cut from `cli-vX.Y.Z` tags by `.github/workflows/release-cli.yml` and published to
PyPI with Trusted Publishing.

See `CLAUDE.md` for the code structure and its rules.
