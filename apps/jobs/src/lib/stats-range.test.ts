import { describe, expect, it } from "vitest";
import {
  ALL_TIME_FROM,
  intervalFor,
  isDay,
  rangeDays,
  resolveRange,
  validateStatsSearch,
} from "./stats-range";

// Local noon on 12 Oct 2026: presets count local calendar days.
const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime();

describe("TW-STATS date range (12 §9, 10 §5)", () => {
  it("TW-STATS presets resolve to inclusive from/to days ending today", () => {
    expect(resolveRange({ range: "30d" }, NOW)).toEqual({
      preset: "30d",
      from: "2026-09-13",
      to: "2026-10-12",
    });
    expect(resolveRange({}, NOW)).toEqual({
      preset: "90d",
      from: "2026-07-15",
      to: "2026-10-12",
    });
    expect(resolveRange({ range: "year" }, NOW)).toEqual({
      preset: "year",
      from: "2026-01-01",
      to: "2026-10-12",
    });
    expect(resolveRange({ range: "all" }, NOW)).toEqual({
      preset: "all",
      from: ALL_TIME_FROM,
      to: "2026-10-12",
    });
    expect(rangeDays(resolveRange({ range: "30d" }, NOW))).toBe(30);
    expect(rangeDays(resolveRange({ range: "90d" }, NOW))).toBe(90);
  });

  it("TW-STATS a custom range is used only when valid, else the default preset", () => {
    expect(
      resolveRange(
        { range: "custom", from: "2026-08-01", to: "2026-08-31" },
        NOW
      )
    ).toEqual({ preset: "custom", from: "2026-08-01", to: "2026-08-31" });
    const fallback = resolveRange({ range: "90d" }, NOW);
    // from after to, a future end, an impossible day, missing days
    for (const search of [
      { range: "custom" as const, from: "2026-09-01", to: "2026-08-01" },
      { range: "custom" as const, from: "2026-09-01", to: "2026-12-01" },
      { range: "custom" as const, from: "2026-02-30", to: "2026-03-01" },
      { range: "custom" as const },
    ]) {
      expect(resolveRange(search, NOW)).toEqual(fallback);
    }
  });

  it("TW-STATS validateStatsSearch keeps known values and drops the rest", () => {
    expect(
      validateStatsSearch({
        range: "30d",
        from: "2026-01-01",
        to: "nope",
        metric: "ai_cost",
        by: "mode",
        extra: "x",
      })
    ).toEqual({ range: "30d", from: "2026-01-01", by: "mode" });
    expect(validateStatsSearch({ range: "week", metric: "offers" })).toEqual({
      metric: "offers",
    });
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
  });

  it("TW-STATS weekly buckets up to a year, monthly beyond", () => {
    expect(intervalFor({ from: "2026-07-15", to: "2026-10-12" })).toBe("week");
    expect(intervalFor({ from: "2025-10-12", to: "2026-10-12" })).toBe("week");
    expect(intervalFor({ from: ALL_TIME_FROM, to: "2026-10-12" })).toBe(
      "month"
    );
  });
});
