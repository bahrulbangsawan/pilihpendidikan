// Copies the CV documents out of the old shared auth namespace into the new
// CV_KV namespace of apps/api:
//
//   cv:{id}        the CV document (with its list metadata)
//   owner:cv:{id}  the owner stamp
//
// Dry run by default: it lists and reads, reports what it would copy, and
// writes nothing. Only `--execute` writes, and it then re-reads every copied
// key from the destination to verify it. KV reads are eventually consistent
// (a miss from the pre-write conflict check can be served for ~60s), so the
// verify step re-reads for up to ~90s before calling a key a mismatch. The source is never modified or
// deleted — removing the old keys is a separate, later decision.
//
//   bun scripts/migrate-cv-kv.ts --dest <CV_KV namespace id>
//   bun scripts/migrate-cv-kv.ts --dest <id> --execute
//
// Options: --source <namespace id> (default: the old shared auth namespace);
// --overwrite lets a final re-sync replace destination keys whose value
// differs (without it, such keys abort the run).
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the environment.

import type { KvKey, KvStore } from "./cloudflare";
import { cloudflareKv, credentialsFromEnv, readArgs } from "./cloudflare";

// The namespace that held sessions and CVs together in the old backend.
export const DEFAULT_SOURCE_NAMESPACE = "8c6838adcba24aa2829579b1750572e7";
export const CV_PREFIXES = ["cv:", "owner:cv:"] as const;

export interface CvMigrationOptions {
  source: KvStore;
  dest: KvStore;
  execute: boolean;
  // Replace destination keys whose value differs from the source.
  overwrite?: boolean;
  log?: (line: string) => void;
  // Read passes over the copied keys before a lagging one counts as a
  // mismatch, and the pause between passes (injectable for tests).
  verifyAttempts?: number;
  verifyIntervalMs?: number;
  wait?: (ms: number) => Promise<void>;
}

const DEFAULT_VERIFY_ATTEMPTS = 10;
const DEFAULT_VERIFY_INTERVAL_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CvMigrationReport {
  mode: "dry-run" | "execute";
  documents: number;
  ownerStamps: number;
  // Documents with no owner stamp: copied, but only admins can reach them.
  unowned: string[];
  // Keys the destination already holds with a different value.
  conflicts: string[];
  copied: number;
  verified: number;
  mismatches: string[];
}

function idOf(key: string): string {
  return key.startsWith("owner:cv:")
    ? key.slice("owner:cv:".length)
    : key.slice("cv:".length);
}

async function readAll(
  store: KvStore,
  keys: KvKey[]
): Promise<Array<{ key: KvKey; value: string }>> {
  const out: Array<{ key: KvKey; value: string }> = [];
  for (const key of keys) {
    const value = await store.get(key.name);
    if (value !== null) {
      out.push({ key, value });
    }
  }
  return out;
}

// Re-reads every copied key until it matches the source or the attempts run
// out; returns the keys that never became readable with the right value.
async function verifyCopies(
  options: CvMigrationOptions,
  entries: Array<{ key: KvKey; value: string }>,
  log: (line: string) => void
): Promise<string[]> {
  const attempts = options.verifyAttempts ?? DEFAULT_VERIFY_ATTEMPTS;
  const interval = options.verifyIntervalMs ?? DEFAULT_VERIFY_INTERVAL_MS;
  const wait = options.wait ?? sleep;
  let pending = entries;
  for (let attempt = 1; attempt <= attempts && pending.length > 0; attempt++) {
    if (attempt > 1) {
      log(`Waiting for ${pending.length} keys to become readable…`);
      await wait(interval);
    }
    const lagging: typeof entries = [];
    for (const entry of pending) {
      if ((await options.dest.get(entry.key.name)) !== entry.value) {
        lagging.push(entry);
      }
    }
    pending = lagging;
  }
  return pending.map((entry) => entry.key.name);
}

export async function migrateCvKv(
  options: CvMigrationOptions
): Promise<CvMigrationReport> {
  const log = options.log ?? (() => undefined);
  const keys: KvKey[] = [];
  for (const prefix of CV_PREFIXES) {
    keys.push(...(await options.source.listKeys(prefix)));
  }
  const entries = await readAll(options.source, keys);
  const docs = entries.filter((e) => e.key.name.startsWith("cv:"));
  const stamps = entries.filter((e) => e.key.name.startsWith("owner:cv:"));
  const stamped = new Set(stamps.map((e) => idOf(e.key.name)));
  const report: CvMigrationReport = {
    mode: options.execute ? "execute" : "dry-run",
    documents: docs.length,
    ownerStamps: stamps.length,
    unowned: docs.map((e) => idOf(e.key.name)).filter((id) => !stamped.has(id)),
    conflicts: [],
    copied: 0,
    verified: 0,
    mismatches: [],
  };
  for (const entry of entries) {
    const existing = await options.dest.get(entry.key.name);
    if (existing !== null && existing !== entry.value) {
      report.conflicts.push(entry.key.name);
    }
  }
  log(
    `${report.mode}: ${docs.length} CV documents, ${stamps.length} owner stamps, ${report.unowned.length} without owner, ${report.conflicts.length} conflicting keys in the destination`
  );
  if (!options.execute) {
    log("Dry run: nothing was written. Re-run with --execute to copy.");
    return report;
  }
  if (report.conflicts.length > 0 && !options.overwrite) {
    throw new Error(
      `Refusing to overwrite ${report.conflicts.length} destination keys that differ: ${report.conflicts.slice(0, 5).join(", ")}`
    );
  }
  await options.dest.putMany(
    entries.map((e) => ({
      key: e.key.name,
      value: e.value,
      metadata: e.key.metadata,
    }))
  );
  report.copied = entries.length;
  const lagging = await verifyCopies(options, entries, log);
  report.verified = entries.length - lagging.length;
  report.mismatches = lagging;
  log(
    `Copied ${report.copied} keys; verified ${report.verified}; ${report.mismatches.length} mismatches. Source left untouched.`
  );
  return report;
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const destId = args.value("--dest");
  if (!destId) {
    throw new Error("Pass --dest <CV_KV namespace id>.");
  }
  const creds = credentialsFromEnv();
  const report = await migrateCvKv({
    source: cloudflareKv(
      creds,
      args.value("--source") ?? DEFAULT_SOURCE_NAMESPACE
    ),
    dest: cloudflareKv(creds, destId),
    execute: args.has("--execute"),
    overwrite: args.has("--overwrite"),
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.mismatches.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
