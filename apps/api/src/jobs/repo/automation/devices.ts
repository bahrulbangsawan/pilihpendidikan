// Device reads for task policy (21 §3, §4). Devices live in the identity
// database `DB` (04 §1, owned by leaf-2.2); automation only reads them:
//
//   - task creation needs "at least one eligible device" (or the target
//     device) unless `queue_without_device` (21 §4);
//   - task detail shows the name of the device holding / targeted by a task.
//
// Every statement carries the `user_id` predicate (a device id of another
// user is "not found").

import type { UserScope } from "../../core/scope";
import { placeholders } from "./records";

export interface DeviceSummary {
  accepts_tasks: boolean;
  capabilities: string[];
  cli_version: string;
  id: string;
  last_seen_at: number | null;
  name: string;
  revoked_at: number | null;
}

interface DeviceRow {
  accepts_tasks: number;
  capabilities: string;
  cli_version: string;
  id: string;
  last_seen_at: number | null;
  name: string;
  revoked_at: number | null;
}

function capabilitiesOf(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function toSummary(row: DeviceRow): DeviceSummary {
  return {
    id: row.id,
    name: row.name,
    cli_version: row.cli_version,
    capabilities: capabilitiesOf(row.capabilities),
    accepts_tasks: row.accepts_tasks === 1,
    last_seen_at: row.last_seen_at,
    revoked_at: row.revoked_at,
  };
}

const DEVICE_COLUMNS =
  "id, name, cli_version, capabilities, accepts_tasks, last_seen_at, revoked_at";

/** The user's devices that are not revoked. */
export async function listActiveDevices(
  identityDb: D1Database,
  scope: UserScope
): Promise<DeviceSummary[]> {
  const result = await identityDb
    .prepare(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at`
    )
    .bind(scope.userId)
    .all<DeviceRow>();
  return (result.results ?? []).map(toSummary);
}

/** One of the user's devices (revoked ones included), or null. */
export async function loadUserDevice(
  identityDb: D1Database,
  scope: UserScope,
  deviceId: string
): Promise<DeviceSummary | null> {
  const row = await identityDb
    .prepare(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = ? AND user_id = ? LIMIT 1`
    )
    .bind(deviceId, scope.userId)
    .first<DeviceRow>();
  return row ? toSummary(row) : null;
}

/** Display names of some of the user's devices (id → name). */
export async function deviceNames(
  identityDb: D1Database,
  scope: UserScope,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].slice(0, 50);
  if (unique.length === 0) {
    return new Map();
  }
  const result = await identityDb
    .prepare(
      `SELECT id, name FROM devices WHERE user_id = ? AND id IN (${placeholders(unique.length)})`
    )
    .bind(scope.userId, ...unique)
    .all<{ id: string; name: string }>();
  return new Map((result.results ?? []).map((row) => [row.id, row.name]));
}
