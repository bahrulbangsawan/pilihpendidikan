import { beforeEach, describe, expect, it } from "bun:test";
import type {
  BoardCard,
  BoardResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  BOARD_CLOSED_LANE_CAP,
  BoardCardPageSchema,
  BoardResponseSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import { STAGES } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import { DETERMINISTIC_ONLY_MODEL } from "@pilihpendidikan/jobs-contracts/scoring";
import { seedApplication, seedTask } from "../../../../test/seed-jobs";
import type { Fixture } from "./support.test";
import {
  changeRows,
  inboxJob,
  moveTo,
  profileVersionOf,
  setup,
  trackNew,
  userIdOf,
} from "./support.test";

const STRONG_ETAG_RE = /^"[0-9a-f]{32}"$/;

let f: Fixture;

beforeEach(async () => {
  f = await setup();
});

async function board(
  query: Record<string, string> = {},
  headers: Record<string, string> = {}
) {
  return await f.alice.get<BoardResponse>("/api/v1/board", { query, headers });
}

function column(body: BoardResponse, stage: string) {
  const found = body.columns.find((c) => c.stage === stage);
  if (!found) {
    throw new Error(`no column ${stage}`);
  }
  return found;
}

function cardOf(body: BoardResponse, id: string): BoardCard {
  for (const c of body.columns) {
    const card = c.cards.find((x) => x.id === id);
    if (card) {
      return card;
    }
  }
  throw new Error(`card ${id} not on the board`);
}

function insertScore(
  userId: string,
  postingId: string,
  version: number,
  score: number,
  model = "gpt-test"
) {
  f.t.jobsSqlite
    .query(
      "INSERT INTO match_scores (id, user_id, posting_id, profile_version, rubric_version, model, score, confidence, components, explanation, status, created_at) VALUES (?, ?, ?, ?, 'r1', ?, ?, 0.8, '{}', 'fits', 'ready', ?)"
    )
    .run(newId("scr"), userId, postingId, version, model, score, f.clock.now());
}

describe("GET /api/v1/board (06 §1.3–§1.4)", () => {
  it("groups cards by stage in board order, each column ordered by board_rank", async () => {
    const a = await trackNew(f.t, f.alice);
    const b = await trackNew(f.t, f.alice);
    const c = await trackNew(f.t, f.alice);
    await moveTo(f.alice, c, "ready");
    const res = await board();
    expect(res.status).toBe(200);
    expect(BoardResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.columns.map((x) => x.stage)).toEqual([...STAGES]);
    const saved = column(res.body, "saved");
    expect(saved.cards.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(saved.cards[0].board_rank < saved.cards[1].board_rank).toBe(true);
    expect(column(res.body, "ready").cards.map((x) => x.id)).toEqual([c.id]);
    expect(saved.total).toBe(2);
    expect(saved.has_more).toBe(false);
  });

  it("cards carry the posting summary (company, title, first location, workplace)", async () => {
    const app = await trackNew(
      f.t,
      f.alice,
      {},
      {
        company_name: "Gojek",
        title: "Data Engineer",
        locations: JSON.stringify([{ raw: "Jakarta" }, { raw: "Remote" }]),
        workplace_type: "hybrid",
        apply_url: "https://jobs.example.com/apply",
      }
    );
    const card = cardOf((await board()).body, app.id);
    expect(card.posting).toMatchObject({
      id: app.posting_id,
      company_name: "Gojek",
      title: "Data Engineer",
      location: "Jakarta",
      workplace_type: "hybrid",
      status: "open",
      apply_url: "https://jobs.example.com/apply",
    });
    expect(card.submission_status).toBe("not_started");
    expect(card.mode).toBe("approval");
  });

  it("the score badge is the current profile_version's score only", async () => {
    const userId = userIdOf(f.alice);
    const app = await trackNew(f.t, f.alice);
    const other = await trackNew(f.t, f.alice);
    const version = await profileVersionOf(f, f.alice);
    insertScore(userId, app.posting_id, version + 1, 12);
    insertScore(userId, app.posting_id, version, 84);
    insertScore(userId, other.posting_id, version + 7, 55);
    const res = await board();
    const card = cardOf(res.body, app.id);
    expect(card.score).toMatchObject({
      score: 84,
      status: "ready",
      profile_version: version,
      deterministic_only: false,
      posting_id: app.posting_id,
    });
    expect(cardOf(res.body, other.id).score).toBeNull();
  });

  it("marks deterministic-only scores ('AI off', 07 §9)", async () => {
    const app = await trackNew(f.t, f.alice);
    const version = await profileVersionOf(f, f.alice);
    insertScore(
      userIdOf(f.alice),
      app.posting_id,
      version,
      71,
      DETERMINISTIC_ONLY_MODEL
    );
    const card = cardOf((await board()).body, app.id);
    expect(card.score?.deterministic_only).toBe(true);
  });

  it("shows the live task with its device name, progress and submission badge", async () => {
    const cli = await f.client.cliSession("alice@example.com", {
      device: { name: "MacBook" },
    });
    const app = await trackNew(f.t, f.alice);
    const task = seedTask(f.t.jobsSqlite, userIdOf(f.alice), {
      application_id: app.id,
      state: "running",
      lease_id: "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
      lease_device_id: cli.deviceId,
      progress: JSON.stringify({ stage: "filling", step: 3 }),
    });
    f.t.jobsSqlite
      .query(
        "UPDATE applications SET submission_status = 'in_progress' WHERE id = ?"
      )
      .run(app.id);
    const res = await board();
    const card = cardOf(res.body, app.id);
    expect(card.live_task).toMatchObject({
      id: task.id,
      kind: "apply",
      state: "running",
      device_id: cli.deviceId,
      device_name: "MacBook",
      progress_stage: "filling",
      submit_intent_at: null,
    });
    expect(card.submission_status).toBe("in_progress");
    expect(res.body.counts.tasks_live).toBe(1);
  });

  it("finished tasks are not live; a queued task pinned to a device names it", async () => {
    const cli = await f.client.cliSession("alice@example.com", {
      device: { name: "ThinkPad" },
    });
    const app = await trackNew(f.t, f.alice);
    seedTask(f.t.jobsSqlite, userIdOf(f.alice), {
      application_id: app.id,
      state: "failed",
      idempotency_key: "old",
    });
    seedTask(f.t.jobsSqlite, userIdOf(f.alice), {
      application_id: app.id,
      state: "queued",
      target_device_id: cli.deviceId,
    });
    const card = cardOf((await board()).body, app.id);
    expect(card.live_task?.state).toBe("queued");
    expect(card.live_task?.device_name).toBe("ThinkPad");
  });

  it("marks closed postings, due follow-ups, the next pending interview and the latest offer", async () => {
    const now = f.clock.now();
    const app = await trackNew(
      f.t,
      f.alice,
      {},
      { status: "closed", closed_at: now - 1000 }
    );
    const later = await trackNew(f.t, f.alice);
    f.t.jobsSqlite
      .query("UPDATE applications SET follow_up_at = ? WHERE id = ?")
      .run(now - 60_000, app.id);
    f.t.jobsSqlite
      .query("UPDATE applications SET follow_up_at = ? WHERE id = ?")
      .run(now + 86_400_000, later.id);
    const userId = userIdOf(f.alice);
    const insertInterview = (at: number, outcome: string) =>
      f.t.jobsSqlite
        .query(
          "INSERT INTO interviews (id, user_id, application_id, round, kind, scheduled_at, outcome, created_at, updated_at) VALUES (?, ?, ?, 1, 'technical', ?, ?, ?, ?)"
        )
        .run(newId("ivw"), userId, app.id, at, outcome, now, now);
    insertInterview(now - 86_400_000, "passed");
    insertInterview(now + 3 * 86_400_000, "pending");
    insertInterview(now + 86_400_000, "pending");
    const insertOffer = (received: number, status: string) =>
      f.t.jobsSqlite
        .query(
          "INSERT INTO offers (id, user_id, application_id, received_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(newId("ofr"), userId, app.id, received, status, now, now);
    insertOffer(now - 10_000, "expired");
    insertOffer(now - 5000, "open");
    const res = await board();
    const card = cardOf(res.body, app.id);
    expect(card.posting.status).toBe("closed");
    expect(card.stage).toBe("saved");
    expect(card.follow_up_due).toBe(true);
    expect(card.next_interview_at).toBe(now + 86_400_000);
    expect(card.latest_offer_status).toBe("open");
    const other = cardOf(res.body, later.id);
    expect(other.follow_up_due).toBe(false);
    expect(other.next_interview_at).toBeNull();
    expect(other.latest_offer_status).toBeNull();
    expect(res.body.counts.follow_ups_due).toBe(1);
  });

  it("counts pending approvals, new inbox jobs, overdue follow-ups, unconfirmed submissions and live tasks", async () => {
    const userId = userIdOf(f.alice);
    const now = f.clock.now();
    const app = await trackNew(f.t, f.alice);
    const insertApproval = (state: string, expiresAt: number) =>
      f.t.jobsSqlite
        .query(
          "INSERT INTO approvals (id, user_id, kind, application_id, payload, payload_hash, state, expires_at, created_at) VALUES (?, ?, 'submit', ?, '{}', ?, ?, ?, ?)"
        )
        .run(
          newId("apr"),
          userId,
          app.id,
          "h".repeat(64),
          state,
          expiresAt,
          now
        );
    insertApproval("pending", now + 3_600_000);
    insertApproval("pending", now + 7_200_000);
    insertApproval("pending", now - 1);
    insertApproval("approved", now + 3_600_000);
    inboxJob(f.t, f.alice);
    inboxJob(f.t, f.alice);
    inboxJob(f.t, f.alice, {}, { inbox_state: "dismissed" });
    seedApplication(f.t.jobsSqlite, userId, {
      submission_status: "submitted_unverified",
      follow_up_at: now - 1,
    });
    seedApplication(f.t.jobsSqlite, userId, {
      submission_status: "outcome_unknown",
    });
    seedApplication(f.t.jobsSqlite, userId, {
      submission_status: "outcome_unknown",
      archived: 1,
      follow_up_at: now - 1,
    });
    seedTask(f.t.jobsSqlite, userId, {
      application_id: app.id,
      state: "paused",
    });
    inboxJob(f.t, f.bob);
    const res = await board();
    expect(res.body.counts).toEqual({
      approvals_pending: 2,
      inbox_new: 2,
      follow_ups_due: 1,
      unconfirmed: 2,
      tasks_live: 1,
    });
  });

  it("returns the user's latest change_log seq as the cursor", async () => {
    await trackNew(f.t, f.alice);
    await trackNew(f.t, f.bob);
    const rows = changeRows(f.t, userIdOf(f.alice));
    const res = await board();
    expect(res.body.cursor).toBe(rows.at(-1)?.seq ?? -1);
    expect(res.body.generated_at).toBe(f.clock.now());
  });

  it("hides archived cards unless include_archived=1", async () => {
    const app = await trackNew(f.t, f.alice);
    const del = await f.alice.delete(`/api/v1/applications/${app.id}`);
    expect(del.status).toBe(200);
    const hidden = await board();
    expect(column(hidden.body, "saved").cards).toHaveLength(0);
    const shown = await board({ include_archived: "1" });
    const card = cardOf(shown.body, app.id);
    expect(card.archived).toBe(true);
  });

  it("TB-ETAG answers 304 to a matching If-None-Match and a new tag after a change", async () => {
    await trackNew(f.t, f.alice);
    const first = await board();
    const etag = first.headers.get("ETag");
    expect(etag).toMatch(STRONG_ETAG_RE);
    const again = await board({}, { "If-None-Match": etag ?? "" });
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
    expect(again.headers.get("ETag")).toBe(etag);
    await trackNew(f.t, f.alice);
    const changed = await board({}, { "If-None-Match": etag ?? "" });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("ETag")).not.toBe(etag);
    expect(column(changed.body, "saved").cards).toHaveLength(2);
  });

  it("TB-ETAG the tag ignores generated_at: polling an unchanged board later still gets 304", async () => {
    await trackNew(f.t, f.alice);
    const first = await board();
    f.clock.advance(15_000);
    const later = await board(
      {},
      { "If-None-Match": first.headers.get("ETag") ?? "" }
    );
    expect(later.status).toBe(304);
    const fresh = await board();
    expect(fresh.body.generated_at).toBe(first.body.generated_at + 15_000);
    expect(fresh.headers.get("ETag")).toBe(first.headers.get("ETag"));
  });

  it("TB-CLOSED-CAP closed lanes keep their 200 most recent cards; the rest pages via /applications?stage=", async () => {
    const userId = userIdOf(f.alice);
    const base = f.clock.now() - 1_000_000;
    const rejected: string[] = [];
    for (let i = 0; i < BOARD_CLOSED_LANE_CAP + 5; i++) {
      rejected.push(
        seedApplication(f.t.jobsSqlite, userId, {
          stage: "rejected",
          updated_at: base + i,
          board_rank: `i${(i + 1).toString(36)}`,
        }).id
      );
    }
    for (let i = 0; i < 3; i++) {
      seedApplication(f.t.jobsSqlite, userId, { stage: "withdrawn" });
    }
    for (let i = 0; i < BOARD_CLOSED_LANE_CAP + 2; i++) {
      seedApplication(f.t.jobsSqlite, userId, {
        stage: "accepted",
        board_rank: `k${(i + 1).toString(36)}`,
      });
    }
    const res = await board();
    const lane = column(res.body, "rejected");
    expect(lane.cards).toHaveLength(BOARD_CLOSED_LANE_CAP);
    expect(lane.total).toBe(BOARD_CLOSED_LANE_CAP + 5);
    expect(lane.has_more).toBe(true);
    const shown = new Set(lane.cards.map((c) => c.id));
    for (const oldest of rejected.slice(0, 5)) {
      expect(shown.has(oldest)).toBe(false);
    }
    const ranks = lane.cards.map((c) => c.board_rank);
    expect([...ranks].sort()).toEqual(ranks);
    expect(column(res.body, "withdrawn")).toMatchObject({
      total: 3,
      has_more: false,
    });
    const accepted = column(res.body, "accepted");
    expect(accepted.cards).toHaveLength(BOARD_CLOSED_LANE_CAP + 2);
    expect(accepted.has_more).toBe(false);

    const page1 = await f.alice.get<{
      items: BoardCard[];
      next_cursor: string | null;
    }>("/api/v1/applications", { query: { stage: "rejected", limit: 200 } });
    expect(page1.body.items).toHaveLength(200);
    expect(new Set(page1.body.items.map((c) => c.id))).toEqual(shown);
    const page2 = await f.alice.get<{
      items: BoardCard[];
      next_cursor: string | null;
    }>("/api/v1/applications", {
      query: {
        stage: "rejected",
        limit: 200,
        cursor: page1.body.next_cursor ?? "",
      },
    });
    expect(page2.body.items.map((c) => c.id).sort()).toEqual(
      rejected.slice(0, 5).sort()
    );
    expect(page2.body.next_cursor).toBeNull();
  });
});

describe("GET /api/v1/applications (05 §5 list)", () => {
  it("lists cards most recently updated first and pages with next_cursor", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      f.clock.advance(1000);
      ids.push((await trackNew(f.t, f.alice)).id);
    }
    const page1 = await f.alice.get<{
      items: BoardCard[];
      next_cursor: string | null;
    }>("/api/v1/applications", { query: { limit: 2 } });
    expect(page1.status).toBe(200);
    expect(BoardCardPageSchema.safeParse(page1.body).success).toBe(true);
    expect(page1.body.items.map((c) => c.id)).toEqual([ids[4], ids[3]]);
    const page2 = await f.alice.get<{
      items: BoardCard[];
      next_cursor: string | null;
    }>("/api/v1/applications", {
      query: { limit: 2, cursor: page1.body.next_cursor ?? "" },
    });
    expect(page2.body.items.map((c) => c.id)).toEqual([ids[2], ids[1]]);
    const page3 = await f.alice.get<{
      items: BoardCard[];
      next_cursor: string | null;
    }>("/api/v1/applications", {
      query: { limit: 2, cursor: page2.body.next_cursor ?? "" },
    });
    expect(page3.body.items.map((c) => c.id)).toEqual([ids[0]]);
    expect(page3.body.next_cursor).toBeNull();
  });

  it("filters by stage and by q over title and company (case-insensitive, wildcards literal)", async () => {
    const acme = await trackNew(
      f.t,
      f.alice,
      {},
      { company_name: "Acme Corp", title: "Backend Engineer" }
    );
    const tokped = await trackNew(
      f.t,
      f.alice,
      {},
      { company_name: "Tokopedia", title: "100% Remote Designer" }
    );
    await trackNew(
      f.t,
      f.alice,
      {},
      { company_name: "Bukalapak", title: "QA" }
    );
    await moveTo(f.alice, tokped, "ready");
    const byQ = await f.alice.get<{ items: BoardCard[] }>(
      "/api/v1/applications",
      {
        query: { q: "acme" },
      }
    );
    expect(byQ.body.items.map((c) => c.id)).toEqual([acme.id]);
    const byTitle = await f.alice.get<{ items: BoardCard[] }>(
      "/api/v1/applications",
      {
        query: { q: "100%" },
      }
    );
    expect(byTitle.body.items.map((c) => c.id)).toEqual([tokped.id]);
    const wildcard = await f.alice.get<{ items: BoardCard[] }>(
      "/api/v1/applications",
      {
        query: { q: "%" },
      }
    );
    expect(wildcard.body.items.map((c) => c.id)).toEqual([tokped.id]);
    const byStage = await f.alice.get<{ items: BoardCard[] }>(
      "/api/v1/applications",
      {
        query: { stage: "ready" },
      }
    );
    expect(byStage.body.items.map((c) => c.id)).toEqual([tokped.id]);
  });

  it("excludes archived cards unless include_archived=1", async () => {
    const app = await trackNew(f.t, f.alice);
    await f.alice.delete(`/api/v1/applications/${app.id}`);
    const without = await f.alice.get<{ items: BoardCard[] }>(
      "/api/v1/applications"
    );
    expect(without.body.items).toHaveLength(0);
    const withArchived = await f.alice.get<{ items: BoardCard[] }>(
      "/api/v1/applications",
      {
        query: { include_archived: "1" },
      }
    );
    expect(withArchived.body.items.map((c) => c.id)).toEqual([app.id]);
  });

  it("rejects a malformed cursor or an unknown stage with 400", async () => {
    const cursor = await f.alice.get("/api/v1/applications", {
      query: { cursor: "not a cursor!" },
    });
    expect(cursor.status).toBe(400);
    const stage = await f.alice.get("/api/v1/applications", {
      query: { stage: "ghosted" },
    });
    expect(stage.status).toBe(400);
    expect(stage.body.error).toBe("invalid_request");
  });

  it("T6-09 the board and the list never show another user's cards", async () => {
    await trackNew(f.t, f.alice);
    await trackNew(f.t, f.alice);
    const bobBoard = await f.bob.get<BoardResponse>("/api/v1/board");
    expect(bobBoard.body.columns.every((c) => c.cards.length === 0)).toBe(true);
    expect(bobBoard.body.cursor).toBe(0);
    const bobList = await f.bob.get<{ items: BoardCard[] }>(
      "/api/v1/applications"
    );
    expect(bobList.body.items).toHaveLength(0);
  });

  it("a read-only personal token reads the board but cannot write (403 insufficient_scope)", async () => {
    const app = await trackNew(f.t, f.alice);
    const reader = await f.client.personalToken("alice@example.com", "read");
    const read = await reader.get<BoardResponse>("/api/v1/board");
    expect(read.status).toBe(200);
    expect(cardOf(read.body, app.id).id).toBe(app.id);
    const write = await reader.post(`/api/v1/applications/${app.id}/move`, {
      base_revision: 1,
      stage: "ready",
    });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe("insufficient_scope");
    expect(write.body.scope).toBe("jobs:write");
  });
});
