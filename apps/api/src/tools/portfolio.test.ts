import { beforeEach, describe, expect, it } from "bun:test";
import type { TestEnv } from "../../test/fakes";
import {
  createTestEnv,
  createToolSession,
  jsonOf,
  textOf,
} from "../../test/fakes";
import type { Caller } from "../auth";

// Ported from the old backend's portfolio tool tests.

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
const PROJECT_ID_RE = /id: ([0-9a-f-]+)/;

const PORTFOLIO_TOOLS = [
  "portfolio_add_project",
  "portfolio_add_social",
  "portfolio_create",
  "portfolio_delete",
  "portfolio_get",
  "portfolio_get_project",
  "portfolio_get_url",
  "portfolio_list",
  "portfolio_list_projects",
  "portfolio_remove_project",
  "portfolio_remove_project_media",
  "portfolio_remove_social",
  "portfolio_set_affiliation",
  "portfolio_set_project_media",
  "portfolio_update_contact",
  "portfolio_update_meta",
  "portfolio_update_owner",
  "portfolio_update_project",
  "portfolio_update_social",
];

let t: TestEnv;

beforeEach(() => {
  t = createTestEnv();
});

function session(caller: Caller) {
  return createToolSession(t.env, caller);
}

describe("registration", () => {
  it("registers the per-user portfolio tools", () => {
    const names = [...session(ALICE).tools.keys()].filter((n) =>
      n.startsWith("portfolio_")
    );
    expect(names.sort()).toEqual(PORTFOLIO_TOOLS);
  });
});

describe("create + get", () => {
  it("any signed-in caller creates and reads their own portfolio", async () => {
    const alice = session(ALICE);
    const created = textOf(
      await alice.call("portfolio_create", {
        portfolio_id: "p1",
        full_name: "Alice Doe",
        email: "alice@example.com",
        track: "tech",
      })
    );
    expect(created).toContain("created successfully");
    expect(created).toContain("https://portfolio.pilihpendidikan.com/?id=p1");
    const got = jsonOf(
      await alice.call("portfolio_get", { portfolio_id: "p1" })
    );
    expect(got.owner).toMatchObject({ fullName: "Alice Doe", track: "tech" });
    expect(Array.isArray(got.projects)).toBe(true);
    expect(t.kv.PORTFOLIO_KV.store.get("owner:portfolio:p1")?.value).toBe(
      "alice@example.com"
    );
  });

  it("rejects a duplicate id and never overwrites", async () => {
    const alice = session(ALICE);
    await alice.call("portfolio_create", {
      portfolio_id: "dup",
      full_name: "First",
    });
    const again = textOf(
      await alice.call("portfolio_create", {
        portfolio_id: "dup",
        full_name: "Second",
      })
    );
    expect(again).toContain("already exists");
    const got = jsonOf(
      await alice.call("portfolio_get", { portfolio_id: "dup" })
    );
    expect((got.owner as { fullName: string }).fullName).toBe("First");
  });

  it("portfolio_get_url points at the new hosts", async () => {
    const alice = session(ALICE);
    await alice.call("portfolio_create", {
      portfolio_id: "p1",
      full_name: "A",
    });
    const urls = textOf(
      await alice.call("portfolio_get_url", { portfolio_id: "p1" })
    );
    expect(urls).toContain("https://portfolio.pilihpendidikan.com/?id=p1");
    expect(urls).toContain("https://api.pilihpendidikan.com/portfolio/p1.pdf");
  });
});

describe("partial update", () => {
  it("portfolio_update_owner changes only the provided fields", async () => {
    const alice = session(ALICE);
    await alice.call("portfolio_create", {
      portfolio_id: "p1",
      full_name: "Alice Doe",
    });
    await alice.call("portfolio_update_owner", {
      portfolio_id: "p1",
      headline: "iOS & Product Engineering",
    });
    const got = jsonOf(
      await alice.call("portfolio_get", { portfolio_id: "p1" })
    );
    expect(got.owner).toMatchObject({
      fullName: "Alice Doe",
      headline: "iOS & Product Engineering",
    });
  });
});

describe("server-authoritative ownership", () => {
  it("another user can neither read nor edit, and lists only their own", async () => {
    const alice = session(ALICE);
    await alice.call("portfolio_create", {
      portfolio_id: "secret",
      full_name: "Alice Doe",
    });
    const bob = session(BOB);
    expect(
      textOf(await bob.call("portfolio_get", { portfolio_id: "secret" }))
    ).toContain("not found");
    expect(
      textOf(
        await bob.call("portfolio_update_owner", {
          portfolio_id: "secret",
          full_name: "Hijacked",
        })
      )
    ).toContain("not found");
    const aliceGet = jsonOf(
      await alice.call("portfolio_get", { portfolio_id: "secret" })
    );
    expect((aliceGet.owner as { fullName: string }).fullName).toBe("Alice Doe");
    expect(textOf(await bob.call("portfolio_list", {}))).toContain(
      "No portfolios found"
    );
    const aliceList = jsonOf<Array<{ id: string }>>(
      await alice.call("portfolio_list", {})
    );
    expect(aliceList.map((r) => r.id)).toContain("secret");
  });
});

describe("projects collection", () => {
  it("adds, updates one field, guards the 16:9 media slot, and removes", async () => {
    const alice = session(ALICE);
    await alice.call("portfolio_create", {
      portfolio_id: "p1",
      full_name: "Alice Doe",
    });
    const added = textOf(
      await alice.call("portfolio_add_project", {
        portfolio_id: "p1",
        title: "Lumen",
        year_accomplished: 2025,
        role: "iOS Developer",
        summary: "A focus timer.",
        description: "On-device ML focus app.",
        project_type: "self-initiated",
        impact: "40 users on TestFlight.",
        learnings: "Shipping on-device ML.",
      })
    );
    const projectId = (added.match(PROJECT_ID_RE) as RegExpMatchArray)[1];
    await alice.call("portfolio_update_project", {
      portfolio_id: "p1",
      id: projectId,
      role: "iOS Developer & Team Lead",
    });
    const project = jsonOf(
      await alice.call("portfolio_get_project", {
        portfolio_id: "p1",
        id: projectId,
      })
    );
    expect(project).toMatchObject({
      role: "iOS Developer & Team Lead",
      title: "Lumen",
    });
    const badMedia = textOf(
      await alice.call("portfolio_set_project_media", {
        portfolio_id: "p1",
        id: projectId,
        type: "image",
        url: "https://example.com/x.png",
        alt: "x",
        width: 1000,
        height: 1000,
      })
    );
    expect(badMedia).toContain("16:9");
    await alice.call("portfolio_remove_project", {
      portfolio_id: "p1",
      id: projectId,
    });
    const listed = jsonOf<unknown[]>(
      await alice.call("portfolio_list_projects", { portfolio_id: "p1" })
    );
    expect(listed).toHaveLength(0);
  });
});

describe("social links collection", () => {
  it("adds, updates by index, and removes a social link", async () => {
    const alice = session(ALICE);
    await alice.call("portfolio_create", {
      portfolio_id: "p1",
      full_name: "Alice Doe",
    });
    await alice.call("portfolio_add_social", {
      portfolio_id: "p1",
      label: "LinkedIn",
      url: "https://linkedin.com/in/alice",
    });
    await alice.call("portfolio_update_social", {
      portfolio_id: "p1",
      index: 0,
      url: "https://github.com/alice",
    });
    interface WithSocials {
      owner: { contact: { socials: Array<{ label: string; url: string }> } };
    }
    const got = jsonOf<WithSocials>(
      await alice.call("portfolio_get", { portfolio_id: "p1" })
    );
    expect(got.owner.contact.socials[0]).toEqual({
      label: "LinkedIn",
      url: "https://github.com/alice",
    });
    await alice.call("portfolio_remove_social", {
      portfolio_id: "p1",
      index: 0,
    });
    const after = jsonOf<WithSocials>(
      await alice.call("portfolio_get", { portfolio_id: "p1" })
    );
    expect(after.owner.contact.socials).toHaveLength(0);
  });
});
