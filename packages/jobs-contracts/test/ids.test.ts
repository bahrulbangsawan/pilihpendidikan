import { describe, expect, test } from "bun:test";
import vectors from "../test-vectors/ids.json" with { type: "json" };
import type { IdKind } from "../src/ids";
import {
  decodeUlidTime,
  encodeUlidTime,
  ID_MAX_CLOCK_SKEW_MS,
  ID_PREFIXES,
  idPattern,
  idPrefixOf,
  idTimestamp,
  isId,
  isIdWithinClockSkew,
  newId,
  newUlid,
} from "../src/ids";

const NOW = 1_791_770_000_000;

describe("prefixed ULIDs (03 §1)", () => {
  test("TC-IDS ID_PREFIXES lists every 00 §7 prefix plus obs_ and the cloud prefixes (24)", () => {
    const readme =
      "usr_ pst_ ujb_ app_ evt_ ivw_ ofr_ scr_ rul_ dev_ grt_ rft_ tsk_ att_ lse_ apr_ evd_ fil_ cvv_ run_ src_ fct_ ans_ eml_ sal_".split(
        " "
      );
    expect<string[]>([...ID_PREFIXES].sort()).toEqual(
      [...readme, "obs_", "csr_", "crn_"].sort()
    );
  });

  test("TC-IDS newId has the canonical shape for every prefix", () => {
    for (const prefix of ID_PREFIXES) {
      const id = newId(prefix, NOW);
      expect(id).toMatch(idPattern(prefix));
      expect(id).toHaveLength(prefix.length + 26);
      expect(isId(prefix, id)).toBe(true);
      expect(idPrefixOf(id)).toBe(prefix);
    }
  });

  test("TC-IDS newId accepts the prefix with or without the underscore", () => {
    expect(newId("app", NOW).startsWith("app_")).toBe(true);
    expect(newId("app_", NOW).startsWith("app_")).toBe(true);
    expect(isId("app", newId("app_", NOW))).toBe(true);
  });

  test("TC-IDS idTimestamp recovers the creation time", () => {
    const id = newId("evt", NOW);
    expect(idTimestamp(id)).toBe(NOW);
    expect(idTimestamp(id.slice(4))).toBe(NOW);
    expect(decodeUlidTime(newUlid(NOW))).toBe(NOW);
  });

  test("TC-IDS ids are unique and time-sortable", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => newId("app", NOW + i));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  test("TC-IDS malformed ids are rejected", () => {
    expect(isId("app", "app_01ja6v8m3w8z1t6q4y2b7k9c0d")).toBe(false);
    expect(isId("app", "evt_01JA6V8M3W8Z1T6Q4Y2B7K9C0D")).toBe(false);
    expect(isId("app", 42)).toBe(false);
    expect(idTimestamp("app_nope")).toBeNull();
    expect(idTimestamp("xyz_01JA6V8M3W8Z1T6Q4Y2B7K9C0D")).toBeNull();
    expect(idPrefixOf("xyz_01JA6V8M3W8Z1T6Q4Y2B7K9C0D")).toBeNull();
    expect(() => newId("zzz" as IdKind)).toThrow();
    expect(() => encodeUlidTime(-1)).toThrow();
    expect(() => encodeUlidTime(2 ** 48)).toThrow();
  });

  test("TC-IDS ±24 h clock-skew helper (03 §1)", () => {
    expect(ID_MAX_CLOCK_SKEW_MS).toBe(86_400_000);
    expect(isIdWithinClockSkew(newId("run", NOW), NOW)).toBe(true);
    expect(
      isIdWithinClockSkew(newId("run", NOW - ID_MAX_CLOCK_SKEW_MS), NOW)
    ).toBe(true);
    expect(
      isIdWithinClockSkew(newId("run", NOW + ID_MAX_CLOCK_SKEW_MS), NOW)
    ).toBe(true);
    expect(
      isIdWithinClockSkew(newId("run", NOW - ID_MAX_CLOCK_SKEW_MS - 1), NOW)
    ).toBe(false);
    expect(
      isIdWithinClockSkew(newId("run", NOW + ID_MAX_CLOCK_SKEW_MS + 1), NOW)
    ).toBe(false);
    expect(isIdWithinClockSkew("run_garbage", NOW)).toBe(false);
  });

  test.each(vectors.ulid_time.map((c) => [c.ms, c.time] as const))(
    "TC-IDS ULID time vector %p → %s",
    (ms, time) => {
      expect(encodeUlidTime(ms)).toBe(time);
      expect(decodeUlidTime(`${time}${"0".repeat(16)}`)).toBe(ms);
    }
  );

  test.each(vectors.validity.map((c) => [c.value, c.prefix, c.valid] as const))(
    "TC-IDS validity vector %s",
    (value, prefix, valid) => {
      expect(isId(prefix as IdKind, value)).toBe(valid);
    }
  );
});
