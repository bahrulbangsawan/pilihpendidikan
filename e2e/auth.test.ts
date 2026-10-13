// CLI sign-in and token lifecycle against `wrangler dev` (13 §5 S-04, S-05,
// S-32; 17 §15 end-to-end items 14 and 15). The user is a real Chromium:
// signed in on the dashboard, approving the consent page, revoking a device.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { API_ROUTE_SCHEMAS } from "../packages/jobs-contracts/src/api/routes";
import { ApiServer } from "./harness/api";
import { Browser } from "./harness/browser";
import { CliHome } from "./harness/cli";
import { uniqueEmail, WEB_ORIGIN } from "./harness/env";
import { poll } from "./harness/procs";
import type { Exchange } from "./harness/proxy";
import { ApiProxy } from "./harness/proxy";
import { webSignIn } from "./harness/scenario";
import { Client, signIn } from "./harness/users";
import { WebServer } from "./harness/web";
import { finishFile } from "./harness/cleanup";

const OAUTH_TOKEN_PATH = /^\/oauth\/token$/;
const DEVICE_ID = /^dev_[0-9A-Z]{26}$/;
const CLI_CLIENT_HEADER = /^cli\/0\.1\.0/;

const CLIENT_ID = "pilih-jobs-cli";

let api: ApiServer;
let web: WebServer;
let browser: Browser;
const proxies: ApiProxy[] = [];
const browsers: Browser[] = [];

// S-04's device: later revoked from the web (T17-15).
let laptop: {
  cli: CliHome;
  proxy: ApiProxy;
  deviceId: string;
  name: string;
  dashboard: Browser;
};
// T17-14's device: later used for the refresh rotation (S-05).
let box: { cli: CliHome; proxy: ApiProxy; email: string };
// S-32's device (signed in before the minimum version is raised).
let oldCli: CliHome | null = null;

async function proxy(): Promise<ApiProxy> {
  const p = await ApiProxy.start(api.origin);
  proxies.push(p);
  return p;
}

function tokenResponses(p: ApiProxy): Array<{
  access_token: string;
  refresh_token?: string;
  at: number;
}> {
  return p
    .find("POST", OAUTH_TOKEN_PATH)
    .filter((e) => e.status === 200)
    .map((e) => ({
      ...(e.responseJson as { access_token: string; refresh_token?: string }),
      at: e.at,
    }));
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...filesUnder(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

async function revokeToken(origin: string, token: string, hint: string) {
  const res = await fetch(`${origin}/oauth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token,
      token_type_hint: hint,
      client_id: CLIENT_ID,
    }),
  });
  expect(res.status).toBe(200);
}

async function refreshWith(origin: string, refreshToken: string) {
  const res = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

beforeAll(async () => {
  api = await ApiServer.start({ name: "api-auth" });
  web = await WebServer.start(api.origin);
  browser = await Browser.launch();
}, 300_000);

afterAll(async () => {
  for (const b of browsers) {
    await b.close();
  }
  await browser?.close();
  for (const p of proxies) {
    await p.close();
  }
  await web?.stop();
  await api?.stop();
  finishFile();
});

describe("CLI sign-in (17)", () => {
  test("S-04 pilih-jobs login on a random loopback port: consent shows the device, tokens are stored encrypted, whoami works, /cli shows the device online within 10 s", async () => {
    const email = uniqueEmail("s04");
    // The user has the dashboard's CLI page open while signing the CLI in
    // (a second browser window, so the consent page does not replace it).
    const dashboard = await Browser.launch();
    browsers.push(dashboard);
    await webSignIn(dashboard, api, email, { confirm: "fetch" });
    await dashboard.goto(`${WEB_ORIGIN}/cli`);
    await dashboard.waitForText("Waiting for your computer to connect", 60_000);
    const { session: bearer } = await signIn(api, { email });
    const p = await proxy();
    const cli = CliHome.create("s04", p.origin);
    const name = "s04-laptop (macOS)";
    const { proc, url, port } = await cli.startLogin(name, [], {
      fixedPort: false,
    });
    const authorize = new URL(url);
    const redirect = new URL(authorize.searchParams.get("redirect_uri") ?? "");
    // RFC 8252: an OS-assigned port on the IPv4 loopback, PKCE S256.
    expect(redirect.hostname).toBe("127.0.0.1");
    expect(port).toBeGreaterThan(1023);
    expect(redirect.pathname).toBe("/callback");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("client_id")).toBe(CLIENT_ID);

    await browser.addCookies([
      { name: "session", value: bearer, url: p.origin },
    ]);
    await browser.goto(url);
    const consent = await browser.waitForText(name);
    expect(consent).toContain(email);
    expect(consent).toContain("Approve");
    await browser.click('button[name="decision"][value="approve"]');
    await browser.waitForUrl(`127\\.0\\.0\\.1:${port}/callback`);
    await browser.waitForText("You can close this tab");
    const exit = await proc.exited;
    const login = CliHome.resultOf(proc, exit.code);
    expect(exit.code).toBe(0);
    const loggedInAt = Date.now();
    expect(login.data.email).toBe(email);
    expect(login.data.device_name).toBe(name);
    const deviceId = String(login.data.device_id);
    expect(deviceId).toMatch(DEVICE_ID);

    const who = await cli.ok(["whoami"]);
    expect(who.data.email).toBe(email);
    expect(who.data.credential_kind).toBe("oauth_cli");
    expect((who.data.device as { id: string }).id).toBe(deviceId);

    // The grant is bound to the device on the server.
    const userId = String(login.data.user_id);
    const grants = api.query<{
      device_id: string | null;
      revoked_at: number | null;
    }>(
      "DB",
      "SELECT device_id, revoked_at FROM oauth_grants WHERE user_id = ?",
      userId
    );
    expect(grants).toHaveLength(1);
    expect(grants[0].device_id).toBe(deviceId);
    expect(grants[0].revoked_at).toBeNull();
    const devices = api.query<{ name: string }>(
      "DB",
      "SELECT name FROM devices WHERE id = ? AND user_id = ?",
      deviceId,
      userId
    );
    expect(devices.map((d) => d.name)).toEqual([name]);

    // 17 §15 item 11: nothing is written in plaintext; the tokens live in
    // the AES-GCM credentials file.
    const [issued] = tokenResponses(p);
    expect(issued.refresh_token).toBeTruthy();
    const files = filesUnder(cli.home);
    expect(files.some((f) => f.endsWith("credentials.enc"))).toBe(true);
    for (const file of files) {
      const content = readFileSync(file).toString("latin1");
      expect(content.includes(issued.access_token)).toBe(false);
      expect(content.includes(String(issued.refresh_token))).toBe(false);
    }

    // The open CLI page lists the device as online within 10 s, by itself.
    const row = `tr[data-device="${deviceId}"]`;
    await dashboard.waitFor(row, { timeout: 10_000 });
    await poll(
      "the device row to read Online",
      async () => (await dashboard.text(row)).includes("Online"),
      { timeoutMs: 10_000, intervalMs: 250 }
    );
    expect(Date.now() - loggedInAt).toBeLessThanOrEqual(10_000);
    laptop = { cli, proxy: p, deviceId, name, dashboard };
  }, 300_000);

  test("T17-14 a real browser completes pilih-jobs login without a session: e-mail form → approval link → consent → loopback", async () => {
    const b = await Browser.launch();
    browsers.push(b);
    const p = await proxy();
    const cli = CliHome.create("t1714", p.origin);
    const email = uniqueEmail("t1714");
    const name = "t1714-box (Linux)";
    const { proc, url, port } = await cli.startLogin(name);
    await b.goto(url);
    await b.waitForText("Send approval link");
    await b.fill('input[name="email"]', email);
    await b.click('form[action="/oauth/authorize"] button[type="submit"]');
    await b.waitForText("Check your email");
    const mail = await api.waitForMail(email);
    expect(new URL(mail.link).pathname).toBe("/oauth/magic");
    // The link works only in the browser that started the flow.
    await b.goto(mail.link);
    const consent = await b.waitForText(name);
    expect(consent).toContain(email);
    await b.click('button[name="decision"][value="approve"]');
    await b.waitForUrl(`127\\.0\\.0\\.1:${port}/callback`);
    const exit = await proc.exited;
    expect(exit.code).toBe(0);
    const login = CliHome.resultOf(proc, exit.code);
    expect(login.data.email).toBe(email);
    const who = await cli.ok(["whoami"]);
    expect(who.data.email).toBe(email);
    expect((who.data.scopes as string[]).sort()).toEqual(
      [
        "ai:invoke",
        "automation:execute",
        "cv:read",
        "discovery:write",
        "files:read",
        "files:write",
        "jobs:read",
        "jobs:write",
        "offline_access",
      ].sort()
    );
    box = { cli, proxy: p, email };
  }, 300_000);

  test("S-05 refresh rotation: an expired access token is refreshed by the CLI with a new pair", async () => {
    const { cli, proxy: p } = box;
    const [first] = tokenResponses(p);
    // Force the access token's end on the server (RFC 7009, access token only).
    await revokeToken(api.origin, first.access_token, "access_token");
    const marker = p.log.length;
    const who = await cli.ok(["whoami"]);
    expect(who.data.email).toBe(box.email);
    const after = p.log.slice(marker);
    const me = after.filter((e) => e.path === "/api/v1/me");
    expect(me.map((e) => e.status)).toEqual([401, 200]);
    const refreshes = after.filter((e) => e.path === "/oauth/token");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].status).toBe(200);
    const pair = refreshes[0].responseJson as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    expect(pair.refresh_token).toBeTruthy();
    expect(pair.refresh_token).not.toBe(first.refresh_token);
    expect(pair.access_token).not.toBe(first.access_token);
    expect(pair.expires_in).toBe(3600);
  }, 180_000);

  test("S-05 replaying a used refresh token revokes the whole family; the CLI must log in again", async () => {
    const { cli, proxy: p } = box;
    const pairs = tokenResponses(p);
    const original = pairs[0];
    const current = pairs.at(-1);
    if (!current) {
      throw new Error("no rotated pair");
    }
    // Rotate once more so the first child has been used too (no grace).
    await revokeToken(api.origin, current.access_token, "access_token");
    await cli.ok(["whoami"]);
    const replay = await refreshWith(
      api.origin,
      String(original.refresh_token)
    );
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
    // Every token of the grant is dead: the newest refresh token too.
    const newest = tokenResponses(p).at(-1);
    const dead = await refreshWith(api.origin, String(newest?.refresh_token));
    expect(dead.body.error).toBe("invalid_grant");
    const grant = api.query<{
      revoked_at: number | null;
      revoked_reason: string | null;
    }>(
      "DB",
      "SELECT g.revoked_at, g.revoked_reason FROM oauth_grants g JOIN users u ON u.id = g.user_id WHERE u.email = ?",
      box.email
    );
    expect(grant).toHaveLength(1);
    expect(grant[0].revoked_at).not.toBeNull();
    expect(grant[0].revoked_reason).toBe("refresh_reuse");
    const result = await cli.run(["whoami"]);
    expect(result.code).toBe(3);
    expect(JSON.stringify(result.envelope?.error)).toContain(
      "pilih-jobs login"
    );
  }, 180_000);

  test("S-05 grace: a refresh token replayed within 60 s of its rotation returns the same child", async () => {
    const user = await signIn(api, { email: uniqueEmail("grace") });
    const p = await proxy();
    const cli = CliHome.create("grace", p.origin);
    await cli.login(browser, user, "grace-pc");
    const [issued] = tokenResponses(p);
    const first = await refreshWith(api.origin, String(issued.refresh_token));
    expect(first.status).toBe(200);
    const again = await refreshWith(api.origin, String(issued.refresh_token));
    expect(again.status).toBe(200);
    expect(again.body.refresh_token).toBe(first.body.refresh_token);
    expect(again.body.access_token).not.toBe(first.body.access_token);
  }, 180_000);

  test("T17-15 revoking the device on the web stops the CLI at its next request", async () => {
    const { cli, proxy: p, deviceId, name, dashboard } = laptop;
    await dashboard.goto(`${WEB_ORIGIN}/cli`);
    const row = `tr[data-device="${deviceId}"]`;
    await dashboard.waitForHydration(row);
    await dashboard.click(`${row} button[aria-label="Actions for ${name}"]`);
    await dashboard.click('[role="menuitem"]:has-text("Revoke")');
    await dashboard.waitForText(`Revoke ${name}?`);
    await dashboard.click(
      '[role="alertdialog"] button:has-text("Revoke device")'
    );
    await dashboard.waitForText(`${name} is signed out.`);
    const revokedAt = Date.now();
    const marker = p.log.length;
    const result = await cli.run(["whoami"]);
    expect(result.code).toBe(3);
    const after = p.log
      .slice(marker)
      .filter((e: Exchange) => e.at >= revokedAt);
    const authenticated = after.filter(
      (e) => e.path.startsWith("/api/v1/") && e.path !== "/api/v1/meta"
    );
    // One authenticated request, answered 401 revoked_token; then at most
    // one refresh attempt, refused; nothing else.
    expect(authenticated).toHaveLength(1);
    expect(authenticated[0].status).toBe(401);
    expect(JSON.stringify(authenticated[0].responseJson)).toContain(
      "revoked_token"
    );
    const refreshes = after.filter((e) => e.path === "/oauth/token");
    expect(refreshes.length).toBeLessThanOrEqual(1);
    for (const r of refreshes) {
      expect(r.status).toBe(400);
    }
    // The secrets were deleted: the next command stops locally, before any
    // authenticated request.
    const again = p.log.length;
    expect((await cli.run(["whoami"])).code).toBe(3);
    expect(
      p.log
        .slice(again)
        .filter(
          (e) => e.path.startsWith("/api/v1/") && e.path !== "/api/v1/meta"
        )
    ).toHaveLength(0);
  }, 180_000);

  test("S-32 a CLI below min_cli_version gets 426 on every /api/v1 route except /meta", async () => {
    const user = await signIn(api, { email: uniqueEmail("s32") });
    const p = await proxy();
    const cli = CliHome.create("s32", p.origin);
    oldCli = cli;
    await cli.login(browser, user, "s32-old-cli");
    const [issued] = tokenResponses(p);
    const client = p.log.find((e) => e.requestHeaders["x-pilih-client"])
      ?.requestHeaders["x-pilih-client"];
    expect(client).toMatch(CLI_CLIENT_HEADER);
    await api.restart({ vars: { JOBS_MIN_CLI_VERSION: "9.9.9" } });

    const asCli = new Client(api.origin, issued.access_token, {
      "x-pilih-client": String(client),
    });
    const refused: string[] = [];
    const answered: string[] = [];
    for (const key of Object.keys(API_ROUTE_SCHEMAS)) {
      const [method, template] = key.split(" ");
      const path = template.replace(
        /\{([a-z]+)_id\}/g,
        (_m, prefix: string) => {
          const idPrefix = prefix === "export" ? "exp" : prefix;
          return `${idPrefix}_01JA6V8M3W8Z1T6Q4Y2B7K9C00`;
        }
      );
      const res = await asCli.call(
        method,
        path,
        method === "GET" ? undefined : {},
        {
          idempotencyKey: `s32-${method}-${path}`,
        }
      );
      if (res.status === 426) {
        expect((res.body as { error?: string }).error).toBe(
          "cli_upgrade_required"
        );
        refused.push(key);
      } else {
        answered.push(`${key} → ${res.status}`);
      }
    }
    expect(answered).toEqual(["GET /api/v1/meta → 200"]);
    expect(refused.length).toBe(Object.keys(API_ROUTE_SCHEMAS).length - 1);
    const meta = await asCli.get<{ min_cli_version: string }>("/api/v1/meta");
    expect(meta.body.min_cli_version).toBe("9.9.9");
  }, 300_000);

  test("S-32 pilih-jobs refuses below min_cli_version (exit 10) and prints the upgrade instructions", async () => {
    const cli = oldCli;
    if (!cli) {
      throw new Error("the S-32 CLI was not signed in");
    }
    const board = await cli.run(["board"]);
    expect(board.code).toBe(10);
    const error = board.envelope?.error ?? {};
    expect(String(error.code)).toBe("cli_upgrade_required");
    expect(JSON.stringify(error)).toContain("9.9.9");
    expect(JSON.stringify(error)).toContain("pilih-jobs update");
    const human = await cli.run(["board"], { json: false });
    expect(human.code).toBe(10);
    expect(human.stderr).toContain("pilih-jobs update");
    // `version` is exempt from the gate.
    expect((await cli.run(["version"])).code).toBe(0);
  }, 300_000);
});
