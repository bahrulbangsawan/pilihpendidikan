import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestEnv } from "../test/fakes";
import {
  createTestEnv,
  createToolSession,
  jsonOf,
  textOf,
} from "../test/fakes";
import type { Caller } from "../src/auth";
import { handleJobsGet, handleJobsList } from "../src/documents/jobs";
import {
  calendarDate,
  descriptionLines,
  descriptionOf,
  parseLegacyDate,
} from "../src/jobs/legacy/mapping";
import type { JobData } from "../src/types";
import type {
  FixtureEntry,
  MigrationOptions,
  SqlTarget,
} from "./migrate-jobs-kv-to-d1";
import {
  bindingKv,
  fileCheckpoint,
  memoryKv,
  migrateJobsKvToD1,
  readKvExport,
  sqliteTarget,
} from "./migrate-jobs-kv-to-d1";

const FIXTURE = join(import.meta.dir, "fixtures", "jobs-kv-export.json");
const NOW = Date.UTC(2026, 9, 12);
const OWNERS = ["alice@example.com", "bob@example.com", "carol@example.com"];
const INVALID_IDS = ["broken-json", "not-an-object", "unknown-status"];

function loadFixture(t: TestEnv): FixtureEntry[] {
  const entries = readKvExport(FIXTURE);
  for (const entry of entries) {
    t.kv.JOBS_KV.store.set(entry.key, {
      value: entry.value,
      metadata: entry.metadata,
    });
  }
  return entries;
}

function tableCounts(t: TestEnv): Record<string, number> {
  const count = (sqlite: TestEnv["sqlite"], table: string) =>
    (sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number })
      .n;
  const out: Record<string, number> = { users: count(t.sqlite, "users") };
  for (const table of [
    "job_postings",
    "user_jobs",
    "applications",
    "application_events",
    "interviews",
    "submission_evidence",
    "change_log",
  ]) {
    out[table] = count(t.jobsSqlite, table);
  }
  return out;
}

function options(
  t: TestEnv,
  overrides: Partial<MigrationOptions> = {}
): MigrationOptions {
  return {
    kv: bindingKv(t.env.JOBS_KV),
    identity: sqliteTarget(t.sqlite),
    jobs: sqliteTarget(t.jobsSqlite),
    execute: false,
    now: () => NOW,
    random: () => 0.5,
    ...overrides,
  };
}

/** A target that refuses every write (proves a dry run writes nothing). */
function noWrites(target: SqlTarget): SqlTarget {
  return {
    query: (sql, params) => target.query(sql, params),
    batch: () => Promise.reject(new Error("write attempted in a dry run")),
  };
}

describe("T6-10 dry run on the fixture KV export", () => {
  it("T6-10 reports counts per class and status, orphans and invalid blobs, and writes nothing", async () => {
    const t = createTestEnv();
    loadFixture(t);
    const before = tableCounts(t);
    const dir = mkdtempSync(join(tmpdir(), "jobs-kv-"));
    const lines: string[] = [];
    const report = await migrateJobsKvToD1(
      options(t, {
        identity: noWrites(sqliteTarget(t.sqlite)),
        jobs: noWrites(sqliteTarget(t.jobsSqlite)),
        planFile: join(dir, "migration-plan.jsonl"),
        log: (line) => lines.push(line),
      })
    );
    expect(report.mode).toBe("dry run");
    expect(report.inventory).toEqual({
      jobKeys: 56,
      ownerStamps: 55,
      stampsWithoutJob: 1,
    });
    expect(report.classes).toEqual({
      ok: 50,
      orphan: 3,
      invalid: 3,
      already_migrated: 0,
    });
    expect(report.statuses).toEqual({
      saved: 9,
      applied: 9,
      interviewing: 8,
      offer: 8,
      rejected: 8,
      accepted: 8,
    });
    expect(report.orphans).toEqual(["orphan-1", "orphan-2", "orphan-3"]);
    expect(report.invalid).toEqual([
      { id: "broken-json", reason: "unparseable_json" },
      { id: "not-an-object", reason: "not_an_object" },
      { id: "unknown-status", reason: "unknown_status" },
    ]);
    expect(report.users).toEqual({ existing: 0, toCreate: 4 });
    expect(tableCounts(t)).toEqual(before);
    expect(lines.join("\n")).toContain("dry run");
    const plan = readFileSync(join(dir, "migration-plan.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(plan).toHaveLength(56);
    const first = JSON.parse(plan[0]) as Record<string, unknown>;
    // Redacted: emails hashed, titles kept.
    expect(String(first.owner)).toStartWith("sha256:");
    expect(plan.join("\n")).not.toContain("@example.com");
    expect(lines.filter((l) => l.startsWith("  {"))).toHaveLength(20);
  });

  it("T6-10 the inventory follows the KV list cursor past 1,000 keys", async () => {
    const t = createTestEnv();
    for (let i = 0; i < 1203; i++) {
      const id = `bulk-${String(i).padStart(4, "0")}`;
      t.kv.JOBS_KV.store.set(`job:${id}`, {
        value: JSON.stringify({ id, title: id, status: "saved", sections: [] }),
      });
      t.kv.JOBS_KV.store.set(`owner:job:${id}`, { value: "alice@example.com" });
    }
    const report = await migrateJobsKvToD1(options(t));
    expect(report.inventory.jobKeys).toBe(1203);
    expect(report.classes.ok).toBe(1203);
  });
});

describe("T6-11 execute twice: the second run is a no-op", () => {
  it("T6-11 row counts are unchanged by a second --execute", async () => {
    const t = createTestEnv();
    loadFixture(t);
    const first = await migrateJobsKvToD1(options(t, { execute: true }));
    expect(first.executed).toBe(50);
    expect(first.failed).toEqual([]);
    expect(first.verify?.ok).toBe(true);
    const after = tableCounts(t);
    expect(after).toMatchObject({
      users: 4,
      applications: 50,
      job_postings: 50,
      user_jobs: 50,
    });
    const second = await migrateJobsKvToD1(options(t, { execute: true }));
    expect(second.executed).toBe(0);
    expect(second.classes.already_migrated).toBe(50);
    expect(tableCounts(t)).toEqual(after);
  });

  it("T6-11 resumes from the checkpoint after an interruption", async () => {
    const t = createTestEnv();
    loadFixture(t);
    const checkpoint = fileCheckpoint(
      join(mkdtempSync(join(tmpdir(), "ckpt-")), "c.json")
    );
    const real = sqliteTarget(t.jobsSqlite);
    let batches = 0;
    const flaky: SqlTarget = {
      query: (sql, params) => real.query(sql, params),
      batch: (statements) => {
        batches += 1;
        return batches > 30
          ? Promise.reject(new Error("network down"))
          : real.batch(statements);
      },
    };
    const interrupted = await migrateJobsKvToD1(
      options(t, { execute: true, jobs: flaky, checkpoint })
    );
    expect(interrupted.executed).toBe(30);
    expect(interrupted.failed).toHaveLength(20);
    expect(interrupted.ok).toBe(false);
    expect((await checkpoint.load()).size).toBe(30);
    const resumed = await migrateJobsKvToD1(
      options(t, { execute: true, checkpoint })
    );
    expect(resumed.executed).toBe(20);
    expect(resumed.ok).toBe(true);
    expect(tableCounts(t).applications).toBe(50);
  });

  it("T6-11 --refresh re-imports an untouched job whose KV copy is newer, never a touched one", async () => {
    const t = createTestEnv();
    loadFixture(t);
    await migrateJobsKvToD1(options(t, { execute: true }));
    const bump = (id: string, title: string) => {
      const job = JSON.parse(
        t.kv.JOBS_KV.store.get(`job:${id}`)?.value ?? "{}"
      ) as JobData;
      t.kv.JOBS_KV.store.set(`job:${id}`, {
        value: JSON.stringify({
          ...job,
          title,
          updatedAt: "2026-06-01T00:00:00.000Z",
        }),
      });
    };
    bump("job-001", "Edited in KV");
    bump("job-002", "Edited in KV too");
    // job-002 was touched in D1 (a note through the new tools).
    await createToolSession(t.env, {
      email: "alice@example.com",
      isAdmin: false,
      scope: "write",
    }).call("jobs_note_add", { job_id: "job-002", text: "touched" });
    const dry = await migrateJobsKvToD1(options(t));
    expect(dry.stale).toBe(1);
    const run = await migrateJobsKvToD1(
      options(t, { execute: true, refresh: true })
    );
    expect(run.refreshed).toBe(1);
    const title = (id: string) =>
      (
        t.jobsSqlite
          .query(
            "SELECT p.title FROM applications a JOIN user_jobs u ON u.id = a.user_job_id JOIN job_postings p ON p.id = u.posting_id WHERE a.legacy_job_id = ?"
          )
          .get(id) as { title: string }
      ).title;
    expect(title("job-001")).toBe("Edited in KV");
    expect(title("job-002")).not.toBe("Edited in KV too");
    expect(tableCounts(t).applications).toBe(50);
  });
});

describe("T6-12 field mapping through the script (06 §12.2)", () => {
  it("T6-12 the fixture's edge cases land as specified", async () => {
    const t = createTestEnv();
    loadFixture(t);
    await migrateJobsKvToD1(options(t, { execute: true }));
    const view = (id: string) =>
      t.jobsSqlite
        .query(
          "SELECT a.stage, a.submission_status, p.title, p.company_name, p.canonical_url, p.company_domain, p.salary, p.description_text FROM applications a JOIN user_jobs u ON u.id = a.user_job_id JOIN job_postings p ON p.id = u.posting_id WHERE a.legacy_job_id = ?"
        )
        .get(id);
    expect(view("job-003")).toMatchObject({
      title: "Untitled role",
      company_name: "Unknown company",
      canonical_url: null,
      salary: null,
      description_text: "",
    });
    expect(view("job-011")).toMatchObject({
      canonical_url: "not a url",
      company_domain: null,
    });
    expect(view("job-001")).toMatchObject({ company_domain: "example.com" });
    const note = t.jobsSqlite
      .query(
        "SELECT payload FROM application_events WHERE idempotency_key = 'legacy:job-004:interview_date'"
      )
      .get() as { payload: string };
    expect(JSON.parse(note.payload).text).toBe(
      "Legacy interview date: next week"
    );
    expect(
      t.jobsSqlite
        .query(
          "SELECT COUNT(*) AS n FROM interviews i JOIN applications a ON a.id = i.application_id WHERE a.legacy_job_id IN ('job-004','job-005','job-006')"
        )
        .get()
    ).toEqual({ n: 0 });
    // Dave's stamp "Dave@Example.com " belongs to the normalized email.
    expect(
      t.sqlite.query("SELECT email FROM users ORDER BY email").all()
    ).toEqual([
      { email: "alice@example.com" },
      { email: "bob@example.com" },
      { email: "carol@example.com" },
      { email: "dave@example.com" },
    ]);
  });

  it("T6-12 the fixture runs fully locally from a KV export", async () => {
    const t = createTestEnv();
    const report = await migrateJobsKvToD1(
      options(t, {
        kv: memoryKv(readKvExport(FIXTURE)),
        execute: true,
        sampleRate: 1,
      })
    );
    expect(report.verify).toMatchObject({ ok: true, sampled: 50 });
  });
});

// --- S-02 --------------------------------------------------------------------

interface Snapshot {
  get: Record<string, JobData>;
  mcpGet: Record<string, JobData>;
  mcpList: Record<string, string>[];
  restList: Record<string, string>[];
}

async function snapshot(t: TestEnv, email: string): Promise<Snapshot> {
  const caller: Caller = { email, isAdmin: false, scope: "write" };
  const rest = (await (
    await handleJobsList(caller, t.env, new URL("https://api.test/api/jobs"))
  ).json()) as { items: Record<string, string>[] };
  const mcp = createToolSession(t.env, caller);
  const list = jsonOf<Record<string, string>[]>(await mcp.call("jobs_list"));
  const get: Record<string, JobData> = {};
  const mcpGet: Record<string, JobData> = {};
  const unreadable = new Set<string>();
  for (const row of rest.items) {
    const response = await handleJobsGet(caller, t.env, row.id);
    if (response.status === 404) {
      // Listed from KV metadata but unreadable (invalid blob): reported by
      // the migration as `invalid`, never migrated.
      unreadable.add(row.id);
      continue;
    }
    const res = (await response.json()) as { item: JobData };
    get[row.id] = res.item;
    const got = textOf(await mcp.call("jobs_get", { job_id: row.id }));
    if (!got.startsWith("{")) {
      throw new Error(`${email} ${row.id}: ${got}`);
    }
    mcpGet[row.id] = JSON.parse(got) as JobData;
  }
  const byId = (a: Record<string, string>, b: Record<string, string>) =>
    a.id < b.id ? -1 : 1;
  // Invalid blobs (06 §12.4 step 2) are reported and never migrated.
  for (const id of INVALID_IDS) {
    unreadable.add(id);
    delete get[id];
    delete mcpGet[id];
  }
  const readable = (row: Record<string, string>) => !unreadable.has(row.id);
  return {
    restList: rest.items.filter(readable).sort(byId),
    mcpList: list.filter(readable).sort(byId),
    get,
    mcpGet,
  };
}

/** The documented lossy transformations of 06 §12.2 applied to a KV value. */
function migrated(job: JobData): JobData {
  return {
    ...job,
    jobDescription: descriptionLines(descriptionOf(job.jobDescription).text),
    interviewDate: interviewOf(job.interviewDate ?? ""),
    createdAt: new Date(Date.parse(job.createdAt)).toISOString(),
    updatedAt: new Date(Date.parse(job.updatedAt)).toISOString(),
  };
}

function interviewOf(date: string): string {
  const at = parseLegacyDate(date);
  return at === null ? "" : calendarDate(at, null);
}

function migratedRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {
    ...row,
    interviewDate: interviewOf(row.interviewDate ?? ""),
  };
  if ("updatedAt" in row) {
    out.updatedAt = new Date(Date.parse(row.updatedAt)).toISOString();
  }
  return out;
}

describe("S-02 legacy migration parity (13 §5)", () => {
  it("S-02 50 KV jobs: dry run → execute → /api/jobs and MCP jobs_list/get are identical", async () => {
    const t = createTestEnv();
    loadFixture(t);
    const before: Record<string, Snapshot> = {};
    for (const email of OWNERS) {
      before[email] = await snapshot(t, email);
    }
    expect(OWNERS.map((e) => before[e].restList.length)).toEqual([25, 15, 8]);
    expect(OWNERS.map((e) => Object.keys(before[e].get).length)).toEqual([
      25, 15, 8,
    ]);

    const dry = await migrateJobsKvToD1(options(t));
    expect(dry.executed).toBe(0);
    expect(tableCounts(t).applications).toBe(0);
    const run = await migrateJobsKvToD1(
      options(t, { execute: true, sampleRate: 1 })
    );
    expect(run.ok).toBe(true);

    await t.setFlag("JOBS_LEGACY_BACKEND", "d1");
    for (const email of OWNERS) {
      const after = await snapshot(t, email);
      const was = before[email];
      expect(after.restList).toEqual(was.restList.map(migratedRow));
      expect(after.mcpList).toEqual(was.mcpList.map(migratedRow));
      for (const id of Object.keys(was.get)) {
        expect(after.get[id]).toEqual(migrated(was.get[id]));
        expect(after.mcpGet[id]).toEqual(migrated(was.mcpGet[id]));
      }
    }
    // Statuses mapped 1:1, sections preserved, legacy ids address the jobs.
    const alice = await snapshot(t, "alice@example.com");
    expect(alice.get["job-001"].sections).toHaveLength(2);
    expect(alice.get["job-006"].status).toBe("accepted");
    const mcp = createToolSession(t.env, {
      email: "alice@example.com",
      isAdmin: false,
      scope: "write",
    });
    expect(textOf(await mcp.call("jobs_get", { job_id: "orphan-1" }))).toBe(
      'Job "orphan-1" not found.'
    );
    expect(
      jsonOf(
        await mcp.call("jobs_update", {
          job_id: "job-001",
          title: "Edited after cut-over",
        })
      ).title
    ).toBe("Edited after cut-over");
  });
});
