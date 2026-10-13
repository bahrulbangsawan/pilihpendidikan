// The five device operations of 05 §3. Routes (routes/devices) validate and
// authorize the request; these functions do the work against `DB` (the
// credentials) and JOBS_DB (presence, lease effects, change_log).
//
// Ordering across the two databases (no cross-database transaction exists):
// the identity batch runs first and is authoritative (a revoked device is
// revoked even if the JOBS_DB half has to be retried); the JOBS_DB batch then
// applies the lease effects with the `device` change and the idempotency row.

import type {
  DeviceHeartbeatRequest,
  RegisterDeviceRequest,
  UpdateDeviceRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { ResolvedCaller } from "../../../auth";
import type { Env } from "../../../env";
import { findGrant, runIdentityBatch } from "../../../oauth/grants";
import {
  cleanDeviceName,
  findClient,
  isFirstParty,
} from "../../../oauth/shared";
import type { CallerDevice } from "../../core/device";
import {
  apiError,
  insufficientScope,
  invalidRequest,
  notFound,
  revisionConflict,
} from "../../core/http";
import type { Page } from "../../core/pagination";
import { pageOf, parsePage } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import { cliVersions } from "../../core/version";
import type { JobsDb } from "../../repo/core/db";
import { GuardFailedError, UniqueViolationError } from "../../repo/core/db";
import type { LeaseLossCounts } from "../../repo/devices/effects";
import {
  activeDeviceIds,
  applyDeviceLeaseLoss,
  deviceChange,
  isAutomationPaused,
  leasesToCancel,
  pollSignals,
} from "../../repo/devices/effects";
import type { DeviceWithGrant } from "../../repo/devices/identity";
import {
  liveGrantIdsOfDevice,
  listUserDevices,
  loadUserDevice,
  registerDeviceStatements,
  revokeDeviceStatements,
  updateDeviceSelfReportStatement,
  updateDeviceStatement,
} from "../../repo/devices/identity";
import type { DeviceViewOut } from "./index";
import {
  normalizeCapabilities,
  POLL_HOT_WINDOW_MS,
  pollIntervalMs,
  readDeviceReport,
  selfReportChanged,
  storeDeviceReport,
  toDeviceView,
  watchKey,
} from "./index";

export interface DeviceCallContext {
  caller: ResolvedCaller;
  db: JobsDb;
  env: Env;
  now: number;
  scope: UserScope;
}

async function viewOf(
  ctx: DeviceCallContext,
  row: DeviceWithGrant,
  active?: ReadonlySet<string>
): Promise<DeviceViewOut> {
  const leases = active ?? (await activeDeviceIds(ctx.db, ctx.scope, ctx.now));
  return toDeviceView(
    row,
    { active: leases, now: ctx.now },
    await readDeviceReport(ctx.env, row.id)
  );
}

async function mustLoad(
  ctx: DeviceCallContext,
  deviceId: string
): Promise<DeviceWithGrant> {
  const row = await loadUserDevice(ctx.env.DB, ctx.scope, deviceId);
  if (!row) {
    throw notFound("Device not found.");
  }
  return row;
}

function deviceRevoked(): never {
  throw apiError("device_revoked", "This device was revoked.");
}

// ---------------------------------------------------------------------------
// POST /api/v1/devices
// ---------------------------------------------------------------------------

function notACliGrant(): never {
  throw apiError(
    "insufficient_scope",
    "Only the access token of a pilih-jobs login (a grant without a device) can register a device.",
    { scope: "offline_access" }
  );
}

async function duplicateRegistration(
  ctx: DeviceCallContext,
  grantId: string
): Promise<never> {
  const grant = await findGrant(ctx.env.DB, grantId);
  throw apiError(
    "duplicate",
    "This login is already bound to a device. Run `pilih-jobs login` again to register another one.",
    { details: { device_id: grant?.device_id ?? null } }
  );
}

/**
 * 17 §6 steps 1–4: the token must come from a live first-party grant of
 * this user that has no device yet; the device row, `grant.device_id` and the
 * grant's live access tokens are written in ONE batch. A second registration
 * on the same grant is `409 duplicate`.
 */
export async function registerDevice(
  ctx: DeviceCallContext,
  body: RegisterDeviceRequest
): Promise<{ device: DeviceViewOut; statements: D1PreparedStatement[] }> {
  const grantId = ctx.caller.grantId;
  if (ctx.caller.credentialKind !== "oauth_cli" || !grantId) {
    notACliGrant();
  }
  const grant = await findGrant(ctx.env.DB, grantId);
  if (!grant || grant.user_id !== ctx.scope.userId) {
    notACliGrant();
  }
  const client = await findClient(ctx.env.DB, grant.client_id);
  if (!(client && isFirstParty(client))) {
    notACliGrant();
  }
  if (grant.device_id !== null) {
    return await duplicateRegistration(ctx, grantId);
  }
  const name = cleanDeviceName(body.name);
  if (!name) {
    throw invalidRequest("name must contain printable characters.");
  }
  const id = newId("dev", ctx.now);
  try {
    await runIdentityBatch(
      ctx.env.DB,
      registerDeviceStatements(ctx.env.DB, ctx.scope, {
        id,
        grantId,
        clientId: grant.client_id,
        name,
        platform: body.platform,
        arch: body.arch,
        cliVersion: body.cli_version,
        publicKey: body.public_key ?? null,
        capabilities: normalizeCapabilities(body.capabilities),
        now: ctx.now,
      })
    );
  } catch (err) {
    if (
      err instanceof GuardFailedError ||
      err instanceof UniqueViolationError
    ) {
      return await duplicateRegistration(ctx, grantId);
    }
    throw err;
  }
  const row = await mustLoad(ctx, id);
  return {
    device: await viewOf(ctx, row),
    statements: [
      deviceChange(ctx.db, ctx.scope, {
        deviceId: id,
        revision: row.revision,
        now: ctx.now,
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/devices
// ---------------------------------------------------------------------------

const TRUE_VALUES = new Set(["1", "true", "yes"]);

function cursorKey(cursor: readonly (string | number)[] | null) {
  if (cursor === null) {
    return null;
  }
  const [createdAt, id] = cursor;
  if (
    cursor.length !== 2 ||
    typeof createdAt !== "number" ||
    typeof id !== "string"
  ) {
    throw invalidRequest("Cursor does not match this list.");
  }
  return [createdAt, id] as const;
}

/** The user's devices (newest first) with `online` / `active` (04 §1). */
export async function listDevices(
  ctx: DeviceCallContext,
  query: URLSearchParams
): Promise<Page<DeviceViewOut>> {
  const page = parsePage(query);
  const rows = await listUserDevices(ctx.env.DB, ctx.scope, {
    after: cursorKey(page.cursor),
    includeRevoked: TRUE_VALUES.has(
      (query.get("include_revoked") ?? "").toLowerCase()
    ),
    limit: page.limit + 1,
  });
  const active = await activeDeviceIds(ctx.db, ctx.scope, ctx.now);
  const views = await Promise.all(rows.map((row) => viewOf(ctx, row, active)));
  return pageOf(views, page.limit, (view) => [view.created_at, view.id]);
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/devices/{dev_id}
// ---------------------------------------------------------------------------

export interface UpdateDeviceInput {
  baseRevision: number;
  body: UpdateDeviceRequest;
  /** The caller passed the scope check only through `automation:execute`. */
  viaAltScope: boolean;
}

/**
 * Rename / toggle `accepts_tasks` (05 §3). With `devices:manage` any of the
 * user's devices; with only `automation:execute` the caller's OWN device and
 * only `accepts_tasks` (`pilih-jobs worker enable/disable`).
 */
export async function updateDevice(
  ctx: DeviceCallContext,
  deviceId: string,
  input: UpdateDeviceInput
): Promise<{
  device: DeviceViewOut;
  statements: D1PreparedStatement[];
}> {
  const current = await mustLoad(ctx, deviceId);
  if (input.viaAltScope) {
    const own = ctx.caller.deviceId === deviceId;
    if (!own || input.body.name !== undefined) {
      throw insufficientScope(["devices:manage"]);
    }
  }
  if (current.revoked_at !== null) {
    deviceRevoked();
  }
  if (current.revision !== input.baseRevision) {
    throw revisionConflict(await viewOf(ctx, current));
  }
  let name: string | undefined;
  if (input.body.name !== undefined) {
    name = cleanDeviceName(input.body.name);
    if (!name) {
      throw invalidRequest("name must contain printable characters.");
    }
  }
  const changes = name !== undefined || input.body.accepts_tasks !== undefined;
  if (!changes) {
    return { device: await viewOf(ctx, current), statements: [] };
  }
  const result = await updateDeviceStatement(ctx.env.DB, ctx.scope, deviceId, {
    baseRevision: input.baseRevision,
    name,
    acceptsTasks: input.body.accepts_tasks,
  }).run();
  const updated = await mustLoad(ctx, deviceId);
  if ((result.meta?.changes ?? 0) === 0) {
    if (updated.revoked_at !== null) {
      deviceRevoked();
    }
    throw revisionConflict(await viewOf(ctx, updated));
  }
  return {
    device: await viewOf(ctx, updated),
    statements: [
      deviceChange(ctx.db, ctx.scope, {
        deviceId,
        revision: updated.revision,
        now: ctx.now,
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/devices/{dev_id}/revoke
// ---------------------------------------------------------------------------

export interface RevokeDeviceResult {
  device: DeviceViewOut;
  tasks: {
    awaiting_approval: number;
    cancelled: number;
    outcome_unknown: number;
    requeued: number;
  };
}

function taskCounts(counts: LeaseLossCounts): RevokeDeviceResult["tasks"] {
  return {
    outcome_unknown: counts.outcome_unknown,
    requeued: counts.requeued,
    awaiting_approval: counts.awaiting_approval,
    cancelled: counts.cancelled,
  };
}

/**
 * 17 §9 / 21 §10. `DB` batch: the device, every live grant bound to it, the
 * refresh families and the access tokens. JOBS_DB batch: every live lease →
 * `outcome_unknown` (past submit_intent) / lease cleared (awaiting approval) /
 * `queued` with the target cleared; queued tasks pinned to the device →
 * `cancelled`; the `device` change and (`idempotency`) the idempotency row.
 */
export async function revokeDevice(
  ctx: DeviceCallContext,
  deviceId: string,
  idempotency: (status: number, body: unknown) => D1PreparedStatement[]
): Promise<RevokeDeviceResult> {
  const current = await mustLoad(ctx, deviceId);
  if (current.revoked_at !== null) {
    // Already revoked. Re-apply the JOBS_DB half (idempotent: a lease or a
    // pinned task left by an interrupted earlier revoke is handled now).
    await applyDeviceLeaseLoss(ctx.db, ctx.scope, {
      deviceId,
      now: ctx.now,
      cancelPinned: true,
      extra: () => [],
    });
    deviceRevoked();
  }
  const grantIds = await liveGrantIdsOfDevice(ctx.env.DB, ctx.scope, current);
  try {
    await runIdentityBatch(
      ctx.env.DB,
      revokeDeviceStatements(ctx.env.DB, ctx.scope, {
        deviceId,
        grantIds,
        now: ctx.now,
      })
    );
  } catch (err) {
    if (err instanceof GuardFailedError) {
      deviceRevoked();
    }
    throw err;
  }
  const revoked = await mustLoad(ctx, deviceId);
  const view = await viewOf(ctx, revoked, new Set());
  // `extra` receives exactly the counts the call returns (the ones that
  // applied), so the stored idempotent response equals the live one.
  const counts = await applyDeviceLeaseLoss(ctx.db, ctx.scope, {
    deviceId,
    now: ctx.now,
    cancelPinned: true,
    extra: (applied) => [
      deviceChange(ctx.db, ctx.scope, {
        deviceId,
        revision: revoked.revision,
        now: ctx.now,
      }),
      ...idempotency(200, { device: view, tasks: taskCounts(applied) }),
    ],
  });
  return { device: view, tasks: taskCounts(counts) };
}

// ---------------------------------------------------------------------------
// POST /api/v1/devices/{dev_id}/heartbeat
// ---------------------------------------------------------------------------

export interface HeartbeatResult {
  cancel_lease_ids: string[];
  min_cli_version: string;
  poll_interval_ms: number;
  server_time: number;
}

/**
 * The device heartbeat (05 §3, 21 §1.1 / §3): re-sent capabilities and the
 * CLI version update the device row when they changed; the report goes to
 * KV; the answer tells the CLI which leases to stop and how fast to poll.
 */
export async function deviceHeartbeat(
  ctx: DeviceCallContext,
  device: CallerDevice,
  body: DeviceHeartbeatRequest
): Promise<HeartbeatResult> {
  if (selfReportChanged(device, body)) {
    await updateDeviceSelfReportStatement(ctx.env.DB, ctx.scope, {
      deviceId: device.id,
      cliVersion: body.cli_version,
      capabilities: body.capabilities
        ? normalizeCapabilities(body.capabilities)
        : null,
    }).run();
  }
  const paused = await isAutomationPaused(ctx.db, ctx.scope);
  const cancel = await leasesToCancel(ctx.db, ctx.scope, {
    deviceId: device.id,
    leaseIds: body.active_lease_ids,
    paused,
  });
  const signals = await pollSignals(ctx.db, ctx.scope, {
    deviceId: device.id,
    since: ctx.now - POLL_HOT_WINDOW_MS,
  });
  const watching =
    (await ctx.env.AUTH_KV.get(watchKey(ctx.scope.userId))) !== null;
  const row = await loadUserDevice(ctx.env.DB, ctx.scope, device.id);
  await storeDeviceReport(ctx.env, device.id, body, ctx.now);
  return {
    server_time: ctx.now,
    poll_interval_ms: pollIntervalMs({
      now: ctx.now,
      recentTask: signals.recentTask,
      watching,
      lastClaimAt: signals.lastClaimAt,
      deviceCreatedAt: row?.created_at ?? ctx.now,
    }),
    cancel_lease_ids: cancel,
    min_cli_version: cliVersions(ctx.env).min,
  };
}
