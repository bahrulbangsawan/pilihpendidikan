// 05 §3 — Devices (17 §6, 21 §3).
import { z } from "zod";
import {
  PageQuerySchema,
  paginated,
  RevisionSchema,
  SemverSchema,
  TimestampSchema,
} from "../common";
import {
  BrowserModeSchema,
  BrowserStatusSchema,
  DeviceCapabilitySchema,
  DevicePlatformSchema,
  LOCAL_TASK_STATES,
} from "../enums";
import { LeaseIdSchema } from "../ids";
import { defineSchema } from "../registry";
import { route } from "./route";
import { DeviceViewSchema } from "./views";

const DeviceNameSchema = z.string().min(1).max(60);

export const RegisterDeviceRequestSchema = defineSchema(
  "api",
  "RegisterDeviceRequest",
  z.object({
    name: DeviceNameSchema,
    platform: DevicePlatformSchema,
    arch: z.string().min(1).max(20),
    cli_version: SemverSchema,
    capabilities: z.array(DeviceCapabilitySchema),
    /** Ed25519 SPKI base64url; reserved for DPoP (17 §11). */
    public_key: z.string().max(200).optional(),
  })
);
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequestSchema>;

export const DeviceResponseSchema = defineSchema(
  "api",
  "DeviceResponse",
  z.object({ device: DeviceViewSchema })
);

export const DeviceViewPageSchema = paginated(
  "api",
  "DeviceView",
  DeviceViewSchema
);

/**
 * `?limit=&cursor=&include_revoked=` — revoked devices are hidden unless
 * `include_revoked` is true (12 §7 "Show signed-out devices").
 */
export const ListDevicesQuerySchema = defineSchema(
  "api",
  "ListDevicesQuery",
  PageQuerySchema.extend({
    include_revoked: z
      .enum(["0", "1", "true", "false", "yes", "no"])
      .optional(),
  })
);

/**
 * `{base_revision, name?, accepts_tasks?}`. With `automation:execute` on the
 * caller's own device only `accepts_tasks` may change (05 §3).
 */
export const UpdateDeviceRequestSchema = defineSchema(
  "api",
  "UpdateDeviceRequest",
  z.object({
    base_revision: RevisionSchema,
    name: DeviceNameSchema.optional(),
    accepts_tasks: z.boolean().optional(),
  })
);
export type UpdateDeviceRequest = z.infer<typeof UpdateDeviceRequestSchema>;

/** Revocation effects on the device's live leases (21 §10). */
export const RevokeDeviceResponseSchema = defineSchema(
  "api",
  "RevokeDeviceResponse",
  z.object({
    device: DeviceViewSchema,
    tasks: z.object({
      /** Leases past submit_intent → outcome_unknown. */
      outcome_unknown: z.number().int().min(0),
      /** Leases before submit_intent → queued (target cleared). */
      requeued: z.number().int().min(0),
      /** awaiting_approval leases → lease cleared, approval kept. */
      awaiting_approval: z.number().int().min(0),
      /** Queued tasks pinned to the device → cancelled. */
      cancelled: z.number().int().min(0),
    }),
  })
);
export type RevokeDeviceResponse = z.infer<typeof RevokeDeviceResponseSchema>;

const countPerState = z.number().int().min(0).optional();

export const DeviceHeartbeatRequestSchema = defineSchema(
  "api",
  "DeviceHeartbeatRequest",
  z.object({
    cli_version: SemverSchema,
    /** Count of local tasks per CLI-local state (20 §3 local_tasks). */
    local_state_summary: z.object(
      Object.fromEntries(
        LOCAL_TASK_STATES.map((state) => [state, countPerState])
      ) as Record<(typeof LOCAL_TASK_STATES)[number], typeof countPerState>
    ),
    active_lease_ids: z.array(LeaseIdSchema),
    outbox_depth: z.number().int().min(0),
    /** Dead-lettered outbox entries (12 §7 "Outbox warnings"). */
    outbox_dead: z.number().int().min(0).optional(),
    /** Last successful outbox flush (12 §7 "Last sync"). */
    last_sync_at: TimestampSchema.nullable().optional(),
    browser: z.object({ mode: BrowserModeSchema, status: BrowserStatusSchema }),
    /** Re-sent on every heartbeat; `browser install` may add some (21 §3). */
    capabilities: z.array(DeviceCapabilitySchema).optional(),
  })
);
export type DeviceHeartbeatRequest = z.infer<
  typeof DeviceHeartbeatRequestSchema
>;

export const DeviceHeartbeatResponseSchema = defineSchema(
  "api",
  "DeviceHeartbeatResponse",
  z.object({
    server_time: TimestampSchema,
    poll_interval_ms: z.number().int().min(2000),
    /** Leases the device must stop (cancel requested, revoked, paused-all). */
    cancel_lease_ids: z.array(LeaseIdSchema),
    min_cli_version: SemverSchema,
  })
);
export type DeviceHeartbeatResponse = z.infer<
  typeof DeviceHeartbeatResponseSchema
>;

export const devicesRoutes = {
  "POST /api/v1/devices": route({
    method: "POST",
    path: "/api/v1/devices",
    operation: "registerDevice",
    section: "05 §3",
    scope: "offline_access",
    idempotency: "optional",
    status: 201,
    request: RegisterDeviceRequestSchema,
    response: DeviceResponseSchema,
  }),
  "GET /api/v1/devices": route({
    method: "GET",
    path: "/api/v1/devices",
    operation: "listDevices",
    section: "05 §3",
    scope: "devices:manage",
    idempotency: "none",
    status: 200,
    request: null,
    query: ListDevicesQuerySchema,
    response: DeviceViewPageSchema,
  }),
  "PATCH /api/v1/devices/{dev_id}": route({
    method: "PATCH",
    path: "/api/v1/devices/{dev_id}",
    operation: "updateDevice",
    section: "05 §3",
    scope: "devices:manage",
    alt_scope: "automation:execute",
    idempotency: "optional",
    status: 200,
    request: UpdateDeviceRequestSchema,
    response: DeviceResponseSchema,
  }),
  "POST /api/v1/devices/{dev_id}/revoke": route({
    method: "POST",
    path: "/api/v1/devices/{dev_id}/revoke",
    operation: "revokeDevice",
    section: "05 §3",
    scope: "devices:manage",
    idempotency: "optional",
    status: 200,
    request: null,
    response: RevokeDeviceResponseSchema,
  }),
  "POST /api/v1/devices/{dev_id}/heartbeat": route({
    method: "POST",
    path: "/api/v1/devices/{dev_id}/heartbeat",
    operation: "deviceHeartbeat",
    section: "05 §3",
    scope: "automation:execute",
    device: true,
    idempotency: "optional",
    status: 200,
    request: DeviceHeartbeatRequestSchema,
    response: DeviceHeartbeatResponseSchema,
  }),
} as const;
