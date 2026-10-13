// Child processes for the e2e suite: every server, CLI and browser runs in
// its own process group so a test can SIGKILL a whole tree (the CLI and the
// Chromium it launched) and the suite never leaks processes, even when a
// test times out or the runner is interrupted.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const live = new Set<number>();

function killGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/** SIGKILLs every process group this suite started that is still alive. */
export function killAll(): void {
  for (const pid of live) {
    killGroup(pid, "SIGKILL");
  }
  live.clear();
}

process.on("exit", killAll);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    killAll();
    process.exit(130);
  });
}

export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  /** Appends every output line to this file (debugging a failed run). */
  logFile?: string;
  /** Text written to stdin, then stdin is closed. */
  stdin?: string;
  /** Leave stdin open (an interactive driver). */
  keepStdin?: boolean;
}

export interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** A running child with its captured output. */
export class Proc {
  readonly child: ChildProcess;
  readonly name: string;
  stdout = "";
  stderr = "";
  readonly exited: Promise<ExitResult>;
  private readonly waiters: Array<() => void> = [];
  private readonly logFile: string | undefined;
  private done = false;

  constructor(
    name: string,
    command: string,
    args: string[],
    opts: SpawnOptions
  ) {
    this.name = name;
    this.logFile = opts.logFile;
    if (this.logFile) {
      mkdirSync(dirname(this.logFile), { recursive: true });
      appendFileSync(this.logFile, `$ ${command} ${args.join(" ")}\n`);
    }
    this.child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...cleanEnv(), ...opts.env } as NodeJS.ProcessEnv,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pid = this.child.pid;
    if (pid !== undefined) {
      live.add(pid);
    }
    this.child.stdout?.setEncoding("utf8");
    this.child.stderr?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => {
      this.stdout += chunk;
      this.log(chunk);
      this.notify();
    });
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderr += chunk;
      this.log(chunk);
      this.notify();
    });
    if (opts.stdin !== undefined) {
      this.child.stdin?.end(opts.stdin);
    } else if (!opts.keepStdin) {
      this.child.stdin?.end();
    }
    this.exited = new Promise<ExitResult>((resolve) => {
      this.child.on("exit", (code, signal) => {
        this.done = true;
        if (pid !== undefined) {
          live.delete(pid);
        }
        resolve({ code, signal });
        this.notify();
      });
      this.child.on("error", (err) => {
        this.done = true;
        this.stderr += String(err);
        resolve({ code: -1, signal: null });
        this.notify();
      });
    });
  }

  get pid(): number {
    return this.child.pid ?? -1;
  }

  get running(): boolean {
    return !this.done;
  }

  get output(): string {
    return `${this.stdout}\n${this.stderr}`;
  }

  private log(chunk: string): void {
    if (this.logFile) {
      appendFileSync(this.logFile, chunk);
    }
  }

  private notify(): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter();
    }
  }

  /** Resolves when `predicate(output)` holds; rejects on timeout or exit. */
  async waitFor<T>(
    predicate: (output: string) => T | null | undefined | false,
    timeoutMs: number,
    what = "output"
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = predicate(this.output);
      if (value) {
        return value;
      }
      if (this.done) {
        throw new Error(
          `${this.name} exited before ${what}:\n${tail(this.output)}`
        );
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new Error(
          `${this.name}: timed out waiting for ${what}:\n${tail(this.output)}`
        );
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(left, 500));
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** SIGKILL the whole process group (the CLI and its Chromium). */
  kill9(): void {
    if (this.child.pid !== undefined) {
      killGroup(this.child.pid, "SIGKILL");
    }
  }

  signal(sig: NodeJS.Signals): void {
    if (this.child.pid !== undefined) {
      killGroup(this.child.pid, sig);
    }
  }

  /** SIGTERM, then SIGKILL after `graceMs`. */
  async stop(graceMs = 5000): Promise<ExitResult> {
    if (!this.done) {
      this.signal("SIGTERM");
      const timer = setTimeout(() => this.kill9(), graceMs);
      const result = await this.exited;
      clearTimeout(timer);
      // Grandchildren (workerd, Chromium) may outlive the leader.
      this.kill9();
      return result;
    }
    this.kill9();
    return await this.exited;
  }
}

export function tail(text: string, lines = 60): string {
  return text.split("\n").slice(-lines).join("\n");
}

/**
 * The environment for children: no Claude Code markers (bun test hides
 * passing lines under them), colours off, no interactive prompts.
 */
export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const key of [
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "PILIH_JOBS_API_URL",
    "PILIH_JOBS_HOME",
    "PILIH_JOBS_TOKEN",
    "PILIH_JOBS_CONFIG",
    "VIRTUAL_ENV",
  ]) {
    delete env[key];
  }
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  return env;
}

export function spawnProc(
  name: string,
  command: string,
  args: string[],
  opts: SpawnOptions
): Proc {
  return new Proc(name, command, args, opts);
}

/** Runs a command to completion; throws with its output on a non-zero exit. */
export async function run(
  name: string,
  command: string,
  args: string[],
  opts: SpawnOptions & { timeoutMs?: number; allowFailure?: boolean }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const proc = spawnProc(name, command, args, opts);
  const timeout = opts.timeoutMs ?? 300_000;
  const timer = setTimeout(() => proc.kill9(), timeout);
  const result = await proc.exited;
  clearTimeout(timer);
  if (!opts.allowFailure && result.code !== 0) {
    throw new Error(
      `${name} failed (${result.code ?? result.signal}):\n${tail(proc.output)}`
    );
  }
  return { code: result.code, stdout: proc.stdout, stderr: proc.stderr };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An error that stops `poll` at once instead of being retried. */
export class FatalError extends Error {}

/** Polls `probe` until it returns a truthy value (a `FatalError` ends it). */
export async function poll<T>(
  what: string,
  probe: () => Promise<T | null | undefined | false>,
  { timeoutMs = 30_000, intervalMs = 500 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      const value = await probe();
      if (value) {
        return value;
      }
    } catch (err) {
      if (err instanceof FatalError) {
        throw err;
      }
      lastError = err;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs} ms waiting for ${what}${
          lastError ? `: ${String(lastError)}` : ""
        }`
      );
    }
    await sleep(intervalMs);
  }
}
