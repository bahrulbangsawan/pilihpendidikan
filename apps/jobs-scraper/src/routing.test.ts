import { describe, expect, test } from "bun:test";
import {
  stringHash,
  instanceName,
  MAX_BODY_BYTES,
  poolSize,
  routeRequest,
  routingKey,
} from "./routing";

const POOL_NAME = /^pool-[0-2]$/;

describe("scraper worker routing (24 §3)", () => {
  test("forwards only the protocol endpoints", () => {
    expect(routeRequest("GET", "/healthz", null)).toEqual({ kind: "health" });
    expect(routeRequest("POST", "/v1/scrape", "120")).toEqual({
      kind: "forward",
      path: "/v1/scrape",
    });
    expect(routeRequest("POST", "/v1/probe", null).kind).toBe("forward");
    expect(routeRequest("POST", "/v1/directory", null).kind).toBe("forward");
    expect(routeRequest("POST", "/v1/other", null)).toEqual({
      kind: "reject",
      status: 404,
    });
    expect(routeRequest("GET", "/", null)).toEqual({
      kind: "reject",
      status: 404,
    });
    expect(routeRequest("GET", "/v1/scrape", null)).toEqual({
      kind: "reject",
      status: 405,
    });
    expect(routeRequest("POST", "/healthz", null)).toEqual({
      kind: "reject",
      status: 405,
    });
  });

  test("routes the scheduler fallback clock (24 §6.6)", () => {
    expect(routeRequest("POST", "/clock/ensure", null)).toEqual({
      kind: "clock",
      action: "ensure",
    });
    expect(routeRequest("GET", "/clock", null)).toEqual({
      kind: "clock",
      action: "status",
    });
    expect(routeRequest("GET", "/clock/ensure", null)).toEqual({
      kind: "reject",
      status: 405,
    });
    expect(routeRequest("POST", "/clock", null)).toEqual({
      kind: "reject",
      status: 405,
    });
  });

  test("refuses bodies over 4 MB", () => {
    expect(
      routeRequest("POST", "/v1/scrape", String(MAX_BODY_BYTES + 1))
    ).toEqual({
      kind: "reject",
      status: 413,
    });
    expect(routeRequest("POST", "/v1/scrape", "not-a-number").kind).toBe(
      "reject"
    );
  });

  test("routes a domain to one stable instance", () => {
    const scrape = { source: { canonical_domain: "WeWorkRemotely.com" } };
    expect(routingKey(scrape)).toBe("weworkremotely.com");
    expect(routingKey({ url: "https://www.workfromhome.id/jobs?page=2" })).toBe(
      "www.workfromhome.id"
    );
    expect(routingKey({ directory: { url: "https://bahrul.me/tools" } })).toBe(
      "bahrul.me"
    );
    expect(routingKey(null)).toBe("");
    expect(routingKey({ source: {} })).toBe("");
    const name = instanceName("weworkremotely.com", 3);
    expect(name).toMatch(POOL_NAME);
    expect(instanceName("weworkremotely.com", 3)).toBe(name);
    expect(stringHash("")).toBe(7);
    const spread = new Set(
      [
        "a.com",
        "b.com",
        "c.com",
        "d.com",
        "e.com",
        "f.com",
        "g.com",
        "h.com",
      ].map((d) => instanceName(d, 3))
    );
    expect(spread.size).toBeGreaterThan(1);
  });

  test("pool size is clamped to a sane integer", () => {
    expect(poolSize("3")).toBe(3);
    expect(poolSize(undefined)).toBe(1);
    expect(poolSize("0")).toBe(1);
    expect(poolSize("abc")).toBe(1);
    expect(poolSize("99")).toBe(1);
  });
});
