// Devices in the identity database `DB` (04 §1, 17 §6, 21 §3, D-10).
//
// A `devices` row is one CLI installation, bound 1:1 to the OAuth grant it
// was registered with (`devices.grant_id` UNIQUE, `oauth_grants.device_id`).
// Every statement here filters on `user_id` (the caller's scope): another
// user's device is "not found" (11 §6.1).
//
//   register   guard (grant live, unbound, this user's, first-party) +
//              INSERT devices + bind the grant + bind its live access tokens
//              — one batch (17 §6 step 2)
//   rebind     `device_hint` on re-login: the device row keeps its id and
//              takes the new grant; the old grant family is revoked
//              (reason 'user') — one batch (04 §1 note, 17 §6 step 6)
//   revoke     devices.revoked_at + every live grant of the device + its
//              refresh family + its access tokens — one batch (17 §9)

import type {
  DeviceCapability,
  DevicePlatform,
  GrantRevokedReason,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { UserScope } from "../../core/scope";
import { identityGuard, revokeGrantStatements } from "../../../oauth/grants";

export interface DeviceRow {
  accepts_tasks: number;
  arch: string;
  capabilities: string;
  cli_version: string;
  created_at: number;
  grant_id: string;
  id: string;
  last_ip_hash: string | null;
  last_seen_at: number | null;
  name: string;
  platform: DevicePlatform;
  public_key: string | null;
  revision: number;
  revoked_at: number | null;
  user_id: string;
}

/** A device with the state of the grant it is bound to. */
export interface DeviceWithGrant extends DeviceRow {
  grant_revoked_at: number | null;
  grant_revoked_reason: GrantRevokedReason | null;
}

const DEVICE_COLUMNS =
  "d.id, d.user_id, d.grant_id, d.name, d.platform, d.arch, d.cli_version, d.public_key, d.capabilities, d.accepts_tasks, d.created_at, d.last_seen_at, d.last_ip_hash, d.revoked_at, d.revision, g.revoked_at AS grant_revoked_at, g.revoked_reason AS grant_revoked_reason";
const FROM_DEVICES =
  "FROM devices d LEFT JOIN oauth_grants g ON g.id = d.grant_id AND g.user_id = d.user_id";

/** One of the user's devices (any state), or null. */
export async function loadUserDevice(
  db: D1Database,
  scope: UserScope,
  deviceId: string
): Promise<DeviceWithGrant | null> {
  return await db
    .prepare(
      `SELECT ${DEVICE_COLUMNS} ${FROM_DEVICES} WHERE d.id = ? AND d.user_id = ? LIMIT 1`
    )
    .bind(deviceId, scope.userId)
    .first<DeviceWithGrant>();
}

export interface DeviceListOptions {
  /** `(created_at, id)` of the last row of the previous page. */
  after: readonly [number, string] | null;
  includeRevoked: boolean;
  limit: number;
}

/** The user's devices, newest first (keyset on `created_at, id`). */
export async function listUserDevices(
  db: D1Database,
  scope: UserScope,
  options: DeviceListOptions
): Promise<DeviceWithGrant[]> {
  const where = ["d.user_id = ?"];
  const binds: Array<string | number> = [scope.userId];
  if (!options.includeRevoked) {
    where.push("d.revoked_at IS NULL");
  }
  if (options.after) {
    where.push("(d.created_at, d.id) < (?, ?)");
    binds.push(options.after[0], options.after[1]);
  }
  const result = await db
    .prepare(
      `SELECT ${DEVICE_COLUMNS} ${FROM_DEVICES} WHERE ${where.join(" AND ")} ORDER BY d.created_at DESC, d.id DESC LIMIT ?`
    )
    .bind(...binds, options.limit)
    .all<DeviceWithGrant>();
  return result.results ?? [];
}

/** A device the user owns and has not revoked (`device_hint`), or null. */
export async function findLiveUserDevice(
  db: D1Database,
  scope: UserScope,
  deviceId: string
): Promise<DeviceRow | null> {
  return await db
    .prepare(
      "SELECT id, user_id, grant_id, name, platform, arch, cli_version, public_key, capabilities, accepts_tasks, created_at, last_seen_at, last_ip_hash, revoked_at, revision FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL LIMIT 1"
    )
    .bind(deviceId, scope.userId)
    .first<DeviceRow>();
}

export interface NewDevice {
  arch: string;
  capabilities: readonly DeviceCapability[];
  clientId: string;
  cliVersion: string;
  grantId: string;
  id: string;
  name: string;
  now: number;
  platform: DevicePlatform;
  publicKey: string | null;
}

/**
 * Registration (17 §6 step 2): the grant must be this user's, live, of the
 * first-party client and still without a device — otherwise the guard aborts
 * the batch and nothing is written.
 */
export function registerDeviceStatements(
  db: D1Database,
  scope: UserScope,
  device: NewDevice
): D1PreparedStatement[] {
  return [
    identityGuard(
      db,
      `grant-unbound:${device.grantId}`,
      "SELECT 1 FROM oauth_grants WHERE id = ? AND user_id = ? AND client_id = ? AND revoked_at IS NULL AND device_id IS NULL",
      device.grantId,
      scope.userId,
      device.clientId
    ),
    db
      .prepare(
        "INSERT INTO devices (id, user_id, grant_id, name, platform, arch, cli_version, public_key, capabilities, accepts_tasks, created_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)"
      )
      .bind(
        device.id,
        scope.userId,
        device.grantId,
        device.name,
        device.platform,
        device.arch,
        device.cliVersion,
        device.publicKey,
        JSON.stringify([...new Set(device.capabilities)]),
        device.now
      ),
    db
      .prepare(
        "UPDATE oauth_grants SET device_id = ? WHERE id = ? AND user_id = ? AND device_id IS NULL"
      )
      .bind(device.id, device.grantId, scope.userId),
    db
      .prepare(
        "UPDATE mcp_tokens SET device_id = ? WHERE grant_id = ? AND user_id = ? AND status = 'active' AND device_id IS NULL"
      )
      .bind(device.id, device.grantId, scope.userId),
  ];
}

/**
 * `device_hint` re-login (17 §6 step 6): bind the NEW grant to the existing
 * device row and revoke the device's previous grant family (reason `user`).
 * The guard re-checks ownership, liveness and the old binding, so a racing
 * revoke or a second re-login aborts the batch.
 */
export function rebindDeviceStatements(
  db: D1Database,
  scope: UserScope,
  input: {
    deviceId: string;
    newGrantId: string;
    now: number;
    oldGrantId: string;
  }
): D1PreparedStatement[] {
  return [
    identityGuard(
      db,
      `device-rebind:${input.deviceId}`,
      "SELECT 1 FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND grant_id = ?",
      input.deviceId,
      scope.userId,
      input.oldGrantId
    ),
    db
      .prepare(
        "UPDATE devices SET grant_id = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
      )
      .bind(input.newGrantId, input.deviceId, scope.userId),
    db
      .prepare(
        "UPDATE oauth_grants SET device_id = ? WHERE id = ? AND user_id = ? AND device_id IS NULL"
      )
      .bind(input.deviceId, input.newGrantId, scope.userId),
    ...(input.oldGrantId === input.newGrantId
      ? []
      : revokeGrantStatements(db, input.oldGrantId, "user", input.now)),
  ];
}

export interface DevicePatch {
  acceptsTasks?: boolean;
  baseRevision: number;
  name?: string;
}

/** Rename / toggle `accepts_tasks` with `base_revision` (D-21). */
export function updateDeviceStatement(
  db: D1Database,
  scope: UserScope,
  deviceId: string,
  patch: DevicePatch
): D1PreparedStatement {
  let accepts: number | null = null;
  if (patch.acceptsTasks !== undefined) {
    accepts = patch.acceptsTasks ? 1 : 0;
  }
  return db
    .prepare(
      "UPDATE devices SET name = COALESCE(?, name), accepts_tasks = COALESCE(?, accepts_tasks), revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? AND revoked_at IS NULL"
    )
    .bind(
      patch.name ?? null,
      accepts,
      deviceId,
      scope.userId,
      patch.baseRevision
    );
}

/** Live grants bound to a device (normally one: `devices.grant_id`). */
export async function liveGrantIdsOfDevice(
  db: D1Database,
  scope: UserScope,
  device: Pick<DeviceRow, "grant_id" | "id">
): Promise<string[]> {
  const result = await db
    .prepare(
      "SELECT id FROM oauth_grants WHERE user_id = ? AND revoked_at IS NULL AND (device_id = ? OR id = ?)"
    )
    .bind(scope.userId, device.id, device.grant_id)
    .all<{ id: string }>();
  return (result.results ?? []).map((row) => row.id);
}

/**
 * Revocation (17 §9, 21 §10, credentials half): the device, every live grant
 * bound to it, their refresh families and access tokens. The guard makes a
 * second concurrent revoke a no-op instead of a double write.
 */
export function revokeDeviceStatements(
  db: D1Database,
  scope: UserScope,
  input: {
    deviceId: string;
    grantIds: readonly string[];
    now: number;
    reason?: GrantRevokedReason;
  }
): D1PreparedStatement[] {
  const reason = input.reason ?? "device_revoked";
  return [
    identityGuard(
      db,
      `device-live:${input.deviceId}`,
      "SELECT 1 FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
      input.deviceId,
      scope.userId
    ),
    db
      .prepare(
        "UPDATE devices SET revoked_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
      )
      .bind(input.now, input.deviceId, scope.userId),
    ...input.grantIds.flatMap((grantId) =>
      revokeGrantStatements(db, grantId, reason, input.now)
    ),
    // Defence in depth: any access token still pointing at the device.
    db
      .prepare(
        "UPDATE mcp_tokens SET status = 'revoked', revoked_at = ? WHERE device_id = ? AND user_id = ? AND status = 'active'"
      )
      .bind(input.now, input.deviceId, scope.userId),
  ];
}

/**
 * What a device heartbeat reports about itself (21 §3: capabilities are
 * re-sent; `cli_version` after an update). Written only when it changed.
 */
export function updateDeviceSelfReportStatement(
  db: D1Database,
  scope: UserScope,
  input: {
    capabilities: readonly DeviceCapability[] | null;
    cliVersion: string;
    deviceId: string;
  }
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE devices SET cli_version = ?, capabilities = COALESCE(?, capabilities) WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
    )
    .bind(
      input.cliVersion,
      input.capabilities
        ? JSON.stringify([...new Set(input.capabilities)])
        : null,
      input.deviceId,
      scope.userId
    );
}
