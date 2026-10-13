// `bun run analytics:rebuild --user <usr_id> [--execute]` — recompute one
// user's `analytics_daily` rows from the event log (10 §4), on the LOCAL
// JOBS_DB of `wrangler dev` (Miniflare's SQLite file). Dry run by default:
// prints the days it would write; `--execute` writes them with the same code
// the `rebuild_analytics` queue consumer runs (AI spend per day is kept).
//
//   bun scripts/analytics-rebuild.ts --user usr_… [--execute]
//     [--persist-to .wrangler/state] [--db path/to/jobs.sqlite] [--json]
//
// Never touches a remote database: `--remote` is refused. A production
// rebuild goes through the queue (`rebuild_analytics`), not this script.

import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isId } from "@pilihpendidikan/jobs-contracts/ids";
import { trustedScope } from "../src/jobs/core/scope";
import type { JobsDb } from "../src/jobs/repo/core/db";
import { jobsDb } from "../src/jobs/repo/core/db";
import {
  planRebuild,
  rebuildUserAnalytics,
} from "../src/jobs/services/analytics/rollup";

export interface Options {
  db: string | null;
  execute: boolean;
  json: boolean;
  persistTo: string;
  user: string;
}

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    db: null,
    execute: false,
    json: false,
    persistTo: ".wrangler/state",
    user: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--remote":
        throw new Error(
          "analytics:rebuild only touches the local JOBS_DB (never --remote)"
        );
      case "--execute":
        options.execute = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--user":
        options.user = argv[++i] ?? "";
        break;
      case "--persist-to":
        options.persistTo = argv[++i] ?? options.persistTo;
        break;
      case "--db":
        options.db = argv[++i] ?? null;
        break;
      default:
        throw new Error(`unknown argument "${arg}"`);
    }
  }
  if (!isId("usr", options.user)) {
    throw new Error("--user <usr_…> is required");
  }
  return options;
}

/** The local Miniflare SQLite file that holds the JOBS_DB tables. */
export function findLocalJobsDb(persistTo: string): string {
  const dir = resolve(persistTo, "v3", "d1", "miniflare-D1DatabaseObject");
  if (!existsSync(dir)) {
    throw new Error(
      `no local D1 state in ${dir}: run bun run db:migrate:jobs:local first`
    );
  }
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".sqlite")) {
      continue;
    }
    const path = join(dir, name);
    const probe = new Database(path, { readonly: true });
    try {
      const row = probe
        .query(
          "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'analytics_daily'"
        )
        .get();
      if (row) {
        return path;
      }
    } finally {
      probe.close();
    }
  }
  throw new Error(`no JOBS_DB (analytics_daily) found in ${dir}`);
}

type SqlValue = string | number | null;

class Statement {
  readonly params: SqlValue[];
  readonly sql: string;
  readonly #sqlite: Database;

  constructor(sqlite: Database, sql: string, params: SqlValue[] = []) {
    this.#sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.#sqlite,
      this.sql,
      values.map((value) => (value === undefined ? null : (value as SqlValue)))
    );
  }

  rows(): Record<string, unknown>[] {
    return this.#sqlite.query(this.sql).all(...this.params) as Record<
      string,
      unknown
    >[];
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve((this.rows()[0] as T | undefined) ?? null);
  }

  all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({ results: this.rows() as T[] });
  }

  run(): Promise<{ meta: { changes: number } }> {
    this.rows();
    return Promise.resolve({ meta: { changes: 0 } });
  }
}

/** A minimal D1 over bun:sqlite (prepare/bind/first/all/run/batch). */
export function sqliteJobsDb(sqlite: Database): JobsDb {
  const d1 = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => ({ results: s.rows() }));
        sqlite.exec("COMMIT");
        return Promise.resolve(results);
      } catch (err) {
        sqlite.exec("ROLLBACK");
        return Promise.reject(err);
      }
    },
  };
  return jobsDb({ JOBS_DB: d1 as unknown as D1Database });
}

export async function run(
  options: Options,
  log: (line: string) => void = console.log
): Promise<{ days: number; executed: boolean }> {
  const path = options.db ?? findLocalJobsDb(options.persistTo);
  const sqlite = new Database(path);
  try {
    const db = sqliteJobsDb(sqlite);
    const scope = trustedScope(options.user, "script");
    const now = Date.now();
    const plan = await planRebuild(db, scope, { now });
    const days = [...plan.metrics.keys()].sort();
    if (options.json) {
      log(
        JSON.stringify({
          user: options.user,
          zone: plan.zone,
          days: Object.fromEntries(days.map((d) => [d, plan.metrics.get(d)])),
        })
      );
    } else {
      log(
        `${options.execute ? "Rebuilding" : "Dry run:"} ${days.length} day(s) for ${options.user} in ${plan.zone} (${days[0] ?? "-"} … ${days.at(-1) ?? "-"})`
      );
    }
    if (!options.execute) {
      log("Nothing written. Pass --execute to write the rows.");
      return { days: days.length, executed: false };
    }
    await rebuildUserAnalytics(db, scope, { now, zone: plan.zone });
    log(`Wrote ${days.length} day(s).`);
    return { days: days.length, executed: true };
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}
