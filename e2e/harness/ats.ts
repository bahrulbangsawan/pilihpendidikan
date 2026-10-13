// The fixture ATS server (apps/jobs-cli/tests/fixtures/ats_server, 13 §4.1)
// in its own process, through e2e/support/ats_fixture.py. Tests read what the
// "employer" received (`hits`) to count submissions, and set flags (hold a
// request, let the assisted page's human click Submit).
import { join } from "node:path";
import { CLI_DIR, logPath, SUPPORT_DIR } from "./env";
import type { Proc } from "./procs";
import { spawnProc } from "./procs";

const PORT_LINE = /\{"port": (\d+)\}/;

export interface Hit {
  method: string;
  host: string;
  path: string;
  query: string;
  form: Record<string, string[]>;
  files: Record<string, string>;
  at: number;
}

export class AtsServer {
  readonly port: number;
  private readonly proc: Proc;

  private constructor(proc: Proc, port: number) {
    this.proc = proc;
    this.port = port;
  }

  static async start(): Promise<AtsServer> {
    const proc = spawnProc(
      "ats",
      "uv",
      [
        "run",
        "--project",
        CLI_DIR,
        "--frozen",
        "python",
        join(SUPPORT_DIR, "ats_fixture.py"),
      ],
      { cwd: CLI_DIR, logFile: logPath("ats"), keepStdin: true }
    );
    const port = await proc.waitFor(
      (out) => {
        const match = PORT_LINE.exec(out);
        return match ? Number(match[1]) : null;
      },
      60_000,
      "the fixture ATS port"
    );
    return new AtsServer(proc, port);
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** `/e2e/<n>/apply`: a form with an optional resume; `/cv/<n>/apply`: resume required. */
  applyUrl(flow: string): string {
    return `${this.origin}/${flow}/apply`;
  }

  async setFlags(flags: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.origin}/__e2e/flags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(flags),
    });
    if (!res.ok) {
      throw new Error(`fixture flags → ${res.status}`);
    }
  }

  /** Requests the "employer" received; `wallAt` is epoch ms (converted from its clock). */
  async hits(): Promise<Array<Hit & { wallAt: number }>> {
    const res = await fetch(`${this.origin}/__e2e/hits`);
    const body = (await res.json()) as {
      hits: Hit[];
      mono: number;
      wall: number;
    };
    return body.hits.map((h) => ({
      ...h,
      wallAt: Math.round((body.wall - (body.mono - h.at)) * 1000),
    }));
  }

  /** Form submissions the employer received for one flow (`/e2e/7`). */
  async submissions(flow: string): Promise<Array<Hit & { wallAt: number }>> {
    return (await this.hits()).filter(
      (h) => h.method === "POST" && h.path === `/${flow}/submit`
    );
  }

  async stop(): Promise<void> {
    await this.proc.stop(3000);
  }
}
