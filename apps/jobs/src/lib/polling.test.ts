import { describe, expect, it } from "vitest";
import {
  isLivePollState,
  isStale,
  MAX_BACKOFF_MS,
  POLL_POLICIES,
  pollInterval,
} from "./polling";

describe("TW-POLL polling (12 §10)", () => {
  it("TW-POLL uses the 12 §10 intervals while visible", () => {
    const visible = { hidden: false, failures: 0 };
    expect(pollInterval(POLL_POLICIES.board, visible)).toBe(15_000);
    expect(pollInterval(POLL_POLICIES.application, visible)).toBe(15_000);
    expect(pollInterval(POLL_POLICIES.applicationLive, visible)).toBe(2000);
    expect(pollInterval(POLL_POLICIES.runMonitor, visible)).toBe(2000);
    expect(pollInterval(POLL_POLICIES.approvals, visible)).toBe(10_000);
    expect(pollInterval(POLL_POLICIES.inboxActive, visible)).toBe(30_000);
    expect(pollInterval(POLL_POLICIES.devices, visible)).toBe(10_000);
  });

  it("TW-POLL pauses when the tab is hidden, except the live screens", () => {
    const hidden = { hidden: true, failures: 0 };
    expect(pollInterval(POLL_POLICIES.board, hidden)).toBe(false);
    expect(pollInterval(POLL_POLICIES.application, hidden)).toBe(false);
    expect(pollInterval(POLL_POLICIES.devices, hidden)).toBe(false);
    expect(pollInterval(POLL_POLICIES.applicationLive, hidden)).toBe(10_000);
    expect(pollInterval(POLL_POLICIES.runMonitor, hidden)).toBe(10_000);
    expect(pollInterval(POLL_POLICIES.approvals, hidden)).toBe(60_000);
  });

  it("TW-POLL doubles the delay per consecutive failure, capped at 60 s", () => {
    const board = [0, 1, 2, 3, 4].map((failures) =>
      pollInterval(POLL_POLICIES.board, { hidden: false, failures })
    );
    expect(board).toEqual([15_000, 30_000, 60_000, 60_000, 60_000]);
    const live = [0, 1, 2, 3, 4, 5, 6].map((failures) =>
      pollInterval(POLL_POLICIES.runMonitor, { hidden: false, failures })
    );
    expect(live).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]);
    expect(Math.max(...live.map(Number))).toBe(MAX_BACKOFF_MS);
  });

  it("TW-POLL a hidden paused tab stays paused even while failing", () => {
    expect(
      pollInterval(POLL_POLICIES.board, { hidden: true, failures: 3 })
    ).toBe(false);
  });

  it("TW-POLL a success resets the backoff", () => {
    expect(
      pollInterval(POLL_POLICIES.board, { hidden: false, failures: 0 })
    ).toBe(15_000);
  });

  it("TW-POLL data is stale after three failed polls", () => {
    expect([0, 1, 2, 3, 4].map(isStale)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("TW-POLL the detail switches to 2 s only for claimed / running / awaiting approval", () => {
    expect(
      ["claimed", "running", "awaiting_approval"].every(isLivePollState)
    ).toBe(true);
    expect(
      ["queued", "paused", "submitted", "failed"].some(isLivePollState)
    ).toBe(false);
  });
});
