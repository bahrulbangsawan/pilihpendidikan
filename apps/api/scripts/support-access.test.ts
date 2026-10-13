import { describe, expect, it } from "bun:test";
import type { TestEnv } from "../test/fakes";
import { createTestEnv, createToolSession } from "../test/fakes";
import type { SqlTarget } from "./migrate-jobs-kv-to-d1";
import { sqliteTarget } from "./migrate-jobs-kv-to-d1";
import type { SupportAccessOptions } from "./support-access";
import { readOnly, supportAccess } from "./support-access";

const SELECT_RE = /^\s*SELECT\b/i;

const ALICE = {
  email: "alice@example.com",
  isAdmin: false,
  scope: "write" as const,
};

async function setup(): Promise<TestEnv> {
  const t = createTestEnv({}, { flags: { JOBS_LEGACY_BACKEND: "d1" } });
  await createToolSession(t.env, ALICE).call("jobs_create", {
    job_id: "acme",
    title: "Senior Engineer",
  });
  return t;
}

/** Records every statement a target receives. */
function recording(target: SqlTarget, seen: string[]): SqlTarget {
  return {
    query: (sql, params) => {
      seen.push(sql);
      return target.query(sql, params);
    },
    batch: (statements) => {
      seen.push(...statements.map((s) => s.sql));
      return target.batch(statements);
    },
  };
}

function opts(
  t: TestEnv,
  overrides: Partial<SupportAccessOptions> = {}
): SupportAccessOptions {
  return {
    execute: true,
    identity: sqliteTarget(t.sqlite),
    jobs: sqliteTarget(t.jobsSqlite),
    subject: { email: ALICE.email },
    ticket: "SUP-42",
    reason: "User reports a missing job card",
    operator: "ops@example.com",
    scope: "applications",
    ...overrides,
  };
}

function logRows(t: TestEnv) {
  return t.sqlite.query("SELECT * FROM support_access_log").all() as Record<
    string,
    unknown
  >[];
}

describe("TL-BREAKGLASS scripts/support-access.ts (11 §6.2, D-26)", () => {
  it("TL-BREAKGLASS requires a ticket, a reason and an operator", async () => {
    const t = await setup();
    await expect(supportAccess(opts(t, { ticket: "" }))).rejects.toThrow(
      "--ticket"
    );
    await expect(supportAccess(opts(t, { reason: "x" }))).rejects.toThrow(
      "--reason"
    );
    await expect(supportAccess(opts(t, { operator: "" }))).rejects.toThrow(
      "--operator"
    );
    expect(logRows(t)).toEqual([]);
  });

  it("TL-BREAKGLASS a dry run logs nothing and reads no Job Tracker data", async () => {
    const t = await setup();
    const seen: string[] = [];
    const report = await supportAccess(
      opts(t, {
        execute: false,
        jobs: recording(sqliteTarget(t.jobsSqlite), seen),
      })
    );
    expect(report).toMatchObject({ mode: "dry run", logId: null, read: null });
    expect(seen).toEqual([]);
    expect(logRows(t)).toEqual([]);
  });

  it("TL-BREAKGLASS execute logs the access first, then prints what was read", async () => {
    const t = await setup();
    const lines: string[] = [];
    const report = await supportAccess(
      opts(t, { log: (line) => lines.push(line) })
    );
    const rows = logRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: report.logId,
      operator_email: "ops@example.com",
      subject_user_id: report.userId,
      reason: "User reports a missing job card",
      ticket_ref: "SUP-42",
      scope: "read:applications",
    });
    expect(report.read).toEqual([
      expect.objectContaining({
        legacy_job_id: "acme",
        title: "Senior Engineer",
      }),
    ]);
    const output = lines.join("\n");
    expect(output).toContain("Senior Engineer");
    expect(output).toContain("SUP-42");
    expect(report.notice).toContain("Support accessed your Job Tracker data");
  });

  it("TL-BREAKGLASS a single application scope reads the job and its timeline", async () => {
    const t = await setup();
    const report = await supportAccess(opts(t, { scope: "application:acme" }));
    expect(report.read).toMatchObject({
      job: { id: "acme", title: "Senior Engineer", status: "saved" },
      events: [expect.objectContaining({ type: "created" })],
    });
  });

  it("TL-BREAKGLASS is read-only on JOBS_DB", async () => {
    const t = await setup();
    const seen: string[] = [];
    await supportAccess(
      opts(t, {
        scope: "application:acme",
        jobs: recording(sqliteTarget(t.jobsSqlite), seen),
      })
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((sql) => SELECT_RE.test(sql))).toBe(true);
    const guarded = readOnly(sqliteTarget(t.jobsSqlite));
    await expect(guarded.query("DELETE FROM applications")).rejects.toThrow(
      "read-only"
    );
    await expect(
      guarded.query("SELECT 1; DELETE FROM applications")
    ).rejects.toThrow("read-only");
    await expect(
      guarded.query("WITH x AS (SELECT 1) DELETE FROM applications")
    ).rejects.toThrow("read-only");
    await expect(guarded.batch([])).rejects.toThrow("read-only");
  });

  it("TL-BREAKGLASS an unknown user logs nothing", async () => {
    const t = await setup();
    const report = await supportAccess(
      opts(t, { subject: { email: "nobody@example.com" } })
    );
    expect(report.userId).toBeNull();
    expect(logRows(t)).toEqual([]);
  });
});
