import { beforeEach, describe, expect, it } from "bun:test";
import { API_ROUTE_SCHEMAS } from "@pilihpendidikan/jobs-contracts/api";
import type { EmailFixture } from "./support.test";
import { approve, draft, setupEmail } from "./support.test";

let f: EmailFixture;

beforeEach(async () => {
  f = await setupEmail();
});

const SHOW = API_ROUTE_SCHEMAS["GET /api/v1/emails/{eml_id}"];

interface ShowBody {
  approval: { id: string; payload_hash: string; state: string } | null;
  email: { id: string; status: string };
  payload_hash: string | null;
}

async function draftOne() {
  const res = await draft(f.alice, f.app.id, {
    delivery: "local_handoff",
    to: "hr@acme.co.id",
    attachment_file_ids: [f.cvFile.id],
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe("GET /api/v1/emails/{eml_id} (pilih-jobs email show)", () => {
  it("returns the draft, its pending approval and the hash the approve call echoes", async () => {
    const drafted = await draftOne();
    const res = await f.alice.get<ShowBody>(
      `/api/v1/emails/${drafted.email.id}`
    );
    expect(res.status).toBe(200);
    expect(SHOW.response.safeParse(res.body).success).toBe(true);
    expect(res.body.email).toMatchObject({
      id: drafted.email.id,
      status: "draft",
    });
    expect(res.body.payload_hash).toBe(drafted.review.payload_hash);
    expect(res.body.approval).toMatchObject({
      id: drafted.approval.id as string,
      state: "pending",
      payload_hash: drafted.review.payload_hash,
    });
    const approved = await approve(f.alice, drafted.email.id, {
      payload_hash: res.body.payload_hash,
    });
    expect(approved.status).toBe(200);
    const after = await f.alice.get<ShowBody>(
      `/api/v1/emails/${drafted.email.id}`
    );
    expect(after.body.email.status).toBe("approved");
    expect(after.body.approval?.state).toBe("approved");
    expect(after.body.payload_hash).toBe(drafted.review.payload_hash);
  });

  it("answers a null hash when an attachment is gone (the draft must be redone)", async () => {
    const drafted = await draftOne();
    f.t.jobsSqlite
      .query("UPDATE files SET status = 'deleted' WHERE id = ?")
      .run(f.cvFile.id);
    const res = await f.alice.get<ShowBody>(
      `/api/v1/emails/${drafted.email.id}`
    );
    expect(res.status).toBe(200);
    expect(SHOW.response.safeParse(res.body).success).toBe(true);
    expect(res.body.payload_hash).toBeNull();
    expect(res.body.approval?.state).toBe("pending");
  });

  it("is 404 for another user, an admin, and a missing id", async () => {
    const drafted = await draftOne();
    const path = `/api/v1/emails/${drafted.email.id}`;
    const bob = await f.client.browserSession("bob@example.com");
    const admin = await f.client.browserSession("admin@example.com");
    for (const session of [bob, admin]) {
      const res = await session.get(path);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain(drafted.email.id);
    }
    expect((await f.alice.get("/api/v1/emails/eml_nope")).status).toBe(404);
  });

  it("needs jobs:read only (a read-only personal token may show)", async () => {
    const drafted = await draftOne();
    const reader = await f.client.personalToken(
      f.alice.email as string,
      "read"
    );
    const res = await reader.get(`/api/v1/emails/${drafted.email.id}`);
    expect(res.status).toBe(200);
  });
});
