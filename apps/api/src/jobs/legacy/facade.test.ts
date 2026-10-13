import { describe, expect, it } from "bun:test";
import type { TestEnv, V1Session } from "../../../test/fakes";
import {
  createTestEnv,
  createToolSession,
  createV1Client,
  jsonOf,
  textOf,
} from "../../../test/fakes";
import {
  rowsOf,
  seedApplication,
  seedPosting,
  seedUserJob,
} from "../../../test/seed-jobs";
import type { Caller } from "../../auth";
import type { JobData } from "../../types";
import { clearFlagCache } from "../core/flags";
import { legacyBackendKind } from "./facade";

const ALICE: Caller = {
  email: "alice@example.com",
  isAdmin: false,
  scope: "write",
};
const BOB: Caller = {
  email: "bob@example.com",
  isAdmin: false,
  scope: "write",
};

interface World {
  alice: V1Session;
  admin: V1Session;
  bob: V1Session;
  t: TestEnv;
}

async function world(backend: "kv" | "d1"): Promise<World> {
  const t = createTestEnv({}, { flags: { JOBS_LEGACY_BACKEND: backend } });
  const client = createV1Client(t);
  return {
    t,
    alice: await client.browserSession(ALICE.email),
    bob: await client.browserSession(BOB.email),
    admin: await client.browserSession("admin@example.com"),
  };
}

function legacyJob(id: string, fields: Partial<JobData> = {}): JobData {
  return {
    id,
    title: `Role ${id}`,
    status: "saved",
    company: "Acme",
    companyUrl: "https://acme.example.com",
    salaryRange: "",
    jobDescription: ["Build things."],
    requirements: [],
    interviewDate: "",
    sections: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...fields,
  };
}

function putKv(t: TestEnv, job: JobData, owner: string | null): void {
  t.kv.JOBS_KV.store.set(`job:${job.id}`, {
    value: JSON.stringify(job),
    metadata: { title: job.title, status: job.status },
  });
  if (owner) {
    t.kv.JOBS_KV.store.set(`owner:job:${job.id}`, { value: owner });
  }
}

function app(t: TestEnv, legacyId: string) {
  return t.jobsSqlite
    .query("SELECT * FROM applications WHERE legacy_job_id = ?")
    .get(legacyId) as Record<string, unknown> | null;
}

/** Ages an application past the 5 s legacy stale window. */
function age(t: TestEnv, legacyId: string): void {
  t.jobsSqlite
    .query(
      "UPDATE applications SET updated_at = updated_at - 60000 WHERE legacy_job_id = ?"
    )
    .run(legacyId);
}

describe("TL-FLAG JOBS_LEGACY_BACKEND selects the store (D-33, 06 §12.5)", () => {
  it("TL-FLAG kv (the default) writes the KV blob and stamp, nothing in JOBS_DB", async () => {
    const { t, alice } = await world("kv");
    expect(await legacyBackendKind(t.env, Date.now())).toBe("kv");
    const res = await alice.post("/api/jobs", legacyJob("k1"));
    expect(res.status).toBe(201);
    expect(t.kv.JOBS_KV.store.get("owner:job:k1")?.value).toBe(ALICE.email);
    expect(app(t, "k1")).toBeNull();
  });

  it("TL-FLAG d1 writes JOBS_DB only and reads it back", async () => {
    const { t, alice } = await world("d1");
    const res = await alice.post("/api/jobs", legacyJob("d1job"));
    expect(res.status).toBe(201);
    expect(t.kv.JOBS_KV.store.size).toBe(0);
    expect(app(t, "d1job")).toMatchObject({ stage: "saved", mode: "manual" });
    const got = await alice.get("/api/jobs/d1job");
    expect((got.body as { item: JobData }).item.title).toBe("Role d1job");
  });

  it("TL-FLAG flipping back to kv serves KV again (rollback path)", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("only-d1"));
    await t.setFlag("JOBS_LEGACY_BACKEND", "kv");
    expect((await alice.get("/api/jobs/only-d1")).status).toBe(404);
    await t.setFlag("JOBS_LEGACY_BACKEND", "d1");
    expect((await alice.get("/api/jobs/only-d1")).status).toBe(200);
  });

  it("TL-FLAG an unknown flag value falls back to kv", async () => {
    const t = createTestEnv();
    t.sqlite
      .query(
        "INSERT INTO feature_flags (key, value, updated_at, updated_by) VALUES ('JOBS_LEGACY_BACKEND', '\"sqlite\"', 0, 'test') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run();
    clearFlagCache(t.env);
    expect(await legacyBackendKind(t.env, Date.now())).toBe("kv");
  });
});

describe("TL-FALLBACK P3: a D1 miss migrates that one KV job on the fly", () => {
  it("TL-FALLBACK GET of a KV-only job migrates it and serves the same content", async () => {
    const { t, alice } = await world("d1");
    const job = legacyJob("old", {
      status: "interviewing",
      interviewDate: "2026-02-03",
      sections: [{ id: "s1", name: "Notes", items: [] }],
    });
    putKv(t, job, ALICE.email);
    const res = await alice.get("/api/jobs/old");
    expect(res.status).toBe(200);
    expect((res.body as { item: JobData }).item).toEqual(job);
    expect(app(t, "old")).toMatchObject({
      stage: "interviewing",
      submission_status: "submitted_verified",
      last_change_source: "legacy_migration",
    });
    const events = t.jobsSqlite
      .query(
        "SELECT type, idempotency_key FROM application_events ORDER BY idempotency_key"
      )
      .all();
    expect(events).toEqual([
      { type: "created", idempotency_key: "legacy:old:created" },
      { type: "legacy_imported", idempotency_key: "legacy:old:imported" },
    ]);
    // Served from D1 afterwards, even with the KV blob gone.
    t.kv.JOBS_KV.store.delete("job:old");
    expect((await alice.get("/api/jobs/old")).status).toBe(200);
  });

  it("TL-FALLBACK never migrates a job stamped to someone else", async () => {
    const { t, alice } = await world("d1");
    putKv(t, legacyJob("bobs"), BOB.email);
    expect((await alice.get("/api/jobs/bobs")).status).toBe(404);
    expect(app(t, "bobs")).toBeNull();
  });

  it("TL-FALLBACK ignores unstamped and unparseable KV blobs", async () => {
    const { t, alice } = await world("d1");
    putKv(t, legacyJob("orphan"), null);
    t.kv.JOBS_KV.store.set("job:broken", { value: "{nope" });
    t.kv.JOBS_KV.store.set("owner:job:broken", { value: ALICE.email });
    expect((await alice.get("/api/jobs/orphan")).status).toBe(404);
    expect((await alice.get("/api/jobs/broken")).status).toBe(404);
  });

  it("TL-FALLBACK a deleted (archived) job is not resurrected from KV", async () => {
    const { t, alice } = await world("d1");
    putKv(t, legacyJob("gone"), ALICE.email);
    expect((await alice.delete("/api/jobs/gone")).status).toBe(200);
    expect(app(t, "gone")).toMatchObject({ archived: 1 });
    expect((await alice.get("/api/jobs/gone")).status).toBe(404);
    expect(
      t.jobsSqlite.query("SELECT COUNT(*) AS n FROM applications").get()
    ).toEqual({ n: 1 });
  });

  it("TL-FALLBACK MCP tools on a KV-only job migrate it first, then edit", async () => {
    const { t } = await world("d1");
    putKv(t, legacyJob("mcpold"), ALICE.email);
    const mcp = createToolSession(t.env, ALICE);
    const updated = jsonOf(
      await mcp.call("jobs_update", { job_id: "mcpold", status: "applied" })
    );
    expect(updated.status).toBe("applied");
    expect(app(t, "mcpold")).toMatchObject({ stage: "applied" });
  });
});

describe("TL-STALE-GUARD legacy PUT needs no revision but refuses a 5 s cross-source race (05 §14)", () => {
  it("TL-STALE-GUARD 409 when MCP changed the job less than 5 s ago", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("race"));
    age(t, "race");
    await createToolSession(t.env, ALICE).call("jobs_update", {
      job_id: "race",
      title: "From MCP",
    });
    const res = await alice.put(
      "/api/jobs/race",
      legacyJob("race", { title: "From web" })
    );
    expect(res.status).toBe(409);
    const got = await alice.get("/api/jobs/race");
    expect((got.body as { item: JobData }).item.title).toBe("From MCP");
  });

  it("TL-STALE-GUARD the same source may save again right away", async () => {
    const { alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("same"));
    expect(
      (await alice.put("/api/jobs/same", legacyJob("same", { title: "One" })))
        .status
    ).toBe(200);
    expect(
      (await alice.put("/api/jobs/same", legacyJob("same", { title: "Two" })))
        .status
    ).toBe(200);
  });

  it("TL-STALE-GUARD after 5 s the save wins without a revision", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("later"));
    await createToolSession(t.env, ALICE).call("jobs_update", {
      job_id: "later",
      title: "From MCP",
    });
    age(t, "later");
    const res = await alice.put(
      "/api/jobs/later",
      legacyJob("later", { title: "Web" })
    );
    expect(res.status).toBe(200);
    expect((res.body as { item: JobData }).item.title).toBe("Web");
  });

  it("TL-STALE-GUARD never applies on the kv backend", async () => {
    const { t, alice } = await world("kv");
    await alice.post("/api/jobs", legacyJob("kvrace"));
    await createToolSession(t.env, ALICE).call("jobs_update", {
      job_id: "kvrace",
      title: "MCP",
    });
    expect(
      (await alice.put("/api/jobs/kvrace", legacyJob("kvrace"))).status
    ).toBe(200);
  });
});

describe("status writes follow 03 §5.1 (06 §12.6)", () => {
  it("an illegal legacy transition is 422 with the legacy text Invalid status", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("jump"));
    age(t, "jump");
    const res = await alice.put(
      "/api/jobs/jump",
      legacyJob("jump", { status: "offer" })
    );
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "Invalid status" });
    expect(app(t, "jump")).toMatchObject({ stage: "saved" });
  });

  it("accepted → saved is refused for MCP as well", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("done", { status: "accepted" }));
    const mcp = createToolSession(t.env, ALICE);
    expect(
      textOf(await mcp.call("jobs_update", { job_id: "done", status: "saved" }))
    ).toBe("Invalid status");
  });

  it("applied is mark_applied: submitted_verified with a user attestation", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("apply"));
    age(t, "apply");
    const res = await alice.put(
      "/api/jobs/apply",
      legacyJob("apply", { status: "applied" })
    );
    expect(res.status).toBe(200);
    expect(app(t, "apply")).toMatchObject({
      stage: "applied",
      submission_status: "submitted_verified",
    });
    const evidence = t.jobsSqlite
      .query("SELECT kind, verdict FROM submission_evidence")
      .all();
    expect(evidence).toEqual([
      { kind: "user_attestation", verdict: "verified" },
    ]);
  });

  it("the lossy read: preparing reads as saved and a saved PUT keeps the stage", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("prep"));
    t.jobsSqlite
      .query(
        "UPDATE applications SET stage = 'preparing', updated_at = 0 WHERE legacy_job_id = 'prep'"
      )
      .run();
    const got = await alice.get("/api/jobs/prep");
    expect((got.body as { item: JobData }).item.status).toBe("saved");
    const res = await alice.put(
      "/api/jobs/prep",
      legacyJob("prep", { title: "Renamed" })
    );
    expect(res.status).toBe(200);
    expect(app(t, "prep")).toMatchObject({ stage: "preparing" });
  });
});

describe("T6-15 a legacy edit of a public posting forks a private copy", () => {
  it("T6-15 forks on a title edit; the public row and Bob's view are unchanged", async () => {
    const { t, alice, bob } = await world("d1");
    const posting = seedPosting(t.jobsSqlite, { title: "Backend Engineer" });
    const aliceJob = seedUserJob(t.jobsSqlite, alice.userId as string, {
      posting_id: posting.id,
    });
    const bobJob = seedUserJob(t.jobsSqlite, bob.userId as string, {
      posting_id: posting.id,
    });
    seedApplication(t.jobsSqlite, alice.userId as string, {
      user_job_id: aliceJob.id,
      legacy_job_id: "shared",
      updated_at: 0,
    });
    seedApplication(t.jobsSqlite, bob.userId as string, {
      user_job_id: bobJob.id,
      legacy_job_id: "shared",
    });
    const before = (await alice.get("/api/jobs/shared")).body as {
      item: JobData;
    };
    const res = await alice.put("/api/jobs/shared", {
      ...before.item,
      title: "My own title",
    });
    expect(res.status).toBe(200);
    const pub = t.jobsSqlite
      .query("SELECT title, revision FROM job_postings WHERE id = ?")
      .get(posting.id);
    expect(pub).toEqual({ title: "Backend Engineer", revision: 1 });
    const aliceUserJob = rowsOf(
      t.jobsSqlite,
      "user_jobs",
      alice.userId as string
    )[0];
    expect(aliceUserJob.posting_id).not.toBe(posting.id);
    const fork = t.jobsSqlite
      .query(
        "SELECT visibility, source_kind, owner_user_id, title, company_name FROM job_postings WHERE id = ?"
      )
      .get(aliceUserJob.posting_id as string);
    expect(fork).toEqual({
      visibility: "private",
      source_kind: "manual",
      owner_user_id: alice.userId,
      title: "My own title",
      company_name: "Acme",
    });
    const bobs = (await bob.get("/api/jobs/shared")).body as { item: JobData };
    expect(bobs.item.title).toBe("Backend Engineer");
  });

  it("T6-15 a private posting is edited in place (no new posting)", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("mine"));
    age(t, "mine");
    const count = () =>
      (
        t.jobsSqlite.query("SELECT COUNT(*) AS n FROM job_postings").get() as {
          n: number;
        }
      ).n;
    expect(count()).toBe(1);
    await alice.put("/api/jobs/mine", legacyJob("mine", { company: "Globex" }));
    expect(count()).toBe(1);
    expect(
      t.jobsSqlite
        .query("SELECT company_name, revision FROM job_postings")
        .get()
    ).toEqual({ company_name: "Globex", revision: 2 });
  });
});

describe("T11-ADMIN admins get no bypass on jobs (D-26)", () => {
  for (const backend of ["kv", "d1"] as const) {
    it(`T11-ADMIN an admin gets 404 for another user's job (${backend})`, async () => {
      const { alice, admin } = await world(backend);
      await alice.post("/api/jobs", legacyJob("private"));
      expect((await admin.get("/api/jobs/private")).status).toBe(404);
      expect(
        (await admin.put("/api/jobs/private", legacyJob("private"))).status
      ).toBe(404);
      expect((await admin.delete("/api/jobs/private")).status).toBe(404);
      const list = await admin.get("/api/jobs", { query: { mine: "0" } });
      expect(list.body).toEqual({ items: [] });
    });
  }

  it("T11-ADMIN an admin gets 404 for another user's /api/v1 application", async () => {
    const { t, alice, admin } = await world("d1");
    await alice.post("/api/jobs", legacyJob("v1"));
    const id = app(t, "v1")?.id as string;
    expect((await alice.get(`/api/v1/applications/${id}`)).status).toBe(200);
    expect((await admin.get(`/api/v1/applications/${id}`)).status).toBe(404);
  });
});

describe("interview dates, follow-ups, archive and caps on D1", () => {
  it("sets, moves and clears the next pending interview through interviewDate", async () => {
    const { t, alice } = await world("d1");
    await alice.post(
      "/api/jobs",
      legacyJob("ivw", { interviewDate: "2026-03-01" })
    );
    age(t, "ivw");
    await alice.put(
      "/api/jobs/ivw",
      legacyJob("ivw", { interviewDate: "2026-03-05" })
    );
    age(t, "ivw");
    let rows = t.jobsSqlite
      .query("SELECT scheduled_at, outcome FROM interviews")
      .all();
    expect(rows).toEqual([
      { scheduled_at: Date.UTC(2026, 2, 5, 9), outcome: "pending" },
    ]);
    await alice.put("/api/jobs/ivw", legacyJob("ivw", { interviewDate: "" }));
    rows = t.jobsSqlite.query("SELECT outcome FROM interviews").all();
    expect(rows).toEqual([{ outcome: "cancelled" }]);
    const got = await alice.get("/api/jobs/ivw");
    expect((got.body as { item: JobData }).item.interviewDate).toBe("");
  });

  it("rejects an interview date that is not YYYY-MM-DD (422)", async () => {
    const { alice } = await world("d1");
    const res = await alice.post(
      "/api/jobs",
      legacyJob("baddate", { interviewDate: "soon" })
    );
    expect(res.status).toBe(422);
  });

  it("jobs_update follow_up_at writes applications.follow_up_at (d1) and is refused on kv", async () => {
    const d1 = await world("d1");
    const mcp = createToolSession(d1.t.env, ALICE);
    await mcp.call("jobs_create", { job_id: "fu", title: "Follow" });
    await mcp.call("jobs_update", { job_id: "fu", follow_up_at: "2026-11-01" });
    expect(app(d1.t, "fu")).toMatchObject({
      follow_up_at: Date.UTC(2026, 10, 1, 9),
    });
    await mcp.call("jobs_update", { job_id: "fu", follow_up_at: null });
    expect(app(d1.t, "fu")).toMatchObject({ follow_up_at: null });
    const kv = await world("kv");
    const kvMcp = createToolSession(kv.t.env, ALICE);
    await kvMcp.call("jobs_create", { job_id: "fu", title: "Follow" });
    expect(
      textOf(
        await kvMcp.call("jobs_update", {
          job_id: "fu",
          follow_up_at: "2026-11-01",
        })
      )
    ).toContain("not available yet");
  });

  it("DELETE archives (the application and its history stay)", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("arch"));
    expect((await alice.delete("/api/jobs/arch")).body).toEqual({
      ok: true,
      id: "arch",
    });
    expect(app(t, "arch")).toMatchObject({ archived: 1 });
    expect(
      (
        t.jobsSqlite
          .query("SELECT COUNT(*) AS n FROM application_events")
          .get() as { n: number }
      ).n
    ).toBeGreaterThan(0);
  });

  it("checklists above 200 items are refused (413, 06 §5)", async () => {
    const { t, alice } = await world("d1");
    await alice.post("/api/jobs", legacyJob("big"));
    age(t, "big");
    const items = Array.from({ length: 201 }, (_, i) => ({
      id: `i${i}`,
      title: "x",
      notes: "",
      url: "",
      done: false,
    }));
    const res = await alice.put(
      "/api/jobs/big",
      legacyJob("big", { sections: [{ id: "s", name: "S", items }] })
    );
    expect(res.status).toBe(413);
  });
});
