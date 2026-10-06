import { describe, expect, it } from "bun:test";
import { createTestEnv } from "../test/fakes";
import {
  createToken,
  hashToken,
  isAdminEmail,
  readBearer,
  resolveCaller,
  revokeTokenRow,
} from "./auth";
import type { Env } from "./env";
import { createBrowserSession, endBrowserSession } from "./session";

const HEX_64_RE = /^[0-9a-f]{64}$/;

function bearerRequest(token: string): Request {
  return new Request("https://api.pilihpendidikan.com/api/whoami", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function seedSession(env: Env, token: string, email: string) {
  await env.AUTH_KV.put(
    `auth:session:${await hashToken(token)}`,
    JSON.stringify({ email, createdAt: Date.now() })
  );
}

describe("hashToken", () => {
  it("produces a deterministic 64-char hex digest", async () => {
    const a = await hashToken("some-token");
    expect(a).toMatch(HEX_64_RE);
    expect(await hashToken("some-token")).toBe(a);
    expect(await hashToken("other-token")).not.toBe(a);
  });
});

describe("isAdminEmail", () => {
  it("matches ADMIN_EMAILS case-insensitively and ignores blanks", () => {
    const { env } = createTestEnv({ ADMIN_EMAILS: " Admin@Example.com , " });
    expect(isAdminEmail("admin@example.com", env)).toBe(true);
    expect(isAdminEmail("ADMIN@example.com ", env)).toBe(true);
    expect(isAdminEmail("someone@example.com", env)).toBe(false);
    expect(isAdminEmail("", env)).toBe(false);
  });

  it("treats an empty ADMIN_EMAILS as nobody", () => {
    const { env } = createTestEnv({ ADMIN_EMAILS: "" });
    expect(isAdminEmail("admin@example.com", env)).toBe(false);
  });
});

describe("readBearer", () => {
  it("prefers the Authorization header, then the session cookies", () => {
    const both = new Request("https://api.pilihpendidikan.com/", {
      headers: {
        Authorization: "Bearer header-token",
        Cookie: "__Host-session=cookie-token",
      },
    });
    expect(readBearer(both)).toBe("header-token");
    const cookieOnly = new Request("https://api.pilihpendidikan.com/", {
      headers: { Cookie: "other=1; __Host-session=cookie-token" },
    });
    expect(readBearer(cookieOnly)).toBe("cookie-token");
    const devCookie = new Request("http://localhost:8788/", {
      headers: { Cookie: "session=dev-token" },
    });
    expect(readBearer(devCookie)).toBe("dev-token");
  });
});

describe("resolveCaller", () => {
  it("returns no_bearer without credentials", async () => {
    const { env } = createTestEnv();
    const result = await resolveCaller(
      new Request("https://api.pilihpendidikan.com/api/whoami"),
      env
    );
    expect(result.caller).toBeNull();
    expect(result.reason).toBe("no_bearer");
  });

  it("returns unknown_token for a bearer that matches nothing", async () => {
    const { env } = createTestEnv();
    const result = await resolveCaller(bearerRequest("nope"), env);
    expect(result.caller).toBeNull();
    expect(result.reason).toBe("unknown_token");
  });

  it("resolves a KV session (looked up by hash, never plaintext)", async () => {
    const { env } = createTestEnv();
    await seedSession(env, "plain-value", "x@example.com");
    expect(await env.AUTH_KV.get("auth:session:plain-value")).toBeNull();
    const result = await resolveCaller(bearerRequest("plain-value"), env);
    expect(result.caller).toEqual({
      email: "x@example.com",
      isAdmin: false,
      scope: "write",
    });
  });

  it("elevates an ADMIN_EMAILS session", async () => {
    const { env } = createTestEnv();
    await seedSession(env, "sess-admin", "admin@example.com");
    const result = await resolveCaller(bearerRequest("sess-admin"), env);
    expect(result.caller?.isAdmin).toBe(true);
  });

  it("falls back to D1 for personal tokens and keeps their scope", async () => {
    const { env } = createTestEnv();
    await createToken(env.DB, {
      email: "Owner@Example.com",
      token: "pat-read",
      label: null,
      kind: "personal",
      scope: "read",
      expiresAt: null,
    });
    const result = await resolveCaller(bearerRequest("pat-read"), env);
    expect(result.caller).toEqual({
      email: "owner@example.com",
      isAdmin: false,
      scope: "read",
    });
    expect(result.tokenId).not.toBeNull();
  });

  it("rejects revoked and expired D1 tokens", async () => {
    const { env } = createTestEnv();
    const revoked = await createToken(env.DB, {
      email: "owner@example.com",
      token: "pat-gone",
      label: null,
      kind: "personal",
      scope: "write",
      expiresAt: null,
    });
    await revokeTokenRow(env.DB, revoked.id);
    expect((await resolveCaller(bearerRequest("pat-gone"), env)).reason).toBe(
      "revoked_token"
    );
    await createToken(env.DB, {
      email: "owner@example.com",
      token: "oauth-old",
      label: null,
      kind: "session",
      scope: "write",
      expiresAt: Date.now() - 1000,
    });
    expect((await resolveCaller(bearerRequest("oauth-old"), env)).reason).toBe(
      "expired_token"
    );
  });

  it("stores only hashes in D1", async () => {
    const { env, sqlite } = createTestEnv();
    await createToken(env.DB, {
      email: "owner@example.com",
      token: "secret-value",
      label: "x",
      kind: "personal",
      scope: "write",
      expiresAt: null,
    });
    const dump = JSON.stringify(sqlite.query("SELECT * FROM mcp_tokens").all());
    expect(dump).not.toContain("secret-value");
    expect(dump).toContain(await hashToken("secret-value"));
  });
});

describe("browser sessions", () => {
  it("work until signed out, then stop resolving through KV and D1", async () => {
    const { env } = createTestEnv();
    const token = await createBrowserSession(env, "User@Example.com");
    const before = await resolveCaller(bearerRequest(token), env);
    expect(before.caller?.email).toBe("user@example.com");
    await endBrowserSession(env, token);
    const after = await resolveCaller(bearerRequest(token), env);
    expect(after.caller).toBeNull();
    expect(after.reason).toBe("revoked_token");
  });
});
