import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allowedOrigins,
  applyEdgePolicy,
  checkServerFnRequest,
  contentSecurityPolicy,
  FRAMEABLE_HEADER,
  NONCE_HEADER,
  STATIC_SECURITY_HEADERS,
} from "./edge-policy";

const NONCE_RE = /^[A-Za-z0-9+/]{22}==$/;
const APP = "https://jobs.pilihpendidikan.com";
const FN_URL = `${APP}/_serverFn/eyJmaWxlIjoiL3NyYy9mdW5jdGlvbnMvYXBpLmZ1bmN0aW9ucy50cyJ9`;

function post(headers: Record<string, string>, url = FN_URL): Request {
  return new Request(url, { method: "POST", headers, body: "{}" });
}

const origins = allowedOrigins(new URL(APP), APP);

describe("T11-CSRF server-function POSTs", () => {
  it("T11-CSRF rejects a cross-origin server-function POST with 403", async () => {
    const refused = checkServerFnRequest(
      post({ Origin: "https://evil.example" }),
      origins
    );
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toMatchObject({ error: "forbidden" });
  });

  it("T11-CSRF rejects a sibling subdomain (same-site is not same-origin)", () => {
    expect(
      checkServerFnRequest(
        post({ Origin: "https://cv.pilihpendidikan.com" }),
        origins
      )?.status
    ).toBe(403);
    expect(
      checkServerFnRequest(
        post({ Origin: APP, "Sec-Fetch-Site": "same-site" }),
        origins
      )?.status
    ).toBe(403);
  });

  it("T11-CSRF rejects http:// for an https app (scheme counts)", () => {
    expect(
      checkServerFnRequest(
        post({ Origin: "http://jobs.pilihpendidikan.com" }),
        origins
      )?.status
    ).toBe(403);
  });

  it("T11-CSRF rejects a POST with no Origin and no Sec-Fetch-Site, or Origin: null", () => {
    expect(checkServerFnRequest(post({}), origins)?.status).toBe(403);
    expect(
      checkServerFnRequest(post({ Origin: "null" }), origins)?.status
    ).toBe(403);
  });

  it("T11-CSRF lets the app's own POST through", () => {
    expect(checkServerFnRequest(post({ Origin: APP }), origins)).toBeNull();
    expect(
      checkServerFnRequest(
        post({ Origin: "null", "Sec-Fetch-Site": "same-origin" }),
        origins
      )
    ).toBeNull();
  });

  it("T11-CSRF refuses a cross-site fetch of a GET server function too", () => {
    const get = new Request(FN_URL, {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(checkServerFnRequest(get, origins)?.status).toBe(403);
    expect(checkServerFnRequest(new Request(FN_URL), origins)).toBeNull();
  });

  it("T11-CSRF the edge refuses before the app handler runs", async () => {
    let called = false;
    const response = await applyEdgePolicy(
      post({ Origin: "https://evil.example" }),
      () => {
        called = true;
        return new Response("ok");
      },
      { appOrigin: APP, dev: false }
    );
    expect(response.status).toBe(403);
    expect(called).toBe(false);
  });

  it("T11-CSRF on localhost the dev origin is the allowed one", () => {
    const local = allowedOrigins(new URL("http://localhost:4007/board"), APP);
    expect(local).toEqual(["http://localhost:4007"]);
    expect(
      checkServerFnRequest(
        post(
          { Origin: "http://localhost:4007" },
          "http://localhost:4007/_serverFn/x"
        ),
        local
      )
    ).toBeNull();
    expect(
      checkServerFnRequest(
        post(
          { Origin: "http://localhost:4003" },
          "http://localhost:4007/_serverFn/x"
        ),
        local
      )?.status
    ).toBe(403);
  });
});

describe("security headers (12 §1)", () => {
  it("HTML gets a nonce CSP, frame-ancestors none, same-origin referrer and noindex", async () => {
    let seenNonce: string | null = null;
    const response = await applyEdgePolicy(
      new Request(`${APP}/board`, { headers: { [NONCE_HEADER]: "forged" } }),
      (request) => {
        seenNonce = request.headers.get(NONCE_HEADER);
        return new Response("<html></html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      { appOrigin: APP, dev: false }
    );
    expect(seenNonce).not.toBe("forged");
    expect(seenNonce).toMatch(NONCE_RE);
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain(`'nonce-${seenNonce}'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline' 'unsafe-eval'");
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("dev relaxes only script-src and connect-src", () => {
    const dev = contentSecurityPolicy("n", true);
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy("n", false)).toContain(
      "'nonce-n' 'strict-dynamic'"
    );
  });

  it("public/_headers carries the same fixed headers as the Worker", () => {
    const file = readFileSync(
      new URL("../../public/_headers", import.meta.url),
      "utf8"
    );
    for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
      expect(file).toContain(`${name}: ${value}`);
    }
  });
});

describe("TW-RENDER render page and inline PDF headers (08 §6.4, §7)", () => {
  const html = () =>
    new Response("<html></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  it("TW-RENDER /render/* is no-store, no-referrer, noindex with a strict CSP", async () => {
    const response = await applyEdgePolicy(
      new Request(`${APP}/render/cv/cvv_01JA0000000000000000000000?ticket=abc`),
      html,
      { appOrigin: APP, dev: false }
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    for (const directive of [
      "default-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "connect-src 'self'",
      "'wasm-unsafe-eval'",
      "'strict-dynamic'",
    ]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline' 'unsafe-eval'");
  });

  it("TW-RENDER pages keep same-origin referrers and allow the PDF engine's WebAssembly only", async () => {
    const response = await applyEdgePolicy(new Request(`${APP}/board`), html, {
      appOrigin: APP,
      dev: false,
    });
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("frame-src 'self'");
  });

  it("TW-RENDER only the marked inline PDF may be framed, by the app itself", async () => {
    const framed = await applyEdgePolicy(
      new Request(`${APP}/download/files/fil_x/content?inline=1`),
      () =>
        new Response("%PDF-", {
          headers: {
            "Content-Type": "application/pdf",
            [FRAMEABLE_HEADER]: "same-origin",
          },
        }),
      { appOrigin: APP, dev: false }
    );
    expect(framed.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(framed.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'self'"
    );
    expect(framed.headers.has(FRAMEABLE_HEADER)).toBe(false);
    const plain = await applyEdgePolicy(
      new Request(`${APP}/download/files/fil_x/content`),
      () =>
        new Response("%PDF-", {
          headers: { "Content-Type": "application/pdf" },
        }),
      { appOrigin: APP, dev: false }
    );
    expect(plain.headers.get("X-Frame-Options")).toBe("DENY");
    expect(plain.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
  });
});
