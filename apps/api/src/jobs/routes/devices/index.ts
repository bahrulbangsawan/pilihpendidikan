// 05 §3 — Devices (17 §6, 21 §3, D-10). Owner: leaf-2.2.
//
//   POST  /api/v1/devices                     offline_access + a CLI grant token
//                                             without a device → 201 {device}
//   GET   /api/v1/devices                     devices:manage → {items, next_cursor}
//   PATCH /api/v1/devices/{dev_id}            devices:manage, or automation:execute
//                                             for the caller's own device
//                                             (accepts_tasks only)
//   POST  /api/v1/devices/{dev_id}/revoke     devices:manage → {device, tasks}
//   POST  /api/v1/devices/{dev_id}/heartbeat  automation:execute, own device
//
// Not-owned devices are 404 (11 §6.1). A revoked device addressed by another
// valid credential is `403 device_revoked`; the revoked CLI itself gets
// `401 revoked_token` from the router (05 §1.3).

import type { RouteContext } from "../../core/context";
import { notFound } from "../../core/http";
import type { RouteDef } from "../../core/router";
import { defineRoute, fromContract } from "../../core/router";
import type { DeviceCallContext } from "../../services/devices/operations";
import {
  deviceHeartbeat,
  listDevices,
  registerDevice,
  revokeDevice,
  updateDevice,
} from "../../services/devices/operations";

function callContext(
  c: RouteContext<unknown, unknown, unknown>
): DeviceCallContext {
  return {
    env: c.env,
    db: c.db,
    scope: c.scope,
    caller: c.caller,
    now: c.now,
  };
}

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("POST /api/v1/devices"),
    async handler(c) {
      const { device, statements } = await registerDevice(
        callContext(c),
        c.body
      );
      return await c.commit(statements, { status: 201, body: { device } });
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/devices"),
    async handler(c) {
      return c.respond(await listDevices(callContext(c), c.query));
    },
  }),
  defineRoute({
    ...fromContract("PATCH /api/v1/devices/{dev_id}"),
    async handler(c) {
      const { device, statements } = await updateDevice(
        callContext(c),
        c.params.dev_id,
        {
          body: c.body,
          baseRevision: c.baseRevision(c.body.base_revision),
          viaAltScope: c.grantedVia === "alt_scope",
        }
      );
      return await c.commit(statements, { body: { device } });
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/devices/{dev_id}/revoke"),
    async handler(c) {
      const result = await revokeDevice(
        callContext(c),
        c.params.dev_id,
        (status, body) => c.idempotencyStatements(status, body)
      );
      c.markIdempotencyRecorded();
      return c.respond(result);
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/devices/{dev_id}/heartbeat"),
    async handler(c) {
      const device = c.device;
      if (!device || device.id !== c.params.dev_id) {
        throw notFound("Device not found.");
      }
      return c.respond(await deviceHeartbeat(callContext(c), device, c.body));
    },
  }),
];
