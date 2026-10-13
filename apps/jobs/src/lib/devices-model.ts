// The CLI & devices screen's rules (12 §7, 17 §7.2, 21 §10, 22 §12) as pure
// functions: the extras apps/api adds to a device view, the status shown in
// the table, version badges against `GET /api/v1/meta`, outbox warnings,
// what revoking a device does to its live work, retryable failures, and the
// visitor's operating system for the install tabs.

import type {
  DeviceView,
  GetMetaResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type { DevicePlatform } from "@pilihpendidikan/jobs-contracts/enums";
import { TASK_ERROR_RETRY } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  AutomationTaskRecord,
  DiscoveryRunRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { PollPolicy } from "./polling";
import { POLL_POLICIES } from "./polling";
import { isOlderThan } from "./semver";

/** Outbox depth this old (or any dead letter) is a warning (12 §7). */
export const OUTBOX_WARNING_MS = 3_600_000;
/** A device created this recently counts as "just connected" (22 §12). */
export const JUST_CONNECTED_MS = 300_000;
/** After copying the login command, poll every 3 s for this long. */
export const CONNECT_WATCH_MS = 120_000;

/** `report` of a device view: its last heartbeat (05 §3, 12 §7). */
export type DeviceReport = NonNullable<DeviceView["report"]>;

/** The dashboard fields of a device view; absent on old API answers. */
export interface DeviceExtras {
  report: DeviceReport | null;
  signedIn: boolean;
  signedOutReason: string | null;
}

/**
 * `signed_in`, `signed_out_reason` and `report` with their defaults: a
 * device the API says nothing about is signed in and has no report yet.
 */
export function deviceExtras(device: DeviceView): DeviceExtras {
  return {
    signedIn: device.signed_in !== false,
    signedOutReason: device.signed_out_reason ?? null,
    report: device.report ?? null,
  };
}

export type DeviceStatus =
  | { kind: "signed_out"; reason: string | null }
  | { kind: "active" }
  | { kind: "online"; lastSeenAt: number | null }
  | { kind: "offline"; lastSeenAt: number | null };

/**
 * 12 §7: `active` (holds a lease with a fresh heartbeat), `online` (seen in
 * the last 6 min), else offline since `last_seen_at`. A revoked device or a
 * revoked login grant reads as signed out, with the grant's reason.
 */
export function deviceStatus(
  device: DeviceView,
  extras: DeviceExtras = deviceExtras(device)
): DeviceStatus {
  if (device.revoked_at !== null) {
    return {
      kind: "signed_out",
      reason: extras.signedOutReason ?? "device_revoked",
    };
  }
  if (!extras.signedIn) {
    return { kind: "signed_out", reason: extras.signedOutReason };
  }
  if (device.active) {
    return { kind: "active" };
  }
  if (device.online) {
    return { kind: "online", lastSeenAt: device.last_seen_at };
  }
  return { kind: "offline", lastSeenAt: device.last_seen_at };
}

export type VersionStatus = "current" | "update" | "too_old" | "unknown";

/** The device's CLI version: the latest heartbeat's, else registration's. */
export function deviceVersion(
  device: DeviceView,
  extras: DeviceExtras = deviceExtras(device)
): string {
  return extras.report?.cli_version ?? device.cli_version;
}

/** ⚠ below the recommended version; destructive below the minimum (12 §7). */
export function versionStatus(
  version: string,
  meta: Pick<
    GetMetaResponse,
    "min_cli_version" | "recommended_cli_version"
  > | null
): VersionStatus {
  if (!meta) {
    return "unknown";
  }
  if (isOlderThan(version, meta.min_cli_version)) {
    return "too_old";
  }
  if (isOlderThan(version, meta.recommended_cli_version)) {
    return "update";
  }
  return "current";
}

export interface OutboxWarning {
  /** Changes that could not sync: pending (stuck > 1 h) plus dead letters. */
  changes: number;
  dead: number;
  pendingSince: number | null;
}

/** 12 §7: `outbox_depth > 0` for more than 1 h, or any dead-lettered item. */
export function outboxWarning(
  extras: DeviceExtras,
  nowMs: number
): OutboxWarning | null {
  const report = extras.report;
  if (!report) {
    return null;
  }
  const stuck =
    report.outbox_depth > 0 &&
    report.outbox_pending_since !== null &&
    nowMs - report.outbox_pending_since > OUTBOX_WARNING_MS;
  if (!stuck && report.outbox_dead === 0) {
    return null;
  }
  return {
    changes: (stuck ? report.outbox_depth : 0) + report.outbox_dead,
    dead: report.outbox_dead,
    pendingSince: stuck ? report.outbox_pending_since : null,
  };
}

/** Task states that hold (or are about to hold) a device's attention. */
export const LIVE_TASK_STATES: ReadonlySet<string> = new Set([
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
]);

/** The device's live tasks: the lease it holds now. */
export function liveTasksOf(
  deviceId: string,
  tasks: readonly AutomationTaskRecord[]
): AutomationTaskRecord[] {
  return tasks.filter(
    (task) =>
      LIVE_TASK_STATES.has(task.state) && task.lease_device_id === deviceId
  );
}

/** Running discovery runs of the device. */
export function runningRunsOf(
  deviceId: string,
  runs: readonly DiscoveryRunRecord[]
): DiscoveryRunRecord[] {
  return runs.filter(
    (run) => run.device_id === deviceId && run.status === "running"
  );
}

export interface RevokeConsequences {
  /** Queued tasks pinned to this device: cancelled. */
  pinned: number;
  /** Live leases on this device: stopped (released or marked for review). */
  running: number;
  /** Of those, past submit_intent: become outcome_unknown (21 §10). */
  submitting: number;
}

/** What `POST /devices/{id}/revoke` does to the device's work (21 §10). */
export function revokeConsequences(
  deviceId: string,
  tasks: readonly AutomationTaskRecord[]
): RevokeConsequences {
  const live = liveTasksOf(deviceId, tasks);
  return {
    running: live.length,
    submitting: live.filter((task) => task.submit_intent_at !== null).length,
    pinned: tasks.filter(
      (task) => task.state === "queued" && task.target_device_id === deviceId
    ).length,
  };
}

/**
 * A `failed` task worth a manual retry: its error class retries ("yes" /
 * "once", 21 §8) and nobody retried it yet. Unknown classes are not offered.
 */
export function isRetryableFailure(
  task: AutomationTaskRecord,
  tasks: readonly AutomationTaskRecord[]
): boolean {
  if (task.state !== "failed" || task.error_class === null) {
    return false;
  }
  const policy = (TASK_ERROR_RETRY as Readonly<Record<string, string>>)[
    task.error_class
  ];
  if (policy !== "yes" && policy !== "once") {
    return false;
  }
  return !tasks.some((other) => other.retry_of === task.id);
}

/** Discovery runs worth re-running: failed or partial with a known source. */
export function isRetryableRun(run: DiscoveryRunRecord): boolean {
  return (
    (run.status === "failed" || run.status === "partial") &&
    runSourceIds(run).length > 0
  );
}

export function runSourceIds(run: DiscoveryRunRecord): string[] {
  return [
    ...new Set(
      run.sources
        .map((source) => source.source_id)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
}

/**
 * The device that appeared most recently, when it connected in the last
 * 5 minutes ("Connected · MacBook · just now", 22 §12 step 4).
 */
export function justConnected(
  devices: readonly DeviceView[],
  nowMs: number
): DeviceView | null {
  const recent = devices
    .filter(
      (device) =>
        device.revoked_at === null &&
        nowMs - device.created_at <= JUST_CONNECTED_MS
    )
    .sort((a, b) => b.created_at - a.created_at);
  return recent[0] ?? null;
}

const WINDOWS_RE = /windows|win32|win64|wow64/i;
const MAC_RE = /mac|iphone|ipad|ipod/i;

/** The visitor's OS for the install tabs (defaults to Linux). */
export function detectPlatform(
  userAgent: string,
  platform = ""
): DevicePlatform {
  const text = `${platform} ${userAgent}`;
  if (WINDOWS_RE.test(text)) {
    return "windows";
  }
  if (MAC_RE.test(text)) {
    return "macos";
  }
  return "linux";
}

/**
 * A device that signed in within the connect watch but has not called the
 * api yet (`last_seen_at` null): its row is there, "Online" is still to come.
 */
export function awaitingFirstContact(
  devices: readonly DeviceView[],
  nowMs: number
): boolean {
  return devices.some(
    (device) =>
      device.revoked_at === null &&
      device.last_seen_at === null &&
      nowMs - device.created_at <= CONNECT_WATCH_MS
  );
}

/**
 * The devices poll on /cli (12 §10, 22 §12): every 3 s while no device is
 * connected yet, while a just-created device has not been seen online yet
 * (the row appears at `pilih-jobs login`, "Online" with its first call), or
 * for 2 minutes after the login command was copied; otherwise every 10 s.
 */
export function devicesPollPolicy(input: {
  /** Devices are loaded and none is connected. */
  empty: boolean;
  /** A new device is waiting for its first api call (`awaitingFirstContact`). */
  connecting?: boolean;
  nowMs: number;
  /** Until when to watch for a new device (copying `pilih-jobs login`). */
  watchUntil: number;
}): PollPolicy {
  return input.empty ||
    input.connecting === true ||
    input.nowMs < input.watchUntil
    ? POLL_POLICIES.devicesConnecting
    : POLL_POLICIES.devices;
}
