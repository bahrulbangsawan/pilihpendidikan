# Deploying pilihpendidikan

The first production deploy moves the CV, invoice, portfolio and jobs backend
off the old `bahrul` Worker onto `apps/api` at `api.pilihpendidikan.com`. The
steps below run in order. Every step that creates a resource, writes data or
deploys needs the owner's go-ahead; nothing here has been run yet.

Order in one line: **resources → ids into config → D1 schema → deploy api →
copy data (dry run, then execute) → deploy the three apps → retire the old
backend.**

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
bunx wrangler kv namespace create AUTH_KV
bunx wrangler kv namespace create CV_KV
bunx wrangler kv namespace create RATE_LIMIT_KV
```

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

## 7. Retire the old backend (bahrul repo)

Done from the `bahrul` repo, after steps 1–6:

1. Final CV re-sync (step 5 with `--overwrite`).
2. Apply bahrul D1 migrations `0028`–`0032` remotely.
3. Deploy `bahrul-mcp` (drops the cv / invoice / portfolio / jobs routes and
   bindings; renames `CV_KV` → `AUTH_KV` on the same namespace).
4. Optionally, once verified, delete the copied `cv:*` / `owner:cv:*` keys
   from the old auth namespace (manual; no script here deletes data) and
   retire the old `cv-bahrul`, `invoice-bahrul` and `portfolio-bahrul` Workers.

## Rollback

- `apps/api` and the apps: `bunx wrangler rollback` in the app directory, or
  redeploy the previous commit. No data is lost: invoice, portfolio and jobs
  namespaces are shared, and the CV / token copies left their sources intact.
- Before step 7 the old backend is untouched and keeps serving.
