// `telemetry_daily` (04 §2.7, 22 §8.1): anonymous CLI counters, one row per
// (day, random install hash). No user id, device id or IP is ever stored;
// the table has no user column, so these statements carry no user predicate.

import type { JobsDb } from "../core/db";
import { decodeRow, encodeJson, queryFirst, stmt } from "../core/db";
import { runProfileBatch } from "../profile/facts";

export interface TelemetryDayRow {
  cli_version: string;
  counters: Record<string, unknown>;
  day: string;
  install_hash: string;
  platform: string;
}

/** The stored counters of one install for one day, or null. */
export async function loadTelemetryDay(
  db: JobsDb,
  day: string,
  installHash: string
): Promise<TelemetryDayRow | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    // sql-allow: anonymous — telemetry_daily has no user column (22 §8.1)
    "SELECT day, install_hash, cli_version, platform, counters FROM telemetry_daily WHERE day = ? AND install_hash = ?",
    day,
    installHash
  );
  return row ? decodeRow<TelemetryDayRow>("telemetry_daily", row) : null;
}

/** Inserts or replaces one install-day row (counters already merged). */
export async function upsertTelemetryDay(
  db: JobsDb,
  row: TelemetryDayRow
): Promise<void> {
  await runProfileBatch(db, [
    stmt(
      db,
      // sql-allow: anonymous — telemetry_daily has no user column (22 §8.1)
      "INSERT INTO telemetry_daily (day, install_hash, cli_version, platform, counters) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, install_hash) DO UPDATE SET cli_version = excluded.cli_version, platform = excluded.platform, counters = excluded.counters",
      row.day,
      row.install_hash,
      row.cli_version,
      row.platform,
      encodeJson(row.counters)
    ),
  ]);
}
