// The user's browser: Playwright Chromium (from the CLI virtualenv) driven
// line by line through e2e/support/browser_driver.py. It signs in, approves
// the OAuth consent page, drags cards and reads what the dashboard shows.
import { join } from "node:path";
import { CLI_DIR, logPath, SUPPORT_DIR, scratchDir } from "./env";
import type { Proc } from "./procs";
import { spawnProc, tail } from "./procs";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  cmd: string;
}

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  url?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  expires?: number;
}

let browserCount = 0;

export class Browser {
  private readonly proc: Proc;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = "";
  readonly downloads: string;

  private constructor(proc: Proc, downloads: string) {
    this.proc = proc;
    this.downloads = downloads;
    proc.child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    proc.exited.then(() => {
      for (const [, p] of this.pending) {
        p.reject(
          new Error(`browser exited during ${p.cmd}:\n${tail(proc.stderr)}`)
        );
      }
      this.pending.clear();
    });
  }

  static async launch(opts: { headed?: boolean } = {}): Promise<Browser> {
    browserCount += 1;
    const name = `browser-${browserCount}`;
    const downloads = scratchDir(`downloads-${browserCount}`);
    const args = [
      "run",
      "--project",
      CLI_DIR,
      "--frozen",
      "python",
      join(SUPPORT_DIR, "browser_driver.py"),
      "--downloads",
      downloads,
    ];
    if (opts.headed) {
      args.push("--headed");
    }
    const proc = spawnProc(name, "uv", args, {
      cwd: CLI_DIR,
      logFile: logPath(name),
      keepStdin: true,
    });
    const browser = new Browser(proc, downloads);
    await proc.waitFor(
      (out) => out.includes('"ready": true'),
      60_000,
      "browser ready"
    );
    return browser;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line.startsWith("{")) {
        continue;
      }
      let message: {
        id?: number;
        ok?: boolean;
        result?: unknown;
        error?: string;
        url?: string;
      };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message.id !== "number") {
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        continue;
      }
      this.pending.delete(message.id);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(
          new Error(
            `browser ${pending.cmd} failed at ${message.url}: ${message.error}`
          )
        );
      }
    }
  }

  send<T = unknown>(
    cmd: string,
    args: Record<string, unknown> = {}
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        cmd,
      });
      this.proc.child.stdin?.write(`${JSON.stringify({ id, cmd, ...args })}\n`);
    });
  }

  goto(url: string, timeout = 60_000, waitUntil = "load") {
    return this.send<{ url: string; status: number | null }>("goto", {
      url,
      timeout,
      wait_until: waitUntil,
    });
  }

  /** Waits until React has hydrated the element (its fiber is attached). */
  async waitForHydration(selector: string, timeout = 60_000): Promise<void> {
    await this.waitFor(selector, { timeout });
    await this.waitForFunction(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")); })()`,
      timeout
    );
  }

  url() {
    return this.send<string>("url");
  }

  text(selector = "body", timeout = 30_000) {
    return this.send<string>("text", { selector, timeout });
  }

  count(selector: string) {
    return this.send<number>("count", { selector });
  }

  click(selector: string, timeout = 30_000) {
    return this.send<null>("click", { selector, timeout });
  }

  fill(selector: string, value: string, timeout = 30_000) {
    return this.send<null>("fill", { selector, value, timeout });
  }

  press(key: string, selector?: string) {
    return this.send<null>("press", { key, selector });
  }

  focus(selector: string) {
    return this.send<null>("focus", { selector });
  }

  waitFor(selector: string, opts: { state?: string; timeout?: number } = {}) {
    return this.send<null>("wait_for", {
      selector,
      state: opts.state ?? "visible",
      timeout: opts.timeout ?? 30_000,
    });
  }

  waitForUrl(pattern: string, timeout = 30_000) {
    return this.send<string>("wait_for_url", { pattern, timeout });
  }

  waitForFunction<T = unknown>(js: string, timeout = 60_000) {
    return this.send<T>("wait_for_function", { js, timeout });
  }

  eval<T = unknown>(js: string) {
    return this.send<T>("eval", { js });
  }

  cookies() {
    return this.send<Cookie[]>("cookies");
  }

  addCookies(cookies: Cookie[]) {
    return this.send<null>("add_cookies", { cookies });
  }

  clearCookies() {
    return this.send<null>("clear_cookies");
  }

  /** Pointer drag from `source` to `target` (dropped at `y` × its height). */
  drag(source: string, target: string, y = 0.5) {
    return this.send<unknown>("drag", { source, target, y });
  }

  download(selector: string, name?: string, timeout = 120_000) {
    return this.send<{ path: string; suggested: string }>("download", {
      selector,
      name,
      timeout,
    });
  }

  /** Presses a keyboard shortcut and saves the download it triggers. */
  downloadByKey(key: string, timeout = 120_000) {
    return this.send<{ path: string; suggested: string }>("download", {
      press: key,
      timeout,
    });
  }

  screenshot(path: string) {
    return this.send<string>("screenshot", { path });
  }

  console(clear = false) {
    return this.send<string[]>("console", { clear });
  }

  /** Waits until the page text contains `needle` (or matches it). */
  async waitForText(
    needle: string | RegExp,
    timeout = 30_000
  ): Promise<string> {
    const deadline = Date.now() + timeout;
    let last = "";
    for (;;) {
      try {
        last = await this.text("body", 5000);
      } catch {
        last = "";
      }
      if (
        typeof needle === "string" ? last.includes(needle) : needle.test(last)
      ) {
        return last;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `page never showed ${String(needle)}; url ${await this.url().catch(() => "?")}; text:\n${last.slice(0, 1500)}`
        );
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async close(): Promise<void> {
    if (this.proc.running) {
      try {
        await Promise.race([
          this.send("close"),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      } catch {
        // already gone
      }
      await this.proc.stop(3000);
    }
  }
}
