// Builds the MCP tool surface for one session. Used by the PilihMcpServer
// Durable Object and, with a recording fake server, by tool-surface.test.ts —
// so the test sees exactly what a client sees.
//
// Wrapping order (outermost first at call time):
//   request logger → ownership guard → tool handler
// and at registration time the scope filter sits in front of both, so a
// read-scoped session never registers (or logs) a write tool.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Caller } from "./auth";
import type { Env } from "./env";
import { installToolLogger, retentionDays } from "./request-log";
import { registerCvTools } from "./tools/cv";
import { registerInvoiceTools } from "./tools/invoice";
import { registerJobsTools } from "./tools/jobs";
import { installOwnershipGuard } from "./tools/ownership-guard";
import { registerPortfolioTools } from "./tools/portfolio";
import { installToolAliases } from "./tools/tool-aliases";

// Tools that never write. A read-scoped token only receives these.
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "cv_get",
  "cv_list",
  "cv_get_url",
  "cv_list_section",
  "cv_get_entry_by_id",
  "invoice_get",
  "invoice_list",
  "invoice_get_totals",
  "invoice_get_url",
  "portfolio_get",
  "portfolio_list",
  "portfolio_get_project",
  "portfolio_list_projects",
  "portfolio_get_url",
  "jobs_get",
  "jobs_list",
  "jobs_board",
  "jobs_approvals_list",
]);

export interface RegisterToolsOptions {
  fireAndForget: (promise: Promise<unknown>) => void;
}

// Registration-time filter: drops write tools for read-scoped callers and
// marks every tool with MCP `readOnlyHint` so clients can tell them apart.
function installScopeFilter(server: McpServer, caller: Caller | null): void {
  const readOnlySession = caller?.scope !== "write";
  const original = server.registerTool.bind(server);
  server.registerTool = ((name, config, handler) => {
    const readOnly = READ_ONLY_TOOLS.has(name);
    if (readOnlySession && !readOnly) {
      return undefined as unknown as ReturnType<typeof original>;
    }
    const annotated = {
      ...config,
      annotations: { ...config.annotations, readOnlyHint: readOnly },
    };
    return original(name, annotated, handler);
  }) as typeof server.registerTool;
}

// Registers every cv_*, invoice_*, portfolio_* and jobs_* tool for `caller`
// plus the legacy aliases. Returns whether the aliases could be installed.
export function registerAllTools(
  server: McpServer,
  env: Env,
  caller: Caller | null,
  options: RegisterToolsOptions
): boolean {
  const logger = installToolLogger(server, {
    db: env.DB,
    callerEmail: caller?.email ?? null,
    retentionDays: retentionDays(env.LOG_RETENTION_DAYS),
    fireAndForget: options.fireAndForget,
  });
  const guard = installOwnershipGuard(server, { caller, env });
  installScopeFilter(server, caller);

  logger.setCategory("cv");
  guard.setCategory("cv");
  registerCvTools(server, env, caller);

  logger.setCategory("invoice");
  guard.setCategory("invoice");
  registerInvoiceTools(server, env, caller);

  logger.setCategory("portfolio");
  guard.setCategory("portfolio");
  registerPortfolioTools(server, env, caller);

  logger.setCategory("jobs");
  guard.setCategory("jobs");
  registerJobsTools(server, env, caller);

  // Legacy (pre-prefix) names resolve to canonical handlers at call time but
  // stay out of tools/list. Must run after every registration.
  return installToolAliases(server);
}
