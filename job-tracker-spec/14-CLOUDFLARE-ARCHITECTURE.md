# 14 — Cloudflare Architecture

This document evaluates every Cloudflare product named in the brief and adopts
only what consistency, transactions, execution or price require. It also
specifies:
- the exact configuration changes;
- the R2 and Queue contracts;
- the cron jobs;
- provisioning steps;
- the cost model at three scales.

Legend: see `00-README.md` §2. Prices and limits were verified on 2026-10-11 at
the URLs cited, unless marked otherwise.

---

## 1. Principles

1. **Extend, don't duplicate (D-01).** One backend Worker (`api-pilihpendidikan`)
   already owns authentication, CORS, rate limiting, MCP and the jobs data
   [VERIFIED `apps/api/wrangler.jsonc`]. The Job Tracker adds routes and
   bindings to it.
2. **D1 is the system of record (D-02, D-04).** Anything a user would be upset
   to lose lives in D1, or in R2 with a D1 row pointing at it. KV keeps only
   what it holds today: sessions, magic links, rate counters and CV documents.
3. **Adopt a service only for a property D1 + Workers cannot give.** For
   example, durable asynchronous retry (Queues), or cheap blob storage with
   zero egress (R2).

---

## 2. Service-by-service evaluation

| Service | Adopted (v1)? | Reasoning: consistency, transactions, execution, price | Trigger to adopt / revisit |
|---|---|---|---|
| **Workers** | **Yes**: extend `api-pilihpendidikan`; new `jobs-pilihpendidikan` for the dashboard | API logic is request/response and short. Paid plan: 30 s CPU per request by default (up to 5 min), 10,000 subrequests, 128 MB memory [VERIFIED https://developers.cloudflare.com/workers/platform/limits/]. OpenAI calls are wall-time, not CPU | — |
| **D1** | **Yes**: existing `pilihpendidikan` (`DB`) + new `pilihpendidikan-jobs` (`JOBS_DB`) | Relational queries (board, inbox, analytics), uniqueness (fingerprints, live-task index), `batch()` transactions [VERIFIED https://developers.cloudflare.com/d1/worker-api/d1-database/]. Single-writer serialization makes the conditional `UPDATE … RETURNING` claim atomic (04 §3). 10 GB per DB on Paid, Time Travel 30 d [VERIFIED https://developers.cloudflare.com/d1/platform/limits/]. **No interactive transactions** [VERIFIED https://blog.cloudflare.com/whats-new-with-d1/], so every multi-row change is a single `batch()` | Read replication (`withSession`) when board p95 > 400 ms across regions. Shard postings or move descriptions to R2 at 6 GB (04 §4) |
| **R2** | **Yes**: bucket `pilihpendidikan-jobs-files` (`JOBS_FILES`) | CV PDFs, cover letters, attachments, evidence screenshots, run logs. $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, **zero egress**; free 10 GB, 1 M A and 10 M B per month [VERIFIED https://developers.cloudflare.com/r2/pricing/]. D1 rows are capped at 2 MB, and KV is not a document store for user files | — |
| **Queues** | **Yes**: `jobs-ai` + DLQ `jobs-ai-dlq` | Bulk scoring after a sync batch and CV tailoring are slow (OpenAI latency) and must survive Worker restarts. `waitUntil` is not durable. At-least-once delivery [VERIFIED https://developers.cloudflare.com/queues/reference/delivery-guarantees/] is fine because consumers are idempotent (§6). $0.40/M ops after 1 M included, about 3 ops per message [VERIFIED https://developers.cloudflare.com/queues/platform/pricing/] | — |
| **Workflows** | **No** (C-09) | GA [VERIFIED https://developers.cloudflare.com/changelog/2025-04-07-workflows-ga]. Its strengths are durable multi-step state, `step.sleep` and `waitForEvent`. Our multi-step processes (tailor → render → approve; task → lease → approval → result) **already store their state in D1 rows**, which the dashboard must query anyway. Workflows would add a second state store to keep consistent, plus step billing (from 2026-08-10) [VERIFIED https://developers.cloudflare.com/workflows/reference/pricing/]. `waitForEvent` throws when the instance is not running, and approvals can wait up to 7 days | A cloud-only pipeline with more than 3 external steps that has no user-visible state of its own (e.g. a server-side ATS API submission integration) |
| **Durable Objects** | **No new class** (the existing `PilihMcpServer` stays) [VERIFIED] | Coordination needs (claims, approvals: first decision wins) are met by D1 conditional updates. A per-user DO "doorbell" with WebSocket Hibernation (no duration billed while hibernating [VERIFIED https://developers.cloudflare.com/durable-objects/best-practices/websockets/]) would cut poll latency, but D1 would remain authoritative (D-11) | Poll cost (§9) exceeds about $100/month, **or** users need sub-second dashboard progress → M8 `UserEventsHub` DO broadcasting `change_log.seq` nudges |
| **KV** | **Existing only**; `JOBS_KV` goes read-only and is then retired (D-04) | Eventually consistent and not transactional: it cannot hold revisions or leases. It stays for `AUTH_KV`, `CV_KV`, `RATE_LIMIT_KV`, `INVOICE_KV` and `PORTFOLIO_KV` [VERIFIED] | — |
| **Cron Triggers** | **Yes**: add `*/5 * * * *` to the existing `0 3 * * *` [VERIFIED `wrangler.jsonc:104-106`] | Lease reaping, approval expiry, retention (§7). 15 min wall time per cron [VERIFIED https://developers.cloudflare.com/workers/platform/limits/] | — |
| **Browser Rendering** | **No** | The brief requires browser automation to run locally. A cloud browser would hold ATS sessions server-side (C-10). For CV PDFs it would render the HTML print view, which is not the `@react-pdf` output (D-14) | Never for applications. Revisit for CV PDFs only if browser-runtime rendering proves unreliable (A-02) |
| **Workers AI** | **No** | The brief mandates the OpenAI Decisions API (D-12). A second provider doubles the evaluation work | Embeddings for semantic dedupe or search (M8+) |
| **AI Gateway** | **No (v1)** | Caching and analytics are attractive, but prompts contain applicant PII. Gateway logging would have to be disabled per request, and the `apps/api` budget counters already give per-user accounting | When we add a second provider or need provider fallback routing |
| **Analytics Engine** | **No** | User-facing analytics must be exact and per user; they come from `application_events` + `analytics_daily` in D1 (10) | Operator-level product telemetry at scale |
| **Email Sending** (`send_email` binding) | **Existing binding reused** [VERIFIED `wrangler.jsonc:40-45`] for the optional `server_send` email applications | Sending to arbitrary recipients from our domain with `Reply-To` = user is **[ASSUMPTION A-03]** | Enabled by `JOBS_EMAIL_SERVER_SEND_ENABLED` after A-03 is verified |
| **Service bindings** | **Yes**: `apps/jobs` → `api-pilihpendidikan` | BFF calls without public-internet hops or CORS. The bearer stays server-side (D-15) | — |

---

## 3. `apps/api/wrangler.jsonc` additions

Existing keys are unchanged. Only new or changed entries are shown.

```jsonc
{
  // existing: name, main, compatibility_date "2026-03-24", nodejs_compat, routes, observability, dev, send_email, kv_namespaces, durable_objects
  "vars": {
    "ADMIN_EMAILS": "",                       // existing
    "EMAIL_FROM": "noreply@pilihpendidikan.com", // existing
    // send_email.allowed_sender_addresses gains "applications@pilihpendidikan.com" (09 §6.2); server_send stays behind JOBS_EMAIL_SERVER_SEND_ENABLED
    "LOG_RETENTION_DAYS": "90",               // existing
    // Kill switches / rollout flags are NOT vars: they live in DB.feature_flags (D-33),
    // seeded by migration 0002 with JOBS_V1_ENABLED=false (dark launch, 02 §7),
    // JOBS_AUTO_MODE_ENABLED=false, JOBS_EMAIL_SERVER_SEND_ENABLED=false, AI_DISABLED=false.
    "JOBS_MIN_CLI_VERSION": "0.1.0",
    "JOBS_RECOMMENDED_CLI_VERSION": "0.1.0",
    "JOBS_AI_MODE": "live",                   // "fake" in .dev.vars
    "JOBS_AI_MONTHLY_BUDGET_USD": "3.00",     // per user default (§9.4, D-34); daily sub-cap 0.50
    "JOBS_APP_ORIGIN": "https://jobs.pilihpendidikan.com"
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "pilihpendidikan", "database_id": "d71a1734-01e5-435d-8c73-1b6b58a20b70", "migrations_dir": "migrations" },   // existing
    { "binding": "JOBS_DB", "database_name": "pilihpendidikan-jobs", "database_id": "REPLACE_WITH_JOBS_DB_ID", "migrations_dir": "migrations-jobs" }
  ],
  "r2_buckets": [
    { "binding": "JOBS_FILES", "bucket_name": "pilihpendidikan-jobs-files", "preview_bucket_name": "pilihpendidikan-jobs-files-preview" }
  ],
  "queues": {
    "producers": [
      { "binding": "JOBS_AI_QUEUE", "queue": "jobs-ai" }
    ],
    "consumers": [
      { "queue": "jobs-ai", "max_batch_size": 10, "max_batch_timeout": 5, "max_retries": 5, "dead_letter_queue": "jobs-ai-dlq", "max_concurrency": 10 },
      { "queue": "jobs-ai-dlq", "max_batch_size": 10, "max_batch_timeout": 30, "max_retries": 1 }
    ]
  },
  "triggers": {
    "crons": ["0 3 * * *", "*/5 * * * *"]     // existing daily + new 5-minute
  }
  // secret (not in file): OPENAI_API_KEY  → bunx wrangler secret put OPENAI_API_KEY
}
```

Notes:
- `Env` is hand-declared in `apps/api/src/env.ts` [VERIFIED `src/env.ts:5-28`] and
  gains `JOBS_DB: D1Database`, `JOBS_FILES: R2Bucket`, `JOBS_AI_QUEUE: Queue<JobsAiMessage>`,
  `OPENAI_API_KEY: string` and the vars above.
- The single Worker serves `fetch`, `scheduled` and `queue`. The `scheduled`
  handler switches on `controller.cron` (`"0 3 * * *"` keeps today's
  `request_log` purge [VERIFIED `app.ts:113-125`]).
- `max_concurrency: 10` caps simultaneous consumer invocations, which caps
  concurrent OpenAI calls (protects org rate limits; see 9.4).

### 3.1 `apps/jobs/wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "jobs-pilihpendidikan",
  "main": "src/server.ts",                       // wraps TanStack Start server entry like apps/home/src/server.ts [VERIFIED pattern]
  "compatibility_date": "2026-03-24",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [{ "pattern": "jobs.pilihpendidikan.com", "custom_domain": true }],
  "observability": { "enabled": true },
  "services": [{ "binding": "API", "service": "api-pilihpendidikan" }],
  "vars": { "API_PUBLIC_ORIGIN": "https://api.pilihpendidikan.com" }
  // secret: BFF_COOKIE_KEY (32 bytes, AES-GCM for the __Host-jobs-session cookie, 12 §1)
}
```

In dev, `wrangler dev` resolves the service binding to the locally running
`api-pilihpendidikan` on 8788. When the API is not running, the BFF falls
back to `fetch(API_PUBLIC_ORIGIN)` controlled by `JOBS_API_FALLBACK_URL`
(dev only).

---

## 4. D1 usage patterns

| Pattern | Implementation |
|---|---|
| Multi-row change | One `env.JOBS_DB.batch([...])` per request: mutation + `change_log` + `idempotency_keys` (03 §10, 05 §1.4) |
| Optimistic concurrency | `UPDATE … WHERE id=? AND user_id=? AND revision=? RETURNING revision` (04 §3) |
| Claims and first-decision-wins | Conditional `UPDATE … WHERE state='queued'` / `WHERE state='pending'` |
| Pagination | Keyset on `(sort_key, id)`; never `OFFSET` beyond 1,000 |
| Queries per invocation | ≤ 1,000 on Paid [VERIFIED]; sync batch of 100 postings ≈ 100 × 4 statements + 3 = 403 statements in one batch |
| Statement size | ≤ 100 KB [VERIFIED]; description text bound as a parameter, ≤ 64 KB |
| Cross-DB | `DB` (identity) and `JOBS_DB` are never joined; `user_id` comes from the resolved caller |

---

## 5. R2 layout and access patterns

### 5.1 Key layout

`u/{user_id}/{kind}/{fil_id}{ext}` (04 §2.5), e.g.
`u/usr_01J…/cv_pdf/fil_01J….pdf`. Prefixing by user makes account deletion a
single prefix sweep (`list({prefix:"u/usr_…/"})` + `delete` in batches of 1,000).

Custom metadata: `{user_id, file_id, sha256, kind}`. HTTP metadata:
`contentType`, `contentDisposition: attachment`.

### 5.2 Upload (CLI or web → API → R2)

```text
POST /api/v1/files  (multipart: meta JSON + file ≤ 25 MB)
 1. auth + scope files:write + rate limit (05 §1.9)
 2. validate meta (kind, declared sha256, size, content_type allowlist per kind)
 3. INSERT files (status 'pending')                      ── D1
 4. stream body → TransformStream that (a) computes SHA-256 incrementally
    (crypto.DigestStream), (b) counts bytes, (c) sniffs the first 8 bytes (magic)
 5. env.JOBS_FILES.put(key, stream, {sha256: declared, httpMetadata, customMetadata})
    — R2 rejects the put if the declared sha256 mismatches
 6. compare computed digest + size + magic with declared → mismatch: delete object, 422
 7. UPDATE files SET status='ready' + link (cv_variant.file_id) + change_log   ── D1 batch
```

Presigned URLs are **not** used: they do not work on custom domains and need
S3 credentials [VERIFIED https://developers.cloudflare.com/r2/api/s3/presigned-urls/],
and Worker-mediated access keeps authorization in one place. Files are
≤ 25 MB, which is well under the Worker request-body limits.

### 5.3 Download

`GET /api/v1/files/{id}/content`: repository ownership check → `env.JOBS_FILES.get(key)`
→ stream `object.body`, `ETag: "<sha256>"`, `Cache-Control: private, no-store`,
`Content-Disposition: attachment; filename="<safe name>"`. The CLI verifies the
SHA-256 against `files.sha256` before staging (18 §8). Range requests are
supported for screenshots only.

### 5.4 Lifecycle

R2 lifecycle rules are prefix-based, and our prefix is per user. Retention is
therefore enforced by the `0 3 * * *` cron from `files.retention_until`:

| `kind` | Default retention |
|---|---|
| `cv_pdf`, `cover_letter`, `attachment` | While referenced by a non-deleted variant, application or email; unreferenced → 30 d |
| `evidence_screenshot` | 180 d (user-configurable 30–730 d) |
| `run_log` | 30 d |
| any `status='pending'` older than 24 h | deleted (abandoned uploads) |

A bucket-wide lifecycle rule also aborts incomplete multipart uploads after
1 day (defensive; we do not use multipart).

---

## 6. Queue contract (`jobs-ai`)

Message envelope (Zod in `packages/jobs-contracts/src/queue.ts`):

```ts
type JobsAiMessage =
  | { v: 1; type: "score_postings"; message_id: string; user_id: string; posting_ids: string[] /* ≤ 50 */; profile_version: number; rubric_version: string }
  | { v: 1; type: "tailor_cv";      message_id: string; user_id: string; cv_variant_id: string }
  | { v: 1; type: "evaluate_rules"; message_id: string; user_id: string; posting_ids: string[] /* after scoring */ }
  | { v: 1; type: "purge_user";     message_id: string; user_id: string; phase: "jobs_db" | "r2" | "cv_kv" }
  | { v: 1; type: "rollup_user";    message_id: string; user_id: string; days: string[] /* YYYY-MM-DD in the user's tz (10 §4) */ }
  | { v: 1; type: "rebuild_analytics"; message_id: string; user_id: string; reason: "timezone_change" }
  | { v: 1; type: "export_user";    message_id: string; user_id: string; export_id: string /* 11 §10 */ };
```

All messages are ≤ 8 KB, far below the 128 KB limit [VERIFIED https://developers.cloudflare.com/queues/platform/limits/].
`sendBatch` is used for up to 100 messages.

**Idempotency (at-least-once delivery):**

| Type | Idempotency mechanism |
|---|---|
| `score_postings` | `INSERT … ON CONFLICT(user_id, posting_id, profile_version, rubric_version) DO NOTHING`; postings already `ready` are skipped before calling OpenAI |
| `tailor_cv` | Precondition `cv_variants.status = 'generating'`. The tailored CV slug is derived deterministically from `cv_variant_id` (HMAC) so a retry overwrites the same doc; the final `UPDATE … WHERE status='generating'` makes completion one-shot |
| `evaluate_rules` | Task creation uses `idempotency_key = "rule:" + rule_id + ":" + posting_id` (`UNIQUE(user_id, idempotency_key)`) plus `ux_tasks_live_apply` |
| `purge_user` | Each phase is restartable (delete-where-exists) |
| `rollup_user` | Each day is recomputed from `application_events` and written with `INSERT … ON CONFLICT(user_id, day) DO UPDATE` (pure function of the events, so replays are harmless) |
| `rebuild_analytics` | Deletes and recomputes the user's `analytics_daily` rows in one pass; a replay recomputes the same values |
| `export_user` | Keyed by `export_id`: the ZIP is written to `u/{user_id}/export/{export_id}.zip`, so a replay overwrites the same object; the email link is sent only when the export row is still `pending` (conditional `UPDATE`) |

**Retry policy:** OpenAI 429 or 5xx → `message.retry({delaySeconds: min(300, 2^attempt × 10 + jitter)})`.
Validation failure (model output rejected) → no retry, mark the record failed.
`max_retries: 5`, then the DLQ.

**DLQ handling:** the `jobs-ai-dlq` consumer never leaves a record stuck:
for `score_postings` it writes a **deterministic-only** score
(`match_scores.status = 'ready'`, `components.ai.status = "dlq"`, 07 §7.2);
for `tailor_cv` it sets `cv_variants.status = 'failed'`; for the other types it
marks the job failed in its own record. It writes an `application_events` row
when the message is tied to an application, and emits a structured log
`{"evt":"dlq","type":…,"user_id_hash":…}` for alerting (22 §7). Messages are
never replayed automatically; the user can retry from the UI.

**Budget gate (D-34):** before calling OpenAI, the consumer reads the user's
month-to-date and today's AI spend from the `ai_usage` table (04 §2.7). Over
budget: `score_postings` writes a deterministic-only score
(`components.ai.status = "budget"`, `status = 'ready'`) and acks;
`tailor_cv` sets `cv_variants.status = 'failed'` and acks. Synchronous AI
routes answer `429 ai_budget_exhausted` (05 §1.3).

---

## 7. Cron jobs

| Schedule | Job | Action |
|---|---|---|
| `*/5 * * * *` | **Lease reaper** | `automation_tasks` in `claimed`/`running` with `lease_expires_at < now`: with `submit_intent_at` set → `outcome_unknown` + application `submission_status='outcome_unknown'` (D-19); otherwise → `queued` if `attempt_count < max_attempts`, else `failed(lease_expired)`. Close the attempt (`lease_expired`). (The claim path also reaps lazily.) |
| `*/5 * * * *` | **Approval expiry** | `approvals` pending with `expires_at < now` → `expired`; linked task `awaiting_approval` → `cancelled` |
| `*/5 * * * *` | **Task expiry** | `queued` with `expires_at < now` → `expired` |
| `*/5 * * * *` | **Device presence** | No writes; `online` (≤ 6 min) and `active` (lease heartbeat ≤ 90 s) are computed at read time (04 §1) |
| `0 3 * * *` | Existing `request_log` purge | unchanged [VERIFIED] |
| `0 3 * * *` | **Idempotency purge** | `DELETE FROM idempotency_keys WHERE expires_at < now` (batched 5,000) |
| `0 3 * * *` | **Change-log trim** | `change_log` older than 30 d |
| `0 3 * * *` | **Posting expiry and retention** | Closed postings > 180 d with no `user_jobs`; untracked `user_jobs` unseen 90 d; `discovery_run_items` > 90 d (04 §4) |
| `0 3 * * *` | **File retention** | §5.4 |
| `0 3 * * *` | **Analytics rollup** | Enqueue one `rollup_user` message (§6) per user with events in the last 48 h, covering yesterday and today's partial day in that user's timezone (10 §4) |
| `0 3 * * *` | **Capacity check** | `PRAGMA page_count × page_size` on `JOBS_DB` → log warning at 6 GB, error at 8 GB (04 §4) |

All cron work is chunked (≤ 5,000 rows per statement batch) and resumable,
and it stays within 15 min of wall time.

---

## 8. Provisioning (owner go-ahead required)

Following the `DEPLOY.md` convention [VERIFIED]: every step that creates a
resource, writes data or deploys needs the owner's go-ahead.

```sh
# 1. Resources
cd apps/api
bunx wrangler d1 create pilihpendidikan-jobs            # → put database_id into wrangler.jsonc (REPLACE_WITH_JOBS_DB_ID)
bunx wrangler r2 bucket create pilihpendidikan-jobs-files
bunx wrangler r2 bucket create pilihpendidikan-jobs-files-preview
bunx wrangler queues create jobs-ai
bunx wrangler queues create jobs-ai-dlq
bunx wrangler secret put OPENAI_API_KEY

# 2. Schema
bunx wrangler d1 migrations apply pilihpendidikan --remote        # 0002_users_devices_oauth.sql
bunx wrangler d1 migrations apply pilihpendidikan-jobs --remote   # migrations-jobs/0001_jobs_core.sql

# 3. Deploy api dark (feature flag JOBS_V1_ENABLED=false in DB.feature_flags), smoke-test /api/v1/meta
bun run build && bun run deploy

# 4. Legacy migration (D-04): dry run, review, then execute
bun run scripts/migrate-jobs-kv-to-d1.ts            # prints counts, owner-stamp gaps, conflicts
bun run scripts/migrate-jobs-kv-to-d1.ts --execute

# 5. Enable v1 (set feature flag JOBS_V1_ENABLED=true; no redeploy needed); deploy apps/jobs; add jobs.pilihpendidikan.com
cd ../jobs && bun run build && bunx wrangler deploy --dry-run && bun run deploy

# 6. Going live on the hub (DEPLOY.md "Going live"): flip `jobs` in apps/home/src/config/services.ts, redeploy hub
```

Rollback: `bunx wrangler rollback` per Worker. `JOBS_DB` restore:
`bunx wrangler d1 time-travel restore pilihpendidikan-jobs --timestamp=<ISO>`
(in-place; the undo bookmark is printed) [VERIFIED https://developers.cloudflare.com/d1/reference/time-travel/].
`JOBS_KV` stays intact and read-only for 30 days after the migration (D-04).

---

## 9. Cost model

### 9.1 Usage assumptions per *active* user per month

| Driver | Assumption |
|---|---|
| Discovery | 1 run/day, 300 postings seen/run, 40 new/day → **1,200 new postings/month**; 3 sync batches/day |
| CLI online | 8 h/day with an idle poll every 30 s → **28,800 claim polls/month**; `last_seen_at` write ≤ 1 per 5 min (04 §1) → **2,880 device writes/month** |
| Dashboard | 1 h/day open, board poll every 15 s → **7,200 requests/month**, ~500 rows read each |
| Automated applications | **30/month**, each about 15 min of heartbeats (30), 15 AI proxy calls, 3 file ops |
| Tailored CVs | 30/month (one per application) |
| Other API calls | ~3,000/month (inbox, detail views, sync, change feed) |

Derived per user/month: **≈ 40,000 Worker requests**, **≈ 48,000 D1 rows
written** (postings + indexes ≈ 35 k, device writes 2.9 k, scores 3.6 k,
tasks/events ≈ 7 k), **≈ 4.5 M D1 rows read**, **≈ 18 MB new R2 data**
(CV PDFs 3 MB, screenshots 9 MB, run logs 6 MB; about 50 MB steady state after
retention), **≈ 400 queue ops**.

### 9.2 OpenAI per active user per month (dominant cost)

Prices [VERIFIED https://developers.openai.com/api/docs/pricing]: `gpt-6-luna`
on Decisions $0.10/M input, no output charge; `gpt-6.1-sol` $2/M in, $10/M out.

| Use | Calculation | $/user/month |
|---|---|---|
| Scoring | 1,200 × 2,000 tokens × $0.10/M | **$0.24** |
| CV tailoring | 30 × (8,000 × $2/M + 2,000 × $10/M) = 30 × $0.036 | **$1.08** |
| Agent: classify + next-action | 30 × 15 calls × 3,000 tokens × $0.10/M | **$0.14** |
| Agent: field plans | 30 × 2 pages × (6,000 × $2/M + 1,000 × $10/M) = 60 × $0.022 | **$1.32** |
| Agent: verify | 30 × 3,000 × $0.10/M | $0.01 |
| **Total** | | **≈ $2.79** |

### 9.3 Platform cost at scale

Workers Paid base fee and request/CPU pricing ($5/month including 10 M requests,
then $0.30/M; 30 M CPU-ms included, then $0.02/M CPU-ms) are **[ASSUMPTION A-10]**:
they were not re-verified in this pass. CPU is assumed to average 5 ms per
request. D1, R2 and Queue prices are [VERIFIED] (B1–B3 research, links in §2).

| Item | 100 users | 1,000 users | 10,000 users |
|---|---|---|---|
| Worker requests | 4 M → included | 40 M → (40−10) × $0.30 = **$9** | 400 M → 390 × $0.30 = **$117** |
| Worker CPU (5 ms avg) | 20 M ms → included | 200 M ms → 170 × $0.02 = **$3.40** | 2,000 M ms → 1,970 × $0.02 = **$39** |
| D1 rows written | 4.8 M → included (50 M) | 48 M → included | 480 M → 430 × $1 = **$430** |
| D1 rows read | 450 M → included (25 B) | 4.5 B → included | 45 B → 20,000 M × $0.001/M = **$20** |
| D1 storage (JOBS_DB, shared postings) | ~1 GB → included | ~6 GB → (6−5) × $0.75 = **$0.75** | needs 04 §4 mitigation (descriptions → R2); ~9 GB D1 → **$3** |
| R2 storage (steady) | 5 GB → free tier | 50 GB → 40 × $0.015 = **$0.60** | 500 GB (+ descriptions ~30 GB) → **$7.80** |
| R2 ops | ~10 k A / 30 k B → free | ~100 k A / 300 k B → free | ~1 M A / 3 M B → ≈ **$0.00** (A at the free cap) |
| Queues | 40 k ops → included | 400 k → included | 4 M → 3 × $0.40 = **$1.20** |
| Workers base | $5 | $5 | $5 |
| **Cloudflare subtotal** | **≈ $5** | **≈ $19** | **≈ $623** |
| **OpenAI** (§9.2) | **≈ $279** | **≈ $2,790** | **≈ $27,900** |

Observations:
- **OpenAI is about 90–97 % of cost** at every scale. Tailoring and field plans
  (Responses API) dominate, while Decisions calls are cheap.
- At 10 k users the largest Cloudflare line is **D1 writes, mostly posting
  upserts and their indexes** (postings are shared, so 35 k/user is an upper
  bound). Mitigations, in order:
  1. Done in the baseline above: `devices.last_seen_at` is written at most once
     per 5 min (04 §1), about 80 % fewer device writes than a per-minute write.
  2. Index fewer posting columns.
  3. M8 DO doorbell, which replaces idle polls by hibernated WebSockets (removes
     about 70 % of requests).

### 9.4 Per-user AI budget proposal

**[DECISION]** (supports A-05)
- Default hard cap **$3.00/user/month** (`JOBS_AI_MONTHLY_BUDGET_USD`) and soft
  warning at 80 % in the dashboard and CLI. Daily sub-cap is $0.50 so one
  runaway day cannot exhaust the month.
- Cost is computed per call from the provider's reported `usage` (Responses).
  For Decisions it comes from input tokens, estimated from the request size
  when `usage` is absent (A-01).
- When exhausted, scoring degrades to deterministic-only, tailoring and agent
  calls are refused (`429 ai_budget_exhausted`, 05 §1.3), and
  manual tracking keeps working.
- No admin exemption (D-34). A paid tier or BYOK (M8) is the long-term answer
  for users who need more.
- Org-level protection: consumer `max_concurrency: 10` and a global token
  bucket in the AI client (≤ 80 % of the org's RPM tier).

---

## 10. Limits and headroom

| Limit | Value [VERIFIED source] | Our peak | Headroom |
|---|---|---|---|
| D1 DB size (Paid) | 10 GB [d1/platform/limits] | 6 GB alarm at ~1 k–3 k users | Mitigation 04 §4 |
| D1 queries per invocation | 1,000 | ~403 per sync batch | 2.4× |
| D1 statement size | 100 KB | ≤ 66 KB (64 KB description + fields) | OK |
| D1 row size | 2 MB | ≤ 70 KB | OK |
| D1 bound params | 100 | ≤ 40 per insert | OK |
| Worker CPU per request | 30 s default | Sync batch about 300 ms CPU | ample |
| Worker subrequests | 10,000 | AI proxy 1–2; batch 1 queue send | ample |
| Worker memory | 128 MB | File upload streamed (no buffering) | OK |
| Queue message size | 128 KB | ≤ 8 KB | 16× |
| Queue consumer CPU | 30 s (up to 5 min) | Tailor ≈ 200 ms CPU, 20–60 s wall (OpenAI) | OK (wall time limit 15 min) |
| R2 single PUT | 5 GiB | 25 MB | OK |
| Cron wall time | 15 min | chunked jobs < 2 min | OK |
| `send_email` | account-specific | ≤ 10/day/user (09) | A-03 |
