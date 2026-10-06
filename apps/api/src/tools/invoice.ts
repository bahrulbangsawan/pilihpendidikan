import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { registerInvoiceItemsTools } from "./invoice-items";
import { registerInvoiceManagementTools } from "./invoice-management";
import { registerInvoicePartiesTools } from "./invoice-parties";

export function registerInvoiceTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  registerInvoiceManagementTools(server, env, caller);
  registerInvoicePartiesTools(server, env);
  registerInvoiceItemsTools(server, env);
}
