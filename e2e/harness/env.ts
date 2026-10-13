// Repository paths, the per-run scratch directory and free ports.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dir, "../..");
export const API_DIR = join(REPO, "apps/api");
export const WEB_DIR = join(REPO, "apps/jobs");
export const CV_APP_DIR = join(REPO, "apps/cv");
export const CLI_DIR = join(REPO, "apps/jobs-cli");
export const E2E_DIR = join(REPO, "e2e");
export const SUPPORT_DIR = join(E2E_DIR, "support");

/** The dashboard must run on 4007: the api's CORS / returnTo allow-list. */
export const WEB_PORT = 4007;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
/** apps/cv on its dev port (the api's PDF links and CORS expect 4003). */
export const CV_APP_PORT = 4003;

let runDir: string | null = null;

function removeScratch(): void {
  if (runDir && process.env.E2E_KEEP !== "1") {
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  runDir = null;
}

// `bun test` does not run exit handlers; the files call `finishFile()` in
// their afterAll. This one covers plain `bun <script>` runs.
process.on("exit", removeScratch);

/** One scratch directory per test file (state, CLI homes, logs). */
export function scratch(): string {
  if (runDir === null) {
    runDir = mkdtempSync(join(tmpdir(), "pilih-e2e-"));
  }
  return runDir;
}

/** Removes this file's scratch directory (kept with `E2E_KEEP=1`). */
export function cleanupScratch(): void {
  removeScratch();
}

export function scratchDir(name: string): string {
  const dir = join(scratch(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function logPath(name: string): string {
  return join(scratchDir("logs"), `${name}.log`);
}

/** An OS-assigned free TCP port on loopback. */
export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

/** Whether something already listens on `port` (localhost, either family). */
export async function portInUse(port: number): Promise<boolean> {
  for (const host of ["127.0.0.1", "::1"]) {
    const busy = await new Promise<boolean>((done) => {
      const server = createServer();
      server.once("error", () => done(true));
      server.listen(port, host, () => server.close(() => done(false)));
    });
    if (busy) {
      return true;
    }
  }
  return false;
}

let counter = 0;
/** A unique, readable test e-mail address. */
export function uniqueEmail(label: string): string {
  counter += 1;
  return `${label}-${Date.now().toString(36)}-${counter}@e2e.example.com`;
}

/** A unique fake client IP (the api rate-limits sign-in links per IP). */
export function fakeClientIp(): string {
  counter += 1;
  const a = Math.floor(counter / 65_536) % 256;
  const b = Math.floor(counter / 256) % 256;
  return `10.${a}.${b}.${counter % 256}`;
}
