import { describe, expect, it } from "bun:test";
import { createFakeClock } from "../../../test/fakes";
import { localDay, utcMonth } from "./clock";
import { etagFromHash, etagOf, ifNoneMatches } from "./etag";
import { ApiError } from "./http";
import {
  decodeCursor,
  encodeCursor,
  keysetAfter,
  pageOf,
  parsePage,
} from "./pagination";
import {
  cliUpgradeRequired,
  compareSemver,
  parseClientHeader,
  parseSemver,
} from "./version";

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err.code : "other";
  }
}

describe("TCORE-ROUTER pagination helpers (05 §1.5)", () => {
  it("TCORE-ROUTER parses limit/cursor and builds keyset pages", () => {
    expect(parsePage(new URLSearchParams())).toEqual({
      limit: 50,
      cursor: null,
    });
    expect(parsePage(new URLSearchParams("limit=200")).limit).toBe(200);
    for (const bad of ["0", "201", "1.5", "x"]) {
      expect(code(() => parsePage(new URLSearchParams(`limit=${bad}`)))).toBe(
        "invalid_request"
      );
    }
    const cursor = encodeCursor([1_700_000_000_000, "app_1"]);
    expect(decodeCursor(cursor)).toEqual([1_700_000_000_000, "app_1"]);
    expect(code(() => decodeCursor("!!"))).toBe("invalid_request");
    expect(code(() => decodeCursor(encodeCursor([])))).toBe("invalid_request");
    const rows = [1, 2, 3].map((n) => ({ id: `r${n}`, at: n }));
    const page = pageOf(rows, 2, (r) => [r.at, r.id]);
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.next_cursor as string)).toEqual([2, "r2"]);
    expect(pageOf(rows, 3, (r) => [r.at]).next_cursor).toBeNull();
    expect(keysetAfter(["created_at", "id"], [5, "x"], "desc")).toEqual({
      sql: "(created_at, id) < (?, ?)",
      binds: [5, "x"],
    });
    expect(keysetAfter(["a.updated_at"], null, "asc").sql).toBe("");
    expect(() => keysetAfter(["id; drop"], null, "asc")).toThrow();
  });
});

describe("TCORE-ROUTER ETags and versions", () => {
  it("TCORE-ROUTER strong ETags and If-None-Match", async () => {
    const a = await etagOf({ x: 1 });
    expect(a).toBe(await etagOf({ x: 1 }));
    expect(a).not.toBe(await etagOf({ x: 2 }));
    const request = new Request("https://x", {
      headers: { "If-None-Match": `W/${a}, "zz"` },
    });
    expect(ifNoneMatches(request, a)).toBe(true);
    expect(ifNoneMatches(new Request("https://x"), a)).toBe(false);
    expect(etagFromHash("ab")).toBe('"ab"');
  });

  it("TCORE-ROUTER semver precedence and the CLI header", () => {
    const v = (s: string) =>
      parseSemver(s) as NonNullable<ReturnType<typeof parseSemver>>;
    expect(compareSemver(v("1.0.0-alpha"), v("1.0.0"))).toBe(-1);
    expect(compareSemver(v("1.0.0-alpha.1"), v("1.0.0-alpha.beta"))).toBe(-1);
    expect(compareSemver(v("1.0.0-rc.1"), v("1.0.0-beta.11"))).toBe(1);
    expect(compareSemver(v("1.10.0"), v("1.9.9"))).toBe(1);
    expect(parseSemver("1.2")).toBeNull();
    expect(parseClientHeader("cli/0.1.0")).toMatchObject({
      kind: "cli",
      version: "0.1.0",
    });
    expect(parseClientHeader("web/1")).toEqual({
      kind: "other",
      value: "web/1",
    });
    expect(parseClientHeader(null)).toBeNull();
    expect(cliUpgradeRequired(parseClientHeader("web/0.0.1"), "9.0.0")).toBe(
      false
    );
    expect(cliUpgradeRequired(parseClientHeader("cli/0.0.9"), "0.1.0")).toBe(
      true
    );
  });

  it("TCORE-ROUTER clock helpers", () => {
    const clock = createFakeClock(Date.UTC(2026, 9, 31, 20));
    expect(utcMonth(clock.now())).toBe("2026-10");
    expect(localDay(clock.now(), "Asia/Jakarta")).toBe("2026-11-01");
    expect(localDay(clock.now(), "Not/AZone")).toBe("2026-10-31");
    clock.advance(1000);
    expect(clock.now()).toBe(Date.UTC(2026, 9, 31, 20, 0, 1));
  });
});
