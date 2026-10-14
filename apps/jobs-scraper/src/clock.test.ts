import { describe, expect, test } from "bun:test";
import {
  boundaryOf,
  CLOCK_OFFSET_MS,
  CRON_EVERY_FIVE_MINUTES,
  CRON_HOURLY,
  nextAlarmAt,
  ticksFor,
} from "./clock";

const AT = (iso: string) => Date.parse(iso);

describe("T24-CLOCK scheduler fallback timing (24 §6.6)", () => {
  test("alarms land 30 s after the next 5-minute boundary", () => {
    expect(nextAlarmAt(AT("2026-10-14T09:21:10Z"))).toBe(
      AT("2026-10-14T09:25:30Z")
    );
    expect(nextAlarmAt(AT("2026-10-14T09:25:29Z"))).toBe(
      AT("2026-10-14T09:25:30Z")
    );
    expect(nextAlarmAt(AT("2026-10-14T09:25:30Z"))).toBe(
      AT("2026-10-14T09:30:30Z")
    );
    expect(nextAlarmAt(AT("2026-10-14T09:59:59Z"))).toBe(
      AT("2026-10-14T10:00:30Z")
    );
  });

  test("an alarm maps back to its boundary, even when it fires a little late", () => {
    expect(boundaryOf(AT("2026-10-14T10:00:30Z"))).toBe(
      AT("2026-10-14T10:00:00Z")
    );
    expect(boundaryOf(AT("2026-10-14T10:01:40Z"))).toBe(
      AT("2026-10-14T10:00:00Z")
    );
    expect(boundaryOf(AT("2026-10-14T10:05:00Z") + CLOCK_OFFSET_MS)).toBe(
      AT("2026-10-14T10:05:00Z")
    );
  });

  test("the hourly schedule runs on the hour, after the reaper", () => {
    expect(ticksFor(AT("2026-10-14T10:00:00Z"))).toEqual([
      CRON_EVERY_FIVE_MINUTES,
      CRON_HOURLY,
    ]);
    expect(ticksFor(AT("2026-10-14T10:05:00Z"))).toEqual([
      CRON_EVERY_FIVE_MINUTES,
    ]);
  });
});
