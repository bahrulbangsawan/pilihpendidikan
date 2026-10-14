// `cloud_state` (24 §2.4): small key/value pipeline state — the seed catalog
// hash, the last directory refresh, the monthly AI spend. System data.

import type { JobsDb } from "../core/db";
import { queryFirst, runBatch, stmt } from "../core/db";

export const STATE_KEYS = {
  seedHash: "seed_hash",
  directoryRefreshedAt: "directory_refreshed_at",
  /** `ai_spend:<YYYY-MM>` → micro-USD. */
  aiSpendPrefix: "ai_spend:",
} as const;

export async function getState(
  db: JobsDb,
  key: string
): Promise<string | null> {
  const row = await queryFirst<{ value: string }>(
    db,
    "SELECT value FROM cloud_state WHERE key = ?",
    key
  );
  return row?.value ?? null;
}

export function setStateStatement(
  db: JobsDb,
  key: string,
  value: string,
  now: number
): D1PreparedStatement {
  return stmt(
    db,
    "INSERT INTO cloud_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    key,
    value,
    now
  );
}

export async function setState(
  db: JobsDb,
  key: string,
  value: string,
  now: number
): Promise<void> {
  await runBatch(db, [setStateStatement(db, key, value, now)]);
}

/** Adds `delta` to an integer counter stored as text (AI spend). */
export function addToCounterStatement(
  db: JobsDb,
  key: string,
  delta: number,
  now: number
): D1PreparedStatement {
  return stmt(
    db,
    "INSERT INTO cloud_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(cloud_state.value AS INTEGER) + ? AS TEXT), updated_at = excluded.updated_at",
    key,
    String(Math.max(0, Math.round(delta))),
    now,
    Math.max(0, Math.round(delta))
  );
}
