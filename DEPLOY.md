# Deploying pilihpendidikan

The first production deploy moves the CV, invoice, portfolio and jobs backend
off the old `bahrul` Worker onto `apps/api` at `api.pilihpendidikan.com`. The
steps below run in order. Every step that creates a resource, writes data or
deploys needs the owner's go-ahead; nothing here has been run yet.

**Status (2026-10-06):** steps 1–6 are done in the bisa.digital account (api
`026077ee`, cv `58507e9a`, invoice `8fd4838f`, portfolio `55b5bfc2`), and all
four services are flipped live on the hub. The CV copy found 3 documents (one,
`bahrul-dm`, has no owner stamp) and the token copy 1 personal token. Step 7
(bahrul repo) is still open.

Order in one line: **resources → ids into config → D1 schema → deploy api →
copy data (dry run, then execute) → deploy the three apps → retire the old
backend.** After each deploy, the hub picks the service up through
[Going live](#going-live-flip-a-service-on-the-hub).

The Job Tracker (D1 `pilihpendidikan-jobs`, R2, queues, the legacy jobs
migration, `apps/jobs`) has its own ordered plan in [Job Tracker](#job-tracker),
CLI releases are in [pilih-jobs CLI releases](#pilih-jobs-cli-releases), and
the [Release notes](#release-notes) list what changes for existing users.

## Hub: pilihpendidikan.com (apps/home)

The hub has no bindings, data or secrets and does not depend on the api, so
it can (and should) deploy before everything else: the bahrul.me admin
already links to `https://pilihpendidikan.com`. It ships with every service
`"soon"` and links none of them.

```sh
bun install && bun run check && bun run build
cd apps/home
bunx wrangler deploy --dry-run   # config + bundle check, uploads nothing
bun run deploy                   # needs the owner's go-ahead
```

What the deploy creates:

- Worker `home-pilihpendidikan`
- Custom domain `pilihpendidikan.com` and custom domain
  `www.pilihpendidikan.com`, each with its proxied DNS record and edge
  certificate (created by wrangler from `routes`; the zone must have no
  existing records on those two names)

Zone setting (dashboard → SSL/TLS → Edge Certificates, not in this repo):
**Always Use HTTPS = on**, so every `http://` request on the zone, including
the future `cv.`, `invoice.`, `portfolio.` and `api.` hosts, 301s to `https://`.
Turned on 2026-10-06 after the first hub deploy.

Smoke-check:

```sh
curl -sI http://pilihpendidikan.com           # 301 → https://pilihpendidikan.com/
curl -sI https://pilihpendidikan.com          # 200, security headers, Cache-Control: public, max-age=300
curl -sI https://www.pilihpendidikan.com/id   # 301 → https://pilihpendidikan.com/id
curl -s https://pilihpendidikan.com/llms.txt  # names no subdomain while everything is "soon"
curl -s https://pilihpendidikan.com/robots.txt https://pilihpendidikan.com/sitemap.xml
```

Rollback: `bunx wrangler rollback` in `apps/home`. To take the apex offline
again, remove the two custom domains (Workers & Pages → `home-pilihpendidikan`
→ Settings → Domains & Routes).

## 0. Before you start

- The `pilihpendidikan.com` zone is on the same Cloudflare account that owns
  the existing invoice, portfolio and jobs KV namespaces (they are rebound,
  not copied, so the account must be the same).
- `bunx wrangler login` as the owner (or `CLOUDFLARE_API_TOKEN` for wrangler).
- For the migration scripts, export:

  ```sh
  export CLOUDFLARE_ACCOUNT_ID=<account id>
  export CLOUDFLARE_API_TOKEN=<token with Workers KV Storage:Edit and D1:Edit>
  ```

- `bun install && bun run check && bun run build` passes on the commit you
  deploy.

## 1. Create the Cloudflare resources

```sh
cd apps/api
bunx wrangler d1 create pilihpendidikan
bunx wrangler kv namespace create pilihpendidikan-auth
bunx wrangler kv namespace create pilihpendidikan-cv
bunx wrangler kv namespace create pilihpendidikan-rate-limit
```

The titles are prefixed because KV titles are unique per account and the
account already has namespaces titled `CV_KV` (the old CV source) and
`RATE_LIMIT_KV`. The binding names in `wrangler.jsonc` stay `AUTH_KV`,
`CV_KV` and `RATE_LIMIT_KV`. If wrangler offers to add a binding to the
config, answer no: paste the ids over the placeholders instead.

Paste each printed id over its placeholder in `apps/api/wrangler.jsonc`:

| Placeholder | Resource |
|---|---|
| `REPLACE_WITH_D1_DATABASE_ID` | D1 `pilihpendidikan` |
| `REPLACE_WITH_AUTH_KV_ID` | KV for sessions, sign-in links, OAuth state |
| `REPLACE_WITH_CV_KV_ID` | KV for CV documents |
| `REPLACE_WITH_RATE_LIMIT_KV_ID` | KV for rate-limit counters |

These stay as they are (existing namespaces, rebound):

| Binding | Namespace id |
|---|---|
| `INVOICE_KV` | `5c3724f8c1c340cf9dc0230217e98a4b` |
| `PORTFOLIO_KV` | `ffd22e60a94742f3bb484f0f0d2d2f95` (preview `981ccf32fa074260b33f8f152c906490`) |
| `JOBS_KV` | `73682a585fbd48dcbc996d90e7ea4511` (preview `beeb69315ddb44819808a1a4166d0796`) |

Then `bun run cf-typegen` and commit the config.

## 2. Email sending

Sign-in links are sent by the `EMAIL` binding from `noreply@pilihpendidikan.com`.
Onboard `pilihpendidikan.com` to Cloudflare Email Sending (Dashboard → Email →
Email Sending: add the domain and publish the DNS records it lists), and make
sure `noreply@pilihpendidikan.com` is an allowed sender. Until this is done,
sign-in emails fail and the stored link is rolled back.

## 3. D1 schema

```sh
cd apps/api
bunx wrangler d1 migrations apply DB --remote
```

## 4. Deploy the api Worker

```sh
bun run build
cd apps/api && bun run deploy
```

`routes` attaches the custom domain `api.pilihpendidikan.com`. Smoke-check:

```sh
curl -s https://api.pilihpendidikan.com/health                         # OK
curl -s https://api.pilihpendidikan.com/.well-known/oauth-authorization-server
curl -s https://api.pilihpendidikan.com/api/whoami                     # {"authenticated":false}
```

Open <https://api.pilihpendidikan.com/connect> and sign in once to confirm
email delivery.

Invoices, portfolios and jobs are already readable here (shared namespaces).
CVs appear after step 5.

## 5. Copy the data (dry run first)

Both scripts are read-only unless `--execute` is passed, never delete
anything from the source, and verify every key or row they write.

### CV documents

The old backend kept CVs in its auth namespace
(`8c6838adcba24aa2829579b1750572e7`, bound as `CV_KV` / `AUTH_KV` in
`bahrul-mcp`). Copy `cv:*` and `owner:cv:*` into the new CV namespace:

```sh
cd apps/api
bun scripts/migrate-cv-kv.ts --dest <new CV_KV id>             # dry run: review counts
bun scripts/migrate-cv-kv.ts --dest <new CV_KV id> --execute   # copy + verify
```

The report lists documents without an owner stamp (copied, reachable only by
`ADMIN_EMAILS`). Just before step 7, re-run with `--execute --overwrite` to
pick up CVs edited on the old backend in the meantime.

### Personal tokens

Copy active personal tokens of non-admin users from the old D1 database
(`bahrul-content`, id `c844a51a-d3c4-4b2b-b344-4b77e0dd6230`) so tokens
already pasted into the apps keep working:

```sh
cd apps/api
bun scripts/migrate-tokens.ts --source-db c844a51a-d3c4-4b2b-b344-4b77e0dd6230 --dest-db <new D1 id>
bun scripts/migrate-tokens.ts --source-db c844a51a-d3c4-4b2b-b344-4b77e0dd6230 --dest-db <new D1 id> --execute
```

Rows of emails in the old `admin_grant` table are skipped; add
`--exclude <email>` for anyone else who should not carry over. Inserts use
`INSERT OR IGNORE`, so the script can be re-run. Copied tokens get scope
`write`.

## 6. Deploy the three apps

```sh
cd apps/cv && bun run deploy
cd ../invoice && bun run deploy
cd ../portfolio && bun run deploy
```

Each attaches its custom domain (`cv.`, `invoice.`, `portfolio.pilihpendidikan.com`).
The apps already call `https://api.pilihpendidikan.com` and link to
`/connect`. Check a CV `?cv=<id>` load, a token save, and a
`https://api.pilihpendidikan.com/cv/<id>.pdf` redirect.

Then put each app on the hub through [Going live](#going-live-flip-a-service-on-the-hub),
one at a time.

## 7. Retire the old backend (bahrul repo)

Done from the `bahrul` repo, after steps 1–6:

1. Final CV re-sync (step 5 with `--overwrite`).
2. Apply bahrul D1 migrations `0028`–`0032` remotely.
3. Deploy `bahrul-mcp` (drops the cv / invoice / portfolio / jobs routes and
   bindings; renames `CV_KV` → `AUTH_KV` on the same namespace).
4. Optionally, once verified, delete the copied `cv:*` / `owner:cv:*` keys
   from the old auth namespace (manual; no script here deletes data) and
   retire the old `cv-bahrul`, `invoice-bahrul` and `portfolio-bahrul` Workers.

## Going live: flip a service on the hub

The hub links a service only when its entry in
`apps/home/src/config/services.ts` is `"live"`. Never flip one ahead of its
deploy: a `"live"` entry is a public link. For each of `cv`, `invoice`,
`portfolio`, `api` and `jobs`, in that service's own order above:

1. **Deploy the subdomain** (step 4 for `api`, step 6 for the apps, J1–J7 of
   [Job Tracker](#job-tracker) for `jobs`).
2. **Smoke-test it on its real URL:**
   - `cv` / `invoice` / `portfolio`: `curl -sI https://<app>.pilihpendidikan.com`
     and `.../id` return 200; open it in a browser, fill a field, download a
     PDF.
   - `api`: the step 4 checks (`/health`, `/api/whoami`, a `/connect`
     sign-in that delivers its email). Flipping `api` publishes the MCP
     endpoint and the `/connect` link on the hub.
   - `jobs`: the J6 checks with `JOBS_V1_ENABLED` on (sign in, the board
     loads, `/cli` shows the install commands).
3. **Flip its hub status:** change its one line in
   `apps/home/src/config/services.ts` from `status: "soon"` to
   `status: "live"`, then `bun run test` in `apps/home` (the link-guard tests
   cover every status).
4. **Redeploy the hub:** `bun run build && cd apps/home && bun run deploy`
   (owner's go-ahead), then check
   `curl -s https://pilihpendidikan.com | grep <app>.pilihpendidikan.com` and
   `curl -s https://pilihpendidikan.com/llms.txt`. HTML is cached for up to
   five minutes (`max-age=300`).

To take a service off the hub, set it back to `"soon"` and redeploy the hub.

## Rollback

- `apps/api` and the apps: `bunx wrangler rollback` in the app directory, or
  redeploy the previous commit. No data is lost: invoice, portfolio and jobs
  namespaces are shared, and the CV / token copies left their sources intact.
- Before step 7 the old backend is untouched and keeps serving.

---

## Job Tracker

The api's `/api/v1`, the `apps/jobs` dashboard and the `pilih-jobs` CLI.
The Job Tracker (`job-tracker-spec/`) is implemented and tested locally but
**nothing in this section has been run** (status 2026-10-13): no resource is
created, `REPLACE_WITH_JOBS_DB_ID` is still a placeholder, no migration ran
remotely, no flag changed, `apps/jobs` is not deployed and the CLI is not on
PyPI. Every step marked **[owner]** creates a resource, writes data, deploys,
changes a flag or publishes, and needs the owner's go-ahead (02 §7, 14 §8).

Order in one line (02 §7): **resources → schema → deploy api dark → legacy
migration (dry run, execute, verify) → flags on → deploy `apps/jobs` →
publish the CLI → flip `jobs` on the hub.**

### J0. Before you start

- `bun install`, `uv sync` in `apps/jobs-cli`, then `bun run check`,
  `bun run check-types` and `bun run build` pass on the commit you deploy, and
  `bun run e2e` passes on it (13 §5, about 30 minutes; see `e2e/README.md`).
- Release gates (13 §8) that apply before any production deploy of the jobs
  routes: **G1** the isolation sweep S-31 is green (`apps/api`
  `src/jobs/isolation-sweep.test.ts`, part of `bun run check`); **G2** the
  legacy parity S-02 is green (`apps/api/scripts/migrate-jobs-kv-to-d1.test.ts`)
  and the owner approves the migration run (J4).
- Wrangler logged in as the owner (`bunx wrangler login` or
  `CLOUDFLARE_API_TOKEN`), and for the scripts:

  ```sh
  export CLOUDFLARE_ACCOUNT_ID=<account id>
  export CLOUDFLARE_API_TOKEN=<token with D1:Edit and Workers KV Storage:Read>
  ```

- Feature flags are rows of `DB.feature_flags` (D-33), never vars; each
  isolate caches them for 30 s. Migration `0002` seeds every key dark. There
  is no admin UI: the owner sets a flag with one statement (value = a JSON
  scalar: `true` / `false`, or `"kv"` / `"d1"` for `JOBS_LEGACY_BACKEND`):

  ```sh
  # flag <KEY> <JSON value>   — [owner] each time
  flag() {
    bunx wrangler d1 execute pilihpendidikan --remote --command \
      "UPDATE feature_flags SET value = '$2', updated_at = $(date +%s)000, updated_by = '<owner email>' WHERE key = '$1'"
  }
  bunx wrangler d1 execute pilihpendidikan --remote --command "SELECT key, value, updated_at, updated_by FROM feature_flags"
  ```

### J1. Create the resources [owner]

```sh
cd apps/api
bunx wrangler d1 create pilihpendidikan-jobs             # paste the id over REPLACE_WITH_JOBS_DB_ID
bunx wrangler r2 bucket create pilihpendidikan-jobs-files
bunx wrangler r2 bucket create pilihpendidikan-jobs-files-preview
bunx wrangler r2 bucket lifecycle add pilihpendidikan-jobs-files abort-multipart --abort-multipart-days 1
bunx wrangler queues create jobs-ai
bunx wrangler queues create jobs-ai-dlq
bunx wrangler secret put OPENAI_API_KEY                   # a key with a hard monthly cap (D-34, 14 §9.4)
```

If wrangler offers to add a binding to the config, answer no: the bindings are
already in `apps/api/wrangler.jsonc` (`JOBS_DB`, `JOBS_FILES`,
`JOBS_AI_QUEUE` and the two consumers). Paste the D1 id over
`REPLACE_WITH_JOBS_DB_ID`, run `bun run cf-typegen`, and commit the config.
The R2 buckets stay private (no public access, no custom domain): only the
api Worker reads them. Retention is the daily cron's job (14 §5.4); the
lifecycle rule only aborts stale multipart uploads.

The `EMAIL` binding already allows `applications@pilihpendidikan.com`, the
sender of server-sent e-mail applications. It is used only behind
`JOBS_EMAIL_SERVER_SEND_ENABLED` and only if A-03 holds (sending to arbitrary
recipients from the onboarded domain); leave that flag off otherwise.

### J2. Schema [owner]

Take a Time Travel bookmark of `DB` first (`0002` rebuilds `mcp_tokens` with
a `kind` column; existing personal tokens are copied across):

```sh
cd apps/api
bunx wrangler d1 time-travel info pilihpendidikan              # note the bookmark
bunx wrangler d1 migrations apply pilihpendidikan --remote      # 0002_users_devices_oauth.sql, 0003_seed_cli_client.sql
bunx wrangler d1 migrations apply pilihpendidikan-jobs --remote # migrations-jobs/0001_jobs_core.sql
```

`0002` adds users, OAuth grants and refresh tokens, devices, the support
access log and `feature_flags` with every Job Tracker flag off and
`JOBS_LEGACY_BACKEND = "kv"`; `0003` registers the first-party
`pilih-jobs-cli` OAuth client.

### J3. Deploy the api dark [owner]

```sh
bun run build
cd apps/api && bun run deploy
```

This also registers the `jobs-ai` / `jobs-ai-dlq` consumers and the
`*/5 * * * *` cron (no-ops while nothing is queued or leased). **It changes the
legacy jobs API for admins immediately** (see [Release notes](#release-notes)).
Smoke-check:

```sh
curl -s https://api.pilihpendidikan.com/health
curl -s https://api.pilihpendidikan.com/api/v1/meta        # 200, "features": [] while dark
curl -s https://api.pilihpendidikan.com/.well-known/oauth-authorization-server   # revocation_endpoint, CLI scopes
curl -s -H "Authorization: Bearer <a personal token>" \
  -o /dev/null -w '%{http_code}\n' https://api.pilihpendidikan.com/api/v1/board  # 404 while JOBS_V1_ENABLED is off
```

Also check that a personal token minted before the deploy still saves a CV
(the `mcp_tokens` rebuild kept it) and that `/api/jobs` still lists your own
jobs (backend `kv`).

### J4. Legacy jobs: `JOBS_KV` → `JOBS_DB` [owner] (D-04, 06 §12.4–§12.5)

`scripts/migrate-jobs-kv-to-d1.ts` is a dry run unless `--execute`, never
writes or deletes KV, and is idempotent (`INSERT … ON CONFLICT DO NOTHING`,
resumable from its checkpoint). Its remote path (the D1 REST batch and the
Time Travel bookmark call) has only been exercised against fixtures and
in-memory SQLite, so read the dry run's report closely before executing.

```sh
cd apps/api
bun scripts/migrate-jobs-kv-to-d1.ts                       # 1. dry run: counts per class and status,
                                                           #    orphans, conflicts; plan in tmp/jobs-kv-to-d1/
bun scripts/migrate-jobs-kv-to-d1.ts --execute             # 2. write + verify (exit 1 on any mismatch);
                                                           #    prints the Time Travel bookmark taken before
bun scripts/migrate-jobs-kv-to-d1.ts --verify              # 3. verification alone, any time
```

- **Orphans** (a `job:{id}` without an `owner:job:{id}` stamp) are reported and
  not migrated: nobody can reach them any more (D-26). Decide per job with the
  owner of the data; the KV copy stays.
- **P1 shadow (≥ 3 days):** keep `JOBS_LEGACY_BACKEND = "kv"` and re-run
  `--execute --refresh` (picks up new jobs and re-imports KV-edited ones that
  D1 has not changed) then `--verify` daily. The background D1 comparison of
  06 §12.5 P1 is not implemented; the daily `--verify` replaces it.
- **P2 cut-over:** `flag JOBS_LEGACY_BACKEND '"d1"'`, then **right away** run
  `bun scripts/migrate-jobs-kv-to-d1.ts --execute --refresh` and `--verify`
  once more, so nothing written to KV during the last 30 s of the flag cache is
  left behind. `/api/jobs` and the MCP `jobs_*` tools now read and write D1.
- **P3 grace (30 days):** a D1 miss for a legacy id falls back to KV and
  migrates that one job on the fly, logging `{"evt":"legacy_kv_fallback"}`
  (ids only) in the api Worker's logs.
- **P4 retire:** after 30 days with zero `legacy_kv_fallback` lines, export
  `JOBS_KV` to a private archive (owner-held) and remove the `JOBS_KV` binding.
  Deleting the namespace is a separate owner decision.

Rollback: `flag JOBS_LEGACY_BACKEND '"kv"'` (KV was never written), and if
D1 must be rewound,
`bunx wrangler d1 time-travel restore pilihpendidikan-jobs --bookmark=<bookmark printed by --execute>`.

### J5. Turn the Job Tracker on [owner] (13 §9)

| Flag | Turns on | When |
|---|---|---|
| `JOBS_V1_ENABLED` | the whole `/api/v1` (dashboard, discovery, sync) | after J3–J4; no redeploy needed |
| `JOBS_CLI_LOGIN_ENABLED` | OAuth login of `pilih-jobs` and device registration | with the first CLI release (J7) |
| `JOBS_AUTOMATION_ENABLED` | browser agent tasks, assisted and approval modes | M5: after the internal pilot; A-07 review started |
| `JOBS_AUTO_MODE_ENABLED` | unattended `auto` rules | M7: only after the A-07 legal review closes (G7) |
| `JOBS_EMAIL_SERVER_SEND_ENABLED` | e-mail applications sent by the api | only if A-03 holds |
| `AI_DISABLED` | kill switch: scoring falls back to deterministic, tailoring and agent AI calls stop | `true` in an OpenAI incident (22 §10.2) |

```sh
flag JOBS_V1_ENABLED true
curl -s https://api.pilihpendidikan.com/api/v1/meta        # "features": ["jobs_v1", …]
```

Before AI features reach users outside the owner (M4): the privacy notice
covers AI processing and retention, ZDR is requested from OpenAI, and the
A-09 legal review is done (G6); per-user budgets are live (`JOBS_AI_MONTHLY_BUDGET_USD`,
G8). `JOBS_MIN_CLI_VERSION` / `JOBS_RECOMMENDED_CLI_VERSION` are vars in
`apps/api/wrangler.jsonc` and change only with an api deploy.

### J6. Deploy `apps/jobs` [owner]

The dashboard reaches the api through the `API` service binding, so J3 must
be live first. Its one secret encrypts the session cookie:

```sh
bun run build
cd apps/jobs
bunx wrangler deploy --dry-run                                  # config + bundle check, uploads nothing
bun run deploy                                                  # Worker jobs-pilihpendidikan + jobs.pilihpendidikan.com
openssl rand -base64 32 | bunx wrangler secret put BFF_COOKIE_KEY
```

Until the secret is set (seconds) the dashboard cannot sign anyone in;
nothing links to it yet. Never rotate `BFF_COOKIE_KEY` casually: a new key
signs every user out. Smoke-check:

```sh
curl -sI https://jobs.pilihpendidikan.com      # 200; CSP with a nonce, X-Robots-Tag: noindex, Cache-Control: private, no-store
curl -sI https://jobs.pilihpendidikan.com/id   # redirects to / and sets the jobs-lang cookie (D-27)
```

In a browser: request a sign-in link, open it, press Continue and land on the
board (e2e S-01 covers this flow; the api's confirm page must let its form
redirect to the dashboard origin), then check that `document.cookie` shows no
bearer, a card moves, `/cli` lists the install commands, and
`agent-browser errors` is empty.

### J7. Publish the CLI [owner]

[pilih-jobs CLI releases](#pilih-jobs-cli-releases) below, then
`flag JOBS_CLI_LOGIN_ENABLED true` and check `pilih-jobs login` →
`pilih-jobs status` against production from a clean machine.

### J8. Going live on the hub [owner] (12 §15)

[Going live](#going-live-flip-a-service-on-the-hub) for `jobs`: smoke-test
`https://jobs.pilihpendidikan.com` (J6), flip `jobs` to `"live"` in
`apps/home/src/config/services.ts` (its hub shortcut is `J`), `bun run test`
in `apps/home`, redeploy the hub. The same hub deploy publishes
`https://pilihpendidikan.com/install-cli.sh` and `install-cli.ps1`: once the
CLI is on PyPI, set `available: true` on the `install_script` (and, when the
tap exists, `homebrew`) entries of `packages/jobs-contracts/cli-commands.json`
and redeploy `apps/jobs`. Check `curl -sI https://pilihpendidikan.com/install-cli.ps1`
and `irm https://pilihpendidikan.com/install-cli.ps1` on Windows (the script
must come back as text).

### Rollback (Job Tracker)

- Instant, no deploy: `flag JOBS_V1_ENABLED false` (every `/api/v1` route
  except `/meta` answers 404), `flag JOBS_AUTOMATION_ENABLED false`,
  `flag AI_DISABLED true`, `flag JOBS_LEGACY_BACKEND '"kv"'`.
- Workers: `bunx wrangler rollback` in `apps/api` / `apps/jobs`.
- `JOBS_DB`: `bunx wrangler d1 time-travel restore pilihpendidikan-jobs --timestamp=<ISO>`
  (or `--bookmark=`; in place, the undo bookmark is printed).
- A bad CLI release: raise `JOBS_MIN_CLI_VERSION` above it (an owner-approved
  api deploy; old CLIs get `426`), yank it on PyPI, publish the fix (22 §10.4).

---

## pilih-jobs CLI releases

`.github/workflows/release-cli.yml` runs on a tag `cli-vX.Y.Z` (or
`cli-vX.Y.Z-beta.N`) and follows 22 §7: verify (ruff, pyright, pytest) → the
OS / Python matrix (`cli-matrix.yml`) and the e2e suite (`e2e.yml`) →
contracts drift → `uv build`, CycloneDX SBOM from `uv.lock`, regenerated
`THIRD_PARTY_NOTICES`, `SHA256SUMS` (also covering the hub's install scripts),
rendered Homebrew formula and Scoop manifest → TestPyPI → PyPI via Trusted
Publishing with PEP 740 attestations → GitHub release → (stable) packaging bot
PRs → (stable) a PR raising `JOBS_RECOMMENDED_CLI_VERSION`. Nothing has been
published yet.

### One-time setup [owner]

1. Decide A-11 (the MIT licence in `apps/jobs-cli/pyproject.toml`).
2. On pypi.org and test.pypi.org add a **pending trusted publisher** for the
   project `pilih-jobs`: repository `bahrulbangsawan/pilihpendidikan`,
   workflow `release-cli.yml`, environment `pypi` (PyPI) / `testpypi`
   (TestPyPI). No API token is stored anywhere.
3. GitHub → Settings → Environments: `testpypi`, `pypi` and
   `cli-version-bump`, each with the owner as required reviewer (the manual
   gates of steps 6 and 9). Settings → Actions → General: allow GitHub Actions
   to create pull requests (for the version-bump PR).
4. Optional, M7: the tap `pilihpendidikan/homebrew-tap` and the bucket
   `pilihpendidikan/scoop-bucket`, a bot token with contents + pull-request
   write on both as the secret `PACKAGING_BOT_TOKEN`, and the variable
   `PACKAGING_BOT = 1`. Before merging the first formula PR run
   `brew install --build-from-source`, `brew test` and
   `brew audit --strict --online` on macOS arm64 / x64 and Linux (the formula
   is a template: `apps/jobs-cli/packaging/`).
5. Optional nightly live checks (`nightly-live.yml`): the variable
   `PILIH_JOBS_LIVE_CANARY = 1` (live adapter canaries), and `JOBS_AI_LIVE = 1`
   plus the secret `OPENAI_API_KEY` (a separate, low-cap key) for the T7-11
   Decisions contract test (A-01).

### Each release [owner]

1. Set the version in `apps/jobs-cli/src/pilih_jobs/version.py`
   (`__version__ = "0.2.0"` or `"0.2.0-beta.1"`) and `pyproject.toml`
   (`0.2.0` / `0.2.0b1`), `uv lock`, `bun run check` green, merge to `main`.
2. `git tag cli-v0.2.0 && git push origin cli-v0.2.0`.
3. Approve the `testpypi`, then the `pypi` deployment when the checks are
   green; the GitHub release follows. A beta is a GitHub pre-release and
   installs with `uv tool install --prerelease allow pilih-jobs`.
4. Stable only: approve `cli-version-bump`, review and merge its PR, then
   deploy `apps/api` (owner) for the new recommended version to show in
   `/api/v1/meta`. Raise `JOBS_MIN_CLI_VERSION` only with 14 days' notice
   through the recommended version first (13 §9), or as the bad-release kill
   switch (22 §10.4).

The install scripts (`apps/home/public/install-cli.sh`, `install-cli.ps1`)
ship with the hub, not with a CLI release; each release lists their SHA-256
in `SHA256SUMS` so a user can check the copy the hub serves.

---

## Release notes

### Job Tracker api deploy (J3) — BREAKING for admin tooling (D-26)

From the first deploy of the api with the Job Tracker, whatever
`JOBS_LEGACY_BACKEND` says (`kv` or `d1`):

- `/api/jobs`, `/api/jobs/:id` and the MCP `jobs_*` tools **no longer honour
  the admin bypass**. Members of `ADMIN_EMAILS` see and edit only their own
  jobs, and `?mine=0` is ignored.
- A legacy job without an `owner:job:{id}` stamp is reachable by nobody. The
  KV → D1 migration reports such jobs as orphans and does not migrate them.
- Support access to a user's Job Tracker data goes through the break-glass
  script, read-only and logged in `support_access_log` (ticket and reason
  required; dry run unless `--execute`):

  ```sh
  cd apps/api
  bun scripts/support-access.ts --email <user> --ticket <id> --reason "<why>" \
    --operator <owner email> [--scope applications | --scope application:<id>] [--execute]
  ```

- CV, invoice and portfolio documents keep the admin bypass (`?mine=0`).

Tell the people who use `jobs_*` or `/api/jobs` with an admin token before J3.

