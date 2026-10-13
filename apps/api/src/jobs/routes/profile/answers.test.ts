// 05 §10 answer bank: TP-ANSWERS (CRUD, protected + always → 422
// policy_violation, the 19 §6.2 protected-class lexicon, answer kinds,
// revisions, isolation, profile_version for years_experience.*).

import { describe, expect, it } from "bun:test";
import type { ScreeningAnswerRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import { seedUserJob } from "../../../../test/seed-jobs";
import {
  normalizePatterns,
  protectedClassOf,
} from "../../services/profile/answers";

const ANSWERS = "/api/v1/profile/answers";

async function setup() {
  const t = createTestEnv();
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const alice = await client.browserSession("alice@example.com");
  const bob = await client.browserSession("bob@example.com");
  return { t, clock, client, alice, bob };
}

const NOTICE = {
  question_key: "notice_period",
  match_patterns: ["What is your notice period?", "Notice period?"],
  answer: "1 month",
  answer_kind: "text",
  sensitivity: "none",
  auto_use: "always",
} as const;

interface AnswerBody {
  answer: ScreeningAnswerRecord;
}

describe("TP-ANSWERS answer bank (05 §10, 19 §6.2)", () => {
  it("TP-ANSWERS create, get, list, patch and delete, each with its change", async () => {
    const { t, alice } = await setup();
    const created = await alice.post<AnswerBody>(ANSWERS, NOTICE);
    expect(created.status).toBe(201);
    const answer = created.body.answer;
    expect(answer).toMatchObject({
      question_key: "notice_period",
      answer: "1 month",
      sensitivity: "none",
      auto_use: "always",
      revision: 1,
      user_id: alice.userId,
    });
    expect(answer.id.startsWith("ans_")).toBe(true);
    const got = await alice.get<AnswerBody>(`${ANSWERS}/${answer.id}`);
    expect(got.body.answer).toEqual(answer);
    const listed = await alice.get<{ items: ScreeningAnswerRecord[] }>(ANSWERS);
    expect(listed.body.items.map((a) => a.id)).toEqual([answer.id]);
    const patched = await alice.patch<AnswerBody>(`${ANSWERS}/${answer.id}`, {
      base_revision: 1,
      answer: "2 weeks",
    });
    expect(patched.status).toBe(200);
    expect(patched.body.answer).toMatchObject({
      answer: "2 weeks",
      revision: 2,
    });
    const removed = await alice.delete(`${ANSWERS}/${answer.id}`, {
      query: { base_revision: 2 },
    });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ id: answer.id, deleted: true });
    expect((await alice.get(`${ANSWERS}/${answer.id}`)).status).toBe(404);
    const changes = t.jobsSqlite
      .query(
        "SELECT revision, op FROM change_log WHERE user_id = ? AND entity = 'answer' AND entity_id = ? ORDER BY seq"
      )
      .all(alice.userId, answer.id);
    expect(changes).toEqual([
      { revision: 1, op: "upsert" },
      { revision: 2, op: "upsert" },
      { revision: 3, op: "delete" },
    ]);
  });

  it("TP-ANSWERS protected + always is a 422 policy_violation", async () => {
    const { t, alice } = await setup();
    const res = await alice.post(ANSWERS, {
      question_key: "salary_expectation",
      answer: "15000000",
      answer_kind: "number",
      sensitivity: "protected",
      auto_use: "always",
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "policy_violation",
      details: { sensitivity: "protected", auto_use: "always" },
    });
    expect(
      t.jobsSqlite.query("SELECT COUNT(*) AS n FROM screening_answers").get()
    ).toEqual({ n: 0 });
  });

  it("TP-ANSWERS the protected-class lexicon forces sensitivity protected", async () => {
    const { alice } = await setup();
    const res = await alice.post<AnswerBody>(ANSWERS, {
      question_key: "gender",
      answer: "Prefer not to say",
      answer_kind: "choice",
      sensitivity: "none",
      auto_use: "approval",
    });
    expect(res.status).toBe(201);
    expect(res.body.answer.sensitivity).toBe("protected");
    const viaPattern = await alice.post<AnswerBody>(ANSWERS, {
      question_key: "accommodations",
      match_patterns: ["Do you have a disability we should know about?"],
      answer: "No",
      answer_kind: "text",
      sensitivity: "personal",
      auto_use: "never",
    });
    expect(viaPattern.body.answer.sensitivity).toBe("protected");
  });

  it("TP-ANSWERS a lexicon hit refuses auto_use always even when the client says none", async () => {
    const { alice } = await setup();
    for (const question of [
      "requires_sponsorship",
      "date_of_birth",
      "criminal_history",
      "agama",
    ]) {
      const res = await alice.post(ANSWERS, {
        question_key: question,
        answer: "x",
        answer_kind: "text",
        sensitivity: "none",
        auto_use: "always",
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        error: "policy_violation",
        details: { sensitivity: "protected" },
      });
    }
    const eligible = await alice.post<AnswerBody>(ANSWERS, {
      question_key: "years_experience.python",
      answer: "5",
      answer_kind: "number",
      sensitivity: "none",
      auto_use: "always",
    });
    expect(eligible.status).toBe(201);
    expect(eligible.body.answer.sensitivity).toBe("none");
  });

  it("TP-ANSWERS PATCH re-checks the policy on the merged answer", async () => {
    const { alice } = await setup();
    const created = await alice.post<AnswerBody>(ANSWERS, {
      question_key: "veteran_status",
      answer: "No",
      answer_kind: "choice",
      sensitivity: "protected",
      auto_use: "approval",
    });
    const id = created.body.answer.id;
    const always = await alice.patch(`${ANSWERS}/${id}`, {
      base_revision: 1,
      auto_use: "always",
    });
    expect(always.status).toBe(422);
    const downgrade = await alice.patch(`${ANSWERS}/${id}`, {
      base_revision: 1,
      sensitivity: "none",
      auto_use: "always",
    });
    expect(downgrade.status).toBe(422);
    const ok = await alice.patch<AnswerBody>(`${ANSWERS}/${id}`, {
      base_revision: 1,
      auto_use: "never",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.answer).toMatchObject({
      sensitivity: "protected",
      auto_use: "never",
      revision: 2,
    });
  });

  it("TP-ANSWERS stale revisions conflict with the current answer; a no-op patch keeps the revision", async () => {
    const { alice } = await setup();
    const created = await alice.post<AnswerBody>(ANSWERS, NOTICE);
    const id = created.body.answer.id;
    const stale = await alice.patch(`${ANSWERS}/${id}`, {
      base_revision: 4,
      answer: "3 months",
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: "revision_conflict",
      details: { current: { id, revision: 1 } },
    });
    const viaIfMatch = await alice.patch<AnswerBody>(
      `${ANSWERS}/${id}`,
      { base_revision: 1, answer: "1 month" },
      { headers: { "If-Match": '"1"' } }
    );
    expect(viaIfMatch.status).toBe(200);
    expect(viaIfMatch.body.answer.revision).toBe(1);
    const staleDelete = await alice.delete(`${ANSWERS}/${id}`, {
      query: { base_revision: 9 },
    });
    expect(staleDelete.status).toBe(409);
  });

  it("TP-ANSWERS duplicate question keys are 409 duplicate", async () => {
    const { alice } = await setup();
    expect((await alice.post(ANSWERS, NOTICE)).status).toBe(201);
    const again = await alice.post(ANSWERS, { ...NOTICE, answer: "2 weeks" });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "duplicate" });
  });

  it("TP-ANSWERS answer kinds constrain the stored text", async () => {
    const { alice } = await setup();
    const bad = [
      {
        question_key: "years_experience.go",
        answer: "five",
        answer_kind: "number",
      },
      {
        question_key: "willing_to_relocate",
        answer: "maybe",
        answer_kind: "boolean",
      },
      {
        question_key: "available_from",
        answer: "next week",
        answer_kind: "date",
      },
    ];
    for (const body of bad) {
      const res = await alice.post(ANSWERS, {
        ...body,
        sensitivity: "personal",
        auto_use: "approval",
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_request" });
    }
    const good = await alice.post(ANSWERS, {
      question_key: "available_from",
      answer: "2026-11-01",
      answer_kind: "date",
      sensitivity: "personal",
      auto_use: "approval",
    });
    expect(good.status).toBe(201);
  });

  it("TP-ANSWERS another user's answer is not found on every route", async () => {
    const { alice, bob } = await setup();
    const created = await alice.post<AnswerBody>(ANSWERS, NOTICE);
    const id = created.body.answer.id;
    expect((await bob.get(`${ANSWERS}/${id}`)).status).toBe(404);
    expect(
      (await bob.patch(`${ANSWERS}/${id}`, { base_revision: 1, answer: "x" }))
        .status
    ).toBe(404);
    expect((await bob.delete(`${ANSWERS}/${id}`)).status).toBe(404);
    const list = await bob.get<{ items: unknown[] }>(ANSWERS);
    expect(list.body.items).toEqual([]);
    expect((await alice.get(`${ANSWERS}/${id}`)).status).toBe(200);
  });

  it("TP-ANSWERS list pages by question key with an opaque cursor", async () => {
    const { alice } = await setup();
    for (const key of ["b_key", "a_key", "c_key"]) {
      await alice.post(ANSWERS, { ...NOTICE, question_key: key });
    }
    const first = await alice.get<{
      items: ScreeningAnswerRecord[];
      next_cursor: string | null;
    }>(ANSWERS, { query: { limit: 2 } });
    expect(first.body.items.map((a) => a.question_key)).toEqual([
      "a_key",
      "b_key",
    ]);
    expect(first.body.next_cursor).toBeTruthy();
    const second = await alice.get<{
      items: ScreeningAnswerRecord[];
      next_cursor: string | null;
    }>(ANSWERS, {
      query: { limit: 2, cursor: first.body.next_cursor ?? "" },
    });
    expect(second.body.items.map((a) => a.question_key)).toEqual(["c_key"]);
    expect(second.body.next_cursor).toBeNull();
  });

  it("TP-ANSWERS a years_experience answer changes profile_version and re-queues scoring", async () => {
    const { t, alice } = await setup();
    seedUserJob(t.jobsSqlite, alice.userId as string, { inbox_state: "new" });
    const before = (
      await alice.get<{ profile_version: number }>("/api/v1/profile/facts")
    ).body.profile_version;
    await alice.post(ANSWERS, NOTICE);
    expect(
      t.queue.sent.filter((m) => m.body.type === "score_postings")
    ).toHaveLength(0);
    await alice.post(ANSWERS, {
      question_key: "years_experience.python",
      answer: "4",
      answer_kind: "number",
      sensitivity: "none",
      auto_use: "always",
    });
    const after = (
      await alice.get<{ profile_version: number }>("/api/v1/profile/facts")
    ).body.profile_version;
    expect(after).not.toBe(before);
    const scored = t.queue.sent.filter((m) => m.body.type === "score_postings");
    expect(scored).toHaveLength(1);
    expect(scored[0]?.body).toMatchObject({ profile_version: after });
  });

  it("TP-ANSWERS patterns are normalized; the lexicon reads key separators as spaces", () => {
    expect(
      normalizePatterns([
        "  What is your NOTICE period? ",
        "what is your notice period",
        "",
      ])
    ).toEqual(["what is your notice period"]);
    expect(protectedClassOf("requires_sponsorship", [])).toBe(
      "citizenship_visa"
    );
    expect(protectedClassOf("years_experience.python", [])).toBeNull();
    expect(protectedClassOf("misc", ["Are you 18 or older?"])).toBeNull();
    expect(protectedClassOf("misc", ["What is your date of birth?"])).toBe(
      "age"
    );
  });
});
