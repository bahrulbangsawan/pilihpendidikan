import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { registerCvAddTools } from "./cv-add";
import { registerCvLookupTools } from "./cv-lookup";
import { registerCvManagementTools } from "./cv-management";
import { registerCvRemoveTools } from "./cv-remove";
import { registerCvUpdateTools } from "./cv-update";

export function registerCvTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  registerCvManagementTools(server, env, caller);
  registerCvAddTools(server, env);
  registerCvRemoveTools(server, env);
  registerCvLookupTools(server, env);
  registerCvUpdateTools(server, env);
}
