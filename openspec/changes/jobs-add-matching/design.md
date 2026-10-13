## Context

There was no LLM integration in the repository (00 §3). Scoring has to rank
every discovered posting cheaply (target ≤ $0.001 per posting, 07 §1), stay
explainable, and degrade to deterministic-only whenever AI is unavailable,
unaffordable or not consented to. The same provider layer serves CV tailoring
(`jobs-add-cv-variants`), the agent proxy (`jobs-add-browser-agent`) and email
drafts (`jobs-add-email-applications`).

## Goals / Non-Goals

- Goals: a single server-side AI boundary with minimization, `store: false`,
  consent, budget and kill switch; reproducible, explainable scores;
  at-least-once-safe queue processing that never double-charges or leaves a
  posting `queued` forever.
- Non-Goals: predicting hiring outcomes; generated explanations; BYOK; an
  Anthropic provider in v1 (19 §12 keeps it behind a later flag; 13 M4 lists
  a stub, which was not built); pooling feedback across users.

## Decisions

- **D-12 server-only AI.** Only `apps/api/src/jobs/ai/**` reads
  `OPENAI_API_KEY`. Decisions (`gpt-6-luna`) for score / choice / predicate
  questions; Responses Structured Outputs (default `gpt-6.1-sol`,
  `TAILOR_MODEL` override) with `store: false`, `tools: []`, strict schema
  for anything generated. Both enforce self-imposed Decisions limits (≤ 6
  questions, ≤ 40 choices, ≤ 1 inline image) as non-retryable `bad_request`.
- **Fake provider.** `JOBS_AI_MODE=fake` selects a deterministic,
  input-dependent provider so dev and every test run never touch the network.
- **D-06 one queue.** `jobs-ai` (batch 10, timeout 5 s, 5 retries,
  concurrency 10) and `jobs-ai-dlq`; no Workflows, no new Durable Object.
- **D-34 budget.** Month cap from `JOBS_AI_MONTHLY_BUDGET_USD` (default $3),
  daily sub-cap $0.50, warning at 80 %; spend read from `ai_usage` and the
  daily `analytics_daily.metrics.ai_cost_micro_usd`; usage statements go into
  the same batch as the result (idempotent under redelivery). No admin
  exemption.
- **Bounded AI weight.** The code caps the AI component at
  `min(0.20, 0.25 · Σ known feature weights)`: exactly 0.20 when every
  feature is known, and it shrinks with missing features instead of growing
  through renormalization. This is stricter than the plain renormalization
  formula of 07 §3 and implements its stated intent ("it does not dominate",
  T7-05).
- **Deterministic explanations (07 §5)** from `components` with en/id
  templates; `apps/jobs` mirrors the templates and a parity test keeps them
  equal.
- **Stale profile at consumption.** A message whose `profile_version` is no
  longer current drops its queued placeholders and acks; the new version is
  scored instead.

### Divergences from the spec text (code is authoritative)

- AI weight cap as above.
- Without AI consent scoring runs deterministic-only with
  `components.ai.status = "disabled"` (same as `AI_DISABLED`); a too-thin
  profile gives `skipped`.
- No Anthropic stub exists (13 §2 M4 deliverable); 19 §12 marks it "not in
  v1".
- `docs/scoring-eval/<date>.md` has not been produced: it needs a live run.

## Risks / Trade-offs

- Decisions API is a public beta (A-01) → everything behind `AiProvider`, the
  `AI_DISABLED` flag falls back to deterministic-only, live contract test
  `ai/openai.live.test.ts` (T7-11) runs only when enabled.
- Gates are multipliers, not zeros, so a misread "nice to have" only ranks a
  job lower; automation treats `blocking` gates as hard exclusions.
- Work authorization and salary are sensitive → opt-out
  `ai_scoring_sensitive` removes them from AI requests and drops the
  work-authorization predicate; F5 still runs locally.

## Migration Plan

New tables (`match_scores`, `ai_usage`) ship with `migrations-jobs/0001`.
Owner steps (not executed): create `jobs-ai` and `jobs-ai-dlq` (14 §8), `bunx
wrangler secret put OPENAI_API_KEY`, request ZDR, publish the privacy notice,
deploy. Rollback: set `AI_DISABLED` (scores become deterministic-only).

## Open Questions

- A-01: Decisions response shape and `usage` envelope at GA.
- A-05: operator-paid budget level; BYOK later (M8).
- A-09: legal review of AI processing; data-residency endpoint choice.
