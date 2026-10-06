import { describe, expect, it } from "bun:test";
import { createTestEnv, createToolSession } from "../../test/fakes";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { putJob } from "../helpers";
import { jobIdsOwnedBy, ownsJob } from "../ownership";
import { createEmptyJob } from "../types";
import { handleJobsList } from "./jobs";

// Ported regression coverage: a job created by the MCP `jobs_create` tool
// (KV metadata.owner is "") must still be visible to its owner through
// `GET /api/jobs`, because both surfaces read the `owner:job:{id}` stamp.

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

async function createViaMcpShape(env: Env, id: string, owner: string) {
  const job = createEmptyJob();
  job.id = id;
  job.title = id;
  await putJob(env.JOBS_KV, id, job);
  await env.JOBS_KV.put(`owner:job:${id}`, owner);
}

async function restIds(
  env: Env,
  caller: Caller,
  query = ""
): Promise<string[]> {
  const res = await handleJobsList(
    caller,
    env,
    new URL(`https://api.pilihpendidikan.com/api/jobs${query}`)
  );
  const body = (await res.json()) as { items: Array<{ id: string }> };
  return body.items.map((item) => item.id).sort();
}

describe("GET /api/jobs owner scoping", () => {
  it("shows MCP-created jobs to their owner and hides them from others", async () => {
    const { env } = createTestEnv();
    await createViaMcpShape(env, "a1", ALICE.email);
    await createViaMcpShape(env, "b1", BOB.email);
    expect(await restIds(env, ALICE)).toEqual(["a1"]);
    expect(await restIds(env, BOB)).toEqual(["b1"]);
  });

  it("scopes an admin to their own jobs by default, every job with ?mine=0", async () => {
    const { env } = createTestEnv();
    await createViaMcpShape(env, "a1", ALICE.email);
    await createViaMcpShape(env, "x1", ADMIN.email);
    expect(await restIds(env, ADMIN)).toEqual(["x1"]);
    expect(await restIds(env, ADMIN, "?mine=0")).toEqual(["a1", "x1"]);
  });

  it("ownsJob and jobIdsOwnedBy agree on the stamp", async () => {
    const { env } = createTestEnv();
    await createViaMcpShape(env, "a1", ALICE.email);
    expect(await ownsJob(ALICE, env, "a1")).toBe(true);
    expect(await ownsJob(BOB, env, "a1")).toBe(false);
    expect(await ownsJob(ADMIN, env, "a1")).toBe(true);
    expect([...(await jobIdsOwnedBy(env, ALICE.email, ["a1", "zz"]))]).toEqual([
      "a1",
    ]);
  });
});

describe("MCP jobs_list count == REST /api/jobs count (same user)", () => {
  it("agrees for 12 MCP-created jobs and after a 13th", async () => {
    const { env } = createTestEnv();
    const mcp = createToolSession(env, ALICE);
    const mcpCount = async () =>
      (
        JSON.parse(
          (await mcp.call("jobs_list")).content[0]?.text ?? "[]"
        ) as unknown[]
      ).length;
    for (let i = 1; i <= 12; i++) {
      await mcp.call("jobs_create", { job_id: `job-${i}`, title: `Role ${i}` });
    }
    expect(await mcpCount()).toBe(12);
    expect(await restIds(env, ALICE)).toHaveLength(12);
    await mcp.call("jobs_create", { job_id: "job-13", title: "Role 13" });
    expect(await mcpCount()).toBe(13);
    expect(await restIds(env, ALICE)).toHaveLength(13);
  });
});
