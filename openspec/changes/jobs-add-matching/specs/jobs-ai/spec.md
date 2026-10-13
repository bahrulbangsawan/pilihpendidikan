## ADDED Requirements

### Requirement: Server-only AI provider
All AI calls SHALL go through the `AiProvider` interface in `apps/api/src/jobs/ai/` (domain methods `classifyPage`, `chooseAction`, `matchQuestions`, `planFields`, `verifySubmission`, `scorePosting`, plus the `decide` and `structured` primitives), and the OpenAI key (`OPENAI_API_KEY`) MUST be readable only by that module, never by the browser, the BFF or the CLI. (Source: 19 §12; D-12; TAI-PROVIDER)

#### Scenario: CLI needs AI
- **WHEN** the CLI agent needs a model decision
- **THEN** it calls an `apps/api` route and never holds an OpenAI credential

### Requirement: OpenAI implementation
The OpenAI provider SHALL call the Decisions API (`POST {base}/v1/decisions`, model `gpt-6-luna`, 10 s timeout) for score, choice and predicate questions and the Responses API with Structured Outputs (strict JSON schema, `store: false`, `tools: []`, 60 s timeout) for generated structured content, use `OPENAI_BASE_URL` when set (default `https://api.openai.com`), treat 429, 5xx, network errors and timeouts as retryable and other 4xx as non-retryable, handle refusals, and report usage and cost per call. (Source: 07 §4; 19 §1, §12; 11 §11; D-12; TAI-STORE-FALSE)

#### Scenario: Structured request
- **WHEN** the provider sends any Responses API request
- **THEN** the body carries `store: false`, `tools: []` and a strict `json_schema` format

#### Scenario: Rate limited
- **WHEN** OpenAI answers 429
- **THEN** the provider raises a retryable error (routes answer `503 upstream_unavailable`, the queue retries)

### Requirement: Deterministic fake provider
With `JOBS_AI_MODE=fake` the API SHALL use a deterministic, input-dependent fake provider that never calls the network, so local development and every automated test run without OpenAI. (Source: 13 §4; TAI-PROVIDER)

#### Scenario: Test suite
- **WHEN** the api test suite runs
- **THEN** no request reaches OpenAI and AI results are reproducible

### Requirement: Request limits
Both providers MUST refuse, as non-retryable bad requests, a Decisions request with more than 6 questions, more than 40 choices or more than one inline image. (Source: 19 §1.1)

#### Scenario: Too many choices
- **WHEN** a caller builds a choice question with 41 options
- **THEN** the provider rejects it without sending it

### Requirement: Per-user AI budget
The API SHALL enforce one per-user AI budget shared by every purpose (`score`, `tailor_cv`, `agent`, `email_draft`): a monthly cap from `JOBS_AI_MONTHLY_BUDGET_USD` (default $3.00), a $0.50 daily sub-cap and a warning at 80 %, read from D1 usage records, with no admin exemption; an AI call that would cross the cap SHALL be refused with `429 ai_budget_exhausted` on synchronous routes and degrade to deterministic-only in scoring, and usage SHALL be recorded in the same batch as the AI result so a retried message never counts twice. (Source: 07 §9; 14 §9.4; D-34; TCORE-BUDGET, TAI-BUDGET, T7-09)

#### Scenario: Daily cap reached
- **WHEN** a user has spent $0.50 of AI today
- **THEN** further synchronous AI calls answer `429 ai_budget_exhausted` until the next local day

### Requirement: AI kill switch and consent
The `AI_DISABLED` feature flag in `DB.feature_flags` SHALL stop every AI call (scoring falls back to deterministic-only, tailoring and agent calls are refused), and AI processing of a user's data SHALL require that user's consent, set and cleared through `PATCH /api/v1/settings` (`ai_consent`) and off until granted; the `ai_scoring_sensitive` setting SHALL remove work authorization and salary from AI scoring requests. (Source: 11 §11; 07 §8, §11; D-33; TAI-DISABLED)

#### Scenario: Kill switch on
- **WHEN** the operator turns on `AI_DISABLED`
- **THEN** new scores are deterministic-only with `components.ai.status = "disabled"` and no OpenAI request is sent

#### Scenario: No consent
- **WHEN** a user has not granted AI consent
- **THEN** their scores are deterministic-only and CV tailoring is refused

### Requirement: Data minimization
Requests to the AI provider SHALL carry no user identifier and only the minimum data for the task: the PII-free scoring profile and the posting view for scoring, and never contact details or protected screening answers for scoring. (Source: 07 §8; 11 §11; TAI-PII)

#### Scenario: Scoring request content
- **WHEN** a scoring request is built
- **THEN** it contains no email, name, phone, user id, employer or school name

### Requirement: jobs-ai queue
The API SHALL process asynchronous AI and maintenance work through one Cloudflare Queue `jobs-ai` (producer binding `JOBS_AI_QUEUE`, batches of 10, 5 s batch timeout, 5 retries, concurrency 10) with dead-letter queue `jobs-ai-dlq`, dispatching by the message `type` of the `JobsAiMessage` contract, retrying failures after `min(300, 2^attempt × 10 + jitter)` seconds, loading every referenced record with the message user's scope (a miss is acked), and SHALL keep messages free of content (ids only, ≤ 128 KB). (Source: 14 §3, §6; 11 §4.4; D-06)

#### Scenario: Unknown record
- **WHEN** a message refers to a record that no longer exists for that user
- **THEN** the message is acked without side effects

#### Scenario: Retry exhausted
- **WHEN** a message has failed five times
- **THEN** it is delivered to `jobs-ai-dlq`, whose handler marks the record failed or scores it deterministically and logs a `dlq` event
