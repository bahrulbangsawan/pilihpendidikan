# Change: Add job matching scores and the server-side AI layer

## Why

Discovery can deliver hundreds of postings per run. Users need them ranked by
fit with a reason they can read, automation rules need a trustworthy score to
gate on, and every AI feature (scoring, CV tailoring, the browser agent, email
drafts) needs one controlled path to OpenAI: server-side keys, data
minimization, consent, a per-user budget and a kill switch
(`job-tracker-spec/07`, `11` §11, `14` §6, §9.4, `19` §12).

## What Changes

- **AI provider layer** (`apps/api/src/jobs/ai/`): the `AiProvider` interface
  of 19 §12 with an OpenAI implementation (Decisions API `POST /v1/decisions`
  on `gpt-6-luna`; Responses API Structured Outputs with `store: false`,
  `tools: []` and a strict JSON schema; `OPENAI_BASE_URL`; 10 s / 60 s
  timeouts; 429 / 5xx / timeouts retryable) and a deterministic fake
  (`JOBS_AI_MODE=fake`) used in development and tests. The key
  `OPENAI_API_KEY` is read only there (D-12).
- **Controls**: the D-34 budget ($3.00/user/month by default, $0.50/day
  sub-cap, warning at 80 %, `429 ai_budget_exhausted`), usage accounting in
  `ai_usage` written in the same batch as each AI result, the `AI_DISABLED`
  kill switch (D-33), the per-user AI consent setting and the
  `ai_scoring_sensitive` opt-out (11 §11, 07 §8).
- **Queue** `jobs-ai` with DLQ `jobs-ai-dlq` (D-06): consumer dispatch by
  message type, retry backoff `min(300, 2^attempt × 10 + jitter)` s, 5
  retries, then the DLQ handler that never leaves a record stuck.
- **Scoring rubric r1** (07 §3–§5): the PII-free `ScoringProfile`, features
  F1–F7 (skills dictionary and title families from the contracts), the
  Decisions rubric (one `score` + three gate predicates) weighted at most
  0.20, multiplicative gates, the stored `components` JSON and bilingual
  deterministic explanations.
- **Scoring pipeline** (07 §6–§7): placeholders inserted with `ON CONFLICT DO
  NOTHING` and messages sent only for inserted rows; the `score_postings`
  consumer with idempotency, budget gate and deterministic fallbacks;
  `profile_version` invalidation with lazy re-scoring (≤ 500);
  `POST /api/v1/scores:request` (≤ 500 ids) and
  `GET /api/v1/scores/{posting_id}`.
- **Surfaces**: inbox score bars with component explanations in `apps/jobs`,
  the CLI `pilih-jobs score` command, and the manual `bun run scoring:eval`
  script over a 200-pair synthetic golden set.

The rule matcher that consumes scores (`evaluate_rules`, 07 §10) and the AI
proxy routes of the browser agent are specified in `jobs-add-browser-agent`.

The work is implemented in the working tree of this repository. It is not
committed, not deployed, no queue has been created and no live OpenAI call has
been made.

## Impact

- Affected specs: `jobs-matching` (new), `jobs-ai` (new).
- Affected code:
  - `apps/api/src/jobs/ai/**` (provider, primitives, compose, fake, openai)
  - `apps/api/src/jobs/{routes,services,repo}/scoring/**`,
    `apps/api/src/jobs/queue/{consumer.ts,handlers/score-postings.ts,handlers/dlq.ts}`
  - `apps/api/src/jobs/repo/core/{ai-usage,score-queue,profile-version,settings}.ts`
  - `packages/jobs-contracts/src/{scoring.ts,queue.ts,api/scoring.ts}`,
    `packages/jobs-contracts/{skills-dictionary.json,title-families.json}`
  - `apps/api/wrangler.jsonc` (queue producer / consumers),
    `apps/api/scripts/scoring-eval.ts`, `apps/api/test/fixtures/scoring-golden.jsonl`
  - `apps/jobs/src/lib/{score-explain,inbox-score}.ts`, settings page (AI consent)
  - `apps/jobs-cli/src/pilih_jobs/cli/board.py` (`score`)
- Sources: `job-tracker-spec/07` (all), `11` §4.4–§4.5, §11, `14` §3, §6, §9.4,
  `19` §1, §12, `05` §1.3, §6, §10a; decisions D-06, D-12, D-33, D-34;
  assumptions A-01, A-05, A-09.
- Owner actions not taken: creating the `jobs-ai` / `jobs-ai-dlq` queues,
  setting the `OPENAI_API_KEY` secret, the live Decisions contract test
  (A-01), the ZDR request, cost measurement, the budget decision (A-05) and
  the privacy-notice / legal review (A-09).
