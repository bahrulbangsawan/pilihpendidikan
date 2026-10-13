## Context

The CLI is the local execution engine: discovery (this change), browser
automation (`jobs-add-browser-agent`), CV rendering (`jobs-add-cv-variants`)
and email hand-off (`jobs-add-email-applications`). It brings a second
toolchain (Python + uv) into a Bun workspace (A-06) and must be safe on a
user's machine: no stealth scraping, no plaintext secrets, nothing
authoritative stored locally.

## Goals / Non-Goals

- Goals: one installable CLI (`uv tool install pilih-jobs`) with a stable
  command and exit-code contract; polite, policy-guarded discovery from
  official ATS APIs; an outbox that converges under retries, crashes and
  offline periods; contracts shared with TypeScript, not hand-copied.
- Non-Goals: single-file binaries (22 §2.1); stealth fetchers, proxies,
  CAPTCHA solving (D-16); LinkedIn / Indeed (D-17); WebSocket push (D-11
  keeps polling); third-party telemetry SDKs.

## Decisions

- **D-07 / D-08** Python 3.12 (`requires-python >=3.11,<3.14`), Typer +
  Rich, httpx (no browser impersonation on API calls), executables
  `pilih-jobs` and `pj` — never `jobs` (shell builtin). The automation group
  is `worker` with a hidden `automation` alias (D-31, implemented by the
  browser-agent change).
- **D-20** `scripts/gen_contracts.py` generates `contracts/_generated/` from
  `packages/jobs-contracts/schema/*.json` and copies the data files; golden
  vectors are read from `packages/jobs-contracts/test-vectors/` (never
  copied), so fingerprint drift fails both suites.
- **D-36** Scrapling is called in-process only from
  `pilih_jobs/discovery/engine/`; the guard is AST test + `sys.meta_path`
  finder + kwargs allow-list. `lint-imports` keeps `cli` free of
  playwright/scrapling and `api` free of `browser`.
- **D-16 / D-17** No escalation after 403/challenge; robots.txt obeyed even
  though Scrapling defaults it off (C-12); exclusions enforced by the
  registry before any request and by the server (`422 unsupported_source`).
- **D-21 / 20 §6.2** Conditional writes carry `base_revision`; append-only
  records never do; the CLI keeps the server's `cursor_state` on 409.
- **Credentials** live in the OS keyring under service `pilih-jobs`, or in an
  opt-in AES-256-GCM file keyed with scrypt (n=2^17, r=8, p=1); null and
  plaintext keyring backends are refused (17 §12, 16 §11).

Divergences from the spec text, where the code is normative here:
- The AST policy test lives in `apps/jobs-cli/tests/discovery/test_policy.py`
  (T15-POLICY, T11-STEALTH) instead of `tests/policy/test_forbidden_scrapling.py`
  (15 §13); the checks are the same.
- `packaging/` (Homebrew formula, Scoop manifest) and the install scripts are
  owned by the docs-ops leaf (leaf-5.3) and are not part of this change's
  code; distribution beyond `uv build` is an owner handoff.

## Risks / Trade-offs

- Second toolchain in `bun run check` (A-06) → `require-uv.sh` fails loudly
  instead of skipping the Python leg.
- Windows keyring / Playwright quirks and Scrapling's `[fetchers]` extra
  pulling patchright (A-04) → only provable on the CI OS matrix, which has not
  run (owner).
- Undocumented ATS behaviour changes → recorded fixtures, `schema_invalid`
  stops a source, live canaries are opt-in.

## Migration Plan

No data migration. Rollout: TestPyPI → PyPI → tap/bucket (22 §7), all owner
actions not executed. `JOBS_CLI_LOGIN_ENABLED` and `JOBS_V1_ENABLED` gate the
server side; `min_cli_version` is the kill switch for a bad release.

## Open Questions

- A-04: does `uv tool install pilih-jobs` + `browser install` work on macOS
  13+, Windows 11, Ubuntu 22.04+ (CI matrix) — owner.
- A-06: owner acceptance of Python + uv in the workspace.
- A-11: MIT licence for the published CLI (`pyproject.toml` declares MIT
  pending the owner's decision).
