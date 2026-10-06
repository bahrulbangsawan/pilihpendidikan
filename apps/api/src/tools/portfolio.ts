import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { registerPortfolioManagementTools } from "./portfolio-management";
import { registerPortfolioProjectTools } from "./portfolio-projects";
import { registerPortfolioSocialTools } from "./portfolio-socials";

// Wires the per-user portfolio builder tools into one registration (mirrors
// cv.ts / jobs.ts). Registered for ANY authenticated caller; the ownership
// guard scopes every portfolio_* call to `owner:portfolio:{id}` (category
// "portfolio") so a non-admin only ever touches their own portfolio; admins
// bypass. Backs apps/portfolio + `/api/portfolio/:id` + `/portfolio/{slug}.pdf`.
export function registerPortfolioTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  // The management tools take `caller` so portfolio_create can stamp ownership
  // and portfolio_list can filter to the caller's own portfolios (mirrors
  // cv-management.ts). The project/social tools are pure mutations whose
  // ownership is enforced by the wrapping guard, so they don't need caller.
  registerPortfolioManagementTools(server, env, caller);
  registerPortfolioProjectTools(server, env);
  registerPortfolioSocialTools(server, env);
}
