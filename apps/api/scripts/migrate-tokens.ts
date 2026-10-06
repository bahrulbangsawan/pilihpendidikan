// Copies personal MCP tokens of non-admin users from the old backend's D1
// database into apps/api's `mcp_tokens`, so tokens people already pasted into
// the apps keep working against api.pilihpendidikan.com.
//
// Only active `personal` rows are copied. Rows belonging to an active
// `admin_grant` email (the old site owner) and any `--exclude <email>` are
// skipped. Tokens are stored as SHA-256 hashes on both sides; the plaintext
// never passes through this script. Copied rows get scope `write`.
//
// Dry run by default: reads and reports, writes nothing. `--execute` inserts
// with INSERT OR IGNORE (re-runnable) and then verifies every hash landed.
// Nothing is ever deleted from the source.
//
//   bun scripts/migrate-tokens.ts --source-db <old D1 id> --dest-db <new D1 id>
//   bun scripts/migrate-tokens.ts --source-db <id> --dest-db <id> --execute
//
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the environment.

import type { SqlStore } from "./cloudflare";
import { cloudflareD1, credentialsFromEnv, readArgs } from "./cloudflare";

export interface SourceTokenRow {
  id: string;
  user_email: string;
  token_hash: string;
  label: string | null;
  created_at: number;
  last_used_at: number | null;
}

export interface TokenMigrationOptions {
  source: SqlStore;
  dest: SqlStore;
  execute: boolean;
  excludeEmails?: string[];
  log?: (line: string) => void;
}

export interface TokenMigrationReport {
  mode: "dry-run" | "execute";
  candidates: number;
  skippedAdmins: number;
  users: number;
  alreadyPresent: number;
  inserted: number;
  verified: number;
  missing: string[];
}

const SOURCE_SQL = `SELECT id, user_email, token_hash, label, created_at, last_used_at
FROM mcp_tokens
WHERE kind = 'personal' AND status = 'active' AND revoked_at IS NULL
ORDER BY created_at`;

const ADMIN_SQL = "SELECT email FROM admin_grant WHERE revoked_at IS NULL";

const INSERT_SQL = `INSERT OR IGNORE INTO mcp_tokens
(id, user_email, token_hash, label, status, kind, scope, created_at, revoked_at, last_used_at, expires_at)
VALUES (?, ?, ?, ?, 'active', 'personal', 'write', ?, NULL, ?, NULL)`;

const EXISTS_SQL = "SELECT 1 AS one FROM mcp_tokens WHERE token_hash = ?";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export async function migrateTokens(
  options: TokenMigrationOptions
): Promise<TokenMigrationReport> {
  const log = options.log ?? (() => undefined);
  const admins = new Set(
    (await options.source.query<{ email: string }>(ADMIN_SQL)).map((r) =>
      normalize(r.email)
    )
  );
  for (const email of options.excludeEmails ?? []) {
    admins.add(normalize(email));
  }
  const all = await options.source.query<SourceTokenRow>(SOURCE_SQL);
  const rows = all.filter((row) => !admins.has(normalize(row.user_email)));
  const report: TokenMigrationReport = {
    mode: options.execute ? "execute" : "dry-run",
    candidates: rows.length,
    skippedAdmins: all.length - rows.length,
    users: new Set(rows.map((r) => normalize(r.user_email))).size,
    alreadyPresent: 0,
    inserted: 0,
    verified: 0,
    missing: [],
  };
  for (const row of rows) {
    const present = await options.dest.query(EXISTS_SQL, [row.token_hash]);
    if (present.length > 0) {
      report.alreadyPresent += 1;
    }
  }
  log(
    `${report.mode}: ${report.candidates} personal tokens for ${report.users} users (${report.skippedAdmins} admin tokens skipped, ${report.alreadyPresent} already in the destination)`
  );
  if (!options.execute) {
    log("Dry run: nothing was written. Re-run with --execute to copy.");
    return report;
  }
  for (const row of rows) {
    await options.dest.run(INSERT_SQL, [
      row.id,
      normalize(row.user_email),
      row.token_hash,
      row.label,
      row.created_at,
      row.last_used_at,
    ]);
  }
  report.inserted = rows.length - report.alreadyPresent;
  for (const row of rows) {
    const present = await options.dest.query(EXISTS_SQL, [row.token_hash]);
    if (present.length > 0) {
      report.verified += 1;
    } else {
      report.missing.push(row.id);
    }
  }
  log(
    `Inserted ${report.inserted}; verified ${report.verified}/${rows.length}. Source left untouched.`
  );
  return report;
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const sourceDb = args.value("--source-db");
  const destDb = args.value("--dest-db");
  if (!(sourceDb && destDb)) {
    throw new Error("Pass --source-db <old D1 id> and --dest-db <new D1 id>.");
  }
  const creds = credentialsFromEnv();
  const report = await migrateTokens({
    source: cloudflareD1(creds, sourceDb),
    dest: cloudflareD1(creds, destDb),
    execute: args.has("--execute"),
    excludeEmails: args.values("--exclude"),
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.missing.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
