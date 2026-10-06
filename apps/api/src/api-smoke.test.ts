import { beforeEach, describe, expect, it } from "bun:test";
import type { TestEnv } from "../test/fakes";
import { createCtx, createTestEnv } from "../test/fakes";
import { createApp } from "./app";
import { createToken, hashToken } from "./auth";
import type { McpProps, TokenScope } from "./env";
import type { McpHandler } from "./routes/mcp";

// Smoke test of the whole HTTP surface through the real router with fake
// bindings: every route answers with the right status, headers and shape.

const PROD = "https://api.pilihpendidikan.com";
const DEV = "http://localhost:8788";
const CV_ORIGIN = "https://cv.pilihpendidikan.com";
const LINK_RE =
  /https?:\/\/[^\s"<]+\/(?:auth\/verify\?t|oauth\/magic\?token)=[\w%-]+/;
const BASE64_PAD_RE = /=+$/;
const NEW_TOKEN_RE = /id="new-token" type="text" readonly value="([^"]+)"/;

interface McpCall {
  url: string;
  props: McpProps | undefined;
}

let t: TestEnv;
let mcpCalls: McpCall[];
let app: ReturnType<typeof createApp>;

const fakeMcp: McpHandler = {
  fetch(request, _env, ctx) {
    mcpCalls.push({
      url: request.url,
      props: (ctx as unknown as { props?: McpProps }).props,
    });
    return new Response("mcp-ok");
  },
};

beforeEach(() => {
  t = createTestEnv();
  mcpCalls = [];
  app = createApp({ sse: fakeMcp, streamable: fakeMcp });
});

// Form posts get the `Origin` a browser would send from a page on this
// Worker, unless the test opts out with `noOrigin`.
async function call(
  path: string,
  init: RequestInit & { base?: string; noOrigin?: boolean } = {}
): Promise<Response> {
  const ctx = createCtx();
  const base = init.base ?? PROD;
  const headers = new Headers(init.headers);
  if (
    init.body instanceof URLSearchParams &&
    !init.noOrigin &&
    !headers.has("Origin")
  ) {
    headers.set("Origin", base);
  }
  const response = await app.fetch(
    new Request(`${base}${path}`, { ...init, headers }),
    t.env,
    ctx
  );
  await ctx.drain();
  return response;
}

async function token(
  email: string,
  scope: TokenScope = "write"
): Promise<string> {
  const value = `tok-${email}-${scope}`;
  await createToken(t.env.DB, {
    email,
    token: value,
    label: null,
    kind: "personal",
    scope,
    expiresAt: null,
  });
  return value;
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function auth(bearer: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${bearer}`, ...extra };
}

const CV_DOC = {
  personalInfo: { fullName: "Alice Doe", jobTitle: "Engineer" },
  sectionOrder: ["summary"],
  summary: "Hi",
};

async function seedCv(id: string, owner: string) {
  await t.env.CV_KV.put(`cv:${id}`, JSON.stringify(CV_DOC), {
    metadata: { fullName: "Alice Doe", jobTitle: "Engineer" },
  });
  await t.env.CV_KV.put(`owner:cv:${id}`, owner);
}

function lastEmailLink(): string {
  const message = t.sent.at(-1);
  const match = message?.text.match(LINK_RE);
  if (!match) {
    throw new Error("no link in the last email");
  }
  return match[0];
}

describe("health, 404 and 405", () => {
  it("answers /health, unknown paths and wrong methods", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/nope")).status).toBe(404);
    const wrong = await call("/api/cv", { method: "POST" });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toContain("GET");
  });

  it("upgrades plain http to https outside localhost", async () => {
    const res = await call("/api/whoami", {
      base: "http://api.pilihpendidikan.com",
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe(`${PROD}/api/whoami`);
  });
});

describe("CORS", () => {
  it("echoes allowed app origins with credentials on preflight", async () => {
    const res = await call("/api/cv/x", {
      method: "OPTIONS",
      headers: { Origin: CV_ORIGIN, "Access-Control-Request-Method": "PUT" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(CV_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "Authorization"
    );
  });

  it("never echoes foreign origins, and localhost only for a local Worker", async () => {
    const evil = await call("/api/cv/x", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const devToProd = await call("/api/cv/x", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:4003" },
    });
    expect(devToProd.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const devToDev = await call("/api/cv/x", {
      base: DEV,
      method: "OPTIONS",
      headers: { Origin: "http://localhost:4003" },
    });
    expect(devToDev.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:4003"
    );
  });

  it("uses wildcard CORS without credentials for OAuth endpoints", async () => {
    const res = await call("/oauth/token", {
      method: "OPTIONS",
      headers: { Origin: "https://claude.ai" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("decorates real responses for allowed origins", async () => {
    await seedCv("c1", "alice@example.com");
    const res = await call("/api/cv/c1", { headers: { Origin: CV_ORIGIN } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(CV_ORIGIN);
    expect(res.headers.get("Vary")).toContain("Origin");
  });
});

describe("GET /api/whoami", () => {
  it("reports anonymous and authenticated callers", async () => {
    expect(await bodyOf(await call("/api/whoami"))).toEqual({
      authenticated: false,
    });
    const bearer = await token("Alice@Example.com", "read");
    expect(
      await bodyOf(await call("/api/whoami", { headers: auth(bearer) }))
    ).toEqual({
      authenticated: true,
      email: "alice@example.com",
      isAdmin: false,
      scope: "read",
    });
  });
});

describe("document CRUD with ownership", () => {
  it("serves public reads, JSON download and the legacy .pdf alias", async () => {
    await seedCv("c1", "alice@example.com");
    const read = await call("/api/cv/c1");
    expect(read.status).toBe(200);
    expect(read.headers.get("Cache-Control")).toBe("no-store");
    expect(((await read.json()) as typeof CV_DOC).personalInfo.fullName).toBe(
      "Alice Doe"
    );
    expect((await call("/api/cv/c1.json")).status).toBe(200);
    const download = await call("/api/cv/c1?download");
    expect(download.headers.get("Content-Disposition")).toBe(
      'attachment; filename="CV-Alice-Doe.json"'
    );
    const legacy = await call("/api/cv/c1.pdf");
    expect(legacy.status).toBe(301);
    expect(legacy.headers.get("Location")).toBe(`${PROD}/cv/c1.pdf`);
    expect((await call("/api/cv/missing")).status).toBe(404);
  });

  it("lets only the owner save and delete; 401 / 403 / 404 / 422 otherwise", async () => {
    await seedCv("c1", "alice@example.com");
    const alice = await token("alice@example.com");
    const bob = await token("bob@example.com");
    const aliceReader = `${alice}-r`;
    await createToken(t.env.DB, {
      email: "alice@example.com",
      token: aliceReader,
      label: null,
      kind: "personal",
      scope: "read",
      expiresAt: null,
    });
    const body = JSON.stringify({
      ...CV_DOC,
      personalInfo: { fullName: "Alice Updated", jobTitle: "Lead" },
    });
    const put = (bearer: string | null, id = "c1", payload = body) =>
      call(`/api/cv/${id}`, {
        method: "PUT",
        headers: bearer
          ? auth(bearer, { "Content-Type": "application/json" })
          : { "Content-Type": "application/json" },
        body: payload,
      });

    const anonymous = await put(null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect((await put(bob)).status).toBe(403);
    const readOnly = await put(aliceReader);
    expect(readOnly.status).toBe(403);
    expect(await bodyOf(readOnly)).toEqual({ error: "insufficient_scope" });
    expect((await put(alice, "missing")).status).toBe(404);
    expect((await put(alice, "c1", "{not json")).status).toBe(400);
    expect((await put(alice, "c1", JSON.stringify({ nope: 1 }))).status).toBe(
      422
    );

    const saved = await put(alice);
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { ok: boolean }).ok).toBe(true);
    expect(t.kv.CV_KV.store.get("cv:c1")?.metadata).toEqual({
      fullName: "Alice Updated",
      jobTitle: "Lead",
    });

    const del = (bearer: string) =>
      call("/api/cv/c1", { method: "DELETE", headers: auth(bearer) });
    expect((await del(bob)).status).toBe(403);
    expect((await del(alice)).status).toBe(200);
    expect(t.kv.CV_KV.store.has("cv:c1")).toBe(false);
    expect(t.kv.CV_KV.store.has("owner:cv:c1")).toBe(false);
  });

  it("scopes lists to the caller; admins widen with ?mine=0", async () => {
    await seedCv("a1", "alice@example.com");
    await seedCv("b1", "bob@example.com");
    const alice = await token("alice@example.com");
    const admin = await token("admin@example.com");
    const list = async (bearer: string, query = "") =>
      (
        (await (
          await call(`/api/cv${query}`, { headers: auth(bearer) })
        ).json()) as { items: Array<{ id: string; fullName: string }> }
      ).items.map((item) => item.id);
    expect(await list(alice)).toEqual(["a1"]);
    expect(await list(admin)).toEqual([]);
    expect(await list(admin, "?mine=0")).toEqual(["a1", "b1"]);
    expect((await call("/api/cv")).status).toBe(401);
  });

  it("normalizes invoice dates and requires the invoice shape", async () => {
    await t.env.INVOICE_KV.put("invoice:i1", JSON.stringify({ items: [] }));
    await t.env.INVOICE_KV.put("owner:inv:i1", "alice@example.com");
    const alice = await token("alice@example.com");
    const res = await call("/api/invoice/i1", {
      method: "PUT",
      headers: auth(alice),
      body: JSON.stringify({
        from: { companyName: "A" },
        billTo: { name: "Client" },
        items: [],
        invoiceNumber: "INV-1",
        dateDue: null,
        dateOfIssue: "2026-10-01",
      }),
    });
    expect(res.status).toBe(200);
    const stored = JSON.parse(
      t.kv.INVOICE_KV.store.get("invoice:i1")?.value ?? "{}"
    );
    expect(stored.dateDue).toBe("");
    expect(stored.dateOfIssue).toBe("2026-10-01");
    expect(t.kv.INVOICE_KV.store.get("invoice:i1")?.metadata).toEqual({
      invoiceNumber: "INV-1",
      client: "Client",
    });
  });

  it("handles the jobs REST lifecycle with not-found for non-owners", async () => {
    const alice = await token("alice@example.com");
    const bob = await token("bob@example.com");
    const job = {
      id: "j1",
      title: "Engineer",
      status: "saved",
      sections: [],
    };
    const created = await call("/api/jobs", {
      method: "POST",
      headers: auth(alice),
      body: JSON.stringify(job),
    });
    expect(created.status).toBe(201);
    const dup = await call("/api/jobs", {
      method: "POST",
      headers: auth(bob),
      body: JSON.stringify(job),
    });
    expect(dup.status).toBe(409);
    expect((await call("/api/jobs/j1", { headers: auth(alice) })).status).toBe(
      200
    );
    expect((await call("/api/jobs/j1", { headers: auth(bob) })).status).toBe(
      404
    );
    const update = await call("/api/jobs/j1", {
      method: "PUT",
      headers: auth(alice),
      body: JSON.stringify({ ...job, status: "applied" }),
    });
    expect(update.status).toBe(200);
    expect(
      (await call("/api/jobs/j1", { method: "DELETE", headers: auth(bob) }))
        .status
    ).toBe(404);
    expect(
      (await call("/api/jobs/j1", { method: "DELETE", headers: auth(alice) }))
        .status
    ).toBe(200);
    expect((await call("/api/jobs")).status).toBe(401);
  });

  it("rejects malformed path escapes with 400 instead of crashing", async () => {
    expect((await call("/api/cv/%E0%A4%A")).status).toBe(400);
  });
});

describe("PDF print redirects", () => {
  it("302s to the app's print view with the param each app reads", async () => {
    await seedCv("c1", "alice@example.com");
    await t.env.INVOICE_KV.put("invoice:i1", "{}");
    await t.env.PORTFOLIO_KV.put("portfolio:p1", "{}");
    const cases: [string, string][] = [
      ["/cv/c1.pdf", "https://cv.pilihpendidikan.com/?cv=c1&print=1"],
      [
        "/invoice/i1.pdf",
        "https://invoice.pilihpendidikan.com/?invoice=i1&print=1",
      ],
      [
        "/portfolio/p1.pdf",
        "https://portfolio.pilihpendidikan.com/?id=p1&print=1",
      ],
    ];
    for (const [path, location] of cases) {
      const res = await call(path);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(location);
    }
    const local = await call("/portfolio/p1.pdf", { base: DEV });
    expect(local.headers.get("Location")).toBe(
      "http://localhost:4005/?id=p1&print=1"
    );
    expect((await call("/cv/missing.pdf")).status).toBe(404);
  });
});

describe("email sign-in", () => {
  it("emails a link, confirms on POST, sets a hardened cookie and lands on /connect", async () => {
    const requested = await call("/auth/request", {
      method: "POST",
      body: JSON.stringify({ email: "New@Example.com" }),
    });
    expect(requested.status).toBe(200);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].to).toBe("new@example.com");
    const link = new URL(lastEmailLink());
    expect(link.origin).toBe(PROD);

    const confirm = await call(`${link.pathname}${link.search}`);
    expect(confirm.status).toBe(200);
    expect(confirm.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
    expect(await confirm.text()).toContain("new@example.com");

    const verified = await call("/auth/verify", {
      method: "POST",
      body: new URLSearchParams({ t: link.searchParams.get("t") ?? "" }),
    });
    expect(verified.status).toBe(303);
    expect(verified.headers.get("Location")).toBe(`${PROD}/connect`);
    const cookie = verified.headers.get("Set-Cookie") ?? "";
    expect(cookie).toStartWith("__Host-session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");

    const replay = await call("/auth/verify", {
      method: "POST",
      body: new URLSearchParams({ t: link.searchParams.get("t") ?? "" }),
    });
    expect(replay.status).toBe(410);

    const crossSite = await call("/auth/verify", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: new URLSearchParams({ t: "anything" }),
    });
    expect(crossSite.status).toBe(403);

    const session = cookie.split(";")[0];
    const planted = session.replace("__Host-session=", "session=");
    expect(
      (await call("/auth/me", { headers: { Cookie: planted } })).status
    ).toBe(401);
    const me = await call("/auth/me", { headers: { Cookie: session } });
    expect(await bodyOf(me)).toEqual({
      email: "new@example.com",
      isAdmin: false,
      scope: "write",
    });

    const logout = await call("/auth/logout", {
      method: "POST",
      headers: { Cookie: session },
    });
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(
      (await call("/auth/me", { headers: { Cookie: session } })).status
    ).toBe(401);
  });

  it("uses the plain dev cookie on localhost", async () => {
    await call("/auth/request", {
      base: DEV,
      method: "POST",
      body: JSON.stringify({ email: "dev@example.com" }),
    });
    const link = new URL(lastEmailLink());
    expect(link.origin).toBe(DEV);
    const verified = await call("/auth/verify", {
      base: DEV,
      method: "POST",
      body: new URLSearchParams({ t: link.searchParams.get("t") ?? "" }),
    });
    const cookie = verified.headers.get("Set-Cookie") ?? "";
    expect(cookie).toStartWith("session=");
    expect(cookie).not.toContain("Secure");
  });

  it("returns to an allowed app with a single-use code for /auth/exchange", async () => {
    await call("/auth/request", {
      method: "POST",
      body: JSON.stringify({ email: "a@example.com", returnTo: CV_ORIGIN }),
    });
    const t1 = new URL(lastEmailLink()).searchParams.get("t") ?? "";
    const verified = await call("/auth/verify", {
      method: "POST",
      body: new URLSearchParams({ t: t1 }),
    });
    const location = new URL(verified.headers.get("Location") ?? "");
    expect(location.origin).toBe(CV_ORIGIN);
    const code = location.searchParams.get("code") ?? "";
    const exchanged = await call("/auth/exchange", {
      method: "POST",
      headers: { Origin: CV_ORIGIN },
      body: JSON.stringify({ code }),
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get("Access-Control-Allow-Origin")).toBe(
      CV_ORIGIN
    );
    const { token: bearer, email } = (await exchanged.json()) as {
      token: string;
      email: string;
    };
    expect(email).toBe("a@example.com");
    const who = await call("/api/whoami", { headers: auth(bearer) });
    expect(((await who.json()) as { email: string }).email).toBe(
      "a@example.com"
    );
    const again = await call("/auth/exchange", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    expect(again.status).toBe(410);
  });

  it("ignores a foreign returnTo", async () => {
    await call("/auth/request", {
      method: "POST",
      body: JSON.stringify({
        email: "a@example.com",
        returnTo: "https://evil.example",
      }),
    });
    const t1 = new URL(lastEmailLink()).searchParams.get("t") ?? "";
    const verified = await call("/auth/verify", {
      method: "POST",
      body: new URLSearchParams({ t: t1 }),
    });
    expect(verified.headers.get("Location")).toBe(`${PROD}/connect`);
  });

  it("rejects bad emails and rate-limits per IP", async () => {
    const bad = await call("/auth/request", {
      method: "POST",
      body: JSON.stringify({ email: "nope" }),
    });
    expect(bad.status).toBe(400);
    const send = (i: number) =>
      call("/auth/request", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.9" },
        body: JSON.stringify({ email: `user${i}@example.com` }),
      });
    for (let i = 0; i < 5; i++) {
      expect((await send(i)).status).toBe(200);
    }
    const limited = await send(6);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
  });
});

describe("/connect", () => {
  async function signIn(): Promise<string> {
    await call("/connect", {
      method: "POST",
      headers: { Origin: PROD },
      body: new URLSearchParams({ action: "request", email: "c@example.com" }),
    });
    const t1 = new URL(lastEmailLink()).searchParams.get("t") ?? "";
    const verified = await call("/auth/verify", {
      method: "POST",
      body: new URLSearchParams({ t: t1 }),
    });
    return (verified.headers.get("Set-Cookie") ?? "").split(";")[0];
  }

  it("renders the sign-in form when signed out", async () => {
    const page = await call("/connect");
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<label for="email">');
    expect((await call("/")).headers.get("Location")).toBe(`${PROD}/connect`);
  });

  it("mints, shows once, lists and revokes a personal token", async () => {
    const session = await signIn();
    const signedIn = await (
      await call("/connect", { headers: { Cookie: session } })
    ).text();
    expect(signedIn).toContain("c@example.com");
    expect(signedIn).toContain(`${PROD}/mcp`);

    const created = await call("/connect", {
      method: "POST",
      headers: { Cookie: session, Origin: PROD },
      body: new URLSearchParams({
        action: "create",
        label: "Laptop",
        scope: "read",
      }),
    });
    const html = await created.text();
    const minted = html.match(NEW_TOKEN_RE)?.[1] ?? "";
    expect(minted.length).toBeGreaterThan(30);
    expect(html).toContain("Read only");
    const who = (await (
      await call("/api/whoami", { headers: auth(minted) })
    ).json()) as { scope: string };
    expect(who.scope).toBe("read");

    const id = (
      t.sqlite
        .query("SELECT id FROM mcp_tokens WHERE kind = 'personal'")
        .get() as { id: string }
    ).id;
    const revoked = await call("/connect", {
      method: "POST",
      headers: { Cookie: session, Origin: PROD },
      body: new URLSearchParams({ action: "revoke", id }),
    });
    expect(revoked.status).toBe(303);
    expect(revoked.headers.get("Location")).toBe(
      `${PROD}/connect?notice=revoked`
    );
    expect(
      (
        (await (
          await call("/api/whoami", { headers: auth(minted) })
        ).json()) as { authenticated: boolean }
      ).authenticated
    ).toBe(false);
  });

  it("lists signed-in browsers and disconnects another one", async () => {
    const first = await signIn();
    const second = await signIn();
    const page = await (
      await call("/connect", { headers: { Cookie: first } })
    ).text();
    expect(page).toContain("This browser");
    expect(page).toContain("Disconnect");
    const otherHash = await hashToken(second.split("=")[1] ?? "");
    const other = t.sqlite
      .query("SELECT id FROM mcp_tokens WHERE token_hash = ?")
      .get(otherHash) as { id: string };
    const res = await call("/connect", {
      method: "POST",
      headers: { Cookie: first },
      body: new URLSearchParams({ action: "revoke", id: other.id }),
    });
    expect(res.status).toBe(303);
    expect(
      (await call("/auth/me", { headers: { Cookie: second } })).status
    ).toBe(401);
    expect(
      (await call("/auth/me", { headers: { Cookie: first } })).status
    ).toBe(200);
  });

  it("blocks cross-site form posts", async () => {
    const session = await signIn();
    const forged = await call("/connect", {
      method: "POST",
      headers: { Cookie: session, Origin: "https://evil.example" },
      body: new URLSearchParams({ action: "create" }),
    });
    expect(forged.status).toBe(403);
    const noOrigin = await call("/connect", {
      method: "POST",
      noOrigin: true,
      headers: { Cookie: session },
      body: new URLSearchParams({ action: "create" }),
    });
    expect(noOrigin.status).toBe(403);
  });
});

describe("/auth/tokens", () => {
  it("creates, lists, revokes and deletes the caller's own tokens only", async () => {
    const alice = await token("alice@example.com");
    const bob = await token("bob@example.com");
    const created = await call("/auth/tokens", {
      method: "POST",
      headers: auth(alice),
      body: JSON.stringify({ label: "CLI", scope: "read" }),
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as {
      id: string;
      token: string;
      scope: string;
    };
    expect(row.scope).toBe("read");
    expect(row.token.length).toBeGreaterThan(30);

    const listed = (await (
      await call("/auth/tokens", { headers: auth(alice) })
    ).json()) as { tokens: Array<{ id: string }> };
    expect(listed.tokens.map((x) => x.id)).toContain(row.id);
    expect(JSON.stringify(listed)).not.toContain(row.token);

    // A read token cannot mint itself a write token.
    expect(
      (
        await call("/auth/tokens", {
          method: "POST",
          headers: auth(row.token),
          body: JSON.stringify({ scope: "write" }),
        })
      ).status
    ).toBe(403);
    // Someone else's token is invisible.
    expect(
      (
        await call(`/auth/tokens/${row.id}/revoke`, {
          method: "POST",
          headers: auth(bob),
        })
      ).status
    ).toBe(404);
    // Active tokens must be revoked before deletion.
    expect(
      (
        await call(`/auth/tokens/${row.id}`, {
          method: "DELETE",
          headers: auth(alice),
        })
      ).status
    ).toBe(400);
    expect(
      (
        await call(`/auth/tokens/${row.id}/revoke`, {
          method: "POST",
          headers: auth(alice),
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(`/auth/tokens/${row.id}`, {
          method: "DELETE",
          headers: auth(alice),
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call("/auth/tokens", {
          method: "POST",
          headers: auth(alice),
          body: JSON.stringify({ scope: "admin" }),
        })
      ).status
    ).toBe(400);
    expect((await call("/auth/tokens")).status).toBe(401);
  });
});

describe("OAuth for MCP clients", () => {
  const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
  const VERIFIER = "v".repeat(43);

  async function challengeFor(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    );
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(BASE64_PAD_RE, "");
  }

  async function register(body: Record<string, unknown>) {
    return await call("/oauth/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function approve(clientId: string, state: string): Promise<URL> {
    const challenge = await challengeFor(VERIFIER);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      response_type: "code",
    });
    const consent = await call(`/oauth/authorize?${params}`);
    expect(consent.status).toBe(200);
    params.set("email", "mcp@example.com");
    const sent = await call("/oauth/authorize", {
      method: "POST",
      body: params,
    });
    expect(sent.status).toBe(200);
    const flowCookie = (sent.headers.get("Set-Cookie") ?? "").split(";")[0];
    expect(flowCookie).toStartWith("__Host-oauth-flow=");
    const link = new URL(lastEmailLink());
    // Opened in another browser (no flow cookie): refused.
    const elsewhere = await call(`${link.pathname}${link.search}`);
    expect(elsewhere.status).toBe(403);
    const confirm = await call(`${link.pathname}${link.search}`, {
      headers: { Cookie: flowCookie },
    });
    expect(confirm.headers.get("Content-Security-Policy")).toContain(
      "form-action 'self' https://claude.ai"
    );
    const redirected = await call("/oauth/magic", {
      method: "POST",
      headers: { Cookie: flowCookie },
      body: new URLSearchParams({
        token: link.searchParams.get("token") ?? "",
      }),
    });
    expect(redirected.status).toBe(303);
    return new URL(redirected.headers.get("Location") ?? "");
  }

  it("publishes discovery metadata", async () => {
    const as = (await (
      await call("/.well-known/oauth-authorization-server")
    ).json()) as Record<string, unknown>;
    expect(as.issuer).toBe(PROD);
    expect(as.token_endpoint).toBe(`${PROD}/oauth/token`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    const pr = (await (
      await call("/.well-known/oauth-protected-resource/mcp")
    ).json()) as Record<string, unknown>;
    expect(pr.resource).toBe(`${PROD}/`);
  });

  it("runs register → authorize → email → code → token with PKCE", async () => {
    const reg = await register({
      client_name: "Claude",
      redirect_uris: [REDIRECT],
    });
    expect(reg.status).toBe(201);
    const client = (await reg.json()) as {
      client_id: string;
      client_secret: string;
    };
    const back = await approve(client.client_id, "st-1");
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("st-1");
    expect(back.searchParams.get("iss")).toBe(PROD);
    const code = back.searchParams.get("code") ?? "";

    const basic = `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`;
    const exchange = (verifier: string) =>
      call("/oauth/token", {
        method: "POST",
        headers: { Authorization: basic },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: REDIRECT,
        }),
      });
    const ok = await exchange(VERIFIER);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    const issued = (await ok.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(issued.token_type).toBe("Bearer");
    expect(issued.expires_in).toBe(90 * 86_400);
    const replay = await exchange(VERIFIER);
    expect(((await replay.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
    const who = (await (
      await call("/api/whoami", { headers: auth(issued.access_token) })
    ).json()) as { email: string; scope: string };
    expect(who).toMatchObject({ email: "mcp@example.com", scope: "write" });
    const row = t.sqlite
      .query("SELECT token_hash FROM mcp_tokens WHERE kind = 'session'")
      .get() as { token_hash: string };
    expect(row.token_hash).toBe(await hashToken(issued.access_token));
  });

  it("fails PKCE with the wrong verifier and authenticates public clients", async () => {
    const reg = await register({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
    });
    const client = (await reg.json()) as {
      client_id: string;
      client_secret?: string;
    };
    expect(client.client_secret).toBeUndefined();
    const back = await approve(client.client_id, "");
    expect(back.searchParams.has("state")).toBe(false);
    const wrong = await call("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: back.searchParams.get("code") ?? "",
        code_verifier: "w".repeat(43),
        client_id: client.client_id,
      }),
    });
    expect(((await wrong.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
  });

  it("rejects unsafe redirect URIs and unknown clients", async () => {
    expect(
      (await register({ redirect_uris: ["http://evil.example/cb"] })).status
    ).toBe(400);
    expect(
      (await register({ redirect_uris: ["https://ok.example/cb#frag"] })).status
    ).toBe(400);
    expect(
      (await register({ redirect_uris: ["http://127.0.0.1:3000/cb"] })).status
    ).toBe(201);
    const unknown = await call(
      `/oauth/authorize?client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}`
    );
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get("Location")).toBeNull();
  });
});

describe("MCP transports", () => {
  it("answers 401 with an RFC 9728 challenge when unauthenticated", async () => {
    const res = await call("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${PROD}/.well-known/oauth-protected-resource"`
    );
    expect(mcpCalls).toHaveLength(0);
  });

  it("hands the caller to the Durable Object via props on /mcp and /sse", async () => {
    const bearer = await token("alice@example.com", "read");
    const viaHeader = await call("/mcp", {
      method: "POST",
      headers: auth(bearer),
      body: "{}",
    });
    expect(await viaHeader.text()).toBe("mcp-ok");
    await call(`/sse?token=${encodeURIComponent(bearer)}`);
    expect(mcpCalls.map((c) => c.props)).toEqual([
      { email: "alice@example.com", isAdmin: false, scope: "read" },
      { email: "alice@example.com", isAdmin: false, scope: "read" },
    ]);
  });
});

describe("scheduled purge", () => {
  it("deletes request_log rows past their retention", async () => {
    t.sqlite.run(
      "INSERT INTO request_log (ts, caller_email, tool, category, status, retention_until) VALUES (1, 'a@x', 'cv_get', 'cv', 'ok', 2), (1, 'a@x', 'cv_get', 'cv', 'ok', 99999999999999)"
    );
    const ctx = createCtx();
    app.scheduled({} as ScheduledController, t.env, ctx);
    await ctx.drain();
    const left = t.sqlite
      .query("SELECT COUNT(*) AS n FROM request_log")
      .get() as {
      n: number;
    };
    expect(left.n).toBe(1);
  });
});
