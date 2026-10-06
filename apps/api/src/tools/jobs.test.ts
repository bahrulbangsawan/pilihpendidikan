import { beforeEach, describe, expect, it } from "bun:test";
import type { TestEnv } from "../../test/fakes";
import {
  createTestEnv,
  createToolSession,
  jsonOf,
  textOf,
} from "../../test/fakes";
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
  it("shows a non-admin only their jobs and an admin every job", async () => {
    await session(ALICE).call("jobs_create", { job_id: "a1", title: "A1" });
    await session(ALICE).call("jobs_create", { job_id: "a2", title: "A2" });
    await session(BOB).call("jobs_create", { job_id: "b1", title: "B1" });
    const ids = async (caller: Caller) =>
      jsonOf<Array<{ id: string }>>(await session(caller).call("jobs_list"))
        .map((j) => j.id)
        .sort();
    expect(await ids(ALICE)).toEqual(["a1", "a2"]);
    expect(await ids(BOB)).toEqual(["b1"]);
    expect(await ids(ADMIN)).toEqual(["a1", "a2", "b1"]);
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

  it("lets an admin read and edit any job", async () => {
    const admin = session(ADMIN);
    expect(jsonOf(await admin.call("jobs_get", { job_id: "acme" })).title).toBe(
      "Alice's job"
    );
    const updated = await admin.call("jobs_update", {
      job_id: "acme",
      status: "offer",
    });
    expect(jsonOf(updated).status).toBe("offer");
  });

  it("treats a job without an owner stamp as admin-only", async () => {
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
      jsonOf(await session(ADMIN).call("jobs_get", { job_id: "legacy" })).title
    ).toBe("Legacy");
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
