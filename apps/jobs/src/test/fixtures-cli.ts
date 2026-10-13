// Fixtures of the CLI & devices and Sources screens: a device heartbeat
// report typed by the contract's DeviceView (12 §7).
import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import { NOW } from "./fixtures";

export type DeviceReport = NonNullable<DeviceView["report"]>;

export function makeReport(
  overrides: Partial<DeviceReport> = {}
): DeviceReport {
  return {
    cli_version: "1.2.0",
    outbox_depth: 0,
    outbox_dead: 0,
    outbox_pending_since: null,
    last_sync_at: NOW - 12_000,
    browser: { mode: "managed", status: "ready" },
    local_state_summary: {},
    reported_at: NOW - 12_000,
    ...overrides,
  };
}
