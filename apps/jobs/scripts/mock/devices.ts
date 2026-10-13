// Mock api routes for CLI & devices (12 §7, 22 §12): the device list with
// the dashboard report, rename / accepts_tasks (revision-checked), revoke
// (21 §10 effects as counts), and meta.

import { makeMeta } from "../../src/test/fixtures-rest";
import { state } from "./state";
import type { MockRoute, Reply } from "./types";
import {
  apiError,
  match,
  NOT_FOUND,
  ok,
  page,
  revisionConflict,
} from "./types";

const DEVICE_RE = /^\/api\/v1\/devices\/([^/]+)$/;
const REVOKE_RE = /^\/api\/v1\/devices\/([^/]+)\/revoke$/;
const NAME_MAX = 60;

function deviceIndex(id: string): number {
  return state.devices.findIndex((device) => device.id === id);
}

function updateDevice(id: string, body: Record<string, unknown>): Reply {
  const index = deviceIndex(id);
  const current = state.devices[index];
  if (!current || current.revoked_at !== null) {
    return NOT_FOUND;
  }
  if (body.base_revision !== current.revision) {
    return revisionConflict(current);
  }
  const next = { ...current };
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length === 0 || name.length > NAME_MAX) {
      return apiError(400, "invalid_request", "Name must be 1–60 characters.");
    }
    next.name = name;
  }
  if (typeof body.accepts_tasks === "boolean") {
    next.accepts_tasks = body.accepts_tasks;
  }
  next.revision = current.revision + 1;
  state.devices[index] = next;
  return ok({ device: next });
}

function revokeDevice(id: string): Reply {
  const index = deviceIndex(id);
  const current = state.devices[index];
  if (!current) {
    return NOT_FOUND;
  }
  const next = {
    ...current,
    revoked_at: current.revoked_at ?? Date.now(),
    online: false,
    active: false,
    accepts_tasks: false,
    signed_in: false,
    signed_out_reason: "device_revoked" as const,
    revision: current.revision + 1,
  };
  state.devices[index] = next;
  return ok({
    device: next,
    tasks: {
      outcome_unknown: 0,
      requeued: current.active ? 1 : 0,
      awaiting_approval: 0,
      cancelled: 0,
    },
  });
}

export const routes: MockRoute[] = [
  (request) =>
    request.method === "GET" && request.path === "/api/v1/devices"
      ? page(state.devices)
      : null,
  (request) =>
    request.method === "GET" && request.path === "/api/v1/meta"
      ? ok(makeMeta())
      : null,
  (request) => {
    const patch = match(request, "PATCH", DEVICE_RE);
    return patch ? updateDevice(patch[0] ?? "", request.body) : null;
  },
  (request) => {
    const revoke = match(request, "POST", REVOKE_RE);
    return revoke ? revokeDevice(revoke[0] ?? "") : null;
  },
];
