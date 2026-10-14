// Seed catalog sync (24 §7.1): `cloud-sources.json` → `cloud_sources`.
//
//   - a new slug is inserted with every audited value (origin `directory` or
//     `default`);
//   - an existing slug gets the seed's descriptive and strategy fields EXCEPT
//     the ones in its `user_modified` list (operator edits always win);
//   - operational state (`enabled`, `health`, `status_reason`, schedule,
//     stats, cursor) is never touched on an existing row, so a source an
//     operator disabled stays disabled and nothing is re-enabled or
//     duplicated by a later deploy or refresh.
//
// The sync runs when the file's hash differs from `cloud_state.seed_hash`
// (memoized per isolate), from the catalog routes and the hourly dispatch.

import type { CloudSourceSeed } from "@pilihpendidikan/jobs-contracts/cloud";
import { CLOUD_SOURCES_FILE } from "@pilihpendidikan/jobs-contracts/cloud-sources";
import { contentHash } from "@pilihpendidikan/jobs-contracts/fingerprint";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { CloudSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { JobsDb } from "../../repo/core/db";
import { runCloudBatch } from "../../repo/cloud/postings";
import {
  insertCloudSourceStatement,
  listCloudSources,
  systemUpdateStatement,
} from "../../repo/cloud/sources";
import {
  getState,
  STATE_KEYS,
  setStateStatement,
} from "../../repo/cloud/state";

/** Seed fields an existing row follows unless an operator edited them. */
export const SEED_MANAGED_FIELDS = [
  "name",
  "homepage_url",
  "listing_url",
  "canonical_domain",
  "category",
  "directory_ref",
  "description",
  "strategy",
  "strategy_config",
  "priority",
  "interval_minutes",
  "rate_limit",
  "auth_required",
  "auth_note",
  "terms_url",
  "terms_note",
  "allow_browser",
] as const satisfies readonly (keyof CloudSourceRecord &
  keyof CloudSourceSeed)[];

/** A full catalog row from a seed entry (new sources only). */
export function recordFromSeed(
  seed: CloudSourceSeed,
  now: number,
  id: string = newId("csr", now)
): CloudSourceRecord {
  return {
    id,
    slug: seed.slug,
    name: seed.name,
    homepage_url: seed.homepage_url,
    listing_url: seed.listing_url,
    canonical_domain: seed.canonical_domain,
    category: seed.category,
    origin: seed.from_directory ? "directory" : "default",
    directory_ref: seed.directory_ref,
    description: seed.description,
    strategy: seed.strategy,
    strategy_config: seed.strategy_config,
    health: seed.health,
    status_reason: seed.status_reason,
    enabled: seed.enabled,
    priority: seed.priority,
    interval_minutes: seed.interval_minutes,
    rate_limit: seed.rate_limit,
    auth_required: seed.auth_required,
    auth_note: seed.auth_note,
    terms_url: seed.terms_url,
    terms_note: seed.terms_note,
    ai_enabled: false,
    allow_browser: seed.allow_browser,
    next_run_at: null,
    lease_id: null,
    lease_expires_at: null,
    last_run_id: null,
    last_run_status: null,
    last_run_at: null,
    last_success_at: null,
    last_error_class: null,
    last_error_message: null,
    consecutive_failures: 0,
    circuit_open_until: null,
    cursor_state: {},
    stats: {},
    user_modified: [],
    revision: 1,
    created_at: now,
    updated_at: now,
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The seed-managed changes for an existing row (operator edits kept). */
export function seedPatch(
  existing: CloudSourceRecord,
  seed: CloudSourceSeed
): Partial<CloudSourceRecord> {
  const locked = new Set(existing.user_modified);
  const patch: Record<string, unknown> = {};
  for (const field of SEED_MANAGED_FIELDS) {
    if (locked.has(field)) {
      continue;
    }
    const value = seed[field];
    if (!same(existing[field], value)) {
      patch[field] = value;
    }
  }
  return patch as Partial<CloudSourceRecord>;
}

// Keyed by the JOBS_DB binding object, so every test env (and isolate) has
// its own memo.
const syncedHash = new WeakMap<object, string>();

export async function seedHash(): Promise<string> {
  return await contentHash(
    "cloud-sources",
    JSON.stringify(CLOUD_SOURCES_FILE.sources)
  );
}

export interface SeedSyncReport {
  inserted: number;
  skipped: boolean;
  updated: number;
}

/** Syncs the seed catalog when it changed since the last sync. */
export async function ensureCatalogSeeded(
  db: JobsDb,
  now: number,
  options: { force?: boolean } = {}
): Promise<SeedSyncReport> {
  const hash = await seedHash();
  if (!options.force && syncedHash.get(db) === hash) {
    return { inserted: 0, updated: 0, skipped: true };
  }
  if (!options.force && (await getState(db, STATE_KEYS.seedHash)) === hash) {
    syncedHash.set(db, hash);
    return { inserted: 0, updated: 0, skipped: true };
  }
  const existing = new Map(
    (await listCloudSources(db)).map((source) => [source.slug, source])
  );
  const statements: D1PreparedStatement[] = [];
  let inserted = 0;
  let updated = 0;
  for (const seed of CLOUD_SOURCES_FILE.sources) {
    const row = existing.get(seed.slug);
    if (!row) {
      statements.push(
        insertCloudSourceStatement(db, recordFromSeed(seed, now))
      );
      inserted += 1;
      continue;
    }
    const patch = seedPatch(row, seed);
    if (Object.keys(patch).length > 0) {
      statements.push(systemUpdateStatement(db, row.id, patch, now));
      updated += 1;
    }
  }
  statements.push(setStateStatement(db, STATE_KEYS.seedHash, hash, now));
  // INSERT … ON slug: a concurrent sync inserting the same slug aborts this
  // batch with a UNIQUE violation; the other sync already did the work.
  try {
    await runCloudBatch(db, statements);
  } catch (err) {
    if (err instanceof Error && err.name === "UniqueViolationError") {
      return { inserted: 0, updated: 0, skipped: true };
    }
    throw err;
  }
  syncedHash.set(db, hash);
  return { inserted, updated, skipped: false };
}
