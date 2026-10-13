## 1. Contracts

- [x] 1.1 `ScoringProfile`, `ScoreComponents`, `R1_WEIGHTS`, gates and `combineScore` in `packages/jobs-contracts/src/scoring.ts`; `JobsAiMessage` (`score_postings`, `tailor_cv`, …) in `src/queue.ts`; `SCORES_REQUEST_MAX = 500` in `src/api/scoring.ts`; `skills-dictionary.json`, `title-families.json` — TC-QUEUE (leaf-1.1 G1 verified)

## 2. AI layer (`apps/api/src/jobs/ai`)

- [x] 2.1 `AiProvider` interface and `getAiProvider(env)` (`JOBS_AI_MODE=fake|live`): `ai/provider.ts`, request builders in `ai/compose.ts`, primitives / prices / errors / Decisions limits in `ai/primitives.ts` — TAI-PROVIDER
- [x] 2.2 OpenAI provider (Decisions `gpt-6-luna`, Responses strict schema `store: false` `tools: []`, `OPENAI_BASE_URL`, timeouts, retryable classes, refusals, usage → cost): `ai/openai.ts` — TAI-STORE-FALSE
- [x] 2.3 Deterministic fake provider: `ai/fake.ts`, `ai/fake-answers.ts`, `ai/lexicon.ts` — `ai/fake.test.ts`
- [x] 2.4 Budget (D-34) and usage accounting: `repo/core/ai-usage.ts` — TCORE-BUDGET, TAI-BUDGET
- [x] 2.5 `AI_DISABLED` flag (D-33), AI consent and `ai_scoring_sensitive` settings: `core/flags.ts`, `repo/core/settings.ts`, `PATCH /api/v1/settings` (`packages/jobs-contracts/src/api/settings.ts`), settings page in `apps/jobs/src/components/settings/settings-page.tsx` — TAI-DISABLED

## 3. Queue

- [x] 3.1 `jobs-ai` consumer with type dispatch and retry backoff, DLQ handler: `apps/api/src/jobs/queue/consumer.ts`, `queue/handlers/dlq.ts` — `consumer.test.ts`, `dlq.test.ts`
- [x] 3.2 Queue producer / consumers / DLQ in `apps/api/wrangler.jsonc` (batch 10, timeout 5 s, 5 retries, concurrency 10) and the capturing queue fake in `apps/api/test/fakes.ts`

## 4. Scoring

- [x] 4.1 PII-free profile and `profile_version`: `services/scoring/profile.ts`, `repo/core/profile-version.ts` — T7-04, TAI-PII
- [x] 4.2 Features F1–F7: `services/scoring/{features,text}.ts` — T7-01
- [x] 4.3 Combination, bounded AI weight, gates, components: `services/scoring/{combine,engine}.ts` — T7-02, T7-03, T7-05
- [x] 4.4 Bilingual deterministic explanations: `services/scoring/explain.ts` (mirrored by `apps/jobs/src/lib/score-explain.ts`) — T7-12
- [x] 4.5 Producer (placeholders, messages only for inserted rows, profile re-score ≤ 500): `repo/core/score-queue.ts` — TCORE-SCOREQ; T7-06 in the discovery suite
- [x] 4.6 `score_postings` consumer (idempotency, stale version, budget / disabled / skipped / error fallbacks, retry, DLQ `dlq` scores, hand-off to rule evaluation): `services/scoring/{consumer,context}.ts`, `queue/handlers/score-postings.ts`, `repo/scoring/index.ts` — T7-07, T7-08, T7-09
- [x] 4.7 `POST /api/v1/scores:request` and `GET /api/v1/scores/{posting_id}`: `routes/scoring/index.ts`, `services/scoring/requests.ts` — S-11 (component test in `routes/scoring/scoring.test.ts`)
- [x] 4.8 Golden set and evaluation script: `apps/api/test/fixtures/scoring-golden.jsonl` (200 synthetic pairs), `apps/api/scripts/scoring-eval.ts` (`bun run scoring:eval`, `--fake`) — `services/scoring/golden.test.ts`
- [x] 4.9 Sections 2–4 verified by the leaf-2.5 gate (`api-ai` suite incl. T7-01…T7-05, T7-07…T7-09, T7-12, S-11, TAI-*; status.log "leaf-2.5 VERIFIED")

## 5. Surfaces

- [x] 5.1 Inbox score bars, component tooltip and explanation: `apps/jobs/src/lib/{inbox-score,score-explain}.ts`, inbox components — TW-INBOX (leaf-3.2 G1 verified)
- [x] 5.2 CLI `pilih-jobs score`: `apps/jobs-cli/src/pilih_jobs/cli/board.py` (`score_cmd`) — TCMD-BOARD (leaf-4.4 G1 verified)

## 6. Owner handoffs

- [x] 6.1 Handoff recorded (NOT executed — owner action): create the queues `jobs-ai` and `jobs-ai-dlq` (14 §8); nothing was created
- [x] 6.2 Handoff recorded (NOT executed — owner action): `bunx wrangler secret put OPENAI_API_KEY` for `apps/api`; no secret was set and no deploy happened
- [x] 6.3 Handoff recorded (NOT executed — owner action): run the live Decisions contract test T7-11 (`ai/openai.live.test.ts`, skipped unless enabled) to close A-01; it has not been run
- [x] 6.4 Handoff recorded (NOT executed — owner action): request OpenAI Zero Data Retention for the project and update the privacy notice (11 §11, release gate G6); neither was done
- [x] 6.5 Handoff recorded (NOT executed — owner action): measure cost per scored posting (target ≤ $0.001) and run `bun run scoring:eval` live, committing `docs/scoring-eval/<date>.md`; no live run was made
- [x] 6.6 Handoff recorded (NOT executed — owner decision): confirm the operator-paid budget level (A-05) and the legal review of AI processing (A-09)
