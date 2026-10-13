import { beforeEach, describe, expect, it } from "bun:test";
import type { TestEnv } from "../../test/fakes";
import {
  createTestEnv,
  createToolSession,
  jsonOf,
  textOf,
} from "../../test/fakes";
import { seedApplication } from "../../test/seed-jobs";
import type { Caller } from "../auth";

// Ported from the old backend: the jobs tools run through the same wrapping
// stack as the Durable Object (logger → ownership guard → handler), one
// session per caller, sharing one KV store and one D1 request log.

const SECTION_ID_RE = /id: (\w+)/;
const ITEM_ID_RE = /item id: (\w+)/;

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
const ADMIN: Caller = {
  email: "admin@example.com",
  isAdmin: true,
  scope: "write",
};

let t: TestEnv;

beforeEach(() => {
  t = createTestEnv();
});

function session(caller: Caller) {
  return createToolSession(t.env, caller);
}

function store() {
  return t.kv.JOBS_KV.store;
}

describe("jobs_create", () => {
  it("creates a job, stamps owner:job:{id}, and returns the job", async () => {
    const job = jsonOf(
      await session(ALICE).call("jobs_create", {
        job_id: "acme",
        title: "Senior Engineer @ Acme",
      })
    );
    expect(job.id).toBe("acme");
    expect(job.status).toBe("saved");
    expect(job.sections).toEqual([]);
    expect(store().get("owner:job:acme")?.value).toBe("alice@example.com");
    expect(store().has("job:acme")).toBe(true);
  });

  it("is idempotent and never lets another owner hijack an id", async () => {
    await session(ALICE).call("jobs_create", {
      job_id: "acme",
      title: "Original",
    });
    const again = await session(BOB).call("jobs_create", {
      job_id: "acme",
      title: "Takeover",
    });
    expect(textOf(again)).toContain("already exists");
    expect(store().get("owner:job:acme")?.value).toBe("alice@example.com");
    const got = jsonOf(
      await session(ALICE).call("jobs_get", { job_id: "acme" })
    );
    expect(got.title).toBe("Original");
  });
});

describe("jobs_list ownership scoping", () => {
  it("T11-ADMIN shows everyone, admins included, only their own jobs (D-26)", async () => {
    await session(ALICE).call("jobs_create", { job_id: "a1", title: "A1" });
    await session(ALICE).call("jobs_create", { job_id: "a2", title: "A2" });
    await session(BOB).call("jobs_create", { job_id: "b1", title: "B1" });
    await session(ADMIN).call("jobs_create", { job_id: "x1", title: "X1" });
    const ids = async (caller: Caller) =>
      jsonOf<Array<{ id: string }>>(await session(caller).call("jobs_list"))
        .map((j) => j.id)
        .sort();
    expect(await ids(ALICE)).toEqual(["a1", "a2"]);
    expect(await ids(BOB)).toEqual(["b1"]);
    expect(await ids(ADMIN)).toEqual(["x1"]);
  });
});

describe("cross-owner authorization (the ownership guard)", () => {
  beforeEach(async () => {
    await session(ALICE).call("jobs_create", {
      job_id: "acme",
      title: "Alice's job",
    });
  });

  it("answers not-found to a non-owner for get, update, delete and nested edits", async () => {
    const bob = session(BOB);
    for (const [tool, args] of [
      ["jobs_get", { job_id: "acme" }],
      ["jobs_update", { job_id: "acme", title: "hacked" }],
      ["jobs_delete", { job_id: "acme" }],
      ["jobs_section_add", { job_id: "acme", name: "Sneaky" }],
    ] as const) {
      expect(textOf(await bob.call(tool, args))).toBe('Job "acme" not found.');
    }
    expect(store().has("job:acme")).toBe(true);
    const got = jsonOf(
      await session(ALICE).call("jobs_get", { job_id: "acme" })
    );
    expect(got.title).toBe("Alice's job");
  });

  it("T11-ADMIN gives an admin no access to another user's job (D-26)", async () => {
    const admin = session(ADMIN);
    expect(textOf(await admin.call("jobs_get", { job_id: "acme" }))).toBe(
      'Job "acme" not found.'
    );
    expect(
      textOf(
        await admin.call("jobs_update", { job_id: "acme", status: "offer" })
      )
    ).toBe('Job "acme" not found.');
    expect(
      jsonOf(await session(ALICE).call("jobs_get", { job_id: "acme" })).status
    ).toBe("saved");
  });

  it("T11-ADMIN treats a job without an owner stamp as reachable by nobody (D-26)", async () => {
    store().set("job:legacy", {
      value: JSON.stringify({
        id: "legacy",
        title: "Legacy",
        status: "saved",
        sections: [],
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      }),
      metadata: { title: "Legacy", status: "saved" },
    });
    expect(
      textOf(await session(BOB).call("jobs_get", { job_id: "legacy" }))
    ).toBe('Job "legacy" not found.');
    expect(
      textOf(await session(ADMIN).call("jobs_get", { job_id: "legacy" }))
    ).toBe('Job "legacy" not found.');
  });
});

describe("section + item CRUD", () => {
  it("adds, updates and deletes sections and items", async () => {
    const alice = session(ALICE);
    await alice.call("jobs_create", { job_id: "acme", title: "Acme" });
    const s1 = textOf(
      await alice.call("jobs_section_add", {
        job_id: "acme",
        name: "Interviews",
      })
    );
    const sectionId = s1.match(SECTION_ID_RE)?.[1] as string;
    await alice.call("jobs_section_add", { job_id: "acme", name: "Tasks" });
    const i1 = textOf(
      await alice.call("jobs_item_add", {
        job_id: "acme",
        section_id: sectionId,
        title: "Phone screen",
        url: "https://acme.test/round-1",
      })
    );
    const itemId = i1.match(ITEM_ID_RE)?.[1] as string;
    await alice.call("jobs_item_update", {
      job_id: "acme",
      section_id: sectionId,
      item_id: itemId,
      done: true,
      notes: "Went well",
    });
    await alice.call("jobs_section_update", {
      job_id: "acme",
      section_id: sectionId,
      name: "Interview Rounds",
    });
    interface Section {
      id: string;
      name: string;
      items: Array<{ id: string; done: boolean; notes: string }>;
    }
    let sections = jsonOf<{ sections: Section[] }>(
      await alice.call("jobs_get", { job_id: "acme" })
    ).sections;
    expect(sections.map((s) => s.name)).toEqual(["Interview Rounds", "Tasks"]);
    expect(sections[0].items[0]).toMatchObject({
      id: itemId,
      done: true,
      notes: "Went well",
    });
    await alice.call("jobs_item_delete", {
      job_id: "acme",
      section_id: sectionId,
      item_id: itemId,
    });
    await alice.call("jobs_section_delete", {
      job_id: "acme",
      section_id: sections[1].id,
    });
    sections = jsonOf<{ sections: Section[] }>(
      await alice.call("jobs_get", { job_id: "acme" })
    ).sections;
    expect(sections).toHaveLength(1);
    expect(sections[0].items).toHaveLength(0);
    expect(
      textOf(
        await alice.call("jobs_item_add", {
          job_id: "acme",
          section_id: "nope",
          title: "x",
        })
      )
    ).toBe('No section with id "nope".');
  });
});

describe("jobs_delete", () => {
  it("removes the blob and the owner stamp, so the id can be reused", async () => {
    const alice = session(ALICE);
    await alice.call("jobs_create", { job_id: "acme", title: "First" });
    expect(textOf(await alice.call("jobs_delete", { job_id: "acme" }))).toBe(
      'Job "acme" deleted.'
    );
    expect(store().has("job:acme")).toBe(false);
    expect(store().has("owner:job:acme")).toBe(false);
    const again = await alice.call("jobs_create", {
      job_id: "acme",
      title: "Second",
    });
    expect(jsonOf(again).title).toBe("Second");
  });
});

describe("request logging", () => {
  it("logs jobs_* calls (including denied ones) under category 'jobs'", async () => {
    await session(ALICE).call("jobs_create", { job_id: "acme", title: "Acme" });
    await session(ALICE).call("jobs_list");
    await session(BOB).call("jobs_get", { job_id: "acme" });
    const rows = t.sqlite
      .query(
        "SELECT tool, category, caller_email, resource_id, status, retention_until, ts FROM request_log ORDER BY id"
      )
      .all() as Array<{
      tool: string;
      category: string;
      caller_email: string;
      resource_id: string | null;
      status: string;
      retention_until: number;
      ts: number;
    }>;
    expect(rows.map((r) => r.tool)).toEqual([
      "jobs_create",
      "jobs_list",
      "jobs_get",
    ]);
    expect(rows.every((r) => r.category === "jobs")).toBe(true);
    expect(rows[0].resource_id).toBe("acme");
    expect(rows[1].resource_id).toBeNull();
    expect(rows[2]).toMatchObject({
      caller_email: "bob@example.com",
      status: "ok",
    });
    expect(rows[0].retention_until - rows[0].ts).toBe(90 * 86_400_000);
  });
});

// ---------------------------------------------------------------------------
// T6-13: the scenarios above, replayed against JOBS_LEGACY_BACKEND = d1. Tool
// texts and JSON are asserted exactly as above; the KV-store inspections
// become their JOBS_DB equivalents (an application with that legacy id).
// ---------------------------------------------------------------------------

describe("T6-13 the jobs tools against JOBS_LEGACY_BACKEND=d1", () => {
  let d1: TestEnv;
  beforeEach(() => {
    d1 = createTestEnv({}, { flags: { JOBS_LEGACY_BACKEND: "d1" } });
  });
  const on = (caller: Caller) => createToolSession(d1.env, caller);
  const liveApps = (legacyId: string) =>
    d1.jobsSqlite
      .query(
        "SELECT a.user_id FROM applications a WHERE a.legacy_job_id = ? AND a.archived = 0"
      )
      .all(legacyId) as Array<{ user_id: string }>;

  it("T6-13 jobs_create creates a job and returns it; nothing is written to KV", async () => {
    const job = jsonOf(
      await on(ALICE).call("jobs_create", {
        job_id: "acme",
        title: "Senior Engineer @ Acme",
      })
    );
    expect(job.id).toBe("acme");
    expect(job.status).toBe("saved");
    expect(job.sections).toEqual([]);
    expect(liveApps("acme")).toHaveLength(1);
    expect(d1.kv.JOBS_KV.store.size).toBe(0);
  });

  it("T6-13 re-creating an id is rejected and never touches another owner's job", async () => {
    await on(ALICE).call("jobs_create", { job_id: "acme", title: "Original" });
    expect(
      textOf(
        await on(ALICE).call("jobs_create", { job_id: "acme", title: "Again" })
      )
    ).toContain("already exists");
    // Ids are per user on JOBS_DB (ux_apps_legacy): Bob gets his own job and
    // learns nothing about Alice's (11 §6.1).
    const bobs = jsonOf(
      await on(BOB).call("jobs_create", { job_id: "acme", title: "Takeover" })
    );
    expect(bobs.title).toBe("Takeover");
    const got = jsonOf(await on(ALICE).call("jobs_get", { job_id: "acme" }));
    expect(got.title).toBe("Original");
  });

  it("T6-13 jobs_list shows a caller only their jobs", async () => {
    await on(ALICE).call("jobs_create", { job_id: "a1", title: "A1" });
    await on(ALICE).call("jobs_create", { job_id: "a2", title: "A2" });
    await on(BOB).call("jobs_create", { job_id: "b1", title: "B1" });
    const ids = async (caller: Caller) =>
      jsonOf<Array<{ id: string }>>(await on(caller).call("jobs_list")).map(
        (j) => j.id
      );
    expect(await ids(ALICE)).toEqual(["a1", "a2"]);
    expect(await ids(BOB)).toEqual(["b1"]);
    expect(textOf(await on(ADMIN).call("jobs_list"))).toBe(
      "No jobs found. Use jobs_create to start tracking one."
    );
  });

  it("T6-13 answers not-found to a non-owner (and an admin) for every tool", async () => {
    await on(ALICE).call("jobs_create", {
      job_id: "acme",
      title: "Alice's job",
    });
    for (const caller of [BOB, ADMIN]) {
      for (const [tool, args] of [
        ["jobs_get", { job_id: "acme" }],
        ["jobs_update", { job_id: "acme", title: "hacked" }],
        ["jobs_delete", { job_id: "acme" }],
        ["jobs_section_add", { job_id: "acme", name: "Sneaky" }],
        ["jobs_move", { job_id: "acme", stage: "applied" }],
        ["jobs_note_add", { job_id: "acme", text: "hi" }],
      ] as const) {
        expect(textOf(await on(caller).call(tool, args))).toBe(
          'Job "acme" not found.'
        );
      }
    }
    const got = jsonOf(await on(ALICE).call("jobs_get", { job_id: "acme" }));
    expect(got.title).toBe("Alice's job");
  });

  it("T6-13 adds, updates and deletes sections and items", async () => {
    const alice = on(ALICE);
    await alice.call("jobs_create", { job_id: "acme", title: "Acme" });
    const s1 = textOf(
      await alice.call("jobs_section_add", {
        job_id: "acme",
        name: "Interviews",
      })
    );
    const sectionId = s1.match(SECTION_ID_RE)?.[1] as string;
    await alice.call("jobs_section_add", { job_id: "acme", name: "Tasks" });
    const i1 = textOf(
      await alice.call("jobs_item_add", {
        job_id: "acme",
        section_id: sectionId,
        title: "Phone screen",
        url: "https://acme.test/round-1",
      })
    );
    const itemId = i1.match(ITEM_ID_RE)?.[1] as string;
    await alice.call("jobs_item_update", {
      job_id: "acme",
      section_id: sectionId,
      item_id: itemId,
      done: true,
      notes: "Went well",
    });
    await alice.call("jobs_section_update", {
      job_id: "acme",
      section_id: sectionId,
      name: "Interview Rounds",
    });
    interface Section {
      id: string;
      items: Array<{ done: boolean; id: string; notes: string }>;
      name: string;
    }
    let sections = jsonOf<{ sections: Section[] }>(
      await alice.call("jobs_get", { job_id: "acme" })
    ).sections;
    expect(sections.map((s) => s.name)).toEqual(["Interview Rounds", "Tasks"]);
    expect(sections[0].items[0]).toMatchObject({
      id: itemId,
      done: true,
      notes: "Went well",
    });
    await alice.call("jobs_item_delete", {
      job_id: "acme",
      section_id: sectionId,
      item_id: itemId,
    });
    await alice.call("jobs_section_delete", {
      job_id: "acme",
      section_id: sections[1].id,
    });
    sections = jsonOf<{ sections: Section[] }>(
      await alice.call("jobs_get", { job_id: "acme" })
    ).sections;
    expect(sections).toHaveLength(1);
    expect(sections[0].items).toHaveLength(0);
    expect(
      textOf(
        await alice.call("jobs_item_add", {
          job_id: "acme",
          section_id: "nope",
          title: "x",
        })
      )
    ).toBe('No section with id "nope".');
  });

  it("T6-13 jobs_delete archives the job (never purges) and the id can be reused", async () => {
    const alice = on(ALICE);
    await alice.call("jobs_create", { job_id: "acme", title: "First" });
    expect(textOf(await alice.call("jobs_delete", { job_id: "acme" }))).toBe(
      'Job "acme" deleted.'
    );
    expect(liveApps("acme")).toHaveLength(0);
    expect(textOf(await alice.call("jobs_get", { job_id: "acme" }))).toBe(
      'Job "acme" not found.'
    );
    const again = await alice.call("jobs_create", {
      job_id: "acme",
      title: "Second",
    });
    expect(jsonOf(again).title).toBe("Second");
    const rows = d1.jobsSqlite
      .query(
        "SELECT legacy_job_id, archived FROM applications ORDER BY created_at, id"
      )
      .all() as Array<{ archived: number; legacy_job_id: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.archived === 1)?.legacy_job_id).toStartWith(
      "acme#archived:"
    );
  });

  it("T6-13 logs jobs_* calls under category 'jobs' exactly as on KV", async () => {
    await on(ALICE).call("jobs_create", { job_id: "acme", title: "Acme" });
    await on(ALICE).call("jobs_list");
    await on(BOB).call("jobs_get", { job_id: "acme" });
    const rows = d1.sqlite
      .query("SELECT tool, category, resource_id FROM request_log ORDER BY id")
      .all() as Array<{
      category: string;
      resource_id: string | null;
      tool: string;
    }>;
    expect(rows.map((r) => r.tool)).toEqual([
      "jobs_create",
      "jobs_list",
      "jobs_get",
    ]);
    expect(rows.every((r) => r.category === "jobs")).toBe(true);
    expect(rows[0].resource_id).toBe("acme");
  });
});

describe("T6-14 jobs_list paginates every page (no 1,000 cap)", () => {
  it("T6-14 returns 1,005 KV jobs on the kv backend", async () => {
    for (let i = 0; i < 1005; i++) {
      const id = `bulk-${String(i).padStart(4, "0")}`;
      store().set(`job:${id}`, {
        value: JSON.stringify({ id, title: id, status: "saved", sections: [] }),
        metadata: { title: id, status: "saved" },
      });
      store().set(`owner:job:${id}`, { value: ALICE.email });
    }
    store().set("job:zz-bob", {
      value: JSON.stringify({
        id: "zz-bob",
        title: "B",
        status: "saved",
        sections: [],
      }),
      metadata: { title: "B", status: "saved" },
    });
    store().set("owner:job:zz-bob", { value: BOB.email });
    const jobs = jsonOf<Array<{ id: string }>>(
      await session(ALICE).call("jobs_list")
    );
    expect(jobs).toHaveLength(1005);
    expect(jobs.at(-1)?.id).toBe("bulk-1004");
  });

  it("T6-14 returns 1,005 applications on the d1 backend", async () => {
    const d1 = createTestEnv({}, { flags: { JOBS_LEGACY_BACKEND: "d1" } });
    const alice = createToolSession(d1.env, ALICE);
    await alice.call("jobs_create", { job_id: "seed", title: "Seed" });
    const userId = (
      d1.jobsSqlite.query("SELECT user_id FROM applications").get() as {
        user_id: string;
      }
    ).user_id;
    d1.jobsSqlite.exec("BEGIN");
    for (let i = 0; i < 1004; i++) {
      seedApplication(d1.jobsSqlite, userId, {
        legacy_job_id: `bulk-${String(i).padStart(4, "0")}`,
      });
    }
    d1.jobsSqlite.exec("COMMIT");
    const jobs = jsonOf<Array<{ id: string }>>(await alice.call("jobs_list"));
    expect(jobs).toHaveLength(1005);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(1005);
  });
});
