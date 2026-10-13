// 05 §10a / 22 §8 anonymous CLI telemetry (TP-TELEMETRY) and crash reports
// (TP-CRASH): no credential read, per-IP-hash rate limit, no user/device id
// or IP stored, counters merged by maximum, crash JSON redacted in R2.

import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
  TEST_API_ORIGIN,
} from "../../../../test/fakes";
import {
  mergeCounters,
  redactCrashText,
  sanitizeCounters,
} from "../../services/account/telemetry";

const DAY = "2026-10-11";
const CRASH_KEY_RE = /^telemetry\/crash\/2026-10-12\/[0-9a-f-]{36}\.json$/;

function telemetryBody(counters: Record<string, unknown>, day = DAY) {
  return {
    day,
    install_hash: "a1b2c3d4e5f60718",
    cli_version: "0.1.0",
    platform: "macos",
    arch: "arm64",
    python_version: "3.12.7",
    install_channel: "uv",
    counters,
  };
}

const CRASH = {
  install_hash: "a1b2c3d4e5f60718",
  cli_version: "0.1.0",
  platform: "linux",
  python_version: "3.12.7",
  occurred_at: Date.UTC(2026, 9, 11),
  exception_type: "KeyError",
  message:
    "failed for jane@example.com at https://boards.example/jobs?id=1 in /home/jane/.cache/x.json token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP",
  frames: [
    { file: "pilih_jobs/cli/app.py", line: 12, function: "main" },
    { file: "/home/jane/venv/lib/python3.12/site.py", line: 3 },
  ],
};

function setup() {
  const t = createTestEnv();
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const post = (
    path: string,
    body: unknown,
    ip = "203.0.113.7",
    bearer?: string
  ) =>
    client.fetch(
      new Request(`${TEST_API_ORIGIN}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": ip,
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
      })
    );
  return { t, clock, client, post };
}

describe("TP-TELEMETRY anonymous CLI counters (22 §8.1)", () => {
  it("TP-TELEMETRY stores one install-day row with no user, device id or IP", async () => {
    const { t, client, post } = await setup();
    const cli = await client.cliSession("alice@example.com");
    const res = await post(
      "/api/v1/telemetry",
      telemetryBody({
        commands: { "board move": 3, discover: 1 },
        error_classes: { "greenhouse:selector_drift": 2 },
        exit_codes: { "0": 4 },
        duration_buckets: { "<1s": 3, "1-10s": 1 },
        agent_steps: 7,
        outcomes: { submitted: 1 },
      }),
      "203.0.113.7",
      cli.bearer ?? undefined
    );
    expect(res.status).toBe(202);
    const accepted = (await res.json()) as Record<string, unknown>;
    expect(accepted).toEqual({ accepted: true });
    const rows = t.jobsSqlite
      .query("SELECT * FROM telemetry_daily")
      .all() as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "cli_version",
      "counters",
      "day",
      "install_hash",
      "platform",
    ]);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain("203.0.113.7");
    expect(stored).not.toContain(cli.userId as string);
    expect(stored).not.toContain(cli.deviceId as string);
    expect(JSON.parse(rows[0]?.counters ?? "{}")).toMatchObject({
      commands: { "board move": 3, discover: 1 },
      agent_steps: 7,
    });
  });

  it("TP-TELEMETRY a resend of the same day merges by maximum (never double-counts)", async () => {
    const { t, post } = await setup();
    await post(
      "/api/v1/telemetry",
      telemetryBody({ commands: { discover: 2 }, error_classes: {} })
    );
    await post(
      "/api/v1/telemetry",
      telemetryBody({ commands: { discover: 2 }, error_classes: {} })
    );
    await post(
      "/api/v1/telemetry",
      telemetryBody({ commands: { discover: 5, list: 1 }, error_classes: {} })
    );
    const row = t.jobsSqlite
      .query("SELECT counters FROM telemetry_daily")
      .get() as {
      counters: string;
    };
    expect(JSON.parse(row.counters).commands).toEqual({ discover: 5, list: 1 });
    expect(
      mergeCounters(
        { commands: { a: 3 }, agent_steps: 4 },
        { commands: { a: 1 }, agent_steps: 2 }
      )
    ).toEqual({ commands: { a: 3 }, agent_steps: 4 });
  });

  it("TP-TELEMETRY unknown groups and malformed keys are dropped", () => {
    expect(
      sanitizeCounters({
        commands: {
          discover: 1,
          "https://x.example/?q=1": 2,
          "jane@example.com": 1,
        },
        error_classes: { "lever:timeout": -1, "lever:blocked": 3 },
        hostname: { "jane-laptop": 1 },
        agent_steps: 2.5,
      })
    ).toEqual({
      commands: { discover: 1 },
      error_classes: { "lever:blocked": 3 },
    });
  });

  it("TP-TELEMETRY days outside the 90-day window and malformed ids are refused", async () => {
    const { post } = await setup();
    const old = await post(
      "/api/v1/telemetry",
      telemetryBody({ commands: {}, error_classes: {} }, "2026-01-01")
    );
    expect(old.status).toBe(400);
    const future = await post(
      "/api/v1/telemetry",
      telemetryBody({ commands: {}, error_classes: {} }, "2026-12-01")
    );
    expect(future.status).toBe(400);
    const badHash = await post("/api/v1/telemetry", {
      ...telemetryBody({ commands: {}, error_classes: {} }),
      install_hash: "has space in it",
    });
    expect(badHash.status).toBe(400);
  });

  it("TP-TELEMETRY is rate-limited per IP hash", async () => {
    const { post } = await setup();
    const body = telemetryBody({ commands: {}, error_classes: {} });
    let last = 0;
    for (let i = 0; i < 121; i++) {
      last = (await post("/api/v1/telemetry", body, "198.51.100.1")).status;
    }
    expect(last).toBe(429);
    expect((await post("/api/v1/telemetry", body, "198.51.100.2")).status).toBe(
      202
    );
  });
});

describe("TP-CRASH crash reports (22 §8.2)", () => {
  it("TP-CRASH stores a redacted report under telemetry/crash/<day>/ with no ids or IP", async () => {
    const { t, post } = await setup();
    const res = await post("/api/v1/telemetry/crash", CRASH, "203.0.113.9");
    expect(res.status).toBe(202);
    const keys = [...t.r2.objects.keys()].filter((k) =>
      k.startsWith("telemetry/crash/")
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(CRASH_KEY_RE);
    const text = new TextDecoder().decode(
      t.r2.objects.get(keys[0] as string)?.body
    );
    const report = JSON.parse(text);
    expect(Object.keys(report).sort()).toEqual([
      "cli_version",
      "exception_type",
      "frames",
      "install_hash",
      "message",
      "occurred_at",
      "platform",
      "python_version",
      "received_at",
    ]);
    expect(text).not.toContain("jane@example.com");
    expect(text).not.toContain("boards.example");
    expect(text).not.toContain("/home/jane");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP");
    expect(text).not.toContain("203.0.113.9");
    expect(report.frames).toEqual([
      { file: "pilih_jobs/cli/app.py", line: 12, function: "main" },
      { file: "site.py", line: 3, function: null },
    ]);
  });

  it("TP-CRASH second-line redaction masks emails, URLs, paths and secrets", () => {
    expect(
      redactCrashText("mail a.b@c.io see http://x.y/z?q=1 at /usr/lib/a.py")
    ).toBe("mail <email> see <url> at <path>");
    expect(redactCrashText(`key ${"A".repeat(45)}`)).toBe("key <redacted>");
  });

  it("TP-CRASH is rate-limited per IP and validated", async () => {
    const { post } = await setup();
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await post("/api/v1/telemetry/crash", CRASH, "198.51.100.9"))
        .status;
    }
    expect(last).toBe(429);
    const bad = await post(
      "/api/v1/telemetry/crash",
      { ...CRASH, frames: "x" },
      "198.51.100.10"
    );
    expect(bad.status).toBe(400);
  });
});
