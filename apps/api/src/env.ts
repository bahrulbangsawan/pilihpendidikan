// Bindings and vars for the api Worker. Declared by hand (wrangler types runs
// with `--include-env=false`) so optional secrets stay optional and tests can
// build a fake env without every binding.

export interface Env {
  // D1 `pilihpendidikan`: mcp_tokens, oauth_clients, request_log.
  DB: D1Database;
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
  ADMIN_EMAILS?: string;
  // Sender address for sign-in emails.
  EMAIL_FROM?: string;
  // Days a request_log row is kept before the daily purge removes it.
  LOG_RETENTION_DAYS?: string;
}

export type TokenScope = "write" | "read";

// Per-session auth context handed from the MCP route to the Durable Object
// through the agents SDK `props` channel (the DO never sees the Request).
export interface McpProps {
  email: string;
  isAdmin: boolean;
  scope: TokenScope;
}

export function setMcpProps(ctx: ExecutionContext, props: McpProps): void {
  (ctx as unknown as { props?: McpProps }).props = props;
}
