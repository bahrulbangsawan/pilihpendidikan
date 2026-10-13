import { describe, expect, it } from "bun:test";
import {
  checkUrl,
  clampClientTime,
  domainOfUrl,
  excludedHostOf,
  findForbiddenString,
  hasForbiddenCharacters,
  truncateUtf8,
  urlsInConfig,
} from "./validation";

describe("TD-BATCH-LIMITS input hygiene helpers", () => {
  it("TD-BATCH-LIMITS control characters, DEL and unpaired surrogates are forbidden; TAB/LF/CR are not", () => {
    expect(hasForbiddenCharacters("plain text\twith\nlines\r\n")).toBe(false);
    expect(hasForbiddenCharacters("emoji 🚀 pairs fine")).toBe(false);
    expect(hasForbiddenCharacters("nul\u0000")).toBe(true);
    expect(hasForbiddenCharacters("bell\u0007")).toBe(true);
    expect(hasForbiddenCharacters("del\u007f")).toBe(true);
    expect(hasForbiddenCharacters("lone \ud800 high")).toBe(true);
    expect(hasForbiddenCharacters("lone \udc00 low")).toBe(true);
    expect(
      hasForbiddenCharacters(
        `${String.fromCharCode(0x20_0b)} zero width is a format char, allowed`
      )
    ).toBe(false);
  });

  it("TD-BATCH-LIMITS findForbiddenString reports the JSON path, keys included", () => {
    expect(findForbiddenString({ a: [{ b: "ok" }, { c: "x\u0001" }] })).toBe(
      "a[1].c"
    );
    expect(findForbiddenString({ "k\u0002": 1 })).toBe("k\u0002");
    expect(findForbiddenString("x\u0000")).toBe("$");
    expect(findForbiddenString({ fine: ["a", 1, null, true] })).toBeNull();
  });

  it("TD-MANUAL-URL checkUrl implements the T-08 syntax rules", () => {
    expect(
      checkUrl("https://acme.com/jobs/1", { allowHttp: false })
    ).toBeNull();
    expect(checkUrl("http://acme.com/jobs/1", { allowHttp: false })).toBe(
      "scheme"
    );
    expect(checkUrl("http://acme.com/jobs/1", { allowHttp: true })).toBeNull();
    expect(checkUrl("https://a:b@acme.com/", { allowHttp: true })).toBe(
      "userinfo"
    );
    expect(checkUrl("https://a@acme.com/", { allowHttp: true })).toBe(
      "userinfo"
    );
    expect(checkUrl("data:text/html,x", { allowHttp: true })).toBe("scheme");
    expect(checkUrl("not a url", { allowHttp: true })).toBe("malformed");
    expect(
      checkUrl(`https://acme.com/${"a".repeat(2048)}`, { allowHttp: true })
    ).toBe("length");
  });

  it("S-29 excluded hosts match LinkedIn, lnkd.in and every indeed.* domain", () => {
    expect(excludedHostOf("https://www.linkedin.com/jobs/view/1")).toBe(
      "linkedin"
    );
    expect(excludedHostOf("lnkd.in")).toBe("linkedin");
    expect(excludedHostOf("https://id.indeed.com/viewjob")).toBe("indeed");
    expect(excludedHostOf("https://uk.indeed.co.uk/")).toBe("indeed");
    expect(excludedHostOf("https://notlinkedin.com/")).toBeNull();
    expect(excludedHostOf("https://boards.greenhouse.io/acme")).toBeNull();
    expect(excludedHostOf(null)).toBeNull();
  });

  it("S-29 urlsInConfig finds every URL in nested configs", () => {
    expect(
      urlsInConfig({
        url: "https://a.com",
        nested: { list: ["x", "http://b.com/y"] },
        n: 3,
      })
    ).toEqual([
      { path: "config.url", url: "https://a.com" },
      { path: "config.nested.list[1]", url: "http://b.com/y" },
    ]);
  });

  it("TD-BATCH-LIMITS truncateUtf8 cuts on a character boundary", () => {
    const text = "aé€😀".repeat(10);
    for (let max = 1; max < 40; max++) {
      const cut = truncateUtf8(text, max);
      expect(new TextEncoder().encode(cut.text).byteLength).toBeLessThanOrEqual(
        max
      );
      expect(text.startsWith(cut.text)).toBe(true);
      expect(cut.truncated).toBe(true);
    }
    expect(truncateUtf8("short", 64)).toEqual({
      text: "short",
      truncated: false,
    });
  });

  it("TD-BATCH-LIMITS client timestamps ahead of the server are clamped; > 24 h is flagged (20 §9)", () => {
    const now = 1_000_000_000;
    expect(clampClientTime(now - 5, now)).toEqual({
      value: now - 5,
      clamped: false,
      flagged: false,
    });
    expect(clampClientTime(now + 60_000, now)).toEqual({
      value: now,
      clamped: true,
      flagged: false,
    });
    expect(clampClientTime(now + 90_000_000, now)).toEqual({
      value: now,
      clamped: true,
      flagged: true,
    });
  });

  it("TD-MANUAL-URL apply_domain is the registrable domain, never a non-domain host", () => {
    expect(domainOfUrl("https://jobs.acme.co.uk/a")).toBe("acme.co.uk");
    expect(domainOfUrl("https://boards.greenhouse.io/acme/jobs/1")).toBe(
      "greenhouse.io"
    );
    expect(domainOfUrl("http://192.168.1.10:8080/jobs")).toBe("192.168.1.10");
    expect(domainOfUrl("http://[::1]:8080/jobs")).toBeNull();
    expect(domainOfUrl(null)).toBeNull();
  });

  it("TD-BATCH-LIMITS deeply nested values are refused instead of exhausting the stack", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 50_000; i++) {
      deep = [deep];
    }
    expect(findForbiddenString({ extraction: deep })).toStartWith("extraction");
    let ok: unknown = "leaf";
    for (let i = 0; i < 10; i++) {
      ok = { a: ok };
    }
    expect(findForbiddenString(ok)).toBeNull();
  });
});
