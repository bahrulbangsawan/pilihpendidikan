import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APEX_ORIGIN,
  applyEdgePolicy,
  HTML_CACHE_CONTROL,
  SECURITY_HEADERS,
} from "./edge-policy";

const page = () =>
  new Response("<!doctype html>", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

describe("www → apex", () => {
  it("301s www to the same path and query on the apex", async () => {
    let called = false;
    const response = await applyEdgePolicy(
      new Request("https://www.pilihpendidikan.com/id?x=1"),
      () => {
        called = true;
        return page();
      }
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(`${APEX_ORIGIN}/id?x=1`);
    expect(called).toBe(false);
  });

  it("serves the apex without redirecting", async () => {
    const response = await applyEdgePolicy(
      new Request("https://pilihpendidikan.com/"),
      page
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
  });
});

describe("security headers", () => {
  it("adds every header and the HTML cache policy to a page", async () => {
    const response = await applyEdgePolicy(
      new Request("https://pilihpendidikan.com/"),
      page
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
    expect(response.headers.get("Cache-Control")).toBe(HTML_CACHE_CONTROL);
  });

  it("adds them to redirects and non-HTML responses too", async () => {
    const redirect = await applyEdgePolicy(
      new Request("https://www.pilihpendidikan.com/"),
      page
    );
    const text = await applyEdgePolicy(
      new Request("https://pilihpendidikan.com/llms.txt"),
      () => new Response("# llms", { headers: { "Cache-Control": "x" } })
    );
    for (const response of [redirect, text]) {
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    }
    expect(text.headers.get("Cache-Control")).toBe("x");
  });

  it("public/_headers carries the same set for static assets", () => {
    const file = readFileSync(
      resolve(import.meta.dirname, "../../public/_headers"),
      "utf8"
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(file).toContain(`  ${name}: ${value}\n`);
    }
  });
});
