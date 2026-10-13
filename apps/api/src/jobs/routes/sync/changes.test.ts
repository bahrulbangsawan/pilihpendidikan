// 05 §11 / 20 §4 change feed (TS-CHANGES), cursor expiry (TS-CURSOR-EXPIRED)
// and snapshots (TS-SNAPSHOT).

import { describe, expect, it } from "bun:test";
import type {
  ChangesResponse,
  SnapshotResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type { TestEnv } from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import {
  seedApplication,
  seedPosting,
  seedUserJob,
} from "../../../../test/seed-jobs";
import { jobsDb } from "../../repo/core/db";
import { trimChangeLog } from "../../repo/sync/retention";
import { readChanges } from "../../services/sync/changes";
import { trustedScope } from "../../core/scope";

const CHANGES = "/api/v1/changes";
const SNAPSHOT = "/api/v1/snapshot";
const ANSWERS = "/api/v1/profile/answers";

function logChange(
  t: TestEnv,
  userId: string,
  entity: string,
  entityId: string,
  options: { at?: number; op?: string; revision?: number } = {}
): void {
  t.jobsSqlite
    .query(
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(
      userId,
      entity,
      entityId,
      options.revision ?? 1,
      options.op ?? "upsert",
      options.at ?? Date.UTC(2026, 9, 12)
    );
}

async function setup() {
  const t = createTestEnv();
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const alice = await client.browserSession("alice@example.com");
  const bob = await client.browserSession("bob@example.com");
  return {
    t,
    clock,
    client,
    alice,
    bob,
    aliceId: alice.userId as string,
    bobId: bob.userId as string,
  };
}

const ANSWER = {
  question_key: "notice_period",
  answer: "1 month",
  answer_kind: "text",
  sensitivity: "none",
  auto_use: "always",
};

describe("TS-CHANGES change feed (05 §11, 20 §4.1)", () => {
  it("TS-CHANGES returns the user's changes in seq order with the current record as data", async () => {
    const { alice } = await setup();
    await alice.put("/api/v1/profile/facts", {
      facts: [{ key: "contact.phone", value: "+62 811" }],
    });
    const answer = await alice.post<{ answer: { id: string } }>(
      ANSWERS,
      ANSWER
    );
    const res = await alice.get<ChangesResponse>(CHANGES);
    expect(res.status).toBe(200);
    expect(res.body.has_more).toBe(false);
    const entities = res.body.changes.map((c) => c.entity);
    expect(entities).toEqual(["fact", "answer"]);
    const seqs = res.body.changes.map((c) => c.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const answerChange = res.body.changes[1];
    expect(answerChange).toMatchObject({
      entity_id: answer.body.answer.id,
      op: "upsert",
      revision: 1,
      data: { question_key: "notice_period", match_patterns: [] },
    });
    expect(res.body.next_cursor).toBeGreaterThanOrEqual(answerChange?.seq ?? 0);
    const again = await alice.get<ChangesResponse>(CHANGES, {
      query: { cursor: res.body.next_cursor },
    });
    expect(again.body.changes).toEqual([]);
    expect(again.body.next_cursor).toBe(res.body.next_cursor);
  });

  it("TS-CHANGES collapses several changes of one entity into the latest revision", async () => {
    const { alice } = await setup();
    const created = await alice.post<{ answer: { id: string } }>(
      ANSWERS,
      ANSWER
    );
    const id = created.body.answer.id;
    await alice.patch(`${ANSWERS}/${id}`, {
      base_revision: 1,
      answer: "2 weeks",
    });
    await alice.patch(`${ANSWERS}/${id}`, {
      base_revision: 2,
      answer: "3 weeks",
    });
    const res = await alice.get<ChangesResponse>(CHANGES, {
      query: { entities: "answer" },
    });
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0]).toMatchObject({
      entity_id: id,
      revision: 3,
      op: "upsert",
      data: { answer: "3 weeks", revision: 3 },
    });
  });

  it("TS-CHANGES deletes are tombstones without data; a vanished row reads as a delete", async () => {
    const { t, alice, aliceId } = await setup();
    const created = await alice.post<{ answer: { id: string } }>(
      ANSWERS,
      ANSWER
    );
    const id = created.body.answer.id;
    await alice.delete(`${ANSWERS}/${id}`);
    logChange(t, aliceId, "rule", "rul_01JA6V8M3W8Z1T6Q4Y2B7K9C0D", {
      revision: 4,
    });
    const res = await alice.get<ChangesResponse>(CHANGES);
    const answer = res.body.changes.find((c) => c.entity_id === id);
    expect(answer).toMatchObject({ op: "delete", revision: 2 });
    expect(answer && "data" in answer).toBe(false);
    const rule = res.body.changes.find((c) => c.entity === "rule");
    expect(rule).toMatchObject({ op: "delete", revision: 4 });
  });

  it("TS-CHANGES filters by entity; unknown entities are a 400", async () => {
    const { alice } = await setup();
    await alice.get("/api/v1/settings");
    await alice.post(ANSWERS, ANSWER);
    const settings = await alice.get<ChangesResponse>(CHANGES, {
      query: { entities: "settings" },
    });
    expect(settings.body.changes.map((c) => c.entity)).toEqual(["settings"]);
    expect(settings.body.changes[0]?.data).toMatchObject({
      timezone: "Asia/Jakarta",
    });
    const bad = await alice.get(CHANGES, {
      query: { entities: "answer,secrets" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: "invalid_request" });
    const tooMany = await alice.get(CHANGES, { query: { limit: 501 } });
    expect(tooMany.status).toBe(400);
  });

  it("TS-CHANGES pages with limit, has_more and next_cursor", async () => {
    const { alice } = await setup();
    for (const key of ["a_key", "b_key", "c_key"]) {
      await alice.post(ANSWERS, { ...ANSWER, question_key: key });
    }
    const first = await alice.get<ChangesResponse>(CHANGES, {
      query: { limit: 2 },
    });
    expect(first.body.changes).toHaveLength(2);
    expect(first.body.has_more).toBe(true);
    expect(first.body.next_cursor).toBe(first.body.changes[1]?.seq);
    const second = await alice.get<ChangesResponse>(CHANGES, {
      query: { limit: 2, cursor: first.body.next_cursor },
    });
    expect(second.body.changes).toHaveLength(1);
    expect(second.body.has_more).toBe(false);
  });

  it("TS-CHANGES never shows another user's changes; postings only through the user's own link", async () => {
    const { t, alice, bob, aliceId, bobId } = await setup();
    await bob.post(ANSWERS, ANSWER);
    const shared = seedPosting(t.jobsSqlite);
    const other = seedPosting(t.jobsSqlite);
    seedUserJob(t.jobsSqlite, aliceId, { posting_id: shared.id });
    seedUserJob(t.jobsSqlite, bobId, { posting_id: other.id });
    logChange(t, aliceId, "posting", shared.id);
    logChange(t, aliceId, "posting", other.id);
    const res = await alice.get<ChangesResponse>(CHANGES);
    expect(res.body.changes.find((c) => c.entity === "answer")).toBeUndefined();
    const visible = res.body.changes.find((c) => c.entity_id === shared.id);
    expect(visible).toMatchObject({ op: "upsert", data: { id: shared.id } });
    const hidden = res.body.changes.find((c) => c.entity_id === other.id);
    expect(hidden).toMatchObject({ op: "delete" });
    expect(hidden && "data" in hidden).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(bobId);
  });

  it("TS-CHANGES devices come from the identity database; a page stops early at its byte budget", async () => {
    const { t, client, alice, aliceId } = await setup();
    const cli = await client.cliSession("alice@example.com");
    logChange(t, aliceId, "device", cli.deviceId as string);
    const res = await alice.get<ChangesResponse>(CHANGES, {
      query: { entities: "device" },
    });
    expect(res.body.changes[0]).toMatchObject({
      entity: "device",
      data: {
        id: cli.deviceId,
        accepts_tasks: true,
        capabilities: ["discover", "apply", "render_cv"],
      },
    });
    for (const key of ["a_key", "b_key", "c_key"]) {
      await alice.post(ANSWERS, { ...ANSWER, question_key: key });
    }
    const page = await readChanges(
      t.env.DB,
      jobsDb(t.env),
      trustedScope(aliceId, "script"),
      { entities: "answer" },
      { byteBudget: 10 }
    );
    expect(page.changes).toHaveLength(1);
    expect(page.has_more).toBe(true);
    expect(page.next_cursor).toBe(page.changes[0]?.seq);
  });
});

describe("TS-CURSOR-EXPIRED cursor expiry (20 §4.3)", () => {
  it("TS-CURSOR-EXPIRED a cursor older than the oldest retained seq answers 410 cursor_expired", async () => {
    const { t, clock, alice, aliceId } = await setup();
    const old = clock.now() - 40 * 86_400_000;
    for (let i = 0; i < 3; i++) {
      logChange(t, aliceId, "rule", `rul_0${i}`, { at: old });
    }
    await alice.post(ANSWERS, ANSWER);
    const trimmed = await trimChangeLog(
      jobsDb(t.env),
      clock.now() - 30 * 86_400_000
    );
    expect(trimmed.deleted).toBe(3);
    const expired = await alice.get(CHANGES, { query: { cursor: 1 } });
    expect(expired.status).toBe(410);
    expect(expired.body).toMatchObject({ error: "cursor_expired" });
    const fromStart = await alice.get(CHANGES);
    expect(fromStart.status).toBe(410);
  });

  it("TS-CURSOR-EXPIRED a cursor beyond the head is also expired", async () => {
    const { alice } = await setup();
    await alice.post(ANSWERS, ANSWER);
    const ahead = await alice.get(CHANGES, { query: { cursor: 999_999 } });
    expect(ahead.status).toBe(410);
  });

  it("TS-CURSOR-EXPIRED after a 410 a snapshot cursor resumes the feed", async () => {
    const { t, clock, alice, aliceId } = await setup();
    logChange(t, aliceId, "rule", "rul_x", {
      at: clock.now() - 40 * 86_400_000,
    });
    logChange(t, aliceId, "rule", "rul_y", {
      at: clock.now() - 40 * 86_400_000,
    });
    await trimChangeLog(jobsDb(t.env), clock.now() - 30 * 86_400_000);
    expect((await alice.get(CHANGES)).status).toBe(410);
    const snap = await alice.get<SnapshotResponse>(SNAPSHOT, {
      query: { entities: "answers" },
    });
    await alice.post(ANSWERS, ANSWER);
    const res = await alice.get<ChangesResponse>(CHANGES, {
      query: { cursor: snap.body.cursor },
    });
    expect(res.status).toBe(200);
    expect(res.body.changes.map((c) => c.entity)).toEqual(["answer"]);
  });
});

describe("TS-SNAPSHOT full state (05 §11, 20 §4.2)", () => {
  it("TS-SNAPSHOT returns every collection and the cursor taken at its start", async () => {
    const { t, alice, bob, aliceId, bobId } = await setup();
    const app = seedApplication(t.jobsSqlite, aliceId);
    seedApplication(t.jobsSqlite, bobId);
    await alice.put("/api/v1/profile/facts", {
      facts: [{ key: "contact.phone", value: "+62 811" }],
    });
    await alice.post(ANSWERS, ANSWER);
    await bob.post(ANSWERS, ANSWER);
    const res = await alice.get<SnapshotResponse>(SNAPSHOT);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(Object.keys(body).sort()).toEqual(
      [
        "cursor",
        "taken_at",
        "applications",
        "user_jobs",
        "postings",
        "interviews",
        "offers",
        "tasks",
        "approvals",
        "rules",
        "sources",
        "facts",
        "answers",
        "cv_variants",
        "settings",
      ].sort()
    );
    expect(body.applications?.map((a) => a.id)).toEqual([app.id]);
    expect(body.postings?.map((p) => p.id)).toEqual([app.posting_id]);
    expect(body.answers).toHaveLength(1);
    expect(body.facts?.[0]).toMatchObject({
      key: "contact.phone",
      value: "+62 811",
    });
    expect(body.settings?.user_id).toBe(aliceId);
    const head = t.jobsSqlite
      .query("SELECT MAX(seq) AS s FROM change_log")
      .get() as {
      s: number;
    };
    expect(body.cursor).toBeLessThanOrEqual(head.s);
    expect(JSON.stringify(body)).not.toContain(bobId);
  });

  it("TS-SNAPSHOT honours the entities filter and rejects unknown names", async () => {
    const { alice } = await setup();
    const res = await alice.get<SnapshotResponse>(SNAPSHOT, {
      query: { entities: "rules,facts" },
    });
    expect(Object.keys(res.body).sort()).toEqual([
      "cursor",
      "facts",
      "rules",
      "taken_at",
    ]);
    const bad = await alice.get(SNAPSHOT, {
      query: { entities: "applications,users" },
    });
    expect(bad.status).toBe(400);
  });

  it("TS-SNAPSHOT writes after the snapshot arrive through the feed from its cursor", async () => {
    const { alice } = await setup();
    await alice.post(ANSWERS, ANSWER);
    const snap = await alice.get<SnapshotResponse>(SNAPSHOT, {
      query: { entities: "answers" },
    });
    const before = await alice.get<ChangesResponse>(CHANGES, {
      query: { cursor: snap.body.cursor },
    });
    expect(before.body.changes).toEqual([]);
    await alice.post(ANSWERS, { ...ANSWER, question_key: "start_date" });
    const after = await alice.get<ChangesResponse>(CHANGES, {
      query: { cursor: snap.body.cursor },
    });
    expect(after.body.changes).toHaveLength(1);
    expect(after.body.changes[0]?.data).toMatchObject({
      question_key: "start_date",
    });
  });

  it("TS-SNAPSHOT needs jobs:read; personal read tokens may read", async () => {
    const { client } = await setup();
    const reader = await client.personalToken("alice@example.com", "read");
    expect((await reader.get(SNAPSHOT)).status).toBe(200);
    expect((await reader.get(CHANGES)).status).toBe(200);
    const anonymous = client.anonymous();
    expect((await anonymous.get(SNAPSHOT)).status).toBe(401);
  });
});
