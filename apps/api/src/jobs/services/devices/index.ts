// Devices (05 §3, 17 §6, 21 §1.1 / §3 / §10, D-10): registration bound to the
// login grant, the list with presence, rename / worker toggle, revocation and
// the device heartbeat. Credentials live in the identity database `DB`
// (repo/devices/identity.ts); lease effects, presence and poll signals in
// JOBS_DB (repo/devices/effects.ts).
//
// The `DeviceView` of the contract (row minus `grant_id` / `last_ip_hash`,
// plus `online` and `active`) gains three additive fields the dashboard
// needs (12 §7, 17 §7.2): `signed_in` (the bound grant is live),
// `signed_out_reason` (`oauth_grants.revoked_reason`, e.g. `refresh_reuse`
// → "Device signed out — suspicious token reuse") and `report` (the last
// device heartbeat: outbox depth, last sync, browser state).

import type { DeviceHeartbeatRequest } from "@pilihpendidikan/jobs-contracts/api";
import type {
  DeviceCapability,
  GrantRevokedReason,
} from "@pilihpendidikan/jobs-contracts/enums";
import { DEVICE_CAPABILITIES } from "@pilihpendidikan/jobs-contracts/enums";
import type { Env } from "../../../env";
import { DEVICE_ONLINE_WINDOW_MS } from "../../core/device";

/** Poll intervals of 21 §1.1 (the CLI adds ±20 % jitter, never < 2 s). */
export const POLL_INTERVAL_HOT_MS = 5000;
export const POLL_INTERVAL_IDLE_MS = 30_000;
export const POLL_INTERVAL_COLD_MS = 60_000;
/** A task created this recently (or a dashboard watching) → hot. */
export const POLL_HOT_WINDOW_MS = 300_000;
/** No claim for this long → cold. */
export const POLL_COLD_AFTER_MS = 3_600_000;

export interface PollInput {
  /** When the device registered (a new device is not "cold" yet). */
  deviceCreatedAt: number;
  lastClaimAt: number | null;
  now: number;
  recentTask: boolean;
  /** KV `jobs:watch:<user_id>` exists (the BFF refreshes it, 300 s TTL). */
  watching: boolean;
}

/** The server-guided poll interval (21 §1.1). */
export function pollIntervalMs(input: PollInput): number {
  if (input.recentTask || input.watching) {
    return POLL_INTERVAL_HOT_MS;
  }
  const lastActivity = Math.max(input.lastClaimAt ?? 0, input.deviceCreatedAt);
  if (input.now - lastActivity >= POLL_COLD_AFTER_MS) {
    return POLL_INTERVAL_COLD_MS;
  }
  return POLL_INTERVAL_IDLE_MS;
}

/** AUTH_KV key the BFF refreshes while an automation page is open (21 §1.1). */
export function watchKey(userId: string): string {
  return `jobs:watch:${userId}`;
}

// ---------------------------------------------------------------------------
// The device report (the last device heartbeat, kept in AUTH_KV)
// ---------------------------------------------------------------------------

/** What the dashboard shows from the last device heartbeat (12 §7). */
export interface DeviceReport {
  browser: DeviceHeartbeatRequest["browser"];
  cli_version: string;
  last_sync_at: number | null;
  local_state_summary: DeviceHeartbeatRequest["local_state_summary"];
  outbox_dead: number;
  outbox_depth: number;
  /** Since when `outbox_depth > 0` without interruption (Outbox warnings). */
  outbox_pending_since: number | null;
  reported_at: number;
}

const REPORT_TTL_SECONDS = 30 * 86_400;
/** Rewrite an unchanged report at most every 5 min (KV write cost). */
const REPORT_REFRESH_MS = 300_000;

export function reportKey(deviceId: string): string {
  return `jobs:device-report:${deviceId}`;
}

export async function readDeviceReport(
  env: Pick<Env, "AUTH_KV">,
  deviceId: string
): Promise<DeviceReport | null> {
  try {
    return await env.AUTH_KV.get<DeviceReport>(reportKey(deviceId), "json");
  } catch {
    return null;
  }
}

function sameReport(a: DeviceReport, b: DeviceReport): boolean {
  const strip = (r: DeviceReport) =>
    JSON.stringify({ ...r, reported_at: 0, outbox_pending_since: 0 });
  return strip(a) === strip(b);
}

/** Stores the heartbeat's report when it changed (or every 5 min). */
export async function storeDeviceReport(
  env: Pick<Env, "AUTH_KV">,
  deviceId: string,
  body: DeviceHeartbeatRequest,
  now: number
): Promise<DeviceReport> {
  const previous = await readDeviceReport(env, deviceId);
  let pendingSince: number | null = null;
  if (body.outbox_depth > 0) {
    pendingSince = previous?.outbox_pending_since ?? now;
  }
  const report: DeviceReport = {
    cli_version: body.cli_version,
    outbox_depth: body.outbox_depth,
    outbox_dead: body.outbox_dead ?? 0,
    outbox_pending_since: pendingSince,
    last_sync_at: body.last_sync_at ?? previous?.last_sync_at ?? null,
    browser: body.browser,
    local_state_summary: body.local_state_summary,
    reported_at: now,
  };
  const fresh =
    previous !== null &&
    sameReport(previous, report) &&
    now - previous.reported_at < REPORT_REFRESH_MS;
  if (!fresh) {
    await env.AUTH_KV.put(reportKey(deviceId), JSON.stringify(report), {
      expirationTtl: REPORT_TTL_SECONDS,
    });
  }
  return report;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface DeviceRowLike {
  accepts_tasks: number;
  arch: string;
  capabilities: string;
  cli_version: string;
  created_at: number;
  grant_revoked_at: number | null;
  grant_revoked_reason: GrantRevokedReason | null;
  id: string;
  last_seen_at: number | null;
  name: string;
  platform: "macos" | "windows" | "linux";
  public_key: string | null;
  revision: number;
  revoked_at: number | null;
  user_id: string;
}

export interface DeviceViewOut {
  accepts_tasks: boolean;
  active: boolean;
  arch: string;
  capabilities: DeviceCapability[];
  cli_version: string;
  created_at: number;
  id: string;
  last_seen_at: number | null;
  name: string;
  online: boolean;
  platform: "macos" | "windows" | "linux";
  public_key: string | null;
  report: DeviceReport | null;
  revision: number;
  revoked_at: number | null;
  signed_in: boolean;
  signed_out_reason: GrantRevokedReason | null;
  user_id: string;
}

const KNOWN_CAPABILITIES = new Set<string>(DEVICE_CAPABILITIES);

export function parseCapabilities(text: string): DeviceCapability[] {
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) {
      return [];
    }
    return [
      ...new Set(
        value.filter(
          (v): v is DeviceCapability =>
            typeof v === "string" && KNOWN_CAPABILITIES.has(v)
        )
      ),
    ];
  } catch {
    return [];
  }
}

/** The API view of a device row at `now`. */
export function toDeviceView(
  row: DeviceRowLike,
  presence: { active: ReadonlySet<string>; now: number },
  report: DeviceReport | null
): DeviceViewOut {
  const live = row.revoked_at === null;
  const signedIn = live && row.grant_revoked_at === null;
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    platform: row.platform,
    arch: row.arch,
    cli_version: row.cli_version,
    public_key: row.public_key,
    capabilities: parseCapabilities(row.capabilities),
    accepts_tasks: row.accepts_tasks === 1,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    revoked_at: row.revoked_at,
    revision: row.revision,
    online:
      live &&
      row.last_seen_at !== null &&
      presence.now - row.last_seen_at <= DEVICE_ONLINE_WINDOW_MS,
    active: live && presence.active.has(row.id),
    signed_in: signedIn,
    signed_out_reason: signedIn
      ? null
      : (row.grant_revoked_reason ?? (live ? null : "device_revoked")),
    report,
  };
}

/** Capabilities as stored (deduplicated, known names, stable order). */
export function normalizeCapabilities(
  capabilities: readonly DeviceCapability[]
): DeviceCapability[] {
  const set = new Set(capabilities);
  return DEVICE_CAPABILITIES.filter((c) => set.has(c));
}

/** True when the heartbeat changes what the device row stores. */
export function selfReportChanged(
  device: { capabilities: readonly string[]; cli_version: string },
  body: Pick<DeviceHeartbeatRequest, "capabilities" | "cli_version">
): boolean {
  if (device.cli_version !== body.cli_version) {
    return true;
  }
  if (!body.capabilities) {
    return false;
  }
  const next = normalizeCapabilities(body.capabilities);
  const current = normalizeCapabilities(
    device.capabilities.filter((c): c is DeviceCapability =>
      KNOWN_CAPABILITIES.has(c)
    )
  );
  return next.join(",") !== current.join(",");
}
