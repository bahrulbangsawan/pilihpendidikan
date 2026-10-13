// `pilih-jobs` as a user runs it: `uv run --project apps/jobs-cli pilih-jobs`,
// one isolated PILIH_JOBS_HOME per device, the encrypted-file credential store
// (no OS keychain in tests), `PILIH_JOBS_API_URL` pointing at the api (usually
// through this device's recording proxy).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "./browser";
import { CLI_DIR, freePort, logPath, scratchDir } from "./env";
import type { Proc } from "./procs";
import { spawnProc, tail } from "./procs";

const AUTHORIZE_URL = /(https?:\/\/\S+\/oauth\/authorize\?\S+)/;

export const PASSPHRASE = "e2e-local-passphrase";

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Every JSON line on stdout (NDJSON events and the result envelope). */
  lines: Record<string, unknown>[];
  /** The final `{ok, data, error}` envelope (or NDJSON `result` line). */
  envelope: {
    ok?: boolean;
    data?: unknown;
    error?: Record<string, unknown>;
  } | null;
  data: Record<string, unknown>;
}

export function parseJsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      out.push(JSON.parse(line));
    } catch {
      // not JSON
    }
  }
  return out;
}

function toResult(
  code: number | null,
  stdout: string,
  stderr: string
): CliResult {
  const lines = parseJsonLines(stdout);
  const envelope =
    [...lines]
      .reverse()
      .find(
        (l) => "ok" in l && (l.type === undefined || l.type === "result")
      ) ?? null;
  const data =
    envelope && typeof envelope.data === "object" && envelope.data !== null
      ? (envelope.data as Record<string, unknown>)
      : {};
  return {
    code,
    stdout,
    stderr,
    lines,
    envelope: envelope as CliResult["envelope"],
    data,
  };
}

export interface CliOptions {
  /** `[browser] headless_for` (default: everything headless). */
  headlessFor?: string[];
  /** Extra TOML appended to config.toml. */
  extraConfig?: string;
  env?: Record<string, string>;
}

let homeCount = 0;

/** One CLI installation (one device) with its own home directory. */
export class CliHome {
  readonly name: string;
  readonly home: string;
  apiUrl: string;
  readonly extraEnv: Record<string, string>;

  private constructor(
    name: string,
    home: string,
    apiUrl: string,
    env: Record<string, string>
  ) {
    this.name = name;
    this.home = home;
    this.apiUrl = apiUrl;
    this.extraEnv = env;
  }

  static create(name: string, apiUrl: string, opts: CliOptions = {}): CliHome {
    homeCount += 1;
    const home = scratchDir(`cli-${name}-${homeCount}`);
    mkdirSync(join(home, "config"), { recursive: true });
    const headless = opts.headlessFor ?? ["discover", "render_cv", "apply"];
    writeFileSync(
      join(home, "config", "config.toml"),
      [
        "[credentials]",
        'store = "encrypted-file"',
        "",
        "[browser]",
        `headless_for = [${headless.map((k) => JSON.stringify(k)).join(", ")}]`,
        "",
        "[privacy]",
        "telemetry = false",
        "",
        opts.extraConfig ?? "",
      ].join("\n")
    );
    return new CliHome(name, home, apiUrl, opts.env ?? {});
  }

  env(extra: Record<string, string> = {}): Record<string, string> {
    return {
      PILIH_JOBS_HOME: this.home,
      PILIH_JOBS_API_URL: this.apiUrl,
      PILIH_JOBS_KEYRING_PASSPHRASE: PASSPHRASE,
      PILIH_JOBS_NO_UPDATE_CHECK: "1",
      ...this.extraEnv,
      ...extra,
    };
  }

  private argv(args: string[], json: boolean): string[] {
    return [
      "run",
      "--project",
      CLI_DIR,
      "--frozen",
      "pilih-jobs",
      ...(json ? ["--json"] : []),
      ...args,
    ];
  }

  /** Runs one command to completion (JSON mode unless `json: false`). */
  async run(
    args: string[],
    opts: {
      timeoutMs?: number;
      stdin?: string;
      env?: Record<string, string>;
      json?: boolean;
    } = {}
  ): Promise<CliResult> {
    const proc = this.spawn(args, opts);
    const timer = setTimeout(() => proc.kill9(), opts.timeoutMs ?? 180_000);
    const exit = await proc.exited;
    clearTimeout(timer);
    return toResult(exit.code, proc.stdout, proc.stderr);
  }

  /** Runs a command and throws unless it exits 0. */
  async ok(
    args: string[],
    opts: { timeoutMs?: number; env?: Record<string, string> } = {}
  ) {
    const result = await this.run(args, opts);
    if (result.code !== 0) {
      throw new Error(
        `pilih-jobs ${args.join(" ")} exited ${result.code}:\n${tail(result.stdout, 30)}\n${tail(result.stderr, 30)}`
      );
    }
    return result;
  }

  /** Starts a long-running command (worker, login) in its own process group. */
  spawn(
    args: string[],
    opts: { stdin?: string; env?: Record<string, string>; json?: boolean } = {}
  ): Proc {
    return spawnProc(
      `cli-${this.name}`,
      "uv",
      this.argv(args, opts.json ?? true),
      {
        cwd: CLI_DIR,
        env: this.env(opts.env),
        logFile: logPath(`cli-${this.name}`),
        stdin: opts.stdin,
      }
    );
  }

  /** Result of a finished background command. */
  static resultOf(proc: Proc, code: number | null): CliResult {
    return toResult(code, proc.stdout, proc.stderr);
  }

  /**
   * `pilih-jobs login --no-browser --port <p>`: returns the running process
   * and the authorize URL it printed. The test then plays the user in a browser.
   */
  async startLogin(
    deviceName: string,
    extra: string[] = [],
    opts: { fixedPort?: boolean } = {}
  ): Promise<{ proc: Proc; url: string; port: number }> {
    const fixed = opts.fixedPort ?? true;
    const portArgs = fixed ? ["--port", String(await freePort())] : [];
    const proc = this.spawn([
      "login",
      "--no-browser",
      ...portArgs,
      "--device-name",
      deviceName,
      "--credential-store",
      "encrypted-file",
      ...extra,
    ]);
    const url = await proc.waitFor(
      (out) => AUTHORIZE_URL.exec(out)?.[1],
      90_000,
      "the authorize URL"
    );
    const redirect = new URL(
      new URL(url).searchParams.get("redirect_uri") ?? ""
    );
    return { proc, url, port: Number(redirect.port) };
  }

  /**
   * The full login (17 §10.1) with a signed-in browser: the consent page is
   * approved by the user, the CLI exchanges the code and registers the device.
   */
  async login(
    browser: Browser,
    user: { session: string },
    deviceName: string,
    extra: string[] = []
  ): Promise<CliResult> {
    const { proc, url, port } = await this.startLogin(deviceName, extra);
    await browser.addCookies([
      { name: "session", value: user.session, url: new URL(url).origin },
    ]);
    await browser.goto(url);
    await browser.waitForText(deviceName);
    await browser.click('button[name="decision"][value="approve"]');
    await browser.waitForUrl(`127\\.0\\.0\\.1:${port}/callback`, 30_000);
    await browser.waitForText("You can close this tab");
    const exit = await proc.exited;
    const result = CliHome.resultOf(proc, exit.code);
    if (exit.code !== 0) {
      throw new Error(`login failed (${exit.code}):\n${tail(proc.output)}`);
    }
    return result;
  }
}
