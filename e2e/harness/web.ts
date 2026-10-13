// apps/jobs (`vite dev` + workerd) on :4007, its BFF pointed at an e2e api.
// The Worker config and `.dev.vars` are generated into the scratch directory
// (e2e/support/jobs-vite.config.ts), so the developer's apps/jobs/.dev.vars
// is never read or touched.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  logPath,
  portInUse,
  SUPPORT_DIR,
  scratchDir,
  WEB_DIR,
  WEB_ORIGIN,
  WEB_PORT,
} from "./env";
import type { Proc } from "./procs";
import { poll, spawnProc, tail } from "./procs";

export class WebServer {
  readonly origin = WEB_ORIGIN;
  private readonly proc: Proc;

  private constructor(proc: Proc) {
    this.proc = proc;
  }

  static async start(apiOrigin: string): Promise<WebServer> {
    if (await portInUse(WEB_PORT)) {
      throw new Error(
        `port ${WEB_PORT} is busy (a running apps/jobs dev server?). The e2e suite needs it: the api only accepts the dashboard on localhost:${WEB_PORT}.`
      );
    }
    const dir = scratchDir(`web-${Date.now().toString(36)}`);
    writeFileSync(
      join(dir, "wrangler.jsonc"),
      JSON.stringify(
        {
          name: "jobs-pilihpendidikan",
          main: join(WEB_DIR, "src/server.ts"),
          compatibility_date: "2026-03-24",
          compatibility_flags: ["nodejs_compat"],
          vars: {
            API_PUBLIC_ORIGIN: apiOrigin,
            JOBS_APP_ORIGIN: WEB_ORIGIN,
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(dir, ".dev.vars"),
      [
        `BFF_COOKIE_KEY=${randomBytes(32).toString("base64")}`,
        `JOBS_API_FALLBACK_URL=${apiOrigin}`,
        "JOBS_STRICT_CONTRACTS=1",
      ].join("\n")
    );
    const proc = spawnProc(
      "web",
      join(WEB_DIR, "node_modules/.bin/vite"),
      [
        "dev",
        "--config",
        join(SUPPORT_DIR, "jobs-vite.config.ts"),
        "--port",
        String(WEB_PORT),
        "--strictPort",
      ],
      {
        cwd: WEB_DIR,
        env: { E2E_JOBS_WRANGLER_CONFIG: join(dir, "wrangler.jsonc") },
        logFile: logPath("web"),
      }
    );
    const server = new WebServer(proc);
    await poll(
      "apps/jobs on :4007",
      async () => {
        if (!proc.running) {
          throw new Error(`vite exited:\n${tail(proc.output)}`);
        }
        const res = await fetch(`${WEB_ORIGIN}/`);
        return res.status < 500;
      },
      { timeoutMs: 180_000, intervalMs: 1000 }
    );
    return server;
  }

  get log(): string {
    return this.proc.output;
  }

  async stop(): Promise<void> {
    await this.proc.stop(5000);
  }
}
