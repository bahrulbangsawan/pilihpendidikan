// Bindings and vars for the api Worker. Declared by hand (wrangler types runs
// with `--include-env=false`) so optional secrets stay optional and tests can
// build a fake env without every binding.

import type { CloudQueueMessage } from "@pilihpendidikan/jobs-contracts/cloud";
import type { JobsAiMessage } from "@pilihpendidikan/jobs-contracts/queue";

export interface Env {
  // D1 `pilihpendidikan`: identity and credentials — users, mcp_tokens,
  // oauth_clients, oauth_grants, oauth_refresh_tokens, devices,
  // feature_flags, support_access_log, request_log (04 §1).
  DB: D1Database;
  // D1 `pilihpendidikan-jobs`: every Job Tracker record (04 §2, D-02). Only
  // src/jobs/repo/** may touch it (04 §5); everything else goes through the
  // repo functions with the opaque `JobsDb` handle.
  JOBS_DB: D1Database;
  // R2 `pilihpendidikan-jobs-files`: CV PDFs, letters, evidence, run logs
  // (D-05). Keys `u/{user_id}/{kind}/{fil_id}{ext}` (14 §5.1).
  JOBS_FILES: R2Bucket;
  // Queue `jobs-ai` (14 §6). Consumed by src/jobs/queue/consumer.ts.
  JOBS_AI_QUEUE: Queue<JobsAiMessage>;
  // Queue `jobs-scrape` (24 §6): one message per cloud source scrape, probe
  // or directory refresh. Consumed by src/jobs/cloud/consumer.ts. Optional so
  // envs without cloud discovery still boot.
  JOBS_SCRAPE_QUEUE?: Queue<CloudQueueMessage>;
  // Service binding to the scraper Worker `jobs-scraper-pilihpendidikan`
  // (apps/jobs-scraper, 24 §3). Optional: absent in tests and most dev setups.
  SCRAPER?: Fetcher;
  // Dev only: base URL of a scraper started outside wrangler (the Python
  // service on http://localhost:8791, or `wrangler dev` of apps/jobs-scraper
  // on :8792). When set it is used instead of the SCRAPER binding.
  SCRAPER_FALLBACK_URL?: string;
  // System AI budget of cloud discovery (D-40), USD per month; default "2.00".
  JOBS_CLOUD_AI_MONTHLY_BUDGET_USD?: string;
  // AI fallback jobs below this model confidence are dropped; default "0.5".
  JOBS_CLOUD_AI_MIN_CONFIDENCE?: string;
  // Sessions (`auth:session:<hash>`), magic links, one-time codes, OAuth state.
  AUTH_KV: KVNamespace;
  // `cv:{id}` + `owner:cv:{id}`.
  CV_KV: KVNamespace;
  // `invoice:{id}` + `owner:inv:{id}` (rebound existing namespace).
  INVOICE_KV: KVNamespace;
  // `portfolio:{id}` + `owner:portfolio:{id}` (rebound existing namespace).
  PORTFOLIO_KV: KVNamespace;
  // `job:{id}` + `owner:job:{id}` (rebound existing namespace).
  JOBS_KV: KVNamespace;
  // Rate-limit counters. Optional so a partial dev env still boots.
  RATE_LIMIT_KV?: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  EMAIL: SendEmail;
  // Comma-separated emails that bypass per-owner scoping. Empty by default.
  // Never applies to JOBS_DB (D-26).
  ADMIN_EMAILS?: string;
  // Sender address for sign-in emails.
  EMAIL_FROM?: string;
  // Days a request_log row is kept before the daily purge removes it.
  LOG_RETENTION_DAYS?: string;
  // CLI compatibility (05 §1.7, 22): below the minimum ⇒ 426.
  JOBS_MIN_CLI_VERSION?: string;
  JOBS_RECOMMENDED_CLI_VERSION?: string;
  // "live" (OpenAI) or "fake" (deterministic provider; dev and tests).
  JOBS_AI_MODE?: string;
  // Per-user monthly AI budget in USD (D-34); default "3.00".
  JOBS_AI_MONTHLY_BUDGET_USD?: string;
  // Dashboard origin, e.g. https://jobs.pilihpendidikan.com.
  JOBS_APP_ORIGIN?: string;
  // Secret (wrangler secret put / .dev.vars). Only src/jobs/ai/** reads it.
  OPENAI_API_KEY?: string;
  // Optional data-residency endpoint (07 §8); default https://api.openai.com.
  OPENAI_BASE_URL?: string;
  // Optional Responses model override for CV tailoring (08).
  TAILOR_MODEL?: string;
  // Live AI provider: "openai" (default) or "openrouter". JOBS_AI_MODE=fake
  // still wins.
  JOBS_AI_PROVIDER?: string;
  // Secret (wrangler secret put / .dev.vars). Only src/jobs/ai/** reads it.
  OPENROUTER_API_KEY?: string;
  // Optional; default https://openrouter.ai/api.
  OPENROUTER_BASE_URL?: string;
  // OpenRouter model ids (defaults in src/jobs/ai/openrouter.ts).
  OPENROUTER_MODEL_DECISIONS?: string;
  OPENROUTER_MODEL_STRUCTURED?: string;
  OPENROUTER_MODEL_ESCALATION?: string;
}

export type TokenScope = "write" | "read";

// Per-session auth context handed from the MCP route to the Durable Object
// through the agents SDK `props` channel (the DO never sees the Request).
// `userId` is optional: routes/mcp.ts sends the three legacy fields and the
// DO resolves the user id from the email (src/index.ts).
export interface McpProps {
  email: string;
  isAdmin: boolean;
  scope: TokenScope;
  userId?: string;
}

export function setMcpProps(ctx: ExecutionContext, props: McpProps): void {
  (ctx as unknown as { props?: McpProps }).props = props;
}
