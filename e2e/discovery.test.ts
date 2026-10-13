// Discovery end to end (13 §5 S-06, S-07, S-08; 20 §11): the CLI crawls
// fixture Greenhouse / Lever / Ashby board APIs, uploads through its outbox to
// `wrangler dev`, and the inbox shows the postings. S-08 cuts the network
// after the api committed a batch and before the CLI saw the answer.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fingerprint } from "../packages/jobs-contracts/src/fingerprint";
import { ApiServer } from "./harness/api";
import type { BoardPosting } from "./harness/boards";
import {
  ASHBY_BOARD,
  BoardServer,
  GREENHOUSE_BOARD,
  LEVER_SITE,
} from "./harness/boards";
import { Browser } from "./harness/browser";
import { CliHome } from "./harness/cli";
import { sleep } from "./harness/procs";
import { ApiProxy, route } from "./harness/proxy";
import type { WebUser } from "./harness/users";
import { newKey, signIn } from "./harness/users";
import { finishFile } from "./harness/cleanup";

const RUN_ID = /^run_[0-9A-Z]{26}$/;
const BATCH_PATH = /^\/api\/v1\/discovery\/runs\/[^/]+\/postings:batch$/;
const RUNS_PATH = /^\/api\/v1\/discovery\/runs$/;
const ANY_BATCH_PATH = /postings:batch$/;

let api: ApiServer;
let boards: BoardServer;
let browser: Browser;
const proxies: ApiProxy[] = [];

interface Device {
  user: WebUser;
  cli: CliHome;
  proxy: ApiProxy;
  sources: Record<string, string>;
}

let main: Device;
const runIds: string[] = [];
let offlineDevice: Device | null = null;
let offlineRun: { runId: string; dropped: string } | null = null;

async function device(label: string): Promise<Device> {
  const user = await signIn(api);
  const proxy = await ApiProxy.start(api.origin);
  proxies.push(proxy);
  const cli = CliHome.create(label, proxy.origin, { env: boards.env });
  await cli.login(browser, user, `${label}-laptop`);
  const sources: Record<string, string> = {};
  const configs: [string, string, Record<string, unknown>][] = [
    ["greenhouse", "Acme (Greenhouse)", { board_token: GREENHOUSE_BOARD }],
    ["lever", "Acme (Lever)", { site: LEVER_SITE }],
    ["ashby", "Ramp (Ashby)", { job_board_name: ASHBY_BOARD }],
  ];
  for (const [adapter, label_, config] of configs) {
    const created = await user.api.ok<{ source: { id: string } }>(
      "POST",
      "/api/v1/sources",
      { adapter, label: label_, config },
      { idempotencyKey: newKey("src") }
    );
    sources[adapter] = created.source.id;
  }
  return { user, cli, proxy, sources };
}

interface InboxItem {
  user_job: {
    id: string;
    posting_id: string;
    source_id: string | null;
    first_run_id: string | null;
  };
  posting: {
    id: string;
    title: string;
    source_kind: string;
    source_org: string | null;
    source_job_ref: string | null;
    fingerprint: string;
    status: string;
  };
  provenance: {
    run_id: string | null;
    source_id: string | null;
    source_label: string | null;
    source_kind: string;
  };
}

async function inbox(user: WebUser): Promise<InboxItem[]> {
  const page = await user.api.ok<{ items: InboxItem[] }>(
    "GET",
    "/api/v1/inbox",
    undefined,
    {
      query: { limit: 100 },
    }
  );
  return page.items;
}

interface RunRecord {
  id: string;
  status: string;
  stats: {
    new?: number;
    updated?: number;
    unchanged?: number;
    postings_found?: number;
  };
}

async function run(user: WebUser, runId: string): Promise<RunRecord> {
  const page = await user.api.ok<{ items: RunRecord[] }>(
    "GET",
    "/api/v1/discovery/runs",
    undefined,
    { query: { limit: 50 } }
  );
  const found = page.items.find((r) => r.id === runId);
  if (!found) {
    throw new Error(`run ${runId} not listed`);
  }
  return found;
}

async function discover(d: Device): Promise<string> {
  const result = await d.cli.run(["discover", "--all"], { timeoutMs: 240_000 });
  if (result.code !== 0) {
    throw new Error(
      `discover exited ${result.code}:\n${result.stdout}\n${result.stderr}`
    );
  }
  const runId = String(result.data.run_id);
  expect(runId).toMatch(RUN_ID);
  return runId;
}

function key(p: {
  source_kind: string;
  source_org: string | null;
  source_job_ref: string | null;
}) {
  return `${p.source_kind}:${p.source_org}:${p.source_job_ref}`;
}

function expectedKeys(postings: BoardPosting[]): string[] {
  return postings.map((p) => `${p.kind}:${p.org}:${p.ref}`).sort();
}

beforeAll(async () => {
  api = await ApiServer.start({ name: "api-discovery" });
  boards = new BoardServer();
  browser = await Browser.launch();
  main = await device("disc");
}, 300_000);

afterAll(async () => {
  await browser?.close();
  for (const p of proxies) {
    await p.close();
  }
  boards?.stop();
  await api?.stop();
  finishFile();
});

describe("discovery (15, 20)", () => {
  test("S-06 discover Greenhouse + Lever + Ashby fixture boards → batch upsert → the inbox shows every posting with provenance and golden fingerprints", async () => {
    const runId = await discover(main);
    runIds.push(runId);
    const expected = boards.postings();
    expect(expected).toHaveLength(8);
    const items = await inbox(main.user);
    expect(items.map((i) => key(i.posting)).sort()).toEqual(
      expectedKeys(expected)
    );
    for (const item of items) {
      const kind = item.posting.source_kind;
      expect(item.provenance.run_id).toBe(runId);
      expect(item.provenance.source_kind).toBe(kind);
      expect(item.provenance.source_id).toBe(main.sources[kind]);
      expect(item.provenance.source_label).toBeTruthy();
      expect(item.user_job.first_run_id).toBe(runId);
      expect(item.posting.status).toBe("open");
      // The TypeScript reference implementation (the golden vectors' source)
      // gives the fingerprint the CLI computed and the api re-checked.
      expect(item.posting.fingerprint).toBe(
        await fingerprint({
          source_kind: kind,
          source_org: item.posting.source_org,
          source_job_ref: item.posting.source_job_ref,
          title: item.posting.title,
        })
      );
    }
    const record = await run(main.user, runId);
    expect(record.status).toBe("completed");
    expect(record.stats.new).toBe(8);
  }, 300_000);

  test("S-07 the same discovery again: 0 new, every posting unchanged", async () => {
    const runId = await discover(main);
    runIds.push(runId);
    const record = await run(main.user, runId);
    expect(record.status).toBe("completed");
    expect(record.stats.new ?? 0).toBe(0);
    expect(record.stats.updated ?? 0).toBe(0);
    expect(record.stats.unchanged).toBe(8);
    const outcomes = api.query<{ outcome: string; n: number }>(
      "JOBS_DB",
      "SELECT outcome, count(*) AS n FROM discovery_run_items WHERE run_id = ? GROUP BY outcome",
      runId
    );
    expect(outcomes).toEqual([{ outcome: "unchanged", n: 8 }]);
    expect(await inbox(main.user)).toHaveLength(8);
  }, 300_000);

  test("S-07 three postings removed from the boards are closed after two complete runs, not after one", async () => {
    const removed = [
      "4012399",
      "5ac21346-8e0c-4494-8e7a-3eb92ff77003",
      "a1b2c3d4-0000-4000-8000-000000000002",
    ];
    for (const ref of removed) {
      boards.removed.add(ref);
    }
    const status = () =>
      api.query<{
        source_job_ref: string;
        status: string;
        missed_runs: number;
      }>(
        "JOBS_DB",
        "SELECT p.source_job_ref, p.status, p.missed_runs FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id WHERE u.user_id = ? ORDER BY p.source_job_ref",
        main.user.userId
      );
    runIds.push(await discover(main));
    const afterOne = status();
    for (const row of afterOne) {
      expect(row.status).toBe("open");
      expect(row.missed_runs).toBe(
        removed.includes(row.source_job_ref) ? 1 : 0
      );
    }
    runIds.push(await discover(main));
    const afterTwo = status();
    expect(afterTwo).toHaveLength(8);
    for (const row of afterTwo) {
      expect(row.status).toBe(
        removed.includes(row.source_job_ref) ? "closed" : "open"
      );
    }
    const closed = (await inbox(main.user)).filter(
      (i) => i.posting.status === "closed"
    );
    expect(closed.map((i) => i.posting.source_job_ref).sort()).toEqual(
      [...removed].sort()
    );
    boards.removed.clear();
  }, 600_000);

  test("S-08 network down mid-run: discovery finishes offline and its batches wait in the outbox", async () => {
    const d = await device("offline");
    offlineDevice = d;
    // The api commits the first postings:batch, then the network drops: the
    // CLI never sees that answer, and nothing after it gets through.
    let dropped: string | null = null;
    d.proxy.addHook({
      match: route("POST", BATCH_PATH),
      once: true,
      after: (ex) => {
        expect(ex.status).toBe(200);
        dropped = ex.requestHeaders["idempotency-key"] ?? null;
        d.proxy.goOffline();
        return "drop";
      },
    });
    const offline = await d.cli.run(["discover", "--all"], {
      timeoutMs: 240_000,
    });
    expect(dropped).not.toBeNull();
    // Discovery itself succeeds offline (20 §10): the results wait in the outbox.
    expect(offline.code).toBe(0);
    const queued = await d.cli.ok(["sync", "--status"]);
    expect(Number(queued.data.outbox_depth)).toBeGreaterThan(0);
    const created = d.proxy
      .find("POST", RUNS_PATH)
      .find((e) => e.status !== null && e.status < 300);
    const runId =
      (created?.responseJson as { run?: { id?: string } } | null)?.run?.id ??
      "";
    expect(runId).toMatch(RUN_ID);
    expect((await run(d.user, runId)).status).toBe("running");
    offlineRun = { runId, dropped: String(dropped) };
  }, 600_000);

  test("S-08 reconnect: `sync` replays the batches idempotently (Idempotent-Replayed: true), zero duplicates, run completed", async () => {
    const d = offlineDevice;
    if (!(d && offlineRun)) {
      throw new Error("the offline run did not happen");
    }
    const { runId, dropped } = offlineRun;
    d.proxy.goOnline();
    let depth = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 30 && depth > 0; i++) {
      const synced = await d.cli.run(["sync", "--push-only"]);
      const status = await d.cli.ok(["sync", "--status"]);
      depth = Number(status.data.outbox_depth);
      if (depth > 0) {
        expect([0, 7]).toContain(synced.code ?? -1);
        await sleep(2000);
      }
    }
    expect(depth).toBe(0);

    // The batch the api had committed was sent again with the same key and
    // answered from the idempotency store.
    const replays = d.proxy
      .find("POST", ANY_BATCH_PATH)
      .filter(
        (e) =>
          e.requestHeaders["idempotency-key"] === dropped && e.outcome === "ok"
      );
    expect(replays.length).toBeGreaterThanOrEqual(1);
    expect(replays.every((e) => e.status === 200 && e.replayed)).toBe(true);

    // Zero duplicates anywhere.
    const items = await inbox(d.user);
    expect(items.map((i) => key(i.posting)).sort()).toEqual(
      expectedKeys(boards.postings())
    );
    expect(new Set(items.map((i) => i.posting.fingerprint)).size).toBe(8);
    const rows = api.query<{ n: number; postings: number }>(
      "JOBS_DB",
      "SELECT count(*) AS n, count(DISTINCT posting_id) AS postings FROM user_jobs WHERE user_id = ?",
      d.user.userId
    );
    expect(rows[0]).toEqual({ n: 8, postings: 8 });
    const runItems = api.query<{ n: number; postings: number }>(
      "JOBS_DB",
      "SELECT count(*) AS n, count(DISTINCT posting_id) AS postings FROM discovery_run_items WHERE run_id = ?",
      runId
    );
    expect(runItems[0]).toEqual({ n: 8, postings: 8 });
    const record = await run(d.user, runId);
    expect(record.status).toBe("completed");
    expect(record.stats.new).toBe(8);
  }, 600_000);
});
