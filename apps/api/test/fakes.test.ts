import { describe, expect, it } from "bun:test";
import type { JobsAiMessage } from "@pilihpendidikan/jobs-contracts/queue";
import { trustedScope } from "../src/jobs/core/scope";
import { jobsDb, stmt } from "../src/jobs/repo/core/db";
import {
  createFakeClock,
  createFakeQueue,
  createFakeR2,
  createTestEnv,
  createTestJobsD1,
  createV1Client,
} from "./fakes";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("TCORE-FAKES D1 over SQLite", () => {
  it("TCORE-FAKES statements are immutable and report changes", async () => {
    const { d1 } = createTestJobsD1();
    const insert = d1.prepare(
      "INSERT INTO telemetry_daily (day, install_hash, cli_version, platform, counters) VALUES (?, ?, '0.1.0', 'linux', '{}')"
    );
    const a = insert.bind("2026-10-12", "a");
    const b = insert.bind("2026-10-12", "b");
    expect((await a.run()).meta.changes).toBe(1);
    expect((await b.run()).meta.changes).toBe(1);
    const count = await d1
      .prepare("SELECT COUNT(*) AS n FROM telemetry_daily")
      .first<number>("n");
    expect(count).toBe(2);
    const raw = await d1
      .prepare("SELECT install_hash FROM telemetry_daily ORDER BY 1")
      .raw();
    expect(raw).toEqual([["a"], ["b"]]);
  });

  it("TCORE-FAKES batch() is transactional and returns RETURNING rows", async () => {
    const { d1, sqlite } = createTestJobsD1();
    const ok = await d1.batch([
      d1
        .prepare(
          "INSERT INTO ai_usage (user_id, month, purpose) VALUES (?, '2026-10', 'score') RETURNING purpose"
        )
        .bind(USER),
      d1
        .prepare("UPDATE ai_usage SET calls = calls + 1 WHERE user_id = ?")
        .bind(USER),
    ]);
    expect(ok[0].results).toEqual([{ purpose: "score" }]);
    expect(ok[1].meta.changes).toBe(1);
    await expect(
      d1.batch([
        d1
          .prepare("UPDATE ai_usage SET calls = 99 WHERE user_id = ?")
          .bind(USER),
        d1
          .prepare(
            "INSERT INTO ai_usage (user_id, month, purpose) VALUES (?, '2026-10', 'score')"
          )
          .bind(USER),
      ])
    ).rejects.toThrow("UNIQUE constraint failed");
    expect(
      (sqlite.query("SELECT calls FROM ai_usage").get() as { calls: number })
        .calls
    ).toBe(1);
  });

  it("TCORE-FAKES createTestEnv wires both databases, R2, the queue and v1 on", async () => {
    const t = createTestEnv();
    const db = jobsDb(t.env);
    const scope = trustedScope(USER, "script");
    await stmt(
      db,
      "INSERT INTO ai_usage (user_id, month, purpose) VALUES (?, '2026-10', 'agent')",
      scope.userId
    ).run();
    expect(
      t.jobsSqlite.query("SELECT COUNT(*) AS n FROM ai_usage").get()
    ).toEqual({ n: 1 });
    expect(
      t.sqlite
        .query("SELECT value FROM feature_flags WHERE key = 'JOBS_V1_ENABLED'")
        .get()
    ).toEqual({ value: "true" });
    expect(
      t.sqlite
        .query(
          "SELECT value FROM feature_flags WHERE key = 'JOBS_AUTOMATION_ENABLED'"
        )
        .get()
    ).toEqual({ value: "false" });
    expect(t.env.JOBS_AI_MODE).toBe("fake");
    const dark = createTestEnv(
      {},
      { flags: { JOBS_V1_ENABLED: false, JOBS_LEGACY_BACKEND: "d1" } }
    );
    expect(
      dark.sqlite
        .query(
          "SELECT value FROM feature_flags WHERE key = 'JOBS_LEGACY_BACKEND'"
        )
        .get()
    ).toEqual({ value: '"d1"' });
  });
});

describe("TCORE-FAKES R2", () => {
  it("TCORE-FAKES verifies sha256 on put and supports get, ranges, head, list, delete", async () => {
    const { bucket } = createFakeR2();
    const body = "%PDF-1.7 hello";
    const hash = await sha256(body);
    await expect(
      bucket.put("u/x/cv_pdf/a.pdf", body, { sha256: "0".repeat(64) })
    ).rejects.toThrow("SHA-256");
    const put = await bucket.put("u/x/cv_pdf/a.pdf", body, {
      sha256: hash,
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { user_id: "x" },
    });
    expect(put.size).toBe(body.length);
    const got = await bucket.get("u/x/cv_pdf/a.pdf");
    expect(await got?.text()).toBe(body);
    expect(got?.httpMetadata?.contentType).toBe("application/pdf");
    const range = await bucket.get("u/x/cv_pdf/a.pdf", {
      range: { offset: 0, length: 5 },
    });
    expect(await new Response(range?.body).text()).toBe("%PDF-");
    expect((await bucket.head("u/x/cv_pdf/a.pdf"))?.customMetadata).toEqual({
      user_id: "x",
    });
    await bucket.put("u/x/run_log/b.jsonl", "{}");
    await bucket.put("u/y/cv_pdf/c.pdf", "%PDF-");
    const listed = await bucket.list({ prefix: "u/x/" });
    expect(listed.objects.map((o) => o.key)).toEqual([
      "u/x/cv_pdf/a.pdf",
      "u/x/run_log/b.jsonl",
    ]);
    const folders = await bucket.list({ prefix: "u/", delimiter: "/" });
    expect(folders.delimitedPrefixes).toEqual(["u/x/", "u/y/"]);
    await bucket.delete(["u/x/cv_pdf/a.pdf", "u/x/run_log/b.jsonl"]);
    expect(await bucket.get("u/x/cv_pdf/a.pdf")).toBeNull();
    expect((await bucket.list({ prefix: "u/" })).objects).toHaveLength(1);
  });
});

const message = (n: number): JobsAiMessage => ({
  v: 1,
  type: "rollup_user",
  message_id: `m${n}`,
  user_id: USER,
  days: ["2026-10-12"],
});

describe("TCORE-FAKES Queue", () => {
  it("TCORE-FAKES records sends and drains through the consumer with retries and the DLQ", async () => {
    const t = createTestEnv();
    await t.env.JOBS_AI_QUEUE.send(message(1));
    await t.env.JOBS_AI_QUEUE.sendBatch([
      { body: message(2) },
      { body: message(3), delaySeconds: 5 },
    ]);
    expect(t.queue.sent.map((m) => m.body.message_id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    expect(t.queue.sent[2].delaySeconds).toBe(5);
    const seen: string[] = [];
    const deadLettered: string[] = [];
    const report = await t.queue.drain(t.env, {
      overrides: {
        handlers: {
          rollup_user: (qc) => {
            seen.push(`${qc.message.message_id}#${qc.attempts}`);
            return Promise.resolve(
              qc.message.message_id === "m2"
                ? { action: "retry" }
                : { action: "ack" }
            );
          },
        },
        deadLetter: (qc) => {
          deadLettered.push(qc.message.message_id);
          return Promise.resolve({ action: "ack" });
        },
      },
    });
    expect(seen.filter((s) => s.startsWith("m2"))).toEqual([
      "m2#1",
      "m2#2",
      "m2#3",
      "m2#4",
      "m2#5",
      "m2#6",
    ]);
    expect(deadLettered).toEqual(["m2"]);
    expect(report).toMatchObject({ deadLettered: 1, retried: 6, dropped: 0 });
    expect(t.queue.pending).toHaveLength(0);
    expect(t.queue.retries[0].delaySeconds).toBeGreaterThanOrEqual(10);
  });

  it("TCORE-FAKES enforces the queue limits", async () => {
    const queue = createFakeQueue();
    await expect(
      queue.queue.sendBatch(
        Array.from({ length: 101 }, (_, i) => ({ body: message(i) }))
      )
    ).rejects.toThrow("at most 100");
  });
});

describe("TCORE-FAKES clock and v1 client", () => {
  it("TCORE-FAKES the fake clock drives request time", async () => {
    const t = createTestEnv();
    const clock = createFakeClock(Date.UTC(2027, 0, 1));
    const client = createV1Client(t, { clock });
    expect(
      (await client.anonymous().get("/api/v1/meta")).body.server_time
    ).toBe(Date.UTC(2027, 0, 1));
    clock.advance(5000);
    expect(
      (await client.anonymous().get("/api/v1/meta")).body.server_time
    ).toBe(Date.UTC(2027, 0, 1) + 5000);
  });

  it("TCORE-FAKES mints every credential kind for one user", async () => {
    const t = createTestEnv();
    const client = createV1Client(t);
    const sessions = [
      await client.browserSession("one@example.com"),
      await client.personalToken("one@example.com", "write"),
      await client.personalToken("one@example.com", "read"),
      await client.mcpOAuthToken("one@example.com"),
      await client.cliSession("one@example.com"),
      await client.cliSession("one@example.com", {
        device: false,
        scopes: ["jobs:read"],
      }),
    ];
    const kinds: string[] = [];
    for (const session of sessions) {
      const me = await session.get("/api/v1/me");
      expect(me.status).toBe(200);
      expect(me.body.user_id).toBe(sessions[0].userId as string);
      kinds.push(me.body.credential_kind as string);
    }
    expect(kinds).toEqual([
      "browser_session",
      "personal_write",
      "personal_read",
      "oauth_mcp",
      "oauth_cli",
      "oauth_cli",
    ]);
    expect(sessions[4].deviceId).not.toBeNull();
    expect(sessions[5].deviceId).toBeNull();
    expect(sessions[4].headers["X-Pilih-Client"]).toBe("cli/0.1.0");
  });
});
