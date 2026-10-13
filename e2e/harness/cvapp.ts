// apps/cv (the CV builder) on its dev port 4003, unchanged. In dev it calls
// the api at the fixed `http://localhost:8788`, so a forwarding proxy on 8788
// points it at the e2e api (T8-03 renders a CV there with "Download PDF").
import { join } from "node:path";
import { CV_APP_DIR, CV_APP_PORT, logPath, portInUse } from "./env";
import type { Proc } from "./procs";
import { poll, spawnProc, tail } from "./procs";
import { ApiProxy } from "./proxy";

export const CV_APP_API_PORT = 8788;

export class CvApp {
  readonly origin = `http://localhost:${CV_APP_PORT}`;
  private readonly proc: Proc;
  private readonly forward: ApiProxy;

  private constructor(proc: Proc, forward: ApiProxy) {
    this.proc = proc;
    this.forward = forward;
  }

  static async start(apiOrigin: string): Promise<CvApp> {
    for (const port of [CV_APP_PORT, CV_APP_API_PORT]) {
      if (await portInUse(port)) {
        throw new Error(
          `port ${port} is busy; T8-03 runs apps/cv on ${CV_APP_PORT}, which calls the api on ${CV_APP_API_PORT} in dev.`
        );
      }
    }
    const forward = await ApiProxy.start(apiOrigin, { port: CV_APP_API_PORT });
    const proc = spawnProc(
      "cv-app",
      join(CV_APP_DIR, "node_modules/.bin/vite"),
      ["dev", "--port", String(CV_APP_PORT), "--strictPort"],
      { cwd: CV_APP_DIR, logFile: logPath("cv-app") }
    );
    const app = new CvApp(proc, forward);
    await poll(
      "apps/cv on :4003",
      async () => {
        if (!proc.running) {
          throw new Error(`apps/cv exited:\n${tail(proc.output)}`);
        }
        return (await fetch(`${app.origin}/`)).status < 500;
      },
      { timeoutMs: 180_000, intervalMs: 1000 }
    );
    return app;
  }

  async stop(): Promise<void> {
    await this.proc.stop(5000);
    await this.forward.close();
  }
}
