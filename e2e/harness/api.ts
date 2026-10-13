// apps/api under `wrangler dev`, on a random port, against a fresh local
// state (`--persist-to`): both migration sets applied, the D-33 flags seeded,
// `JOBS_AI_MODE=fake`. Nothing here ever talks to a remote Cloudflare
// resource: every wrangler command passes `--local` / `--persist-to`.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_DIR, freePort, logPath, scratchDir, WEB_ORIGIN } from "./env";
import type { Proc } from "./procs";
import { poll, run, spawnProc, tail } from "./procs";

export type FlagValue = boolean | "kv" | "d1";

/** The flags `scripts/seed-local.ts` turns on (D-33); auto mode stays off. */
export const DEFAULT_FLAGS: Record<string, FlagValue> = {
  JOBS_V1_ENABLED: true,
  JOBS_CLI_LOGIN_ENABLED: true,
  JOBS_AUTOMATION_ENABLED: true,
  JOBS_AUTO_MODE_ENABLED: false,
  JOBS_EMAIL_SERVER_SEND_ENABLED: false,
  AI_DISABLED: false,
  JOBS_LEGACY_BACKEND: "kv",
};

let templatePromise: Promise<string> | null = null;

/** Hash of everything that shapes the template (migrations + flag seeding). */
function templateKey(): string {
  const hash = createHash("sha256");
  for (const dir of ["migrations", "migrations-jobs"]) {
    for (const file of readdirSync(join(API_DIR, dir)).sort()) {
      hash.update(file);
      hash.update(readFileSync(join(API_DIR, dir, file)));
    }
  }
  hash.update(readFileSync(join(API_DIR, "scripts/seed-local.ts")));
  hash.update(readFileSync(join(API_DIR, "wrangler.jsonc")));
  return hash.digest("hex").slice(0, 16);
}

async function buildTemplate(dir: string): Promise<void> {
  const opts = { cwd: API_DIR, logFile: logPath("api-template") };
  for (const binding of ["DB", "JOBS_DB"]) {
    await run(
      `migrate ${binding}`,
      "bunx",
      [
        "wrangler",
        "d1",
        "migrations",
        "apply",
        binding,
        "--local",
        "--persist-to",
        dir,
      ],
      opts
    );
  }
  await run(
    "seed flags",
    "bun",
    ["scripts/seed-local.ts", "--persist-to", dir],
    opts
  );
}

/**
 * Migrated + seeded local state, copied for every server. It is cached in the
 * temp directory under a hash of the migrations, the seed script and the
 * Worker config, so a run only rebuilds it when one of them changed.
 */
function template(): Promise<string> {
  if (templatePromise === null) {
    templatePromise = (async () => {
      const dir = join(tmpdir(), `pilih-e2e-api-template-${templateKey()}`);
      if (existsSync(join(dir, ".ready"))) {
        return dir;
      }
      const building = mkdtempSync(
        join(tmpdir(), "pilih-e2e-api-template-build-")
      );
      await buildTemplate(building);
      writeFileSync(join(building, ".ready"), new Date().toISOString());
      rmSync(dir, { recursive: true, force: true });
      try {
        renameSync(building, dir);
      } catch {
        // another run won the race: use its template
        rmSync(building, { recursive: true, force: true });
      }
      return dir;
    })();
  }
  return templatePromise;
}

function d1Files(persist: string): string[] {
  const dir = join(persist, "v3/d1/miniflare-D1DatabaseObject");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")
    .map((f) => join(dir, f));
}

function hasTable(file: string, table: string): boolean {
  const db = new Database(file);
  try {
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    return row !== null;
  } finally {
    db.close();
  }
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** The first link in the text part. */
  link: string;
  index: number;
}

const MAIL_BLOCK =
  /send_email binding called with MessageBuilder:\s*\nFrom: [^\n]*\nTo: ([^\n]+)\nSubject: ([^\n]*)\n[\s\S]*?Text: ([^\n]+\.txt)/g;
const LINK = /https?:\/\/[^\s<>"]+/;

export interface ApiOptions {
  /** D-33 flags written to `DB.feature_flags` before boot (merged over the defaults). */
  flags?: Record<string, FlagValue>;
  /** Extra vars (written to the env file, which wins over wrangler.jsonc). */
  vars?: Record<string, string>;
  /** Reuse a state directory (restart with other vars / flags). */
  persistDir?: string;
  port?: number;
  name?: string;
}

/** One `wrangler dev` instance of apps/api. */
export class ApiServer {
  readonly port: number;
  readonly origin: string;
  readonly persist: string;
  readonly name: string;
  private proc: Proc | null = null;
  private readonly consumedMail = new Set<number>();
  private readonly options: ApiOptions;

  private constructor(port: number, persist: string, options: ApiOptions) {
    this.port = port;
    this.origin = `http://localhost:${port}`;
    this.persist = persist;
    this.options = options;
    this.name = options.name ?? `api-${port}`;
  }

  static async start(options: ApiOptions = {}): Promise<ApiServer> {
    const port = options.port ?? (await freePort());
    let persist = options.persistDir;
    if (persist === undefined) {
      persist = scratchDir(`api-state-${port}-${Date.now().toString(36)}`);
      cpSync(await template(), persist, { recursive: true });
    }
    const server = new ApiServer(port, persist, options);
    server.writeFlags({ ...DEFAULT_FLAGS, ...options.flags });
    await server.boot(options.vars ?? {});
    return server;
  }

  /** Stop and boot again on the same port and state with other vars / flags. */
  async restart(
    options: Pick<ApiOptions, "flags" | "vars"> = {}
  ): Promise<void> {
    await this.stop();
    if (options.flags) {
      this.writeFlags(options.flags);
    }
    await this.boot({ ...this.options.vars, ...options.vars });
  }

  private writeFlags(flags: Record<string, FlagValue>): void {
    const file = this.dbFile("DB");
    const db = new Database(file);
    try {
      const now = Date.now();
      const stmt = db.prepare(
        "INSERT INTO feature_flags (key, value, updated_at, updated_by) VALUES (?, ?, ?, 'e2e') " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
      );
      for (const [key, value] of Object.entries(flags)) {
        stmt.run(key, String(value), now);
      }
    } finally {
      db.close();
    }
  }

  private async boot(vars: Record<string, string>): Promise<void> {
    const envFile = join(scratchDir("api-env"), `${this.name}.env`);
    const all: Record<string, string> = {
      ADMIN_EMAILS: "",
      EMAIL_FROM: "noreply@pilihpendidikan.com",
      LOG_RETENTION_DAYS: "90",
      JOBS_AI_MODE: "fake",
      OPENAI_API_KEY: "",
      JOBS_APP_ORIGIN: WEB_ORIGIN,
      ...vars,
    };
    writeFileSync(
      envFile,
      Object.entries(all)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n")
    );
    const inspector = await freePort();
    this.consumedMail.clear();
    this.proc = spawnProc(
      this.name,
      "bunx",
      [
        "wrangler",
        "dev",
        "--port",
        String(this.port),
        "--host",
        `localhost:${this.port}`,
        "--persist-to",
        this.persist,
        "--env-file",
        envFile,
        "--inspector-port",
        String(inspector),
        "--test-scheduled",
        "--show-interactive-dev-session=false",
      ],
      { cwd: API_DIR, logFile: logPath(this.name) }
    );
    const proc = this.proc;
    await poll(
      `${this.name} /health`,
      async () => {
        if (!proc.running) {
          throw new Error(`wrangler dev exited:\n${tail(proc.output)}`);
        }
        const res = await fetch(`${this.origin}/health`);
        return res.ok;
      },
      { timeoutMs: 120_000, intervalMs: 500 }
    );
  }

  async stop(): Promise<void> {
    if (this.proc) {
      await this.proc.stop(8000);
      this.proc = null;
    }
  }

  get log(): string {
    return this.proc?.output ?? "";
  }

  /** Path of the sqlite file behind a D1 binding. */
  dbFile(binding: "DB" | "JOBS_DB"): string {
    const marker = binding === "DB" ? "feature_flags" : "applications";
    const file = d1Files(this.persist).find((f) => hasTable(f, marker));
    if (!file) {
      throw new Error(`no local sqlite for ${binding} under ${this.persist}`);
    }
    return file;
  }

  /** Read-only SQL against the local D1 (the dev server keeps running). */
  query<T = Record<string, unknown>>(
    binding: "DB" | "JOBS_DB",
    sql: string,
    ...params: Array<string | number | null>
  ): T[] {
    const db = new Database(this.dbFile(binding));
    try {
      db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000;");
      return db.query(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  }

  /** R2 object keys stored by the local bucket. */
  r2Keys(): string[] {
    const dir = join(this.persist, "v3/r2/miniflare-R2BucketObject");
    if (!existsSync(dir)) {
      return [];
    }
    const keys: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".sqlite") || file === "metadata.sqlite") {
        continue;
      }
      const db = new Database(join(dir, file));
      try {
        db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000;");
        const rows = db.query("SELECT key FROM _mf_objects").all() as Array<{
          key: string;
        }>;
        keys.push(...rows.map((r) => r.key));
      } catch {
        // not an object table
      } finally {
        db.close();
      }
    }
    return keys;
  }

  /** Every e-mail the local EMAIL binding printed so far. */
  mails(): Mail[] {
    const out: Mail[] = [];
    let index = 0;
    for (const match of this.log.matchAll(MAIL_BLOCK)) {
      const [, to, subject, textPath] = match;
      let text = "";
      try {
        text = readFileSync(textPath.trim(), "utf8");
      } catch {
        text = "";
      }
      out.push({
        to: to.trim(),
        subject: subject.trim(),
        text,
        link: LINK.exec(text)?.[0] ?? "",
        index,
      });
      index += 1;
    }
    return out;
  }

  /** Waits for the next unread e-mail to `to`. */
  async waitForMail(to: string, timeoutMs = 30_000): Promise<Mail> {
    const mail = await poll(
      `an e-mail to ${to}`,
      () =>
        Promise.resolve(
          this.mails().find(
            (m) =>
              !this.consumedMail.has(m.index) && m.to.includes(to) && m.link
          ) ?? null
        ),
      { timeoutMs, intervalMs: 250 }
    );
    this.consumedMail.add(mail.index);
    return mail;
  }

  /** Runs the scheduled handler (`--test-scheduled`), e.g. the 5-minute lease reaper. */
  async runCron(cron: string): Promise<void> {
    const res = await fetch(
      `${this.origin}/__scheduled?cron=${encodeURIComponent(cron)}`
    );
    if (!res.ok) {
      throw new Error(`cron ${cron} → ${res.status} ${await res.text()}`);
    }
  }
}
