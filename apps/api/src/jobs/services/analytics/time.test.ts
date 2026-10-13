import { describe, expect, it } from "bun:test";
import { localDay } from "../../core/clock";
import { ApiError } from "../../core/http";
import {
  addDays,
  daysInclusive,
  endOfLocalDay,
  isoWeekLabel,
  isoWeekStart,
  isValidTimeZone,
  listDays,
  monthStart,
  parseDay,
  resolvePeriod,
  startOfLocalDay,
  zoneOffsetMs,
} from "./time";

const HOUR = 3_600_000;

describe("analytics calendar (10 §5)", () => {
  it("T10-05 an event at 23:30 Asia/Jakarta lands on its local day and ISO week", () => {
    // 2026-03-01 23:30 WIB (UTC+7) = 16:30 UTC the same day.
    const late = Date.UTC(2026, 2, 1, 16, 30);
    // 2026-03-02 00:30 WIB = 17:30 UTC on March 1.
    const afterMidnight = Date.UTC(2026, 2, 1, 17, 30);
    expect(localDay(late, "Asia/Jakarta")).toBe("2026-03-01");
    expect(localDay(afterMidnight, "Asia/Jakarta")).toBe("2026-03-02");
    // UTC would put both on March 1.
    expect(localDay(afterMidnight, "UTC")).toBe("2026-03-01");
    // 2026-03-01 is a Sunday (ISO week of Monday Feb 23), March 2 a Monday.
    expect(isoWeekStart("2026-03-01")).toBe("2026-02-23");
    expect(isoWeekStart("2026-03-02")).toBe("2026-03-02");
    expect(isoWeekLabel("2026-03-01")).toBe("2026-W09");
    expect(isoWeekLabel("2026-03-02")).toBe("2026-W10");
    expect(startOfLocalDay("2026-03-02", "Asia/Jakarta")).toBe(
      Date.UTC(2026, 2, 1, 17)
    );
    expect(startOfLocalDay("2026-03-02", "Asia/Jakarta")).toBeLessThanOrEqual(
      afterMidnight
    );
    expect(endOfLocalDay("2026-03-01", "Asia/Jakarta")).toBeGreaterThan(late);
  });

  it("T10-05 DST zones (Europe/Amsterdam): 23- and 25-hour days, local midnights", () => {
    const zone = "Europe/Amsterdam";
    // Spring forward on Sunday 2026-03-29 (02:00 → 03:00).
    expect(startOfLocalDay("2026-03-29", zone)).toBe(Date.UTC(2026, 2, 28, 23));
    expect(startOfLocalDay("2026-03-30", zone)).toBe(Date.UTC(2026, 2, 29, 22));
    expect(
      endOfLocalDay("2026-03-29", zone) - startOfLocalDay("2026-03-29", zone)
    ).toBe(23 * HOUR);
    // Fall back on Sunday 2026-10-25 (03:00 → 02:00).
    expect(
      endOfLocalDay("2026-10-25", zone) - startOfLocalDay("2026-10-25", zone)
    ).toBe(25 * HOUR);
    // 23:30 local on the short day is still that day; 00:30 the next.
    expect(localDay(Date.UTC(2026, 2, 29, 21, 30), zone)).toBe("2026-03-29");
    expect(localDay(Date.UTC(2026, 2, 29, 22, 30), zone)).toBe("2026-03-30");
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15), zone)).toBe(HOUR);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15), zone)).toBe(2 * HOUR);
    // ISO weeks still start on the local Monday across the change.
    expect(isoWeekStart("2026-03-29")).toBe("2026-03-23");
    expect(isoWeekStart("2026-03-30")).toBe("2026-03-30");
  });

  it("T10-05 day arithmetic, months and the ISO week-year boundary", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysInclusive("2026-01-01", "2026-01-01")).toBe(1);
    expect(daysInclusive("2026-01-01", "2026-12-31")).toBe(365);
    expect(listDays("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(monthStart("2026-10-12")).toBe("2026-10-01");
    // 2027-01-01 is a Friday: it belongs to ISO week 53 of 2026.
    expect(isoWeekLabel("2027-01-01")).toBe("2026-W53");
    expect(isoWeekLabel("2026-12-28")).toBe("2026-W53");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-2-3")).toBeNull();
    expect(isValidTimeZone("Asia/Jakarta")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("resolvePeriod defaults to 90 days ending today in the user's zone and validates input", () => {
    const now = Date.UTC(2026, 9, 11, 18); // 2026-10-12 01:00 in Jakarta
    const period = resolvePeriod({}, { now, userTimeZone: "Asia/Jakarta" });
    expect(period).toMatchObject({
      to: "2026-10-12",
      from: "2026-07-15",
      tz: "Asia/Jakarta",
      days: 90,
    });
    expect(period.fromMs).toBe(startOfLocalDay("2026-07-15", "Asia/Jakarta"));
    expect(period.toMs).toBe(startOfLocalDay("2026-10-13", "Asia/Jakarta"));
    const utc = resolvePeriod(
      { from: "2026-10-01", to: "2026-10-11", tz: "UTC" },
      { now, userTimeZone: "Asia/Jakarta" }
    );
    expect(utc).toMatchObject({ days: 11, tz: "UTC" });
    const bad: Record<string, string>[] = [
      { tz: "Nowhere/City" },
      { from: "2026-02-30" },
      { from: "2026-10-05", to: "2026-10-01" },
      { from: "2000-01-01", to: "2026-10-01" },
    ];
    for (const query of bad) {
      let error: unknown = null;
      try {
        resolvePeriod(query, { now, userTimeZone: "UTC" });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("invalid_request");
    }
  });
});
