// The calling device (identity database `DB`, 04 §1, 17 §6, 21 §3).
//
// A CLI access token is bound to a `devices` row (`mcp_tokens.device_id`).
// The router loads that row on every request made with such a token:
//   - a missing, revoked or foreign device answers `401 invalid_token`
//     (`reason: revoked_token`, 05 §1.3) — revoking a device revokes its
//     tokens, this is the defence in depth;
//   - `device: true` routes require a device-bound token (`403
//     device_required`, 17 §6 step 5);
//   - presence is written at most once per 5 minutes (04 §1 decision): a
//     non-matching UPDATE writes 0 rows, so the cost is one indexed read.
// "Online" = `last_seen_at` ≤ 6 min old; "active" = holds a lease whose
// attempt heartbeat is ≤ 90 s old (computed at read time by leaf-2.2).

function parseCapabilities(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export const PRESENCE_WRITE_INTERVAL_MS = 300_000;
export const DEVICE_ONLINE_WINDOW_MS = 360_000;
export const DEVICE_ACTIVE_HEARTBEAT_MS = 90_000;

export interface CallerDevice {
  accepts_tasks: boolean;
  arch: string;
  capabilities: string[];
  cli_version: string;
  id: string;
  last_seen_at: number | null;
  name: string;
  platform: string;
  revoked_at: number | null;
  user_id: string;
}

interface DeviceRow
  extends Omit<CallerDevice, "accepts_tasks" | "capabilities"> {
  accepts_tasks: number;
  capabilities: string;
}

/** The device row of a token, or null when it does not exist. */
export async function loadDevice(
  db: D1Database,
  deviceId: string
): Promise<CallerDevice | null> {
  const row = await db
    .prepare(
      "SELECT id, user_id, name, platform, arch, cli_version, capabilities, accepts_tasks, last_seen_at, revoked_at FROM devices WHERE id = ? LIMIT 1"
    )
    .bind(deviceId)
    .first<DeviceRow>();
  if (!row) {
    return null;
  }
  return {
    ...row,
    accepts_tasks: row.accepts_tasks === 1,
    capabilities: parseCapabilities(row.capabilities),
  };
}

/** First 16 hex of SHA-256(ip) — never a raw IP (04 §1). */
export async function ipHash(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ip)
  );
  let hex = "";
  for (const byte of new Uint8Array(digest).slice(0, 8)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Throttled presence write (04 §1): ≤ 1 row write per device per 5 min. */
export async function touchDevicePresence(
  db: D1Database,
  input: { deviceId: string; ip: string | null; now: number; userId: string }
): Promise<boolean> {
  const hash = input.ip ? await ipHash(input.ip) : null;
  const result = await db
    .prepare(
      "UPDATE devices SET last_seen_at = ?1, last_ip_hash = COALESCE(?2, last_ip_hash) WHERE id = ?3 AND user_id = ?4 AND revoked_at IS NULL AND (last_seen_at IS NULL OR last_seen_at < ?1 - ?5)"
    )
    .bind(
      input.now,
      hash,
      input.deviceId,
      input.userId,
      PRESENCE_WRITE_INTERVAL_MS
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
