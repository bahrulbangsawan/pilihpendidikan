# 16 — Local CLI Architecture (`apps/jobs-cli`)

The CLI is the **local execution engine**. It runs Scrapling discovery,
Playwright browser automation and CV attachment on the user's machine, and
syncs every result to Cloudflare, the source of truth. This document covers the
package layout, the command tree, local state, the worker loop, output and
logging, and credential handling. Authentication is in 17, browser control in
18, the agent in 19, sync in 20, the task protocol in 21 and distribution in 22.

Legend: see `00-README.md` §2.

---

## 1. Runtime and toolchain

| Item | Choice | Status |
|---|---|---|
| Language | Python **3.12** (`requires-python = ">=3.11,<3.14"`). Scrapling needs ≥ 3.10 **[VERIFIED]** | **[DECISION D-07]** |
| Env / build | `uv` (lockfile `uv.lock`, `uv build`), hatchling backend | **[NEW]** |
| CLI framework | **Typer** 0.27.x (vendors Click since 0.26.0 **[VERIFIED]** https://typer.tiangolo.com/) + **Rich** 15.x for TTY rendering | **[DECISION]** Typer over Click: the type-hinted signatures are the command docs. Textual rejected for v1 (a full TUI is not needed) |
| HTTP | `httpx` (async, HTTP/2 off, explicit timeouts) | **[DECISION]** separate from Scrapling's curl_cffi. API calls must not carry browser impersonation |
| Models | Pydantic v2, generated from `packages/jobs-contracts` JSON Schema with `datamodel-code-generator` into `src/pilih_jobs/contracts/_generated/` (never hand-edited) | **[DECISION D-20]** |
| Scraping | `scrapling[fetchers]==0.4.15` (15) | **[DECISION D-16]** |
| Browser | `playwright` (Python) 1.63.x, the same package Scrapling depends on | **[DECISION D-22]** |
| Local DB | stdlib `sqlite3`, WAL mode, one file `state.db` | **[NEW]** |
| Credentials | `keyring` 25.x (§11) | **[NEW]** |
| Paths | `platformdirs` | **[NEW]** |
| Lint / types / tests | ruff, pyright (strict on `src/`), pytest + pytest-asyncio + pytest-httpserver | **[NEW]** |

**Monorepo integration [ASSUMPTION A-06]:** `apps/jobs-cli/package.json` is a
thin shim so Turborepo can run the Python leg:

```json
{ "name": "@pilihpendidikan/jobs-cli", "private": true,
  "scripts": { "test": "uv run pytest", "lint": "uv run ruff check src tests",
               "typecheck": "uv run pyright", "build": "uv build",
               "contracts": "uv run python scripts/gen_contracts.py" } }
```

`turbo.json` gains `contracts` as a dependency of `typecheck`/`test` for the
CLI, so models are regenerated from `packages/jobs-contracts` first. Developers
need `uv` installed. `bun run check` documents this.

---

## 2. Package structure

```text
apps/jobs-cli/
├── package.json                 # turbo shim (§1)
├── pyproject.toml               # dist "pilih-jobs", scripts: pilih-jobs, pj
├── uv.lock
├── README.md                    # install + quickstart (mirrors apps/jobs "Connect CLI")
├── THIRD_PARTY_NOTICES          # Scrapling BSD-3, Playwright Apache-2.0, …
├── scripts/gen_contracts.py     # JSON Schema → Pydantic
├── src/pilih_jobs/
│   ├── __main__.py              # python -m pilih_jobs
│   ├── version.py
│   ├── contracts/               # _generated/ Pydantic models + thin helpers
│   ├── cli/                     # Typer app; one module per command group; no business logic
│   │   ├── app.py  auth.py  discover.py  inbox.py  apply.py  browser.py  cv.py
│   │   ├── sync.py  worker.py  approvals.py  devices.py  config.py  logs.py
│   │   └── output.py            # Rich vs JSON renderers, exit codes
│   ├── auth/                    # OAuth PKCE loopback login, token store, refresh (17)
│   ├── api/                     # typed httpx client for /api/v1 (retries, idempotency headers, 426 handling)
│   ├── sync/                    # outbox, change-feed puller, snapshot, conflict handling (20)
│   ├── discovery/               # DiscoveryManager, normalizer, validator, fingerprint, dedupe (15)
│   │   └── engine/              # ScraplingJobEngine — ONLY place importing scrapling
│   ├── adapters/                # source adapters + registry (15 §14)
│   ├── browser/                 # BrowserManager: modes A/B/C, profiles, locks (18)
│   ├── agent/                   # observation, action enumeration, validator, executor, verifier (19)
│   ├── cv/                      # variant fetch, R2 download, sha256 verify, headless render (08)
│   ├── tasks/                   # worker loop, lease manager, heartbeats (21)
│   ├── storage/                 # state.db schema/migrations, paths, file staging
│   ├── policy/                  # domain allowlists, forbidden-feature guard, sensitivity rules
│   ├── telemetry/               # opt-in anonymous metrics, crash reports (22)
│   └── logging.py               # JSONL structured logs + redaction (§10)
└── tests/
    ├── unit/  adapters/  engine/  agent/  sync/  tasks/  policy/
    ├── fixtures/                # recorded HTTP, HTML forms, robots.txt
    └── e2e/                     # against wrangler dev + local form fixtures (13)
```

### 2.1 Module dependency rules

```text
cli ──▶ (auth, api, sync, discovery, browser, agent, cv, tasks, storage, config)
tasks ──▶ (agent, discovery, cv, api, sync, browser)
agent ──▶ (browser, api[ai proxy only], policy, storage)
discovery ──▶ (discovery.engine, adapters, storage, sync.outbox)
adapters ──▶ discovery.engine (via AdapterContext only)
sync ──▶ (api, storage)
api ──▶ (auth, contracts)
everything ──▶ (contracts, logging, policy)
```

These rules are enforced with `import-linter` contracts in CI:

- `scrapling` may be imported only in `discovery.engine`.
- `playwright` may be imported only in `browser` and `agent.executor`.
- `cli` must not import `playwright` or `scrapling`.
- `api` must not import `browser`.

---

## 3. Executable name and command hierarchy

**[DECISION D-08]** The executable is **`pilih-jobs`**, with an optional short
alias **`pj`** (a second `[project.scripts]` entry). The brief proposed `jobs …`,
but `jobs` is a POSIX shell builtin in sh, bash and zsh. Builtins take
precedence over `$PATH`, so `jobs login` would run the shell's job-control
builtin and never reach our binary.

**[DECISION]** The automation group is named **`worker`**, not
`automation`. It controls a long-running local **worker** that claims remote
tasks (21). Automation *policy* (rules) is a separate concept managed in the
web app and under `pilih-jobs rules`. Calling both "automation" would be
ambiguous. `pilih-jobs automation …` stays as a hidden alias of `worker` for
discoverability.

### 3.1 Global flags

`--json` (machine output; implies `--no-input`), `--no-input` (never prompt;
missing input is an error), `-y/--yes` (accept confirmations except
**submission approvals**, which always need an explicit `--approve` or an
interactive answer), `-v/--verbose` (repeatable), `--profile <name>` (browser
profile), `--api-url` (dev; also `PILIH_JOBS_API_URL`), `--config <path>`,
`--color/--no-color`.

### 3.2 Exit codes (stable contract)

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure |
| 2 | Usage error (bad flags) |
| 3 | Not authenticated / token revoked (`pilih-jobs login` needed) |
| 4 | Permission denied (`insufficient_scope`, device revoked) |
| 5 | Not found |
| 6 | Conflict (revision/lease) not auto-resolvable |
| 7 | Network / server unavailable (work queued in outbox) |
| 8 | Paused — human input required (approval, CAPTCHA, login) |
| 9 | Policy refused (excluded source, forbidden domain, sensitivity rule) |
| 10 | Upgrade required (`426`) |
| 130 | Interrupted (SIGINT), state saved |

### 3.3 Commands

The JSON output is an envelope: `{"ok": bool, "data": …, "error"?: {code, message, details}}`.
Long-running commands stream NDJSON events (§5) and end with one envelope line.

| Command | Synopsis | Key flags | JSON `data` sketch |
|---|---|---|---|
| `login` | OAuth PKCE loopback login + device registration (17) | `--device-name`, `--no-browser` (prints URL; still needs the loopback on the same machine), `--scopes` (advanced) | `{user_id, email, device_id, scopes[]}` |
| `logout` | Revoke the refresh token (RFC 7009), delete keyring entries | `--all-devices` (opens web device page) | `{revoked: true}` |
| `whoami` | `GET /api/v1/me` | — | `{user_id, email, device: {id,name}, scopes[]}` |
| `status` | One-screen overview: auth, device, worker, outbox depth, browser, last sync (local time and age), pending approvals | — | `{auth, device, worker, outbox, browser, last_sync_at (epoch ms), approvals_pending}` |
| `discover` | Run discovery (15) | `--source <src_id\|adapter:org>` (repeatable), `--all` (all enabled sources), `--url <url>` (custom_url), `--keywords`, `--location`, `--private`, `--check-tracked`, `--max-pages`, `--dry-run` (no sync), `--reset-adaptive <src>` | stream events → `{run_id, status, stats}` |
| `inbox list` | Discovery results from cloud | `--state new\|seen\|dismissed\|tracked`, `--min-score`, `--source`, `--limit`, `--all` (every page), `--q`, `--ids` (ids only, one per line, for piping) | `{items:[{user_job_id, title, company, score, source, first_seen_at}]}` (`--ids`: `{ids[]}`) |
| `inbox show <ujb_id>` | Posting detail + score breakdown | `--description` | posting + score |
| `inbox track <ujb_id…>` | Track (creates applications) | `--mode`, `--stage` | bulk results |
| `inbox dismiss\|seen\|restore <ujb_id…>` | `POST /api/v1/inbox:bulk` (chunks of ≤ 200; offline every chunk is queued): dismiss (a tracked job is a `conflict`), mark seen, restore dismissed → seen (other states unchanged, `ok`) | `--yes` above 50 ids | bulk results |
| `score <ujb_id\|pst_id…\|--all-new>` | Request scoring (`POST /api/v1/scores:request`; 07) | `--wait` (up to 30 s) | `{queued, cached}` |
| `board` | Kanban board grouped by stage (`GET /api/v1/board`; 06 §11) | `--stage S`, `--archived`, `--ids` | `{columns:[{stage, items:[…]}]}` |
| `list` | List applications | `--stage`, `--q`, `--limit`, `--all` (every page), `--archived`, `--ids` | `{items:[…]}` |
| `show <app_id\|legacy_id>` | Application detail with timeline | `--audit` (full event and attempt audit trail, 21 §14) | application detail |
| `track <ujb_id\|url>` | Track a job (creates an application; a URL creates a `custom_url` posting first) | `--mode`, `--stage` | `{application}` |
| `move <app_id…> <stage>` | Change stage / reorder (`POST …/move`, `base_revision` from cache, per id); the last positional is the stage | `--before <app_id>`, `--after <app_id>` (one id only) | `{application}`; several ids: bulk results |
| `applied <app_id>` | Mark applied manually (user attestation) | `--method`, `--date` | `{application}` |
| `confirm <app_id>` | Confirm or deny an unverified / unknown submission (`POST …/submission`) | `--yes\|--no` | `{application}` |
| `edit <app_id…>` | Edit fields (`PATCH /api/v1/applications/{id}`; the same change per id) | `--priority`, `--follow-up`, `--mode` | `{application}`; several ids: bulk results |
| `note <app_id> "text"` | Add a note event | — | `{event_id}` |
| `checklist <app_id> add\|done\|rm …` | Legacy checklist sections/items | — | `{sections}` |
| `interview add <app_id>` | Record an interview | `--at`, `--kind`, `--duration`, `--location` | `{interview}` |
| `offer add <app_id>` | Record an offer | `--base`, `--currency`, `--deadline` | `{offer}` |
| `follow-up <app_id…> <duration\|date\|done\|clear>` | Set `follow_up_at` (`done` clears it and adds a note) | — | `{application}`; several ids: bulk results |
| `archive <app_id…>` / `rm <app_id…> [--purge]` | Archive (`--undo`); archive or hard delete with **one** confirmation for the set (count + ids) | `--undo`, `--purge`, `--yes` | `{archived\|deleted}`; several ids: bulk results |
| `apply <app_id>` | Run the browser agent for one application locally (creates a task targeted at this device with base `automation:execute`, claims it, executes; D-29) | `--mode assisted\|approval\|auto` (`auto` only if a matching active rule exists, and needs step-up `automation:manage`), `--dry-run` (fill and stop before submit; nothing submitted, no submit_intent), `--approve` (decide the final `submit` approval in the CLI **for this run only** in approval mode; needs step-up `automation:manage` (17 §5.1); still shows the summary and requires a TTY confirmation unless `--yes` was also given **and** mode is approval), `--headed/--headless` (assisted is always headed), `--resume` (resume a paused attempt of this device) | stream events → `{task_id, outcome, submission_status, evidence_id?}` |
| `apply --matched` | Create apply tasks for tracked `ready` applications matching criteria | `--min-score N`, `--limit N`, `--rule <rul_id>`, `--dry-run` (list only) | `{created:[task_id], skipped:[{app_id, reason}]}` |
| `approvals list` | Pending approvals | `--kind`, `--state`, `--ids` | `{items:[…]}` |
| `approvals decide <apr_id…>` | Approve/reject (shows payload, verifies `payload_hash` of every approval); needs step-up `automation:manage`. Several ids need `--approve` or `--reject`; bulk approve **skips** `submit` (`submission_needs_review`: submissions are approved one at a time), `answer` (`needs_input`) and `rule_activation` (`needs_review`), exit 8 | `--approve\|--reject`, `--answer <text>` (one `answer` approval only) | `{state}`; several ids: bulk results |
| `browser install` | Install Chromium (`python -m playwright install chromium`; Linux `--with-deps` prompts for sudo) (22 §4) | `--channel chrome\|msedge` (use a branded browser instead) | `{installed, path, size_mb}` |
| `browser launch` | Start a managed browser (Mode A) with a profile, headed, for inspection | `--profile`, `--channel` | `{profile, pid}` |
| `browser login <profile>` | Open a headed Mode A/C session so the user can log into ATS/email sites manually; closes on Enter | `--url` | `{profile}` |
| `browser connect` | Register a Mode B CDP endpoint (loopback only) and test it | `--cdp http://127.0.0.1:9222` | `{endpoint, browser_version}` |
| `browser status` | Installed browsers, configured modes, profile locks | — | `{…}` |
| `browser profiles [list\|create\|delete]` | Manage named profiles under data dir | `--name` | `{profiles:[…]}` |
| `cv list` | Base CVs (`GET /api/v1/cvs`) | — | |
| `cv generate <app_id>` | Request a tailored variant (`POST …/cv-variants`) | `--base <cv slug>`, `--template`, `--no-tailor`, `--wait` | `{cv_variant}` |
| `cv show <cvv_id>` | Variant status + diff summary | `--diff` | |
| `cv review <app_id\|cvv_id>` | Print the variant diff and approve/reject it (08 §7); needs `cv:write` (step-up on first use, 17 §5.1) | `--approve\|--reject` | `{cv_variant}` |
| `email draft <app_id>` / `email show <eml_id>` | Create / show an email application draft (09) | `--to`, `--locale en\|id`, `--attach <fil_id…>` | `{email_application}` |
| `email approve <eml_id>` | Approve a draft (`automation:manage`, step-up) | — | `{status}` |
| `email send <eml_id>` | `local_handoff`: build the `.eml`, open the mail client, ask for confirmation | — | `{status}` |
| `email confirm <eml_id>` | Record whether the hand-off was actually sent | `--sent\|--not-sent` | `{status, submission_status}` |
| `cv download <cvv_id\|app_id>` | Download the approved PDF to the staging dir (or `--out`), verifying SHA-256 | `--out` | `{path, sha256}` |
| `cv render <cvv_id>` | Headless-render a variant PDF and upload it (normally done by the worker for `render_cv` tasks) | — | `{file_id}` |
| `sync` | Flush outbox then pull changes | `--force` (full snapshot resync), `--status` (report only), `--push-only`, `--pull-only` | `{pushed, pulled, conflicts, outbox_depth, cursor}` |
| `worker start` | Run the task worker in the foreground (21). `--detach` installs/starts a user-level background service (launchd agent / systemd --user unit / Windows Task Scheduler task) | `--detach`, `--kinds apply,discover,render_cv`, `--headed` | stream events |
| `worker stop` | Stop the background worker (releases leases gracefully) | — | `{stopped}` |
| `worker status` | Worker PID, current lease/task, last poll, poll interval | — | `{…}` |
| `worker enable` / `worker disable` | Toggle **this device's** `devices.accepts_tasks` (`PATCH /api/v1/devices/{id}`; allowed for the device's own row with `automation:execute`) | — | `{device_id, accepts_tasks}` |
| `worker pause-all` / `worker resume-all` | Account-wide kill switch `user_settings.automation_paused` (`PATCH /api/v1/settings`, `jobs:write`). Pausing is always allowed; resuming asks for confirmation | `--yes` | `{automation_paused}` |
| `rules list` / `rules show` / `rules enable\|disable <rul_id…>` | Read automation rules (editing is web-first; enable/disable allowed except enabling `auto`, which needs web approval: `failed` / exit 9) | `--ids` (list) | several ids: bulk results |
| `devices list` / `rename` / `revoke <dev_id…>` | Device management (`devices:manage`); `revoke` asks once for the set and revokes this device last | `--ids` (list), `--yes` | several ids: bulk results |
| `tasks list` | Automation tasks (`GET /api/v1/tasks`) | `--state`, `--kind`, `--app <app_id>`, `--limit`, `--ids` | `{items:[…]}` |
| `tasks cancel <tsk_id…>` | `POST …/cancel`: queued ⇒ `cancelled`, leased ⇒ `cancel_requested` (heartbeat), past `submit_intent` ⇒ `conflict` (`too_late`); step-up `automation:manage` | — | `{task}`; several ids: bulk results |
| `tasks retry <tsk_id…>` | `POST …/retry` from `failed` / `outcome_unknown` (new task with `retry_of`); step-up `automation:manage` | `--confirm-not-submitted` (required for `outcome_unknown`: the user checked nothing was submitted) | `{task}`; several ids: bulk results |
| `logs` | Show/tail local logs | `--follow`, `--run <run_id>`, `--task <tsk_id>`, `--level` | NDJSON passthrough |
| `config get/set/list/path` | Local config (§9) | — | |
| `config purge` | Delete local caches, logs, staging files and (with `--profiles`) browser profiles; never touches cloud data | `--profiles`, `--yes` | `{deleted:[…]}` |
| `doctor` | Environment checks (22 §4) | `--bundle` (support bundle) | `{checks:[{name, ok, detail}]}` |
| `version` | Versions of pilih-jobs, Python, Playwright, Scrapling, browser | — | |
| `update` | Self-update via the detected installer (22 §5) | `--check` | `{current, latest, action}` |
| `uninstall` | Log out, stop the worker service, and print the installer-specific removal command (22 §11) | `--purge-data` | `{steps:[…]}` |

**Bulk results.** Every list-item mutation (`inbox track|dismiss|seen|restore`, `move`,
`edit`, `follow-up`, `archive`, `rm`, `rules enable|disable`, `devices revoke`,
`approvals decide`, `tasks cancel|retry`) takes several ids. Ids are checked for their prefix
up front (exit 2), deduplicated in order, and processed one by one: one id failing never
stops the others (errors that hold for every id — not signed in, a missing scope, an
upgrade — abort as usual). With one id a command keeps its single-id output (the `inbox`
commands always report results). With several, `data` is
`{results: [{id, status, error?, message?, …fields}], summary: {ok, skipped, conflict,
not_found, failed, queued}}`; `status` is `ok` (done, or an expected no-op), `skipped`
(deliberately not attempted, `error` says why), `conflict` (409, already decided, hash
mismatch), `not_found`, `failed` or `queued` (offline, in the outbox). Conflicts are reported,
never prompted. Exit 0 when every id is `ok`; otherwise the first `failed` id's own code, then
7 (queued), 6 (conflict), 8 (a skip that needs a one-by-one decision), 5 (not found). Human
mode prints a table and a summary line. List commands take `--ids` (one id per line, also
with `-q`; JSON `{ids[]}`) so a listing pipes into a bulk command, and human tables never
truncate id columns.

---

## 4. Interactive vs. non-interactive behaviour

- **TTY detection:** `sys.stdin.isatty() and sys.stdout.isatty()` together
  with the absence of `--json`/`--no-input`/`CI` decide whether the session is
  interactive.
- **Prompts** happen only when the session is interactive. In `--json` mode
  prompts are never printed. A required decision returns exit 8 with an
  `error.code = "input_required"` envelope that lists what was needed (for
  example `{approval_id}`), so scripts can call `approvals decide` later.
- `--yes` covers ordinary confirmations (dismiss 50 items, delete a profile,
  purge data). It **never** implies submission approval. Submissions need an
  interactive "Submit application to <company> (<domain>)? [y/N]" or a web
  approval, except under an active `auto` rule (19 §8).
- **Secrets are never read from argv.** Personal tokens for scripts come from
  `PILIH_JOBS_TOKEN` (read-only scopes, §11) or stdin (`--token-stdin`).

---

## 5. Output modes and progress

| Mode | When | Format |
|---|---|---|
| Human | TTY, no `--json` | Rich tables, panels, a live progress bar per source (discovery) or per agent step (apply), colours off with `NO_COLOR` |
| JSON | `--json` | Short commands: one envelope object. Long commands: NDJSON events, one per line (`{"type": …, "ts": …}`), then a final `{"type":"result", "ok":…, "data":…}` |
| Quiet | `-q` | Only errors on stderr; exit code is the contract |

Event types are shared with the web dashboard (they are the same objects the
worker sends as `progress` in heartbeats/events, 21 §5): `source_*`, `page_fetched`,
`item`, `sync`, `task_claimed`, `step`, `paused`, `approval_requested`,
`submit_intent`, `evidence`, `result`, `warning`, `log`.

---

## 6. Cancellation (SIGINT / SIGTERM)

```text
1st Ctrl+C ─▶ "graceful":
   discovery  → stop scheduling, finish in-flight requests (≤ 10 s), mark run partial/cancelled, flush outbox
   apply      → if before submit_intent: stop at the next step boundary, close dialogs, report `paused`
                (resumable with `apply --resume`) or release the lease if the user chose "abandon"
              → if after submit_intent and before result: DO NOT stop; finish verification (≤ 60 s),
                record the result in the outbox, then exit 130
   worker     → finish/pause the current task as above, release lease if possible, exit
2nd Ctrl+C ─▶ "abort": cancel asyncio tasks immediately. If a submit_intent was recorded without a
              result, write a local `outcome_unknown` result to the outbox FIRST (synchronous sqlite write,
              < 50 ms) — the cloud will also derive outcome_unknown when the lease expires (D-19).
```

SIGTERM (service stop) behaves like the first Ctrl+C, with a 30 s hard
deadline. On Windows, `CTRL_BREAK_EVENT` is mapped the same way.

---

## 7. Worker loop design

```text
asyncio main loop (single thread)
├── HeartbeatLoop      every 30 s per active lease (21 §5) + device heartbeat every 60 s
├── PollLoop           claim when idle; interval from server `poll_interval_ms` (5 s active / 30 s idle / 60 s after 1 h), ±20 % jitter
├── SyncLoop           flush outbox every 10 s (or immediately on enqueue), pull changes every 60 s
├── TaskRunner         at most ONE browser task (apply/render_cv) at a time per device;
│                      discover tasks may run concurrently with a browser task only if they use JSON_API/STATIC_HTML
└── Scheduler          local schedules for sources with `schedule` hints (e.g. daily@08:00) → creates discover runs
```

- **One worker per device:** a lock file (`<data>/worker.lock`, OS-level
  `fcntl`/`msvcrt` lock) prevents two worker processes. An interactive
  `apply` checks the lock and, if a worker is running, asks it (local IPC:
  a Unix socket / Windows named pipe at `<runtime>/worker.sock`) to run the
  task instead, so one browser profile never has two drivers.
- **Backpressure:** no claim while the outbox depth is above 500 or the
  last sync failed more than 3 times in a row (the device is effectively
  offline). The heartbeat still reports `local_state`.
- **Crash recovery:** on start, the worker reads `local_tasks` (§8) and, for
  each non-terminal local task, sends its outcome or re-attaches to the lease
  (21 §8).

---

## 8. Local state layout

Paths come from `platformdirs` (`appname="pilih-jobs"`, `appauthor=False`):

| Kind | macOS | Windows | Linux |
|---|---|---|---|
| Config | `~/Library/Application Support/pilih-jobs/config.toml` | `%APPDATA%\pilih-jobs\config.toml` | `~/.config/pilih-jobs/config.toml` |
| Data | `~/Library/Application Support/pilih-jobs/` | `%LOCALAPPDATA%\pilih-jobs\` | `~/.local/share/pilih-jobs/` |
| Cache | `~/Library/Caches/pilih-jobs/` | `%LOCALAPPDATA%\pilih-jobs\Cache\` | `~/.cache/pilih-jobs/` |
| Logs | `~/Library/Logs/pilih-jobs/` | `%LOCALAPPDATA%\pilih-jobs\Logs\` | `~/.local/state/pilih-jobs/log/` |

Data dir contents (permissions `0700` on POSIX; user-only ACL on Windows):

```text
state.db                    # SQLite (WAL)
browser-profiles/<name>/    # Playwright persistent contexts (Mode A/C) — never uploaded
scrapling/adaptive.db       # Scrapling adaptive selector store (15 §6)
crawls/<src_id>/            # Spider checkpoints (pickle; trusted dir only)
runs/<att_id>/              # per-attempt dir: CV/cover-letter staging (deleted when the attempt ends), step log + screenshots (kept 7 d after sync)
worker.lock
```

**Authoritative rule:** `state.db` holds only **caches, checkpoints, pending
operations and local task bookkeeping**. Nothing in it is authoritative. A full
resync (`sync --force`) can rebuild everything except unsynced outbox entries.

`state.db` schema: the **canonical definition is 20 §3** (migrations in
`storage/migrations/NNN_*.sql`, version in `PRAGMA user_version`). Tables:
`account`, `outbox` (pending writes, 20 §5), `entity_cache` (read cache from
the change feed), `sync_state` (acknowledged cursor), `seen_postings`
(LocalSeenCache, 15 §11), `checkpoints`, `local_tasks` (leases held by this
device, 21 §5), `runs` (local run index for `logs`) and `kv` (meta cache).

Tokens are **not** stored in `state.db` (§11).

---

## 9. Configuration

TOML at the config path. Precedence: **flags > environment (`PILIH_JOBS_*`) > config file > defaults**.

```toml
[api]
url = "https://api.pilihpendidikan.com"     # PILIH_JOBS_API_URL

[browser]
mode = "managed"                             # managed | connected | persistent   (18)
default_profile = "default"
channel = "chromium"                         # chromium | chrome | msedge
headless_for = ["discover", "render_cv"]     # apply in approval/auto may be headless; assisted is always headed
cdp_endpoint = ""                            # Mode B, loopback only

[worker]
kinds = ["apply", "discover", "render_cv"]
max_daily_applications = 20                  # local ceiling in addition to server rule limits

[discovery]
max_pages = 50
allow_browser = false

[privacy]
telemetry = false                            # opt-in (22 §8)
keep_evidence_screenshots = true
keep_run_dirs_days = 7

[logging]
level = "info"
```

`config set` validates against a Pydantic model and refuses unknown keys.
Server-side preferences (rules, sources, facts) are **not** in this file; they
live in the cloud.

---

## 10. Structured logging

- **Format:** JSONL at `<logs>/pilih-jobs.log`, plus per-run logs
  `<data>/runs/<id>/steps.jsonl`. Fields: `ts, level, event, run_id?, task_id?, attempt_id?, lease_id_hash?, device_id, msg, data`.
- **Rotation:** 10 MB × 5 files. Run logs are deleted 7 days after a
  successful sync.
- **Redaction (mandatory, in a logging filter, not at call sites):**
  - Bearer and refresh tokens, `Authorization` headers and `code`/`code_verifier`
    are never logged. Only `sha256(token)[:8]` may appear.
  - Values typed into form fields are logged as `{"field_ref": "f12", "value_source": "fact:contact.phone", "len": 13}`,
    never as raw values. Raw values of `protected` answers are never written
    anywhere locally except the staging payload in memory.
  - Emails and phones in free-text messages are masked by regex (`a***@d***.com`).
  - Cookies, `Set-Cookie` and browser storage are never logged.
- **Upload:** the redacted step log is uploaded as `run_log` (04 `files`) on
  task completion (19 §11). It is retained 30 days server-side.

---

## 11. Credential management

**[DECISION]** Stored with `keyring` under service `pilih-jobs`; the layout
is owned by 17 §12:

| Account | Content |
|---|---|
| `<api-host>:<user_id>:refresh` | OAuth refresh token (rotates on every refresh, 17 §7) |
| `<api-host>:<user_id>:access` | Cached 1 h access token (optional; in memory first) |
| `<api-host>:<user_id>:device-key` | Ed25519 private key (reserved for DPoP, 17 §11; not created in v1) |

Backends **[VERIFIED]** https://pypi.org/project/keyring/: macOS Keychain,
Windows Credential Locker, Linux Secret Service (GNOME Keyring / KWallet via
Secret Service).

**Headless Linux / containers [LIMITATION]:** Secret Service needs a D-Bus
session and an unlocked keyring. Policy:

1. If no secure backend is available, `login` **refuses** and explains the
   options (run inside a desktop session, start `gnome-keyring-daemon` via
   `dbus-run-session`, or opt in to the encrypted file store).
2. Opt-in encrypted file store (`pilih-jobs config set credentials.store encrypted-file`).
   It is the same setting as `login --credential-store encrypted-file` (17 §12):
   a `keyrings.cryptfile`-style AES-GCM file whose key is derived from a
   passphrase with stdlib `hashlib.scrypt` (n=2^17, r=8, p=1). The passphrase is prompted per process, or comes from
   `PILIH_JOBS_KEYRING_PASSPHRASE` for unattended workers, with a warning that
   this moves the secret to the environment.
3. **Plaintext token files are never supported.** `keyrings.alt` plaintext
   backends are rejected at start-up.

Personal tokens (`PILIH_JOBS_TOKEN`) are accepted for **read-only** commands
and `discover --dry-run`. Commands needing `automation:execute` require an
OAuth device login (05 §1.2).

---

## 12. Version compatibility

- On start (cached 6 h in `kv`), `GET /api/v1/meta` returns
  `{min_cli_version, recommended_cli_version, features[]}`.
  - Below the minimum, every command except `version`, `update`, `logout` and
    `doctor` exits 10 and prints the upgrade command (22 §5).
  - Below the recommended version, a one-line notice is printed (suppressed in
    `--json`; reported in the `meta` field).
- Any `426 cli_upgrade_required` from any endpoint triggers the same handling.
  The worker stops claiming tasks, finishes its current task and exits 10.
- **Contract version:** generated models carry `CONTRACTS_VERSION`. The server
  tolerates unknown request fields only within a major version. The CLI
  ignores unknown response fields (Pydantic `extra="ignore"`).

---

## 13. Threading and Playwright

**[LIMITATION]** "Playwright's API is not thread-safe" **[VERIFIED]**
https://playwright.dev/python/docs/library. Therefore:

- The whole CLI runs on **one asyncio event loop** in the main thread, using
  Playwright's async API only.
- On Windows the loop must be the `ProactorEventLoop`, which is the Python
  3.8+ default. Overriding the policy is forbidden.
- CPU-heavy work (HTML parsing of large pages, PDF hashing, zstd) uses
  `asyncio.to_thread` and never touches Playwright or Selector objects
  afterwards.
- Scrapling browser sessions (discovery) and the agent's browser (applications)
  are separate Playwright browser instances on the same loop. They never share
  a `user_data_dir`, because profiles lock (18 §3).

---

## 14. Error recovery and offline behaviour (summary)

- **Network down:** commands that mutate cloud state enqueue to the outbox and
  exit 7 with `{"queued": n}`. The worker keeps executing *already claimed*
  tasks only until their lease would expire (it cannot heartbeat). It never
  starts a submission it cannot record a `submit_intent` for. Details are in
  20 §5 and 21 §8.
- **Token expired / refresh failed:** exit 3. The outbox is kept. After
  `login`, if the same user logs back in, the outbox replays. If a different
  user logs in, the outbox is **quarantined** (`state = 'dead'`, exportable via
  `sync --status --json`) and never replayed under the wrong identity.
- **Server conflict (409):** handled per 20 §6. Unresolvable conflicts are
  shown in `sync --status` and in the web app.

---

## 15. Test strategy

| Level | Scope | Tooling |
|---|---|---|
| Unit | Command parsing, output renderers, exit-code mapping, config precedence, redaction filter (property tests with Hypothesis: no token/email/phone in output) | pytest |
| Component | `api` client against `pytest-httpserver` with contract fixtures; outbox replay ordering; keyring backend selection (fake backends) | pytest |
| Contract | Generated Pydantic models round-trip `packages/jobs-contracts` example payloads (the same examples the TypeScript tests use) | pytest + JSON fixtures |
| Integration | `login` against `wrangler dev` (loopback redirect, PKCE), device registration, task claim/heartbeat/result | e2e job with `apps/api` dev server and a local D1 |
| Browser | Agent against local static form fixtures (Greenhouse-, Lever-, Ashby-like HTML) served by a fixture server; headless Chromium | pytest-asyncio + Playwright |
| Platform | Install + `doctor` + one discovery dry-run on macOS-14 arm64, Windows-2022 x64, Ubuntu-24.04 x64 | GitHub Actions matrix (22 §9) |
| Signals | SIGINT before/after `submit_intent` produces `paused`/`outcome_unknown` outbox entries | subprocess tests (POSIX); Windows via `CTRL_BREAK_EVENT` |
