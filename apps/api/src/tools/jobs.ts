import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { registerJobsApprovalsTools } from "./jobs-approvals";
import { registerJobsBoardTools } from "./jobs-board";
import { registerJobsItemsTools } from "./jobs-items";
import { registerJobsManagementTools } from "./jobs-management";
import { registerJobsSectionsTools } from "./jobs-sections";

// Wires the jobs tool clusters into one registration (mirrors invoice.ts):
// the legacy tracker tools (management, sections, items — served by the
// legacy facade, KV or JOBS_DB) and the Job Tracker board and approval tools
// (05 §14). Tools with a `job_id` are authorized by the ownership guard
// before their handler runs.
export function registerJobsTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  registerJobsManagementTools(server, env, caller);
  registerJobsSectionsTools(server, env, caller);
  registerJobsItemsTools(server, env, caller);
  registerJobsBoardTools(server, env, caller);
  registerJobsApprovalsTools(server, env, caller);
}
