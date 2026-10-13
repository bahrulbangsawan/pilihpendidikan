## ADDED Requirements

### Requirement: Python CLI package and executables
The repository SHALL contain `apps/jobs-cli`, a uv-managed Python project
(`requires-python >=3.11,<3.14`, Python 3.12 pinned, hatchling, committed
`uv.lock`) published as dist `pilih-jobs` with import package `pilih_jobs`
and the executables `pilih-jobs` and `pj`, and it MUST NOT install an
executable named `jobs`. Its `package.json` SHALL only be a Turborepo shim
whose scripts first run `scripts/require-uv.sh`, failing loudly when `uv` is
missing. (Source: 16 §1, §3; 22 §3; D-07; D-08)

#### Scenario: Wheel install
- **WHEN** the wheel built by `uv build` is installed into a fresh Python 3.12 venv
- **THEN** `pilih-jobs version` and `pj --help` run

#### Scenario: No uv
- **WHEN** a turbo task of `apps/jobs-cli` runs on a machine without `uv`
- **THEN** it exits non-zero with an install hint instead of skipping the Python leg

### Requirement: Command tree and global flags
The CLI SHALL expose the 16 §3.3 command tree through Typer (including
`login`, `logout`, `whoami`, `status`, `sync`, `config`, `version`, `doctor`,
`update`, `uninstall`, `devices`, `discover`, `inbox`, `board` commands and
the `worker`, `apply`, `browser`, `cv`, `email`, `approvals`, `rules`, `logs`
groups, with `automation` as a hidden alias of `worker`) and the global flags
`--json`, `--no-input`, `-y/--yes`, `-v/--verbose`, `-q`, `--profile`,
`--api-url`, `--config`, `--color/--no-color`, accepted before or after the
subcommand. `--yes` MUST never imply a submission approval. (Source: 16 §3.1,
§3.3, §4; D-31)

#### Scenario: Help is fast and import-light
- **WHEN** `pilih-jobs --help` runs
- **THEN** it lists the command groups without importing playwright or scrapling

#### Scenario: Non-interactive confirmation
- **WHEN** a command that needs confirmation runs with `--no-input` and without `--yes`
- **THEN** it exits 8 with `error.code = "input_required"` instead of prompting

### Requirement: Output envelopes and exit codes
Short commands in `--json` mode SHALL print one envelope
`{"ok": bool, "data": …, "error"?: {code, message, details}}`, long commands
SHALL stream NDJSON events (`{"type": …, "ts": …}`) ending with one result
line, and the process MUST exit with the stable codes 0 success, 1 failure,
2 usage, 3 not authenticated, 4 permission denied, 5 not found, 6 conflict,
7 network/server unavailable, 8 paused / input required, 9 policy refused,
10 upgrade required and 130 interrupted. (Source: 16 §3.2, §3.3, §5)

#### Scenario: Server error mapping
- **WHEN** the API answers `403 insufficient_scope`
- **THEN** the envelope has `ok: false` with that code and the process exits 4

#### Scenario: Offline
- **WHEN** the API cannot be reached
- **THEN** the command exits 7 and any queued write stays in the outbox

### Requirement: Configuration precedence
The CLI SHALL read a TOML config from the platformdirs config path and
resolve every setting with the precedence flags > `PILIH_JOBS_*` environment >
config file > defaults; `config set` MUST validate against the typed model and
refuse unknown keys, and `config purge` MUST delete local caches, logs and
staging files (profiles only with `--profiles`) but never the outbox or cloud
data. (Source: 16 §8, §9)

#### Scenario: Flag beats environment
- **WHEN** `PILIH_JOBS_API_URL` and `--api-url` disagree
- **THEN** the flag value is used

#### Scenario: Unknown key
- **WHEN** `pilih-jobs config set foo.bar 1` runs
- **THEN** it exits 2 and the file is unchanged

### Requirement: Login with PKCE loopback
`pilih-jobs login` SHALL fetch the RFC 8414 metadata, generate a 64-character
verifier and a 256-bit `state`, listen once on `127.0.0.1` (an OS-assigned
port, or `--port` for SSH forwarding) for at most 300 s, open the system
browser (never the automation browser), accept only `/callback` with the
expected `state` (constant time) and `iss`, exchange the code once, register
the device (`POST /api/v1/devices`, or reuse it with `device_hint`) and store
the credentials; a failed device registration MUST revoke the just-issued
refresh token. (Source: 17 §4.1, §10.1, §10.2, §13)

#### Scenario: Happy path
- **WHEN** the user approves in the browser
- **THEN** the CLI stores the refresh token in the keyring and prints the signed-in email and device name

#### Scenario: State mismatch
- **WHEN** a request reaches `/callback` with another `state`
- **THEN** the listener answers 400 and the login aborts without storing anything

#### Scenario: Denied consent
- **WHEN** the browser returns `error=access_denied`
- **THEN** the CLI exits 1 with "Authorization was denied"

### Requirement: Credential storage
Refresh and cached access tokens SHALL be stored only in the OS keyring under
service `pilih-jobs` (accounts `<api-host>:<user_id>:refresh|access`) or, when
opted in, in an AES-256-GCM encrypted file keyed with scrypt (n=2^17, r=8,
p=1) from a prompted or `PILIH_JOBS_KEYRING_PASSPHRASE` passphrase; plaintext
and null keyring backends MUST make `login` refuse, and no token may be
written to `state.db`, logs, the config dir or terminal output. Refreshes MUST
be serialized by `auth.lock` across processes. (Source: 17 §12; 16 §11)

#### Scenario: Headless Linux without a keyring
- **WHEN** `login` runs with the null keyring backend
- **THEN** it refuses and explains the encrypted-file option

#### Scenario: Concurrent refresh
- **WHEN** two processes find the access token expired at the same time
- **THEN** exactly one network refresh happens

### Requirement: Logout
`pilih-jobs logout` SHALL release held leases before `submit_intent`, offer to
flush the outbox, revoke the refresh token with `POST /oauth/revoke`
(`forget_device=true` only with `--forget-device`) and delete the keyring
entries, keeping browser profiles; it MUST complete locally when offline.
(Source: 17 §8)

#### Scenario: Logout
- **WHEN** a signed-in user runs `pilih-jobs logout`
- **THEN** the refresh token is revoked server-side and no credential remains in the keyring

### Requirement: Generated contract models
The CLI SHALL use Pydantic v2 models generated from the
`packages/jobs-contracts` JSON Schema into `contracts/_generated/` (never
hand-edited) together with byte-identical copies of the contract data files,
ignore unknown response fields, and reproduce the contract golden vectors for
ids, `fp1` fingerprints, canonical URLs, registrable domains and stage
transitions; `scripts/gen_contracts.py --check` MUST fail when the generated
files are stale. (Source: 16 §1, §12; 20 §7; D-20)

#### Scenario: Drift
- **WHEN** a contract schema changes without regenerating the CLI models
- **THEN** `contracts:check` fails

#### Scenario: Fingerprint parity
- **WHEN** the CLI fingerprints the cases in `test-vectors/fingerprint.json`
- **THEN** every result equals the TypeScript expectation byte for byte

### Requirement: Structured logging with redaction
The CLI SHALL write JSONL logs (rotated 10 MB × 5) and per-run step logs
through a redaction filter attached to every handler that replaces bearer
and refresh tokens, `Authorization`, `code`, `code_verifier` and `state`
values with `sha256[:8]`, masks emails and phone numbers, logs typed field
values only as source and length, never logs cookies, and strips the query
string of `/oauth/*` URLs. (Source: 16 §10; 17 §13)

#### Scenario: Golden log
- **WHEN** a login and a refresh are logged at debug level
- **THEN** the log contains no token, code, verifier or state value

### Requirement: Version compatibility gate
The CLI SHALL send `User-Agent: pilih-jobs/<semver> (…)` and
`X-Pilih-Client: cli/<semver>`, read `GET /api/v1/meta` (cached 6 h), and when
below `min_cli_version` or on any `426 cli_upgrade_required` every command
except `version`, `update`, `logout` and `doctor` MUST exit 10 with the
upgrade command; below `recommended_cli_version` it prints a one-line notice
outside `--json`. (Source: 16 §12; 05 §1.7)

#### Scenario: Server raised the minimum
- **WHEN** an API call answers 426
- **THEN** the command exits 10 and prints the upgrade instruction

### Requirement: Telemetry and crash reports are opt-in
Telemetry SHALL be off by default and, when enabled with
`privacy.telemetry = true`, send only anonymous aggregated counters (versions,
OS, command name, duration bucket, exit code, adapter error classes, install
channel) with a random install id rotated every 30 days to
`POST /api/v1/telemetry`; crash reports SHALL be written locally with file and
line only and sent to `POST /api/v1/telemetry/crash` only after a TTY
confirmation. The server MUST store no user id, device id or IP for these
routes. (Source: 22 §8.1, §8.2; 05 §10a)

#### Scenario: Default install
- **WHEN** a fresh install runs any command
- **THEN** no telemetry request is made

### Requirement: Doctor, update and uninstall
`doctor` SHALL report environment checks with fixes and `--bundle` SHALL
write a support zip with redacted config, logs, outbox summary and profile
names only (never `state.db`, tokens, profiles or screenshots); `update`
SHALL compare with PyPI and `/meta` and run the detected installer's upgrade
command (uv, pipx, Homebrew, Scoop) or print it; `uninstall` SHALL stop the
worker, log out and delete keyring entries, deleting local data only with
`--purge-data`, and never delete cloud data. (Source: 22 §4, §5, §8.3, §11)

#### Scenario: Unknown installer
- **WHEN** `pilih-jobs update` cannot detect how it was installed
- **THEN** it prints the upgrade command and does not modify the environment

### Requirement: Devices commands
`pilih-jobs devices list|rename|revoke` SHALL call the `/api/v1/devices`
routes and MUST require the step-up `devices:manage` scope, asking the user to
run `pilih-jobs login --scope devices:manage` when it is missing. (Source:
16 §3.3; 17 §5.1)

#### Scenario: Base token
- **WHEN** a CLI with only the base scopes runs `devices revoke`
- **THEN** it exits 4 with the step-up instruction

### Requirement: CLI and devices page
`apps/jobs` SHALL serve `/cli` with install commands per OS (uv primary, pipx
alternative) rendered from `packages/jobs-contracts/cli-commands.json` with a
copy button bound to the `C` shortcut, the `browser install`, `login`,
verification and next-step commands, troubleshooting hints, and a devices
table with online/active state and rename/revoke dialogs; while the user
waits for a first device the page MUST poll `GET /api/v1/devices` every 3 s.
(Source: 22 §12; 12 §8)

#### Scenario: No device yet
- **WHEN** a user without devices opens `/cli`
- **THEN** the install steps are the page's hero and the devices list refreshes every 3 s

#### Scenario: Revoke from the web
- **WHEN** the user confirms Revoke on a device row
- **THEN** `POST /api/v1/devices/{dev_id}/revoke` is called through the BFF and the row shows the device as revoked
