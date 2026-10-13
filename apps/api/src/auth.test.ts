import { describe, expect, it } from "bun:test";
import { OAUTH_SCOPES } from "@pilihpendidikan/jobs-contracts/enums";
import { isId } from "@pilihpendidikan/jobs-contracts/ids";
import { createCtx, createTestEnv } from "../test/fakes";
import {
  BROWSER_SESSION_LABEL,
  createToken,
  credentialKindOf,
  hashToken,
  isAdminEmail,
  readBearer,
  resolveCaller,
  revokeTokenRow,
} from "./auth";
import type { Env } from "./env";
import {
  BROWSER_SESSION_SCOPES,
  CLI_BASE_SCOPES,
  formatScopeList,
  legacyScopeFor,
  MCP_OAUTH_SCOPES,
  PERSONAL_READ_SCOPES,
  PERSONAL_WRITE_SCOPES,
  parseScopeList,
  scopesForCredential,
} from "./jobs/core/scopes";
import { routeAuth } from "./routes/auth";
import { createBrowserSession, endBrowserSession } from "./session";

const HEX_64_RE = /^[0-9a-f]{64}$/;
const VERIFY_LINK_RE = /\/auth\/verify\?t=([\w%-]+)/;

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
    expect(result.caller).toMatchObject({
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
    expect(result.caller).toMatchObject({
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

describe("TCORE-CALLER the extended Caller (03 §2, PLAN C4)", () => {
  it("TCORE-CALLER lazily creates exactly one users row per email", async () => {
    const { env, sqlite } = createTestEnv();
    await seedSession(env, "s1", "Lazy@Example.com");
    await seedSession(env, "s2", "lazy@example.com");
    const [a, b] = await Promise.all([
      resolveCaller(bearerRequest("s1"), env),
      resolveCaller(bearerRequest("s2"), env),
    ]);
    expect(a.caller?.userId).toBe(b.caller?.userId as string);
    expect(isId("usr", a.caller?.userId)).toBe(true);
    const rows = sqlite
      .query("SELECT id, email FROM users WHERE email = 'lazy@example.com'")
      .all();
    expect(rows).toHaveLength(1);
  });

  it("TCORE-CALLER resolves a KV browser session to the browser scope set", async () => {
    const { env } = createTestEnv();
    await seedSession(env, "kv-session", "web@example.com");
    const { caller } = await resolveCaller(bearerRequest("kv-session"), env);
    expect(caller).toMatchObject({
      credentialKind: "browser_session",
      deviceId: null,
      grantId: null,
      tokenId: null,
      userDeletedAt: null,
    });
    expect(caller?.scopes).toEqual(BROWSER_SESSION_SCOPES);
    expect(caller?.scopes).toContain("ai:invoke");
    expect(caller?.scopes).not.toContain("automation:execute");
  });

  it("TCORE-CALLER classifies D1 session rows: browser sign-in vs MCP OAuth", async () => {
    const { env } = createTestEnv();
    const token = await createBrowserSession(env, "both@example.com");
    // Drop the KV record: the D1 fallback must still say "browser session".
    await env.AUTH_KV.delete(`auth:session:${await hashToken(token)}`);
    const browser = await resolveCaller(bearerRequest(token), env);
    expect(browser.caller?.credentialKind).toBe("browser_session");
    expect(browser.caller?.tokenId).not.toBeNull();
    await createToken(env.DB, {
      email: "both@example.com",
      token: "mcp-oauth",
      label: "OAuth: Claude",
      kind: "session",
      scope: "write",
      expiresAt: Date.now() + 60_000,
    });
    const mcp = await resolveCaller(bearerRequest("mcp-oauth"), env);
    expect(mcp.caller?.credentialKind).toBe("oauth_mcp");
    expect(mcp.caller?.scopes).toEqual(MCP_OAUTH_SCOPES);
    expect(mcp.caller?.userId).toBe(browser.caller?.userId as string);
  });

  it("TCORE-CALLER maps personal tokens and backfills mcp_tokens.user_id", async () => {
    const { env, sqlite } = createTestEnv();
    const row = await createToken(env.DB, {
      email: "pat@example.com",
      token: "pat-w",
      label: null,
      kind: "personal",
      scope: "write",
      expiresAt: null,
    });
    const { caller } = await resolveCaller(bearerRequest("pat-w"), env);
    expect(caller?.credentialKind).toBe("personal_write");
    expect(caller?.scopes).toEqual(PERSONAL_WRITE_SCOPES);
    const stored = sqlite
      .query("SELECT user_id FROM mcp_tokens WHERE id = ?")
      .get(row.id) as { user_id: string };
    expect(stored.user_id).toBe(caller?.userId as string);
  });

  it("TCORE-CALLER reads scopes, grant and device from kind='oauth' rows", async () => {
    const { env } = createTestEnv();
    await createToken(env.DB, {
      email: "cli@example.com",
      token: "cli-token",
      label: "pilih-jobs CLI",
      kind: "oauth",
      scope: "read",
      expiresAt: Date.now() + 3_600_000,
      scopes: "jobs:read automation:execute bogus:scope",
      grantId: "grt_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
      deviceId: "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
    });
    const { caller } = await resolveCaller(bearerRequest("cli-token"), env);
    expect(caller).toMatchObject({
      credentialKind: "oauth_cli",
      grantId: "grt_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
      deviceId: "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
      scope: "read",
    });
    expect(caller?.scopes).toEqual(["jobs:read", "automation:execute"]);
  });

  it("TCORE-CALLER reports a tombstoned user (11 §10)", async () => {
    const { env, sqlite } = createTestEnv();
    await seedSession(env, "gone", "gone@example.com");
    const first = await resolveCaller(bearerRequest("gone"), env);
    sqlite
      .query("UPDATE users SET deleted_at = 5 WHERE id = ?")
      .run(first.caller?.userId as string);
    const again = await resolveCaller(bearerRequest("gone"), env);
    expect(again.caller?.userDeletedAt).toBe(5);
  });

  it("TCORE-CALLER stamps the user id on new browser-session rows", async () => {
    const { env, sqlite } = createTestEnv();
    await createBrowserSession(env, "stamp@example.com");
    const row = sqlite
      .query("SELECT label, user_id FROM mcp_tokens WHERE user_email = ?")
      .get("stamp@example.com") as { label: string; user_id: string };
    expect(row.label).toBe(BROWSER_SESSION_LABEL);
    expect(isId("usr", row.user_id)).toBe(true);
  });
});

describe("TCORE-SCOPES credential → scope map (05 §1.2)", () => {
  it("TCORE-SCOPES browser sessions get everything but automation:execute", () => {
    expect([...BROWSER_SESSION_SCOPES]).toEqual(
      OAUTH_SCOPES.filter((s) => s !== "automation:execute")
    );
  });

  it("TCORE-SCOPES write personal tokens: no automation or AI spend", () => {
    for (const forbidden of [
      "automation:execute",
      "automation:manage",
      "ai:invoke",
    ] as const) {
      expect(PERSONAL_WRITE_SCOPES).not.toContain(forbidden);
    }
    expect(PERSONAL_WRITE_SCOPES).toContain("jobs:write");
    expect(PERSONAL_WRITE_SCOPES).toContain("devices:manage");
  });

  it("TCORE-SCOPES read personal tokens: jobs:read cv:read files:read", () => {
    expect([...PERSONAL_READ_SCOPES]).toEqual([
      "jobs:read",
      "cv:read",
      "files:read",
    ]);
  });

  it("TCORE-SCOPES MCP OAuth equals write personal tokens; CLI base excludes manage", () => {
    expect(MCP_OAUTH_SCOPES).toEqual(PERSONAL_WRITE_SCOPES);
    expect(CLI_BASE_SCOPES).not.toContain("automation:manage");
    expect(CLI_BASE_SCOPES).not.toContain("devices:manage");
    expect(CLI_BASE_SCOPES).toContain("automation:execute");
  });

  it("TCORE-SCOPES parses stored scope strings (unknown dropped, mcp expanded)", () => {
    expect(parseScopeList("files:read  jobs:read nope")).toEqual([
      "jobs:read",
      "files:read",
    ]);
    expect(parseScopeList("mcp")).toEqual([...MCP_OAUTH_SCOPES]);
    expect(parseScopeList(null)).toEqual([]);
    expect(formatScopeList(["files:read", "jobs:read", "x"])).toBe(
      "jobs:read files:read"
    );
    expect(scopesForCredential("oauth_cli", "jobs:write")).toEqual([
      "jobs:write",
    ]);
    expect(legacyScopeFor(["jobs:write"])).toBe("write");
    expect(legacyScopeFor(["jobs:read"])).toBe("read");
  });

  it("TCORE-SCOPES classifies token rows", () => {
    const base = { scopes: null, scope: "write" as const, label: null };
    expect(credentialKindOf({ ...base, kind: "personal" })).toBe(
      "personal_write"
    );
    expect(credentialKindOf({ ...base, kind: "personal", scope: "read" })).toBe(
      "personal_read"
    );
    expect(
      credentialKindOf({
        ...base,
        kind: "session",
        label: BROWSER_SESSION_LABEL,
      })
    ).toBe("browser_session");
    expect(
      credentialKindOf({ ...base, kind: "session", label: "OAuth: X" })
    ).toBe("oauth_mcp");
    expect(credentialKindOf({ ...base, kind: "oauth", scopes: "mcp" })).toBe(
      "oauth_mcp"
    );
    expect(
      credentialKindOf({ ...base, kind: "oauth", scopes: "jobs:read" })
    ).toBe("oauth_cli");
  });
});

// S-01 (13 §5): `POST /auth/verify` answers 303 to the record's `returnTo`
// app, and CSP `form-action` also governs that redirect, so the confirm page
// must allow exactly that (validated) origin.
describe("TFIX-CONFIRM-CSP the confirm sign-in page allows its return origin", () => {
  const PROD_API = "https://api.pilihpendidikan.com";
  const DEV_API = "http://localhost:8788";

  function formActionOf(res: Response): string {
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const directive = csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("form-action "));
    return directive ?? "";
  }

  // The real request flow: `POST /auth/request` validates `returnTo` and
  // emails the link; the token comes back out of the sent email.
  async function requestLink(
    t: ReturnType<typeof createTestEnv>,
    base: string,
    body: Record<string, string>
  ): Promise<string> {
    const ctx = createCtx();
    const res = await routeAuth(
      new Request(`${base}/auth/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      t.env,
      ctx,
      new URL(`${base}/auth/request`)
    );
    expect(res?.status).toBe(200);
    await ctx.drain();
    const match = t.sent.at(-1)?.text.match(VERIFY_LINK_RE);
    if (!match) {
      throw new Error("no sign-in link in the last email");
    }
    return decodeURIComponent(match[1]);
  }

  async function confirmPage(
    t: ReturnType<typeof createTestEnv>,
    base: string,
    token: string
  ): Promise<Response> {
    const url = new URL(`${base}/auth/verify?t=${encodeURIComponent(token)}`);
    const res = await routeAuth(new Request(url), t.env, createCtx(), url);
    if (!res) {
      throw new Error("/auth/verify did not route");
    }
    expect(res.status).toBe(200);
    return res;
  }

  async function seedMagicRecord(
    env: Env,
    token: string,
    returnTo: string | null
  ): Promise<void> {
    await env.AUTH_KV.put(
      `auth:magic:${await hashToken(token)}`,
      JSON.stringify({ email: "forged@example.com", returnTo })
    );
  }

  it("TFIX-CONFIRM-CSP adds the jobs app origin of the magic record (production)", async () => {
    const t = createTestEnv();
    const token = await requestLink(t, PROD_API, {
      email: "s01@example.com",
      returnTo: "https://jobs.pilihpendidikan.com",
    });
    const res = await confirmPage(t, PROD_API, token);
    expect(formActionOf(res)).toBe(
      "form-action 'self' https://jobs.pilihpendidikan.com"
    );
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
  });

  it("TFIX-CONFIRM-CSP adds the local dashboard origin under wrangler dev", async () => {
    const t = createTestEnv();
    const token = await requestLink(t, DEV_API, {
      email: "s01@example.com",
      returnTo: "http://localhost:4007",
    });
    const res = await confirmPage(t, DEV_API, token);
    expect(formActionOf(res)).toBe("form-action 'self' http://localhost:4007");
  });

  it("TFIX-CONFIRM-CSP keeps form-action 'self' for a record without returnTo", async () => {
    const t = createTestEnv();
    const token = await requestLink(t, PROD_API, { email: "s01@example.com" });
    const res = await confirmPage(t, PROD_API, token);
    expect(formActionOf(res)).toBe("form-action 'self'");
  });

  it("TFIX-CONFIRM-CSP never widens form-action to an origin off the app allow-list", async () => {
    const t = createTestEnv();
    // A foreign returnTo is dropped when the link is requested …
    const requested = await requestLink(t, PROD_API, {
      email: "s01@example.com",
      returnTo: "https://evil.example",
    });
    expect(formActionOf(await confirmPage(t, PROD_API, requested))).toBe(
      "form-action 'self'"
    );
    // … and a stored value is re-checked: a foreign origin, or a localhost
    // app port read by the production Worker, adds nothing.
    await seedMagicRecord(t.env, "forged-foreign", "https://evil.example");
    expect(formActionOf(await confirmPage(t, PROD_API, "forged-foreign"))).toBe(
      "form-action 'self'"
    );
    await seedMagicRecord(t.env, "forged-dev", "http://localhost:4007");
    expect(formActionOf(await confirmPage(t, PROD_API, "forged-dev"))).toBe(
      "form-action 'self'"
    );
  });
});
