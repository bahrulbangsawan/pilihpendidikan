import { describe, expect, it } from "vitest";
import { DAY, makeDevice, NOW } from "@/test/fixtures";
import { makeReport } from "@/test/fixtures-cli";
import { makeMeta, makeRun, makeTask } from "@/test/fixtures-rest";
import { CLI_COMMANDS, installCommand } from "./devices-install";
import {
  awaitingFirstContact,
  bulkRevokePlan,
  CONNECT_WATCH_MS,
  detectPlatform,
  deviceExtras,
  deviceStatus,
  deviceVersion,
  devicesPollPolicy,
  isRetryableFailure,
  isRetryableRun,
  justConnected,
  outboxWarning,
  revokeConsequences,
  versionStatus,
} from "./devices-model";
import { POLL_POLICIES } from "./polling";
import { compareSemver, isOlderThan, parseSemver } from "./semver";

const HOUR = 3_600_000;

describe("TW-DEVICES device status, versions and outbox (12 §7)", () => {
  it("TW-DEVICES classifies active, online, offline and signed-out devices", () => {
    expect(deviceStatus(makeDevice({ active: true, online: true }))).toEqual({
      kind: "active",
    });
    const online = makeDevice({ online: true, active: false });
    expect(deviceStatus(online)).toEqual({
      kind: "online",
      lastSeenAt: online.last_seen_at,
    });
    const offline = makeDevice({
      online: false,
      active: false,
      last_seen_at: NOW - 3 * DAY,
    });
    expect(deviceStatus(offline)).toEqual({
      kind: "offline",
      lastSeenAt: NOW - 3 * DAY,
    });
    // A refresh-token reuse revoked the grant: signed out, with the reason.
    const reused = makeDevice({
      online: true,
      active: true,
      signed_in: false,
      signed_out_reason: "refresh_reuse",
    });
    expect(deviceStatus(reused)).toEqual({
      kind: "signed_out",
      reason: "refresh_reuse",
    });
    const revoked = makeDevice({ revoked_at: NOW - HOUR });
    expect(deviceStatus(revoked)).toEqual({
      kind: "signed_out",
      reason: "device_revoked",
    });
  });

  it("TW-DEVICES reads the dashboard fields; a device without them is signed in with no report", () => {
    const plain = makeDevice();
    expect(deviceExtras(plain)).toEqual({
      signedIn: true,
      signedOutReason: null,
      report: null,
    });
    const reported = makeDevice({
      cli_version: "1.1.0",
      signed_in: true,
      report: makeReport({ cli_version: "1.3.0", outbox_depth: 2 }),
    });
    expect(deviceExtras(reported).report?.outbox_depth).toBe(2);
    // The heartbeat's version wins over the registration's.
    expect(deviceVersion(reported)).toBe("1.3.0");
    expect(deviceVersion(plain)).toBe(plain.cli_version);
  });

  it("TW-DEVICES compares CLI versions with semver precedence against meta", () => {
    expect(compareSemver("1.10.0", "1.9.9")).toBe(1);
    expect(compareSemver("1.2.0-beta.2", "1.2.0-beta.10")).toBe(-1);
    expect(compareSemver("1.2.0-rc.1", "1.2.0")).toBe(-1);
    expect(compareSemver("1.2.0+build.5", "1.2.0")).toBe(0);
    expect(compareSemver("not-a-version", "1.0.0")).toBeNull();
    expect(parseSemver("v2.0.1")?.major).toBe(2);
    expect(isOlderThan("1.0.4", "1.1.0")).toBe(true);

    const meta = makeMeta({
      min_cli_version: "1.1.0",
      recommended_cli_version: "1.2.0",
    });
    expect(versionStatus("1.0.4", meta)).toBe("too_old");
    expect(versionStatus("1.1.3", meta)).toBe("update");
    expect(versionStatus("1.2.0", meta)).toBe("current");
    expect(versionStatus("1.3.0-beta.1", meta)).toBe("current");
    expect(versionStatus("1.0.0", null)).toBe("unknown");
  });

  it("TW-DEVICES warns about an outbox stuck for more than 1 h or any dead letter", () => {
    const now = NOW;
    const fresh = deviceExtras(
      makeDevice({
        report: makeReport({
          outbox_depth: 4,
          outbox_pending_since: now - 30 * 60_000,
        }),
      })
    );
    expect(outboxWarning(fresh, now)).toBeNull();
    const stuck = deviceExtras(
      makeDevice({
        report: makeReport({
          outbox_depth: 3,
          outbox_pending_since: now - 2 * HOUR,
        }),
      })
    );
    expect(outboxWarning(stuck, now)).toEqual({
      changes: 3,
      dead: 0,
      pendingSince: now - 2 * HOUR,
    });
    const dead = deviceExtras(
      makeDevice({
        report: makeReport({ outbox_depth: 0, outbox_dead: 2 }),
      })
    );
    expect(outboxWarning(dead, now)?.changes).toBe(2);
    expect(outboxWarning(deviceExtras(makeDevice()), now)).toBeNull();
  });

  it("TW-DEVICES polls every 3 s with no device or right after copying the login command, else 10 s", () => {
    expect(devicesPollPolicy({ empty: true, nowMs: NOW, watchUntil: 0 })).toBe(
      POLL_POLICIES.devicesConnecting
    );
    expect(POLL_POLICIES.devicesConnecting.visible).toBe(3000);
    expect(
      devicesPollPolicy({
        empty: false,
        nowMs: NOW,
        watchUntil: NOW + CONNECT_WATCH_MS,
      })
    ).toBe(POLL_POLICIES.devicesConnecting);
    expect(
      devicesPollPolicy({
        empty: false,
        nowMs: NOW + CONNECT_WATCH_MS + 1,
        watchUntil: NOW + CONNECT_WATCH_MS,
      })
    ).toBe(POLL_POLICIES.devices);
    expect(POLL_POLICIES.devices.visible).toBe(10_000);
  });

  it("S-04 keeps the 3 s poll until a just-signed-in device is first seen, so it reads Online within 10 s", () => {
    const fresh = makeDevice({
      created_at: NOW - 2000,
      last_seen_at: null,
      online: false,
    });
    expect(awaitingFirstContact([fresh], NOW)).toBe(true);
    expect(
      devicesPollPolicy({
        empty: false,
        connecting: awaitingFirstContact([fresh], NOW),
        nowMs: NOW,
        watchUntil: 0,
      })
    ).toBe(POLL_POLICIES.devicesConnecting);
    // Seen once (online), revoked, or created long ago: back to 10 s.
    const seen = { ...fresh, last_seen_at: NOW - 1000, online: true };
    const revoked = { ...fresh, revoked_at: NOW - 500 };
    const stale = { ...fresh, created_at: NOW - CONNECT_WATCH_MS - 1 };
    for (const device of [seen, revoked, stale]) {
      expect(awaitingFirstContact([device], NOW)).toBe(false);
    }
    expect(
      devicesPollPolicy({
        empty: false,
        connecting: awaitingFirstContact([seen, stale], NOW),
        nowMs: NOW,
        watchUntil: 0,
      })
    ).toBe(POLL_POLICIES.devices);
  });

  it("TW-DEVICES counts what revoking stops, marks for review and cancels (21 §10)", () => {
    const device = makeDevice();
    const tasks = [
      makeTask({ lease_device_id: device.id, state: "running" }),
      makeTask({
        lease_device_id: device.id,
        state: "running",
        submit_intent_at: NOW - 1000,
      }),
      makeTask({
        state: "queued",
        target_device_id: device.id,
        lease_id: null,
        lease_device_id: null,
        lease_expires_at: null,
      }),
      makeTask({ state: "running" }),
      makeTask({ lease_device_id: device.id, state: "failed" }),
    ];
    expect(revokeConsequences(device.id, tasks)).toEqual({
      running: 2,
      submitting: 1,
      pinned: 1,
    });
  });

  it("TW-DEVICES offers retries only for retryable failures not yet retried, and re-runnable runs", () => {
    const login = makeTask({ state: "failed", error_class: "network_offline" });
    const policy = makeTask({
      state: "failed",
      error_class: "policy_violation",
    });
    const unknown = makeTask({ state: "failed", error_class: "mystery" });
    const retried = makeTask({ state: "failed", error_class: "timeout" });
    const retry = makeTask({ state: "queued", retry_of: retried.id });
    const all = [login, policy, unknown, retried, retry];
    expect(isRetryableFailure(login, all)).toBe(true);
    expect(isRetryableFailure(policy, all)).toBe(false);
    expect(isRetryableFailure(unknown, all)).toBe(false);
    expect(isRetryableFailure(retried, all)).toBe(false);

    const device = makeDevice();
    expect(
      isRetryableRun(
        makeRun(device.id, {
          status: "partial",
          sources: [
            {
              source_id: "src_01JA0000000000000000000000",
              adapter: "lever",
              label: "x",
            },
          ],
        })
      )
    ).toBe(true);
    expect(isRetryableRun(makeRun(device.id, { status: "completed" }))).toBe(
      false
    );
    // A run of ad-hoc URLs has no source to re-run.
    expect(
      isRetryableRun(
        makeRun(device.id, {
          status: "failed",
          sources: [{ source_id: null, adapter: "custom_url", label: "url" }],
        })
      )
    ).toBe(false);
  });

  it("TW-DEVICES install commands come from cli-commands.json per OS; the OS is detected", () => {
    for (const platform of ["macos", "linux", "windows"] as const) {
      expect(installCommand(platform)).toBe(
        CLI_COMMANDS.steps.find((step) => step.id === "install")?.commands[
          platform
        ]
      );
    }
    expect(
      detectPlatform(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Win32"
      )
    ).toBe("windows");
    expect(
      detectPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15",
        "MacIntel"
      )
    ).toBe("macos");
    expect(
      detectPlatform("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64")
    ).toBe("linux");
  });

  it("TW-DEVICES shows a device that connected in the last 5 minutes as just connected", () => {
    const old = makeDevice({ created_at: NOW - DAY });
    const fresh = makeDevice({ created_at: NOW - 60_000, name: "Laptop" });
    expect(justConnected([old, fresh], NOW)?.name).toBe("Laptop");
    expect(justConnected([old], NOW)).toBeNull();
  });
});

describe("TW-DEVICES bulk revoke plan (12 §7, 21 §10)", () => {
  it("TW-DEVICES sums the consequences, skips revoked devices and warns when no signed-in device is left", () => {
    const mac = makeDevice({ name: "MacBook" });
    const desk = makeDevice({ name: "Desktop" });
    const old = makeDevice({ name: "Old", revoked_at: NOW - DAY });
    const tasks = [
      makeTask({ lease_device_id: mac.id, state: "running" }),
      makeTask({ lease_device_id: desk.id, state: "running" }),
    ];
    const all = bulkRevokePlan(
      [mac.id, desk.id, old.id],
      [mac, desk, old],
      tasks
    );
    expect(all).toMatchObject({ alreadyRevoked: 1, leavesNone: true });
    expect(all.consequences.running).toBe(2);
    const some = bulkRevokePlan([mac.id], [mac, desk, old], tasks);
    expect(some).toMatchObject({ alreadyRevoked: 0, leavesNone: false });
    expect(some.consequences.running).toBe(1);
    expect(bulkRevokePlan([old.id], [mac, old], tasks).leavesNone).toBe(false);
  });
});
