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
`portfolio` and `api`, in that service's own order above:

1. **Deploy the subdomain** (step 4 for `api`, step 6 for the apps).
2. **Smoke-test it on its real URL:**
   - `cv` / `invoice` / `portfolio`: `curl -sI https://<app>.pilihpendidikan.com`
     and `.../id` return 200; open it in a browser, fill a field, download a
     PDF.
   - `api`: the step 4 checks (`/health`, `/api/whoami`, a `/connect`
     sign-in that delivers its email). Flipping `api` publishes the MCP
     endpoint and the `/connect` link on the hub.
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
