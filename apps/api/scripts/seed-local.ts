// `bun run db:seed:local` — turns the Job Tracker on in the LOCAL D1 used by
// `wrangler dev` (D-33: flags live in DB.feature_flags, never in vars).
//
//   bun scripts/seed-local.ts                         # default local state
//   bun scripts/seed-local.ts --persist-to .tmp/state # a custom state dir
//   bun scripts/seed-local.ts --flag JOBS_AUTO_MODE_ENABLED=true
//   bun scripts/seed-local.ts --dry-run               # print the SQL only
//
// Run `bun run db:migrate:local && bun run db:migrate:jobs:local` first.
// This script only ever passes `--local`; it refuses `--remote`.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { FeatureFlagKey } from "@pilihpendidikan/jobs-contracts/enums";
import { FEATURE_FLAG_KEYS } from "@pilihpendidikan/jobs-contracts/enums";

// Local development defaults: the v1 API, CLI login and automation on;
// auto mode and server-sent email stay off (A-03, D-35), AI stays on (the
// local AI provider is the fake unless JOBS_AI_MODE=live in .dev.vars).
export const LOCAL_FLAGS: Readonly<
  Partial<Record<FeatureFlagKey, boolean | "kv" | "d1">>
> = {
  JOBS_V1_ENABLED: true,
  JOBS_CLI_LOGIN_ENABLED: true,
  JOBS_AUTOMATION_ENABLED: true,
  JOBS_AUTO_MODE_ENABLED: false,
  JOBS_EMAIL_SERVER_SEND_ENABLED: false,
  AI_DISABLED: false,
  JOBS_LEGACY_BACKEND: "kv",
};

interface Options {
  dryRun: boolean;
  flags: Partial<Record<FeatureFlagKey, boolean | "kv" | "d1">>;
  persistTo: string | null;
}

function parseValue(key: FeatureFlagKey, raw: string): boolean | "kv" | "d1" {
  if (key === "JOBS_LEGACY_BACKEND") {
    if (raw === "kv" || raw === "d1") {
      return raw;
    }
    throw new Error("JOBS_LEGACY_BACKEND must be kv or d1");
  }
  if (raw === "true" || raw === "false") {
    return raw === "true";
  }
  throw new Error(`${key} must be true or false`);
}

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    dryRun: false,
    flags: { ...LOCAL_FLAGS },
    persistTo: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--remote") {
      throw new Error("seed-local only writes the local D1 (never --remote)");
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--persist-to") {
      options.persistTo = argv[++i] ?? null;
    } else if (arg === "--flag") {
      const [key, value] = (argv[++i] ?? "").split("=");
      if (!(FEATURE_FLAG_KEYS as readonly string[]).includes(key)) {
        throw new Error(`unknown flag "${key}"`);
      }
      options.flags[key as FeatureFlagKey] = parseValue(
        key as FeatureFlagKey,
        value ?? ""
      );
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return options;
}

/** The SQL that upserts the flags (values are JSON scalars). */
export function seedSql(flags: Options["flags"], now: number): string {
  return Object.entries(flags)
    .map(
      ([key, value]) =>
        `INSERT INTO feature_flags (key, value, updated_at, updated_by) VALUES ('${key}', '${JSON.stringify(value)}', ${now}, 'db:seed:local') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;`
    )
    .join(" ");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const sql = seedSql(options.flags, Date.now());
  if (options.dryRun) {
    console.log(sql);
    return;
  }
  const args = ["wrangler", "d1", "execute", "DB", "--local", "--command", sql];
  if (options.persistTo) {
    args.push("--persist-to", options.persistTo);
  }
  const result = spawnSync("bunx", args, {
    cwd: join(import.meta.dir, ".."),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log(
    `Seeded local feature flags: ${Object.entries(options.flags)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ")}`
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}
