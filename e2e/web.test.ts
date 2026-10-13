// Web scenarios (13 §5): S-01 sign-in through the dashboard BFF, S-03 the
// Kanban board's drag and drop with an illegal move.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApiServer } from "./harness/api";
import { Browser } from "./harness/browser";
import { uniqueEmail, WEB_ORIGIN } from "./harness/env";
import { poll } from "./harness/procs";
import { Client, newKey } from "./harness/users";
import { WebServer } from "./harness/web";
import { createApplication, webSignIn } from "./harness/scenario";
import { finishFile } from "./harness/cleanup";

let api: ApiServer;
let web: WebServer;
let browser: Browser;
let session: Client;
let stageApp = "";

beforeAll(async () => {
  api = await ApiServer.start({ name: "api-web" });
  web = await WebServer.start(api.origin);
  browser = await Browser.launch();
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await web?.stop();
  await api?.stop();
  finishFile();
});

describe("dashboard sign-in and board", () => {
  test("S-01 magic-link sign-in to the dashboard sets the BFF cookie; the board is empty; no bearer reaches JS", async () => {
    const { bearer, cookies } = await webSignIn(
      browser,
      api,
      uniqueEmail("s01"),
      { confirm: "browser" }
    );
    // The empty board state, rendered from GET /api/v1/board through the BFF.
    await browser.waitForText("No applications yet", 60_000);
    // The BFF session cookie is HttpOnly and sealed; the api session cookie
    // (the bearer) is HttpOnly too, so page JavaScript sees neither.
    const bff = cookies.find((c) => c.name === "jobs-session");
    expect(bff).toBeDefined();
    expect(bff?.httpOnly).toBe(true);
    expect(bff?.value).not.toContain(bearer);
    const visible = await browser.eval<string>("document.cookie");
    expect(visible).not.toContain(bearer);
    expect(visible).not.toContain("jobs-session");
    const html = await browser.eval<string>(
      "document.documentElement.outerHTML"
    );
    expect(html).not.toContain(bearer);
    // The same account's board through the api is empty as well.
    const board = await new Client(api.origin, bearer).ok<{
      columns: Array<{ cards: unknown[] }>;
    }>("GET", "/api/v1/board");
    expect(board.columns.length).toBeGreaterThan(0);
    expect(board.columns.flatMap((c) => c.cards)).toHaveLength(0);
  }, 240_000);

  test("S-03 drag a card Saved → Ready → Applied on the board; Applied → Preparing is refused inline", async () => {
    const { bearer } = await webSignIn(browser, api, uniqueEmail("s03"), {
      confirm: "fetch",
    });
    session = new Client(api.origin, bearer);
    const app = await createApplication(session, {
      title: "Platform Engineer",
      company: "Drag Co",
    });
    await browser.goto(`${WEB_ORIGIN}/board`);
    const card = `[data-card-id="${app.id}"]`;
    await browser.waitForHydration(card);
    // Dropped in the middle of the column (see requests/leaf-5.1.md #2).
    const column = (stage: string) =>
      `section[aria-labelledby="column-${stage}"]`;

    await browser.drag(card, column("ready"));
    await poll(
      "the card in Ready",
      async () => (await stageOf(app.id)) === "ready",
      { timeoutMs: 30_000 }
    );
    expect(
      await browser.count(`section[aria-labelledby="column-ready"] ${card}`)
    ).toBe(1);

    await browser.drag(card, column("applied"));
    // 06 §2.2: moving to Applied asks whether it was really submitted.
    await browser.waitForText("Did you submit this application?");
    await browser.click('button:has-text("Just move it")');
    await poll(
      "the card in Applied",
      async () => (await stageOf(app.id)) === "applied",
      { timeoutMs: 30_000 }
    );

    await browser.drag(card, column("preparing"));
    await browser.waitForText("Can't move from Applied to Preparing");
    // Nothing was sent: the stage is unchanged and no event was written.
    expect(await stageOf(app.id)).toBe("applied");
    const events = await session.ok<{ items: Record<string, unknown>[] }>(
      "GET",
      `/api/v1/applications/${app.id}/events`,
      undefined,
      { query: { limit: 100 } }
    );
    const stageEvents = events.items
      .filter((e) => e.type === "stage_changed")
      .sort((a, b) => Number(a.recorded_at) - Number(b.recorded_at));
    expect(stageEvents.map((e) => `${e.from_value}→${e.to_value}`)).toEqual([
      "saved→ready",
      "ready→applied",
    ]);
    for (const e of stageEvents) {
      expect(e.actor_kind).toBe("user");
      expect(e.applied_to_state).toBe(true);
    }
    stageApp = app.id;
  }, 240_000);

  test("S-03 the api refuses Applied → Preparing too (the board only pre-checks it)", async () => {
    const appId = stageApp;
    expect(appId).not.toBe("");
    const current = await session.ok<{ application: { revision: number } }>(
      "GET",
      `/api/v1/applications/${appId}`
    );
    const refused = await session.post(
      `/api/v1/applications/${appId}/move`,
      { stage: "preparing", base_revision: current.application.revision },
      { idempotencyKey: newKey("s03") }
    );
    expect(refused.status).toBe(422);
    expect((refused.body as { error?: string }).error).toBe(
      "invalid_transition"
    );
    expect(await stageOf(appId)).toBe("applied");
  }, 120_000);
});

async function stageOf(appId: string): Promise<string> {
  const detail = await session.ok<{ application: { stage: string } }>(
    "GET",
    `/api/v1/applications/${appId}`
  );
  return detail.application.stage;
}
