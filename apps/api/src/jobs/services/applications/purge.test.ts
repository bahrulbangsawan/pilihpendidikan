import { describe, expect, it } from "bun:test";
import { localDays } from "./purge";

describe("purge analytics days (10 §1, §5)", () => {
  it("TB-PURGE maps event times to distinct local days of the user's timezone", () => {
    const evening = Date.UTC(2026, 9, 12, 20, 0);
    const morning = Date.UTC(2026, 9, 12, 1, 0);
    expect(
      localDays([evening, morning, evening + 1000], "Asia/Jakarta")
    ).toEqual(["2026-10-12", "2026-10-13"]);
    expect(localDays([evening, morning], "UTC")).toEqual(["2026-10-12"]);
    expect(localDays([morning], "America/Los_Angeles")).toEqual(["2026-10-11"]);
  });

  it("TB-PURGE an unknown stored timezone falls back to Asia/Jakarta", () => {
    expect(localDays([Date.UTC(2026, 9, 12, 20, 0)], "Not/AZone")).toEqual([
      "2026-10-13",
    ]);
    expect(localDays([], "UTC")).toEqual([]);
  });
});
