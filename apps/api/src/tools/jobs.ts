import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { registerJobsItemsTools } from "./jobs-items";
import { registerJobsManagementTools } from "./jobs-management";
import { registerJobsSectionsTools } from "./jobs-sections";

// Wires the three jobs tool clusters into one registration (mirrors invoice.ts).
// Only management tools need the caller (jobs_list filters / jobs_create stamps
// ownership); section + item tools authorize via the ownership guard on job_id.
export function registerJobsTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  registerJobsManagementTools(server, env, caller);
  registerJobsSectionsTools(server, env);
  registerJobsItemsTools(server, env);
}
