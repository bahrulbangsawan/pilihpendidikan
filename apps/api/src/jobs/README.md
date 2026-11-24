# src/jobs — the Job Tracker kernel (`/api/v1`)

The Job Tracker API lives inside the `api-pilihpendidikan` Worker (D-01). This
folder is the kernel every feature area builds on (PLAN C4) plus the feature
areas themselves (PLAN C5). Specs: `job-tracker-spec/` 02–05, 14, 20, 21.

```
core/        router.ts      defineRoute, fromContract, dispatchV1, matchRoute
             context.ts     RouteContext (c.*), c.commit (batch + idempotency)
             http.ts        ApiError + helpers (notFound, revisionConflict, …)
             scopes.ts      credential → scope map (05 §1.2)
             scope.ts       UserScope brand: scopeFromCaller, trustedScope
             validate.ts    1 MB JSON bodies, Zod → 400 invalid_request
             pagination.ts  parsePage, pageOf, keysetAfter, cursors
             revision.ts    baseRevision (body / If-Match), assertRevision
             etag.ts        etagOf, ifNoneMatches, notModified
             flags.ts       DB.feature_flags with a 30 s cache (D-33)
             version.ts     X-Pilih-Client, semver, the 426 gate
             device.ts      calling device + throttled presence (04 §1)
             rank.ts        rankBetween / placeInColumn / rebalance (06 §1.2)
             clock.ts deps.ts
repo/core/   db.ts          JobsDb handle, stmt/query helpers, runBatch,
                            guards, JSON/boolean codecs (repo-only)
             change-log.ts  appendChange, appendChangeFromRow, latestChangeSeq
             events.ts      appendEvent (application_events + change_log)
             idempotency.ts idempotency_keys storage (05 §1.4)
             users.ts       lazy users row (DB, 03 §2)
             settings.ts    lazy user_settings (04 §2.7)
             application-state.ts  stage + submission transitions (03 §5,
                            20 §6.2 precedence, forward-only, 06 §2.3)
             leases.ts      lease expiry / revocation effects (21 §7, §10)
             ai-usage.ts    D-34 budget check + usage statements
             score-queue.ts 07 §7.1 producer (+ profile rescore)
             profile-version.ts  07 §2.1 profile_version
ai/          provider.ts    AiProvider (19 §12) + getAiProvider(env)
             primitives.ts  decide / structured shapes, prices, errors
             compose.ts     the six domain methods over the primitives
             fake.ts        deterministic provider (JOBS_AI_MODE=fake)
             openai.ts      live Decisions + Responses (store: false)
             openrouter.ts  live alternative: Chat Completions, Decisions
                            emulated, ZDR routing (JOBS_AI_PROVIDER)
queue/       consumer.ts    jobs-ai consumer, QUEUE_HANDLERS registry
             handlers/<type>.ts   one per JobsAiMessage type + dlq.ts
cron/        index.ts       CRON_JOBS registry, runScheduled
             handlers/<name>.ts
routes/      index.ts       allRoutes (one spread per area)
             table.ts       listRouteTable() (gates, sweeps, S-32)
             <area>/index.ts      `export const routes: RouteDef[]`
services/<area>/  repo/<area>/   per feature leaf
```

## Hard rules

1. **Only `repo/**` touches `JOBS_DB`** (04 §5). Everything else holds the
   opaque `JobsDb` (`c.db`, `qc.db`, `cc.db`) and passes it to repo
   functions; the type has no `prepare`. `T11-JOBSDB`
   (`src/jobs/isolation.test.ts`) fails on any `JOBS_DB` reference outside
   `repo/**` / `env.ts`, and on importing the SQL helpers of
   `repo/core/db.ts` outside `repo/**`.
2. **Every repo function takes a `UserScope` and every SQL statement on a
   user-scoped table has a `user_id` predicate** (an INSERT names `user_id`).
   `T11-SQL` parses every string in `repo/**`. Interpolate values, never the
   `user_id` predicate itself (the lint must see it). The rare exception
   carries a marker on the statement:
   `// sql-allow: system — <why>` (cron scans), `// sql-allow: public-posting
   — <why>` (shared posting rows), `// sql-allow: anonymous — <why>`.
3. **Not owned = not found.** Look rows up with `WHERE id = ? AND user_id = ?`
   and `throw notFound()` on a miss — never 403 (11 §6.1). Admins get no
   bypass on JOBS_DB (D-26).
4. **One write batch per request**: mutation + `change_log` + the idempotency
   row, through `c.commit(...)` (it refuses a second call). D1 batches are
   transactions; there are no interactive transactions.
5. **Optimistic concurrency** (D-21): mutable rows carry `revision`; writes
   take `base_revision` (body or `If-Match`); stale → `409
   revision_conflict` with `details.current` (the full API record).
6. Timestamps are epoch ms from `c.now` / `qc.now` / `cc.now` (one clock read
   per request; tests use the fake clock). JSON keys are the 04 column names;
   JSON columns are parsed and 0/1 flags are booleans (`decodeRow`).
7. Never log request bodies, tokens, emails or fact values (11 §8): log ids
   and counts. No `console.log` of payloads.

## Adding a route

```ts
// src/jobs/routes/applications/index.ts (leaf-2.3)
import { defineRoute, fromContract } from "../../core/router";
import { revisionConflict } from "../../core/http";
import { changeStage } from "../../services/applications";

export const routes = [
  defineRoute({
    ...fromContract("PATCH /api/v1/applications/{app_id}"), // method, pattern,
    // scope, altScope, alsoRequires, device, idempotency, body, query
    async handler(c) {
      // c.params.app_id: string; c.body: PatchApplicationRequest (validated)
      const base = c.baseRevision(c.body.base_revision);       // 400 when absent
      const { statements, application } = await changeStage(c.db, c.scope, {
        applicationId: c.params.app_id, baseRevision: base, now: c.now,
        actor: c.actorKind, source: c.changeSource, stage: c.body.stage,
      });
      return await c.commit(statements, { body: { application } });
    },
  }),
];
```

- Prefer `fromContract("<METHOD> <exact 05 path>")`: it copies the contract of
  `packages/jobs-contracts` (`API_ROUTE_SCHEMAS`), so scope, idempotency,
  device and schemas cannot drift. Override fields after the spread
  (`rateLimit`, `maxBodyBytes`, …). `defineRoute({...})` by hand works too.
- A new area: create `routes/<area>/index.ts` exporting `routes`, then add one
  import + spread in `routes/index.ts`. The spec-coverage gate reads
  `listRouteTable()`.
- Every route needs a case in `src/jobs/isolation-sweep.test.ts` (S-31:
  user B with user A's ids → 404 or nothing of A; the same as an admin;
  the owner's control call is not 404). The sweep is generated from
  `listRouteTable()` and fails on a route without a case. A route with
  `scope: "none" | "any"` must also be added to its `UNSCOPED_ROUTES`
  allow-list (T11-SCOPES).
- Options: `scope` (`"<oauth scope>" | "any" | "none"`), `altScope` (05
  "or": the router accepts it and sets `c.grantedVia = "alt_scope"` — **the
  handler must enforce the condition**, e.g. "own device only"),
  `alsoRequires` (05 "+"), `device: true` (403 `device_required` without a
  device-bound token), `idempotency: "required" | "optional" | "none"`,
  `rateLimit: "sync-batch" | "task-poll" | "ai-invoke" | "file-upload" |
  "task-create"` (05 §1.9; or a custom `{rule, subject: "user"|"device"|"ip"}`
  list, e.g. per-IP telemetry), `body: schema | "raw"` (raw = the router does
  not read the body: multipart / streaming uploads; read `c.request`
  yourself), `query: schema`, `maxBodyBytes` (default 1 MB), `altAuth`
  (non-bearer credential, see below).
- `flagExempt` / `versionExempt` exist only for `GET /api/v1/meta`.

### What the router does before your handler

auth (Bearer header only — `/api/v1` ignores cookies; 401 `invalid_token` +
`reason` + `WWW-Authenticate`; tombstoned users and revoked devices → 401
`revoked_token`) → `JOBS_V1_ENABLED` (404 when dark, except `/meta`) → CLI
version gate (`X-Pilih-Client: cli/<semver>` below `JOBS_MIN_CLI_VERSION` →
426, except `/meta`) → scope (403 `insufficient_scope` + `scope`) → device
(403 `device_required`) → presence write (≤ 1 per 5 min) → rate limit (429 +
`Retry-After`) → JSON body ≤ 1 MB (413; must be `application/json`) →
`Idempotency-Key` (400 when required and missing; replay with
`Idempotent-Replayed: true`; 409 `idempotency_mismatch`) → `query` / `body`
validation (400 `invalid_request`, `details.issues`).

Errors: throw `ApiError` (`notFound()`, `invalidRequest()`,
`revisionConflict(current)`, `invalidTransition(msg, details)`,
`apiError(code, msg, {details})`). Uncaught `GuardFailedError` → 409
`revision_conflict`; uncaught `UniqueViolationError` → 409 `duplicate`;
`AiProviderError` and anything else → 503 `upstream_unavailable` (logged with
the request id). Every response carries `X-Request-Id`; success responses
`Cache-Control: private, no-store`.

### The route context

`c.request c.env c.ctx c.url c.params c.body c.query (URLSearchParams)
c.queryData c.caller c.scope c.callerOrNull c.device c.db c.now c.requestId
c.client c.clientVersion c.idempotency c.idempotencyKey c.flags c.grantedVia
c.changeSource ("web" | "cli" | "mcp") c.actorKind ("user") c.ai()`

Responses: `c.respond(body, status?, headers?)`, `await
c.respondWithEtag(body)` (200 + `ETag` or 304), `await c.commit(statements,
{status?, body?, headers?})`, `await c.json(schema)` (validate the raw body
against another schema), `c.baseRevision(bodyValue)`.

`ResolvedCaller` (src/auth.ts): `{email, isAdmin, scope, userId, scopes,
deviceId, grantId, credentialKind, tokenId, userDeletedAt}`;
`credentialKind ∈ browser_session | personal_write | personal_read |
oauth_mcp | oauth_cli`.

### Writes, idempotency and revisions

```ts
// in repo/<area>: build statements, never run them for the router
export async function planRename(db: JobsDb, scope: UserScope, id: string, name: string, base: number, now: number) {
  const row = await queryFirst<RuleRow>(db, "SELECT * FROM automation_rules WHERE id = ? AND user_id = ?", id, scope.userId);
  if (!row) throw notFound();
  assertRevision(row, base, toApiRule);                                  // fast 409
  return [
    guardRevision(db, scope, "automation_rules", id, base),              // race-safe 409
    stmt(db, "UPDATE automation_rules SET name = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?", name, now, id, scope.userId, base),
    appendChange(db, scope, { entity: "rule", entityId: id, revision: base + 1, now }),
  ];
}
// in the route
return await c.commit(await planRename(c.db, c.scope, …), { body: { rule } });
```

- `c.commit` appends the idempotency row (when the request has a key) to the
  same batch and runs it. A concurrent duplicate with the same key is rolled
  back by the `idempotency_keys` primary key and answered with the winner's
  stored response. Response bodies > 64 KB are stored as `{"$omitted": true}`.
- A response that depends on what the batch wrote (the task a claim picked):
  build `idempotencyStatementsFromSelect(db, scope, {key, requestHash, now},
  "SELECT 200 AS status_code, json_object(…) AS response_body FROM … WHERE
  user_id = ? …")` in your repo, run your own batch via a repo function, then
  `c.markIdempotencyRecorded()`. `c.idempotency` gives `{key, requestHash}`.
- Handlers that write nothing to JOBS_DB (R2 / KV / queue only) may just
  return a response: a keyed 2xx JSON response is stored afterwards.
- Guards: `guard(db, label, "SELECT 1 FROM … WHERE … AND user_id = ?", …)`
  aborts the whole batch when false (`GuardFailedError`); put guards first.
  `guardRevision(db, scope, table, id, revision)` is the D-21 case.
  `retryOnGuardFailure(() => planAndCommit())` re-plans on a race.
- `appendChangeFromRow` logs the row's revision as stored after an `UPDATE …
  revision = revision + 1` in the same batch.
- `appendEvent(db, scope, {applicationId, type, actorKind, payload, …}, now)`
  returns `{id, statements}`: the event + its change_log row. Duplicate
  `idempotencyKey`s are ignored (default) or abort (`onDuplicate: "abort"`).
- Pagination: `parsePage(c.query)` → `{limit, cursor}`;
  `keysetAfter(["created_at", "id"], cursor, "desc")` → SQL fragment +
  binds; fetch `limit + 1` rows; `pageOf(rows, limit, (r) => [r.created_at,
  r.id])` → `{items, next_cursor}`.
- The board cursor is `latestChangeSeq(db, scope)`.

## Domain kernel

### Application stage / submission (`repo/core/application-state.ts`)

`planApplicationTransition(db, scope, {applicationId, actor, source, now,
baseRevision?, stage?: {to, reason?}, submission?: {to, evidenceId?, via?,
submittedAt?, method?}, automation?: {taskId, taskCreatedAt, attemptId?,
expectedFrom?}, actorDeviceId?, eventKeyPrefix?, allowDuringSubmission?})` →
`{before, after, changed, stage, submission, statements}`.

- user / MCP: 03 §5.1 graph → 422 `invalid_transition`; stale
  `baseRevision` → 409 `revision_conflict`; a live task past `submit_intent`
  → 422 with `details.reason = "submission_in_flight"` (06 §2.3).
- automation: applied only when legal from the CURRENT stage, the current
  stage is in `expectedFrom` (default saved/preparing/ready) and no user/MCP
  stage change happened after `taskCreatedAt`; otherwise `stage.result =
  "conflict"`: the stage stays, `stage_changed` is stored with
  `applied_to_state = 0` plus a `conflict_recorded` event (20 §6.2, 6.3 A).
- system: a move that does not apply is `"skipped"` (no event).
- submission: automation/system move forward only (`ignored` otherwise, event
  stored with `applied_to_state = 0`); user/MCP decisions may set any value.
  `submitted_at` is set on `submitted_*`, cleared on not_started / in_progress
  / failed.
- Use `actor: "user"` (or `"mcp"`) for the legacy facade's user edits.
- The statements start with a revision guard; combine them with your own
  (evidence row, task update) in ONE batch.

### Leases (`repo/core/leases.ts`)

`listExpiredLeases(db, {now, limit, scope?})` (scope = lazy per-user reaping
before a claim; no scope = the cron's system scan), `listDeviceLeases(db,
scope, deviceId)` (device revocation), `loadLeaseTask`, `decideLeaseEffect`,
`planLeaseLoss(db, scope, {task, cause: "expired" | "device_revoked", now})`
→ `{effect, statements}`: after `submit_intent` → `outcome_unknown` (never
re-queued, D-19; app submission → outcome_unknown); `awaiting_approval` →
stays, lease cleared; attempts left → `queued` with `not_before = now +
2^attempts min` (revoked: pinned `target_device_id` cleared); else `failed`
(`lease_expired`). The attempt is closed; events + change_log included;
everything is fenced on the old `lease_id` (a `GuardFailedError` means the
lease moved on: skip). Constants: `LEASE_DURATION_MS` 120 s,
`HEARTBEAT_INTERVAL_MS` 30 s, `TASK_QUEUE_TTL_MS` 72 h, `retryBackoffMs`.

### AI budget (`repo/core/ai-usage.ts`)

`getAiBudgetStatus(db, scope, {env, now, timezone, estimateMicroUsd?})` →
month / day spend, per-purpose counters, `warning` (≥ 80 %), `exhausted`
(`"monthly" | "daily" | null`). `assertAiBudget(status)` → 429
`ai_budget_exhausted`. `recordAiUsageStatements(db, scope, {purpose,
inputTokens, outputTokens, costMicroUsd, now, timezone})` → put them in the
SAME batch as the AI result (a retried message must not count twice). The
daily spend lives in `analytics_daily.metrics.ai_cost_micro_usd` — **the
rollup (leaf-2.9) must carry that key over**. Costs: `usage.cost_micro_usd`
from the provider (`costMicroUsd(model, in, out)`).

### Scoring producer (`repo/core/score-queue.ts`)

`enqueueScoring(env, db, scope, {postingIds, profileVersion, now,
rubricVersion?, retryFailed?})` → `{queued, pending, cached, failed,
untracked, messages}`. Inserts `match_scores` placeholders (`status
'queued'`, model `"queued"`, score 0) only for postings the user tracks,
sends `score_postings` messages (≤ 50 ids each, `sendBatch` ≤ 100) only for
inserted rows, rolls back on a send failure. `enqueueProfileRescore(env, db,
scope, {profileVersion, now})` re-queues inbox new/seen + active
applications (≤ 500) after a profile change. `getProfileVersion(env, db,
scope, c)` (memoized per request) / `computeProfileVersion`.

### Settings, users

`getUserSettings(db, scope, now)` (lazily created with the 04 §2.7
defaults: `automation_paused`, `ai_consent_at`, `timezone`, `locale`, …);
`ensureUserSettingsStatements` to prepend to a settings write.
`ensureUser(env.DB, email, now)` / `findUserById` (identity DB).

### Ranks (`core/rank.ts`)

`placeInColumn(columnWithoutCard, cardId, {beforeId, afterId})` →
`{rank, rebalance: null}` or `{rank, rebalance: [{id, rank}, …]}` (write
every rank with `revision + 1` and a change_log row in one batch).
`before_id` = the card that ends up above. `rankBetween`, `rankAfter`.

## AI (`ai/`, leaf-2.5 owns it)

`c.ai()` / `qc.ai()` → `AiProvider`: `decide(request)` (Decisions),
`structured({name, schema, validator, instructions, input, model?, fake?})`
(Responses, `store: false`), and the domain methods `classifyPage`,
`chooseAction`, `matchQuestions`, `planFields` (takes `{attempt,
observation, context: FieldPlanContext}`; the server builds the trusted
block), `verifySubmission`, `scorePosting`. Every result has `usage`;
domain results also carry `calls` (provider requests).
`structured(...)` is unchanged (leaf-2.6).

- The fake provider (`JOBS_AI_MODE=fake`, dev and tests) is
  input-dependent and deterministic: page kinds from page markers
  (challenge, confirmation, login / sign-up controls, mailto, review +
  submit, fields, apply-entry), an injection predicate from "ignore
  previous instructions"-style text, next actions from candidate role
  hints, answer-bank matches from word overlap, verification from
  confirmation / error markers, fit scores from skill and title overlap
  with degree / on-site / sponsorship gates, and field plans that cite only
  the facts and answers the server supplied. Precedence:
  `FakeAiOptions.answer` / `.structured[name]` (value or function) → the
  request's own `fake` hook (`DecisionRequest.fake`,
  `StructuredRequest.fake`) → conservative default. `onDecide` /
  `onStructured` capture requests. Script it with `getAiProvider(env,
  {fake: {...}})` or inject `createV1Client(t, {ai: () => provider})`.
- Live provider: `JOBS_AI_PROVIDER` = `openai` (default; `OPENAI_API_KEY`)
  or `openrouter` (`openrouter.ts`, `OPENROUTER_API_KEY`, optional
  `OPENROUTER_BASE_URL`); `JOBS_AI_MODE=fake` still wins. OpenRouter goes
  through `POST /v1/chat/completions` with `HTTP-Referer` / `X-Title` and
  sends `provider: {data_collection: "deny", zdr: true,
  require_parameters: true}` on every call (never `store`). `structured()`
  is a strict `json_schema` `response_format` (`message.refusal` → refusal,
  `finish_reason: "length"` → `invalid_output`); `decide()` emulates
  Decisions with one strict schema holding a property per question
  (predicate `{probability}`, choice `{choice: enum}`, score `{score:
  level index}`), a fixed system prompt that treats the input as untrusted,
  images as `image_url` parts, 10 s timeout, mapped onto a Decisions
  envelope so `answersFor()` (and its refusals) is shared. Models:
  `OPENROUTER_MODEL_DECISIONS` / `_STRUCTURED` / `_ESCALATION` (default
  `openai/gpt-6-luna`, `openai/gpt-6.1-sol`, `openai/gpt-6-astra`); a
  request naming an `AI_MODELS` id is mapped, so escalation escalates.
  Cost is `usage.cost` (USD credits → micro-USD) when reported, else the
  token estimate. Status mapping as openai.ts, plus 402 (no credits) →
  `unavailable`.
- All providers enforce the self-imposed Decisions limits (≤ 6 questions,
  ≤ 40 choices, ≤ 1 inline base64 image) with a non-retryable
  `bad_request`.
- Cost estimates for budget pre-checks: `estimateDecisionCost(request)`,
  `estimateStructuredCost(request)` in `ai/primitives.ts`; request builders
  `classifyRequest`, `chooseRequest`, `matchRequests`, `fieldPlanRequest`,
  `verifyRequest`, `scoreRequest` in `ai/compose.ts`.
- `POST /api/v1/ai/next-action` quotes control text from, in order: the
  candidate's own `click_ref.text` (untrusted: newlines flattened, `<<…>>`
  markers removed, ≤ 60 characters), the observation remembered from
  page-classify / field-plan of the same lease (isolate memory, 15 min),
  then a role-only template.
- Retryable `AiProviderError`s (429/5xx/timeouts) → 503 on routes, retry
  in the queue. The router does not check `AI_DISABLED`, consent or the
  budget: AI routes do (`services/ai-proxy/call.ts`). AI consent is part of
  `profile_version`, so granting it re-scores with AI.

## Queue and cron

- Implement `queue/handlers/<type>.ts` (`QueueHandler<"type">`): it gets
  `qc = {message, scope (trusted from message.user_id), db, env, ctx, now,
  attempts, deadLetter, ai(), memo(key, fn), log(evt, fields)}` and returns
  `{action: "ack"}` or `{action: "retry", delaySeconds?}`. A thrown error
  retries with `min(300, 2^attempt × 10 + jitter)` s; after 5 retries the
  message goes to `jobs-ai-dlq` → `handlers/dlq.ts`. Load the referenced
  record WITH `qc.scope` (11 §6.1); a miss → ack. Idempotency per 14 §6.
- Implement `cron/handlers/<name>.ts` (`CronHandler`, `cc = {env, ctx, db,
  cron, now, log}`); chunk work (≤ 5,000 rows), stay resumable. The 5-minute
  schedule runs `leases`; the daily one `request-log`, `retention`,
  `file-retention`, `analytics`. A failing job is logged; the others still
  run.

## Tests (`bun test`; run as `env -u CLAUDECODE bun test <paths>`)

```ts
import { createFakeClock, createTestEnv, createV1Client } from "../../../../test/fakes";
import { seedApplication } from "../../../../test/seed-jobs";

const t = createTestEnv();                     // DB + JOBS_DB (real SQLite), R2, Queue, KV; v1 on
const clock = createFakeClock();               // 2026-10-12T00:00Z
const client = createV1Client(t, { clock });
const web = await client.browserSession("alice@example.com");
const cli = await client.cliSession("alice@example.com");          // device-bound, cli/0.1.0
const reader = await client.personalToken("bob@example.com", "read");
const res = await web.patch(`/api/v1/applications/${id}`, { base_revision: 1, stage: "ready" },
  { idempotencyKey: "k1" });                   // res.status, res.body, res.headers
seedApplication(t.jobsSqlite, web.userId!, { stage: "ready" });     // direct seeding
await t.queue.drain(t.env);                    // runs the real consumer (retries, DLQ)
await t.setFlag("JOBS_AUTOMATION_ENABLED", true);
t.r2.objects; t.queue.sent; t.jobsSqlite.query(…)                   // inspection
```

- `createTestEnv(overrides, {flags})` — `JOBS_V1_ENABLED` is on, every other
  D-33 flag dark unless set. `JOBS_AI_MODE=fake`, CLI min version 0.1.0.
- `cliSession(email, {scopes?, device?: false | {name, platform,
  capabilities, acceptsTasks}, cliVersion?: string | null})`;
  `mcpOAuthToken(email)`; `anonymous()`. `session.scope` is a UserScope for
  calling repo functions directly.
- D1 fakes are transactional (`batch()` rolls back on the first error) and
  return RETURNING rows; R2 verifies a declared `sha256`; the queue rejects
  > 100 messages per `sendBatch` and > 128 KB messages.
- Name spec-numbered tests with their id (`it("T6-03 …")`).
