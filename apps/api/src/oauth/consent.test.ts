import { beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { afterEach } from "bun:test";
import { issueCsrf, verifyCsrf } from "./consent";
import type { Harness } from "./support.test";
import {
  approvePage,
  authorizeQuery,
  createHarness,
  decide,
  exchange,
  hiddenFields,
  LOOPBACK,
  magicApprovePage,
  PROD,
  row,
  rows,
  signedInCookie,
  STATE,
} from "./support.test";

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  setSystemTime();
});

describe("T17-02 session-aware consent (17 §4.3)", () => {
  it("T17-02 a valid __Host-session renders the approve page and sends no email", async () => {
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const { html, response } = await approvePage(h, cookie);
    expect(h.t.sent).toHaveLength(0);
    expect(html).toContain(
      "Allow <strong>pilih-jobs CLI</strong> on <strong>alice-mbp (macOS)</strong>"
    );
    expect(html).toContain("Signed in as <strong>alice@example.com</strong>");
    expect(html).toContain("See your tracked jobs");
    expect(html).toContain('value="approve"');
    expect(html).toContain('value="deny"');
    expect(html).toContain('value="switch"'); // "Not you? Sign out"
    expect(html).not.toContain('name="email"');
    // No framing, strict CSP with a nonce, form-action reaches the loopback.
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).toContain("form-action 'self' http://127.0.0.1:53127");
  });

  it("T17-02 without a session the email form renders", async () => {
    const res = await h.call(`/oauth/authorize?${await authorizeQuery()}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('name="email"');
    expect(html).not.toContain("/oauth/authorize/decision");
  });

  it("T17-02 a DCR (third-party) client gets the email form even with a session", async () => {
    const reg = await h.call("/oauth/register", {
      method: "POST",
      body: JSON.stringify({
        client_name: "Some MCP app",
        redirect_uris: ["https://mcp.example/cb"],
      }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const query = await authorizeQuery({
      clientId: client_id,
      redirectUri: "https://mcp.example/cb",
    });
    const res = await h.call(`/oauth/authorize?${query}`, { cookie });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('name="email"');
    expect(html).not.toContain("/oauth/authorize/decision");
  });

  it("T17-02 every value on the approve page is escaped", async () => {
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const { html } = await approvePage(h, cookie, {
      deviceName: '<script>alert(1)</script>"><img src=x>',
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x&gt;"
    );
  });

  it("T17-02 the decision POST without the CSRF token is 403", async () => {
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const { fields } = await approvePage(h, cookie);
    fields.delete("csrf");
    const res = await decide(h, cookie, fields);
    expect(res.status).toBe(403);
    expect(res.headers.get("Location")).toBeNull();
    expect(rows(h, "SELECT id FROM oauth_grants")).toHaveLength(0);
  });

  it("T17-02 a CSRF token bound to other parameters or another session is 403", async () => {
    const alice = await signedInCookie(h, "alice@example.com");
    const { fields } = await approvePage(h, alice.cookie);
    const widened = new URLSearchParams(fields);
    widened.set("scope", `${fields.get("scope")} automation:manage`);
    expect((await decide(h, alice.cookie, widened)).status).toBe(403);
    const bob = await signedInCookie(h, "bob@example.com");
    expect((await decide(h, bob.cookie, fields)).status).toBe(403);
  });

  it("T17-02 the CSRF token expires after 10 minutes", async () => {
    const issued = Date.UTC(2026, 9, 12, 9);
    const token = await issueCsrf("k", "hash", issued);
    expect(await verifyCsrf("k", "hash", token, issued + 599_000)).toBe(true);
    expect(await verifyCsrf("k", "hash", token, issued + 601_000)).toBe(false);
    expect(await verifyCsrf("other", "hash", token, issued)).toBe(false);
    expect(await verifyCsrf("k", "other", token, issued)).toBe(false);
    expect(await verifyCsrf("k", "hash", `x${token}`, issued)).toBe(false);
    setSystemTime(new Date(Date.now()));
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const { fields } = await approvePage(h, cookie);
    setSystemTime(new Date(Date.now() + 11 * 60_000));
    expect((await decide(h, cookie, fields)).status).toBe(403);
  });

  it("T17-02 a cross-origin decision POST is 403", async () => {
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const { fields } = await approvePage(h, cookie);
    fields.set("decision", "approve");
    const evil = await h.form("/oauth/authorize/decision", fields, {
      cookie,
      origin: "https://evil.example",
    });
    expect(evil.status).toBe(403);
    const noOrigin = await h.form("/oauth/authorize/decision", fields, {
      cookie,
      noOrigin: true,
    });
    expect(noOrigin.status).toBe(403);
    expect(rows(h, "SELECT id FROM oauth_grants")).toHaveLength(0);
  });

  it("T17-02 Deny redirects with error=access_denied, state and iss", async () => {
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const { fields } = await approvePage(h, cookie);
    const res = await decide(h, cookie, fields, "deny");
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get("Location") ?? "");
    expect(`${back.origin}${back.pathname}`).toBe(LOOPBACK);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe(STATE);
    expect(back.searchParams.get("iss")).toBe(PROD);
    expect(back.searchParams.has("code")).toBe(false);
    expect(rows(h, "SELECT id FROM oauth_grants")).toHaveLength(0);
  });

  it("T17-02 Approve creates a device-less grant and a 300 s code bound to it", async () => {
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const { fields } = await approvePage(h, cookie);
    const res = await decide(h, cookie, fields);
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get("Location") ?? "");
    expect(back.searchParams.get("state")).toBe(STATE);
    expect(back.searchParams.get("iss")).toBe(PROD);
    const grant = row<Record<string, unknown>>(
      h,
      "SELECT g.client_id, g.device_id, g.scopes, u.email FROM oauth_grants g JOIN users u ON u.id = g.user_id"
    );
    expect(grant).toEqual({
      client_id: "pilih-jobs-cli",
      device_id: null,
      scopes: fields.get("scope") ?? "",
      email: "alice@example.com",
    });
    const codes = [...h.t.kv.AUTH_KV.store.keys()].filter((k) =>
      k.startsWith("oauth:code:")
    );
    expect(codes).toHaveLength(1);
    // Only the hash of the code is a key; the code itself is nowhere in KV.
    const code = back.searchParams.get("code") ?? "";
    expect(JSON.stringify([...h.t.kv.AUTH_KV.store])).not.toContain(code);
  });

  it("T17-02 'Not you? Sign out' ends the session and returns to the email form", async () => {
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const { fields } = await approvePage(h, cookie);
    const res = await decide(h, cookie, fields, "switch");
    expect(res.status).toBe(303);
    expect(res.headers.get("Set-Cookie")).toContain("__Host-session=;");
    const back = res.headers.get("Location") ?? "";
    expect(back).toStartWith(`${PROD}/oauth/authorize?`);
    const again = await h.call(back.slice(PROD.length), { cookie });
    expect(await again.text()).toContain('name="email"');
  });

  it("T17-02 without a session, the emailed link leads to the same approve page", async () => {
    const page = await magicApprovePage(h, "carol@example.com");
    expect(page.html).toContain('action="/oauth/authorize/decision"');
    expect(page.html).toContain(
      "Signed in as <strong>carol@example.com</strong>"
    );
    expect(page.fields.get("magic")).toBeTruthy();
    expect(page.html).not.toContain('value="switch"');
    // Another browser (no flow cookie) cannot decide.
    const body = new URLSearchParams(page.fields);
    body.set("decision", "approve");
    const elsewhere = await h.form("/oauth/authorize/decision", body);
    expect(elsewhere.status).toBe(403);
    const res = await h.form("/oauth/authorize/decision", body, {
      cookie: page.flowCookie,
    });
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get("Location") ?? "");
    const tokens = await exchange(h, back.searchParams.get("code") ?? "");
    expect(tokens.status).toBe(200);
    // The link worked once.
    const replay = await h.form("/oauth/authorize/decision", body, {
      cookie: page.flowCookie,
    });
    expect(replay.status).toBe(410);
  });

  it("T17-02 POST /oauth/magic never issues a code for a first-party client", async () => {
    const page = await magicApprovePage(h, "carol@example.com");
    const res = await h.form(
      "/oauth/magic",
      { token: page.fields.get("magic") ?? "" },
      { cookie: page.flowCookie }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
    expect(hiddenFields(await res.text()).get("csrf")).toBeTruthy();
    expect(rows(h, "SELECT id FROM oauth_grants")).toHaveLength(0);
  });
});
