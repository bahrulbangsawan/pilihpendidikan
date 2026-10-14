// Worker entry for api.pilihpendidikan.com: the HTTP router from ./app.ts
// (incl. the /api/v1 Job Tracker kernel), the `PilihMcpServer` Durable Object
// behind the MCP_OBJECT binding, the crons (`scheduled`), the queue consumers
// (`queue`) and the scheduler fallback's RPC entrypoint (`CloudScheduler`).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WorkerEntrypoint } from "cloudflare:workers";
import { McpAgent } from "agents/mcp";
import { createApp, SESSION_MISMATCH } from "./app";
import type { Caller } from "./auth";
import type { Env, McpProps } from "./env";
import { scopesForCredential } from "./jobs/core/scopes";
import { runSchedulerTick } from "./jobs/cron/fallback";
import type { CronRunReport } from "./jobs/cron/index";
import { ensureUser } from "./jobs/repo/core/users";
import { registerAllTools } from "./mcp-tools";

export class PilihMcpServer extends McpAgent<Env, unknown, Partial<McpProps>> {
  server = new McpServer({ name: "pilihpendidikan", version: "1.0.0" });

  // A session is bound to the account (and scope) that opened it. The agents
  // SDK applies props only when the object starts, so without this check a
  // request carrying another account's credential plus a live session id
  // would run with the first account's tools.
  override async __unsafe_ensureInitialized(
    props?: Partial<McpProps>
  ): Promise<void> {
    const bound =
      this.props ??
      (await this.ctx.storage.get<Partial<McpProps>>("props")) ??
      null;
    if (
      bound?.email &&
      props?.email &&
      (bound.email !== props.email || bound.scope !== props.scope)
    ) {
      throw new Error(SESSION_MISMATCH);
    }
    await super.__unsafe_ensureInitialized(props);
  }

  async init(): Promise<void> {
    const props = this.props ?? {};
    const caller: Caller | null = props.email
      ? {
          email: props.email,
          isAdmin: props.isAdmin ?? false,
          scope: props.scope === "write" ? "write" : "read",
          userId: props.userId ?? (await this.resolveUserId(props.email)),
          scopes: scopesForCredential(
            props.scope === "write" ? "oauth_mcp" : "personal_read"
          ),
        }
      : null;
    const installed = registerAllTools(this.server, this.env, caller, {
      fireAndForget: (promise) => {
        this.ctx.waitUntil(promise.catch(() => undefined));
      },
    });
    if (!installed) {
      console.warn("MCP tool aliases not installed; legacy names will fail");
    }
  }

  // The route hands the DO only {email, isAdmin, scope}; the canonical user
  // id (03 §2) is resolved here. A D1 hiccup leaves it unset: the legacy
  // document tools do not need it, and Job Tracker tools re-resolve it.
  private async resolveUserId(email: string): Promise<string | undefined> {
    try {
      return (await ensureUser(this.env.DB, email, Date.now())).id;
    } catch (err) {
      console.error("MCP user id resolution failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }
}

/**
 * `CloudScheduler`: a private RPC entrypoint (job-tracker-spec/24 §6.6). It has
 * no route; only the scraper Worker's service binding (`entrypoint:
 * "CloudScheduler"`) can call it. Its alarm clock ticks the 5-minute and
 * hourly schedules while Cloudflare does not dispatch this Worker's newer
 * Cron Triggers.
 */
export class CloudScheduler extends WorkerEntrypoint<Env> {
  async tick(cron: string): Promise<CronRunReport> {
    return await runSchedulerTick(cron, this.env, this.ctx);
  }
}

export default createApp({
  sse: PilihMcpServer.serveSSE("/sse"),
  streamable: PilihMcpServer.serve("/mcp"),
});
