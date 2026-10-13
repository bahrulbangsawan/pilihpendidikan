import { beforeEach, describe, expect, it } from "bun:test";
import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import { ApplicationDetailSchema } from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationRecord,
  LegacyJobSection,
} from "@pilihpendidikan/jobs-contracts/records";
import { ApplicationRecordSchema } from "@pilihpendidikan/jobs-contracts/records";
import { seedApplication, seedTask } from "../../../../test/seed-jobs";
import { RANK_MAX_LENGTH, REBALANCE_RANK_LENGTH } from "../../core/rank";
import { trustedScope } from "../../core/scope";
import { runBatch } from "../../repo/core/db";
import {
  planTrackApplication,
  trackApplication,
} from "../../services/applications";
import type { Fixture } from "./support.test";
import {
  appRow,
  changeRows,
  eventRows,
  expectConflict,
  inboxJob,
  moveTo,
  setup,
  trackNew,
  userIdOf,
} from "./support.test";

let f: Fixture;

beforeEach(async () => {
  f = await setup();
});

interface AppBody {
  application: ApplicationRecord;
}

describe("POST /api/v1/applications (track)", () => {
  it("TB-TRACK tracks a user_job: a saved card at the bottom of its column, a created event, user_job tracked, change_log rows", async () => {
    const first = await trackNew(f.t, f.alice);
    const job = inboxJob(f.t, f.alice);
    f.clock.advance(1000);
    const res = await f.alice.post<AppBody>("/api/v1/applications", {
      user_job_id: job.userJobId,
    });
    expect(res.status).toBe(201);
    const app = res.body.application;
    expect(ApplicationRecordSchema.safeParse(app).success).toBe(true);
    expect(app).toMatchObject({
      user_job_id: job.userJobId,
      stage: "saved",
      submission_status: "not_started",
      mode: "approval",
      revision: 1,
      archived: false,
      sections: [],
      last_change_source: "web",
      created_at: f.clock.now(),
    });
    expect(app.board_rank > first.board_rank).toBe(true);
    expect(appRow(f.t, app.id)).toEqual(app);
    const events = eventRows(f.t, app.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "created",
      actor_kind: "user",
      to_value: "saved",
      payload: { origin: "manual", stage: "saved" },
    });
    const userJob = f.t.jobsSqlite
      .query("SELECT inbox_state, revision FROM user_jobs WHERE id = ?")
      .get(job.userJobId) as { inbox_state: string; revision: number };
    expect(userJob).toEqual({ inbox_state: "tracked", revision: 2 });
    const changes = changeRows(f.t, userIdOf(f.alice)).filter((c) =>
      [app.id, job.userJobId, events[0].id].includes(c.entity_id)
    );
    expect(changes.map((c) => [c.entity, c.revision, c.op])).toEqual([
      ["application", 1, "upsert"],
      ["user_job", 2, "upsert"],
      ["event", 1, "upsert"],
    ]);
  });

  it("TB-TRACK an already tracked user_job returns the existing card (200) and writes nothing", async () => {
    const job = inboxJob(f.t, f.alice);
    const first = await f.alice.post<AppBody>("/api/v1/applications", {
      user_job_id: job.userJobId,
    });
    const before = changeRows(f.t, userIdOf(f.alice)).length;
    const again = await f.alice.post<AppBody>("/api/v1/applications", {
      user_job_id: job.userJobId,
      stage: "ready",
    });
    expect(again.status).toBe(200);
    expect(again.body.application.id).toBe(first.body.application.id);
    expect(again.body.application.stage).toBe("saved");
    expect(changeRows(f.t, userIdOf(f.alice))).toHaveLength(before);
  });

  it("TB-TRACK honours stage and mode; the default mode is user_settings.default_mode", async () => {
    const explicit = await trackNew(f.t, f.alice, {
      stage: "ready",
      mode: "manual",
    });
    expect(explicit).toMatchObject({ stage: "ready", mode: "manual" });
    expect(eventRows(f.t, explicit.id)[0]).toMatchObject({ to_value: "ready" });
    f.t.jobsSqlite
      .query(
        "INSERT INTO user_settings (user_id, default_mode, updated_at) VALUES (?, 'assisted', 0)"
      )
      .run(userIdOf(f.alice));
    const defaulted = await trackNew(f.t, f.alice);
    expect(defaulted.mode).toBe("assisted");
  });

  it("TB-TRACK a replay with the same Idempotency-Key returns the stored 201", async () => {
    const job = inboxJob(f.t, f.alice);
    const first = await f.alice.post<AppBody>(
      "/api/v1/applications",
      { user_job_id: job.userJobId },
      { idempotencyKey: "track-1" }
    );
    const replay = await f.alice.post<AppBody>(
      "/api/v1/applications",
      { user_job_id: job.userJobId },
      { idempotencyKey: "track-1" }
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.body).toEqual(first.body);
    expect(eventRows(f.t, first.body.application.id)[0].idempotency_key).toBe(
      "track-1:created"
    );
  });

  it("TB-TRACK another user's user_job is not found (404)", async () => {
    const job = inboxJob(f.t, f.bob);
    const res = await f.alice.post("/api/v1/applications", {
      user_job_id: job.userJobId,
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
    expect(
      f.t.jobsSqlite.query("SELECT COUNT(*) AS n FROM applications").get()
    ).toEqual({ n: 0 });
  });

  it("TB-TRACK planTrackApplication chains afterRank so bulk plans in one batch get distinct ascending ranks", async () => {
    const scope = trustedScope(userIdOf(f.alice), "script");
    const jobs = [
      inboxJob(f.t, f.alice),
      inboxJob(f.t, f.alice),
      inboxJob(f.t, f.alice),
    ];
    const statements: D1PreparedStatement[] = [];
    let afterRank: string | null | undefined;
    const ids: string[] = [];
    for (const job of jobs) {
      const plan = await planTrackApplication(f.db, scope, {
        userJobId: job.userJobId,
        now: f.clock.now(),
        actorKind: "system",
        source: "system",
        afterRank,
      });
      statements.push(...plan.statements);
      ids.push(plan.applicationId);
      afterRank = plan.rank;
    }
    await runBatch(f.db, statements);
    const ranks = ids.map((id) => appRow(f.t, id).board_rank);
    expect(new Set(ranks).size).toBe(3);
    expect([...ranks].sort()).toEqual(ranks);
    const again = await planTrackApplication(f.db, scope, {
      userJobId: jobs[0].userJobId,
      now: f.clock.now(),
      actorKind: "system",
      source: "system",
    });
    expect(again).toMatchObject({ applicationId: ids[0], statements: [] });
  });

  it("TB-TRACK trackApplication commits for callers without a route (MCP) and is idempotent", async () => {
    const scope = trustedScope(userIdOf(f.alice), "script");
    const job = inboxJob(f.t, f.alice);
    const input = {
      userJobId: job.userJobId,
      now: f.clock.now(),
      actorKind: "mcp" as const,
      source: "mcp" as const,
    };
    const created = await trackApplication(f.db, scope, input);
    expect(created.created).toBe(true);
    expect(appRow(f.t, created.application.id)).toEqual(created.application);
    const again = await trackApplication(f.db, scope, input);
    expect(again).toEqual({ application: created.application, created: false });
  });
});

describe("GET /api/v1/applications/{app_id} (detail)", () => {
  it("returns the card with its posting, user_job, score, interviews, offers, open approvals, tasks, evidence and emails", async () => {
    const app = await trackNew(
      f.t,
      f.alice,
      {},
      { title: "Platform Engineer" }
    );
    const userId = userIdOf(f.alice);
    const now = f.clock.now();
    const answerPayload = JSON.stringify({
      type: "answer",
      questions: [
        {
          ref: "q1",
          question: "Notice period?",
          required: true,
          options: [],
          question_key: "notice_period",
          sensitivity: "none",
          suggestion: null,
        },
      ],
    });
    await f.alice.post(`/api/v1/applications/${app.id}/interviews`, {
      kind: "phone_screen",
      scheduled_at: now + 86_400_000,
    });
    await f.alice.post(`/api/v1/applications/${app.id}/offers`, {
      received_at: now,
    });
    f.t.jobsSqlite
      .query(
        "INSERT INTO approvals (id, user_id, kind, application_id, payload, payload_hash, state, expires_at, created_at) VALUES (?, ?, 'answer', ?, ?, ?, ?, ?, ?)"
      )
      .run(
        newId("apr"),
        userId,
        app.id,
        answerPayload,
        "a".repeat(64),
        "pending",
        now + 1000,
        now
      );
    f.t.jobsSqlite
      .query(
        "INSERT INTO approvals (id, user_id, kind, application_id, payload, payload_hash, state, expires_at, created_at) VALUES (?, ?, 'answer', ?, ?, ?, ?, ?, ?)"
      )
      .run(
        newId("apr"),
        userId,
        app.id,
        answerPayload,
        "b".repeat(64),
        "rejected",
        now + 1000,
        now
      );
    seedTask(f.t.jobsSqlite, userId, {
      application_id: app.id,
      state: "failed",
    });
    const res = await f.alice.get<ApplicationDetail>(
      `/api/v1/applications/${app.id}`
    );
    expect(res.status).toBe(200);
    const parsed = ApplicationDetailSchema.safeParse(res.body);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(res.body.application.id).toBe(app.id);
    expect(res.body.posting.title).toBe("Platform Engineer");
    expect(res.body.user_job.inbox_state).toBe("tracked");
    expect(res.body.score).toBeNull();
    expect(res.body.interviews).toHaveLength(1);
    expect(res.body.offers).toHaveLength(1);
    expect(res.body.approvals.map((a) => a.state)).toEqual(["pending"]);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.cv_variants).toEqual([]);
    expect(res.body.evidence).toEqual([]);
    expect(res.body.emails).toEqual([]);
  });

  it("is 404 for an unknown id", async () => {
    const res = await f.alice.get(`/api/v1/applications/${newId("app")}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/applications/{app_id}", () => {
  it("updates priority, mode, follow_up_at and base_cv_id under base_revision (revision + 1, change_log)", async () => {
    const app = await trackNew(f.t, f.alice);
    await f.t.env.CV_KV.put("owner:cv:rahma-cv", "alice@example.com");
    f.clock.advance(5000);
    const res = await f.alice.patch<AppBody>(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      priority: 1,
      mode: "assisted",
      follow_up_at: f.clock.now() + 7 * 86_400_000,
      base_cv_id: "rahma-cv",
    });
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({
      priority: 1,
      mode: "assisted",
      base_cv_id: "rahma-cv",
      revision: 2,
      updated_at: f.clock.now(),
      stage: "saved",
    });
    expect(appRow(f.t, app.id)).toEqual(res.body.application);
    const last = changeRows(f.t, userIdOf(f.alice)).at(-1);
    expect(last).toMatchObject({
      entity: "application",
      entity_id: app.id,
      revision: 2,
    });
  });

  it("refuses a base_cv_id that is not one of the caller's CVs (404)", async () => {
    const app = await trackNew(f.t, f.alice);
    await f.t.env.CV_KV.put("owner:cv:bobs-cv", "bob@example.com");
    const res = await f.alice.patch(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      base_cv_id: "bobs-cv",
    });
    expect(res.status).toBe(404);
    expect(appRow(f.t, app.id).base_cv_id).toBeNull();
  });

  it("validates stage changes against 03 §5.1 (422 invalid_transition) and records legal ones", async () => {
    const app = await trackNew(f.t, f.alice);
    const illegal = await f.alice.patch(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      stage: "offer",
    });
    expect(illegal.status).toBe(422);
    expect(illegal.body.error).toBe("invalid_transition");
    const other = await trackNew(f.t, f.alice, { stage: "ready" });
    const res = await f.alice.patch<AppBody>(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      stage: "ready",
      priority: -1,
    });
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({
      stage: "ready",
      priority: -1,
      revision: 2,
    });
    expect(res.body.application.board_rank > other.board_rank).toBe(true);
    expect(appRow(f.t, app.id)).toEqual(res.body.application);
    const stageEvent = eventRows(f.t, app.id).find(
      (e) => e.type === "stage_changed"
    );
    expect(stageEvent).toMatchObject({
      from_value: "saved",
      to_value: "ready",
      actor_kind: "user",
      applied_to_state: true,
    });
  });

  it("needs base_revision in the body (400 without it); an If-Match header must agree with it", async () => {
    const app = await trackNew(f.t, f.alice);
    const missing = await f.alice.patch(`/api/v1/applications/${app.id}`, {
      priority: 1,
    });
    expect(missing.status).toBe(400);
    const disagree = await f.alice.call<AppBody>(
      "PATCH",
      `/api/v1/applications/${app.id}`,
      {
        body: { base_revision: 1, priority: 1 },
        headers: { "If-Match": '"2"' },
      }
    );
    expect(disagree.status).toBe(400);
    expect(appRow(f.t, app.id).revision).toBe(1);
    const withBody = await f.alice.call<AppBody>(
      "PATCH",
      `/api/v1/applications/${app.id}`,
      {
        body: { base_revision: 1, priority: 1 },
        headers: { "If-Match": '"1"' },
      }
    );
    expect(withBody.status).toBe(200);
    expect(withBody.body.application.priority).toBe(1);
  });

  it("a PATCH that changes nothing answers the card without a write", async () => {
    const app = await trackNew(f.t, f.alice);
    const before = changeRows(f.t, userIdOf(f.alice)).length;
    const res = await f.alice.patch<AppBody>(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      priority: 0,
      stage: "saved",
    });
    expect(res.status).toBe(200);
    expect(res.body.application.revision).toBe(1);
    expect(changeRows(f.t, userIdOf(f.alice))).toHaveLength(before);
  });

  it("archived toggles hide and restore the card without changing its stage", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "ready" });
    const archived = await f.alice.patch<AppBody>(
      `/api/v1/applications/${app.id}`,
      {
        base_revision: 1,
        archived: true,
      }
    );
    expect(archived.body.application).toMatchObject({
      archived: true,
      stage: "ready",
    });
    const restored = await f.alice.patch<AppBody>(
      `/api/v1/applications/${app.id}`,
      {
        base_revision: 2,
        archived: false,
      }
    );
    expect(restored.body.application).toMatchObject({
      archived: false,
      revision: 3,
    });
  });
});

describe("checklists (06 §5)", () => {
  function sections(items: number, notes = ""): LegacyJobSection[] {
    return [
      {
        id: "sec_1",
        name: "Prep",
        items: Array.from({ length: items }, (_, i) => ({
          id: `item_${i}`,
          title: `Step ${i}`,
          notes,
          url: "",
          done: i % 2 === 0,
        })),
      },
    ];
  }

  it("TB-CHECKLIST PATCH sections replaces the whole checklist under base_revision", async () => {
    const app = await trackNew(f.t, f.alice);
    const first = await f.alice.patch<AppBody>(
      `/api/v1/applications/${app.id}`,
      {
        base_revision: 1,
        sections: sections(3),
      }
    );
    expect(first.status).toBe(200);
    expect(first.body.application.sections).toEqual(sections(3));
    const second = await f.alice.patch<AppBody>(
      `/api/v1/applications/${app.id}`,
      {
        base_revision: 2,
        sections: [],
      }
    );
    expect(second.body.application.sections).toEqual([]);
    expect(appRow(f.t, app.id).sections).toEqual([]);
  });

  it("TB-CHECKLIST more than 200 items → 413 payload_too_large", async () => {
    const app = await trackNew(f.t, f.alice);
    const ok = await f.alice.patch(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      sections: sections(200),
    });
    expect(ok.status).toBe(200);
    const res = await f.alice.patch(`/api/v1/applications/${app.id}`, {
      base_revision: 2,
      sections: sections(201),
    });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("payload_too_large");
    expect(appRow(f.t, app.id).sections[0].items).toHaveLength(200);
  });

  it("TB-CHECKLIST more than 64 KB serialized → 413 payload_too_large", async () => {
    const app = await trackNew(f.t, f.alice);
    const res = await f.alice.patch(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      sections: sections(20, "x".repeat(3500)),
    });
    expect(res.status).toBe(413);
    expect((res.body.details as { bytes: number }).bytes).toBeGreaterThan(
      65_536
    );
    expect(appRow(f.t, app.id).revision).toBe(1);
  });

  it("TB-CHECKLIST closes the lost update: a second edit from the same base gets 409 with details.current", async () => {
    const app = await trackNew(f.t, f.alice);
    const cli = await f.client.cliSession("alice@example.com");
    const web = await f.alice.patch(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      sections: sections(1),
    });
    expect(web.status).toBe(200);
    const stale = await cli.patch(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      sections: sections(2),
    });
    const current = expectConflict(stale, { id: app.id, revision: 2 });
    expect(current.sections).toEqual(sections(1));
    expect(appRow(f.t, app.id).sections).toEqual(sections(1));
  });
});

describe("POST /api/v1/applications/{app_id}/move (06 §2)", () => {
  it("places the card between before_id and after_id with a server-computed rank", async () => {
    const a = await trackNew(f.t, f.alice);
    const b = await trackNew(f.t, f.alice);
    const c = await trackNew(f.t, f.alice);
    const moved = await moveTo(f.alice, c, "saved", {
      before_id: a.id,
      after_id: b.id,
    });
    expect(
      moved.board_rank > a.board_rank && moved.board_rank < b.board_rank
    ).toBe(true);
    expect(moved.revision).toBe(2);
    const board = await f.alice.get<{
      columns: Array<{ stage: string; cards: Array<{ id: string }> }>;
    }>("/api/v1/board");
    const saved = board.body.columns.find((x) => x.stage === "saved");
    expect(saved?.cards.map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect(
      eventRows(f.t, c.id).filter((e) => e.type === "stage_changed")
    ).toHaveLength(0);
  });

  it("moves across columns with a stage_changed event in the same batch", async () => {
    const a = await trackNew(f.t, f.alice, { stage: "ready" });
    const c = await trackNew(f.t, f.alice);
    const moved = await moveTo(f.alice, c, "ready", { after_id: a.id });
    expect(moved).toMatchObject({ stage: "ready", revision: 2 });
    expect(moved.board_rank < a.board_rank).toBe(true);
    expect(appRow(f.t, c.id)).toEqual(moved);
    const events = eventRows(f.t, c.id);
    expect(events.at(-1)).toMatchObject({
      type: "stage_changed",
      from_value: "saved",
      to_value: "ready",
    });
    const illegal = await f.alice.post(`/api/v1/applications/${c.id}/move`, {
      base_revision: 2,
      stage: "accepted",
    });
    expect(illegal.status).toBe(422);
    expect(illegal.body.error).toBe("invalid_transition");
  });

  it("T6-03 concurrent moves from two sessions with the same base_revision: one 200, one 409 with details.current", async () => {
    const app = await trackNew(f.t, f.alice);
    const cli = await f.client.cliSession("alice@example.com");
    const [web, laptop] = await Promise.all([
      f.alice.post<AppBody>(`/api/v1/applications/${app.id}/move`, {
        base_revision: 1,
        stage: "preparing",
      }),
      cli.post<AppBody>(`/api/v1/applications/${app.id}/move`, {
        base_revision: 1,
        stage: "withdrawn",
      }),
    ]);
    const statuses = [web.status, laptop.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = web.status === 409 ? web : laptop;
    const winner = web.status === 200 ? web : laptop;
    const current = expectConflict(loser as never, { id: app.id, revision: 2 });
    expect(current.stage).toBe(winner.body.application.stage);
    expect(appRow(f.t, app.id).stage).toBe(winner.body.application.stage);
    expect(
      eventRows(f.t, app.id).filter((e) => e.type === "stage_changed")
    ).toHaveLength(1);
  });

  it("T6-04 a rank-only conflict auto-resolves against the current neighbours (200)", async () => {
    const a = await trackNew(f.t, f.alice);
    const b = await trackNew(f.t, f.alice);
    const c = await trackNew(f.t, f.alice);
    // Another device edits the card meanwhile (revision 1 → 2, same stage).
    await f.alice.patch(`/api/v1/applications/${c.id}`, {
      base_revision: 1,
      priority: 1,
    });
    const res = await f.alice.post<AppBody>(
      `/api/v1/applications/${c.id}/move`,
      {
        base_revision: 1,
        stage: "saved",
        before_id: a.id,
        after_id: b.id,
      }
    );
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({
      revision: 3,
      priority: 1,
      stage: "saved",
    });
    expect(
      res.body.application.board_rank > a.board_rank &&
        res.body.application.board_rank < b.board_rank
    ).toBe(true);
  });

  it("T6-04 a stage conflict returns 409 revision_conflict with details.current", async () => {
    const app = await trackNew(f.t, f.alice);
    await moveTo(f.alice, app, "preparing");
    const stale = await f.alice.post(`/api/v1/applications/${app.id}/move`, {
      base_revision: 1,
      stage: "ready",
    });
    const current = expectConflict(stale, { id: app.id, revision: 2 });
    expect(current.stage).toBe("preparing");
    expect(appRow(f.t, app.id).stage).toBe("preparing");
  });

  it("T6-06 a move is refused while the card's live task is past submit_intent (422 submission_in_flight)", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "ready" });
    const task = seedTask(f.t.jobsSqlite, userIdOf(f.alice), {
      application_id: app.id,
      state: "running",
      lease_id: "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0E",
      submit_intent_at: f.clock.now() - 1000,
    });
    for (const stage of ["withdrawn", "ready", "applied"]) {
      const res = await f.alice.post(`/api/v1/applications/${app.id}/move`, {
        base_revision: 1,
        stage,
      });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("invalid_transition");
      expect(res.body.details).toMatchObject({
        reason: "submission_in_flight",
        task_id: task.id,
      });
    }
    const patch = await f.alice.patch(`/api/v1/applications/${app.id}`, {
      base_revision: 1,
      stage: "rejected",
    });
    expect(patch.status).toBe(422);
    expect((patch.body.details as { reason: string }).reason).toBe(
      "submission_in_flight"
    );
    expect(appRow(f.t, app.id)).toMatchObject({ stage: "ready", revision: 1 });
    f.t.jobsSqlite
      .query(
        "UPDATE automation_tasks SET state = 'outcome_unknown' WHERE id = ?"
      )
      .run(task.id);
    const after = await f.alice.post(`/api/v1/applications/${app.id}/move`, {
      base_revision: 1,
      stage: "withdrawn",
    });
    expect(after.status).toBe(200);
  });

  it("rebalances the column when the midpoint would exceed 32 characters (revision + 1 and a change_log row per rewritten card)", async () => {
    const userId = userIdOf(f.alice);
    const tight = `i${"0".repeat(RANK_MAX_LENGTH - 1)}1`;
    const a = seedApplication(f.t.jobsSqlite, userId, { board_rank: "i" });
    const b = seedApplication(f.t.jobsSqlite, userId, { board_rank: tight });
    const c = await trackNew(f.t, f.alice);
    const before = changeRows(f.t, userId).length;
    const moved = await moveTo(f.alice, c, "saved", {
      before_id: a.id,
      after_id: b.id,
    });
    const rowA = appRow(f.t, a.id);
    const rowB = appRow(f.t, b.id);
    for (const rank of [rowA.board_rank, moved.board_rank, rowB.board_rank]) {
      expect(rank).toHaveLength(REBALANCE_RANK_LENGTH);
    }
    expect(rowA.board_rank < moved.board_rank).toBe(true);
    expect(moved.board_rank < rowB.board_rank).toBe(true);
    expect([rowA.revision, rowB.revision]).toEqual([2, 2]);
    const logged = changeRows(f.t, userId).slice(before);
    expect(logged.map((r) => [r.entity_id, r.revision]).sort()).toEqual(
      [
        [a.id, 2],
        [b.id, 2],
        [c.id, 2],
      ].sort()
    );
  });

  it("stale neighbours (another user's card, a card elsewhere) append the card at the bottom", async () => {
    const a = await trackNew(f.t, f.alice, { stage: "preparing" });
    const elsewhere = await trackNew(f.t, f.alice);
    const c = await trackNew(f.t, f.alice, { stage: "ready" });
    const foreign = await trackNew(f.t, f.bob, { stage: "preparing" });
    const moved = await moveTo(f.alice, c, "preparing", {
      before_id: foreign.id,
      after_id: elsewhere.id,
    });
    expect(moved.stage).toBe("preparing");
    expect(moved.board_rank > a.board_rank).toBe(true);
    expect(appRow(f.t, foreign.id).revision).toBe(1);
    expect(appRow(f.t, elsewhere.id).revision).toBe(1);
  });
});
