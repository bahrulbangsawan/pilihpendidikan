import { beforeEach, describe, expect, it } from "bun:test";
import { applicationsRoutes } from "@pilihpendidikan/jobs-contracts/api";
import {
  ApplicationRecordSchema,
  InterviewRecordSchema,
  OfferRecordSchema,
} from "@pilihpendidikan/jobs-contracts/records";
import type { V1CallOptions, V1Session } from "../../../../test/fakes";
import type { Fixture } from "./support.test";
import {
  appRow,
  changeRows,
  expectConflict,
  inboxJob,
  setup,
  trackNew,
  userIdOf,
} from "./support.test";

let f: Fixture;

beforeEach(async () => {
  f = await setup();
});

interface Owned {
  appId: string;
  interviewId: string;
  offerId: string;
  userJobId: string;
}

/** An application of `session` with an interview, an offer and a note. */
async function ownedGraph(session: V1Session): Promise<Owned> {
  const app = await trackNew(f.t, session, { stage: "applied" });
  const interview = await session.post<{ interview: { id: string } }>(
    `/api/v1/applications/${app.id}/interviews`,
    {
      kind: "technical",
      scheduled_at: f.clock.now() + 86_400_000,
      move_application: false,
    }
  );
  const offer = await session.post<{ offer: { id: string } }>(
    `/api/v1/applications/${app.id}/offers`,
    { received_at: f.clock.now(), move_application: false }
  );
  await session.post(`/api/v1/applications/${app.id}/events`, {
    type: "note_added",
    payload: { text: "private" },
    idempotency_key: `note-${app.id}`,
  });
  return {
    appId: app.id,
    interviewId: interview.body.interview.id,
    offerId: offer.body.offer.id,
    userJobId: app.user_job_id,
  };
}

type Call = [method: string, path: string, options?: V1CallOptions];

/** One request per §5 route (contract key → request against `ids`). */
function callsFor(ids: Owned): Record<string, Call> {
  const app = `/api/v1/applications/${ids.appId}`;
  const ivw = `${app}/interviews/${ids.interviewId}`;
  const ofr = `${app}/offers/${ids.offerId}`;
  return {
    "POST /api/v1/applications": [
      "POST",
      "/api/v1/applications",
      { body: { user_job_id: ids.userJobId } },
    ],
    "GET /api/v1/applications/{app_id}": ["GET", app],
    "GET /api/v1/applications/{app_id}/interviews/{ivw_id}.ics": [
      "GET",
      `${ivw}.ics`,
    ],
    "PATCH /api/v1/applications/{app_id}": [
      "PATCH",
      app,
      { body: { base_revision: 1, priority: 1 } },
    ],
    "POST /api/v1/applications/{app_id}/move": [
      "POST",
      `${app}/move`,
      { body: { base_revision: 1, stage: "withdrawn" } },
    ],
    "POST /api/v1/applications/{app_id}/submission": [
      "POST",
      `${app}/submission`,
      { body: { base_revision: 1, action: "mark_applied" } },
    ],
    "GET /api/v1/applications/{app_id}/events": ["GET", `${app}/events`],
    "POST /api/v1/applications/{app_id}/events": [
      "POST",
      `${app}/events`,
      {
        body: {
          type: "note_added",
          payload: { text: "intruder" },
          idempotency_key: "intrude-1",
        },
      },
    ],
    "GET /api/v1/applications/{app_id}/interviews": [
      "GET",
      `${app}/interviews`,
    ],
    "POST /api/v1/applications/{app_id}/interviews": [
      "POST",
      `${app}/interviews`,
      { body: { kind: "other" } },
    ],
    "GET /api/v1/applications/{app_id}/interviews/{ivw_id}": ["GET", ivw],
    "PATCH /api/v1/applications/{app_id}/interviews/{ivw_id}": [
      "PATCH",
      ivw,
      { body: { base_revision: 1, outcome: "passed" } },
    ],
    "DELETE /api/v1/applications/{app_id}/interviews/{ivw_id}": ["DELETE", ivw],
    "GET /api/v1/applications/{app_id}/offers": ["GET", `${app}/offers`],
    "POST /api/v1/applications/{app_id}/offers": [
      "POST",
      `${app}/offers`,
      { body: { received_at: 1 } },
    ],
    "GET /api/v1/applications/{app_id}/offers/{ofr_id}": ["GET", ofr],
    "PATCH /api/v1/applications/{app_id}/offers/{ofr_id}": [
      "PATCH",
      ofr,
      { body: { base_revision: 1, status: "accepted" } },
    ],
    "DELETE /api/v1/applications/{app_id}/offers/{ofr_id}": ["DELETE", ofr],
    "DELETE /api/v1/applications/{app_id}": ["DELETE", app],
  };
}

/** A fingerprint of everything alice owns, to prove nothing changed. */
function snapshot(userId: string) {
  const tables = [
    "applications",
    "application_events",
    "interviews",
    "offers",
    "submission_evidence",
    "user_jobs",
  ];
  return tables.map((table) =>
    f.t.jobsSqlite
      .query(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY rowid`)
      .all(userId)
  );
}

describe("T6-09 cross-user isolation (13 §5 matrix)", () => {
  it("T6-09 every board/application/interview/offer route answers 404 for another user's ids and changes nothing", async () => {
    const alice = await ownedGraph(f.alice);
    const calls = callsFor(alice);
    const listRoutes = ["GET /api/v1/board", "GET /api/v1/applications"];
    expect(Object.keys(calls).sort()).toEqual(
      Object.keys(applicationsRoutes)
        .filter((key) => !listRoutes.includes(key))
        .sort()
    );
    const before = snapshot(userIdOf(f.alice));
    const logBefore = changeRows(f.t, userIdOf(f.alice)).length;
    const purge: Call = [
      "DELETE",
      `/api/v1/applications/${alice.appId}`,
      { query: { purge: "1" } },
    ];
    for (const [key, [method, path, options]] of [
      ...Object.entries(calls),
      ["DELETE purge", purge] as const,
    ]) {
      const res = await f.bob.call(method, path, options);
      expect({ key, status: res.status, error: res.body?.error }).toEqual({
        key,
        status: 404,
        error: "not_found",
      });
    }
    expect(snapshot(userIdOf(f.alice))).toEqual(before);
    expect(changeRows(f.t, userIdOf(f.alice))).toHaveLength(logBefore);
  });

  it("T6-09 mixing ids: another user's interview or offer under one's own application is 404", async () => {
    const alice = await ownedGraph(f.alice);
    const bob = await ownedGraph(f.bob);
    const mixed: Owned = {
      appId: bob.appId,
      interviewId: alice.interviewId,
      offerId: alice.offerId,
      userJobId: bob.userJobId,
    };
    const calls = callsFor(mixed);
    for (const key of Object.keys(calls).filter(
      (k) => k.includes("{ivw_id}") || k.includes("{ofr_id}")
    )) {
      const [method, path, options] = calls[key];
      const res = await f.bob.call(method, path, options);
      expect({ key, status: res.status }).toEqual({ key, status: 404 });
    }
    expect(
      (await f.bob.get(`/api/v1/applications/${bob.appId}/interviews`)).body
        .items
    ).toHaveLength(1);
  });

  it("T6-09 an admin gets no bypass (D-26): admin@example.com sees only their own cards", async () => {
    const alice = await ownedGraph(f.alice);
    const admin = await f.client.browserSession("admin@example.com");
    const res = await admin.get(`/api/v1/applications/${alice.appId}`);
    expect(res.status).toBe(404);
    const board = await admin.get<{ columns: Array<{ cards: unknown[] }> }>(
      "/api/v1/board"
    );
    expect(board.body.columns.every((c) => c.cards.length === 0)).toBe(true);
  });

  it("T6-09 a user_job id of another user cannot be tracked, even when the posting is shared", async () => {
    const aliceJob = inboxJob(f.t, f.alice);
    const res = await f.bob.post("/api/v1/applications", {
      user_job_id: aliceJob.userJobId,
    });
    expect(res.status).toBe(404);
  });
});

describe("T20-06 conditional §5 routes answer 409 with details.current", () => {
  it("T20-06 every conditional route with a stale base_revision answers 409 revision_conflict with the full current record", async () => {
    const ids = await ownedGraph(f.alice);
    const app = `/api/v1/applications/${ids.appId}`;
    const ivw = `${app}/interviews/${ids.interviewId}`;
    const ofr = `${app}/offers/${ids.offerId}`;
    // Bump every record past revision 1.
    await f.alice.patch(app, { base_revision: 1, priority: 1 });
    await f.alice.patch(ivw, { base_revision: 1, notes: "v2" });
    await f.alice.patch(ofr, { base_revision: 1, notes: "v2" });
    const appCalls: Call[] = [
      ["PATCH", app, { body: { base_revision: 1, mode: "manual" } }],
      [
        "POST",
        `${app}/move`,
        { body: { base_revision: 1, stage: "withdrawn" } },
      ],
      [
        "POST",
        `${app}/submission`,
        { body: { base_revision: 1, action: "mark_applied" } },
      ],
      ["DELETE", app, { query: { base_revision: 1 } }],
      ["DELETE", app, { query: { base_revision: 1, purge: "1" } }],
      [
        "PATCH",
        app,
        {
          body: { base_revision: 1, priority: -1 },
          headers: { "If-Match": '"1"' },
        },
      ],
    ];
    for (const [method, path, options] of appCalls) {
      const res = await f.alice.call(method, path, options);
      const current = expectConflict(res, { id: ids.appId, revision: 2 });
      expect(ApplicationRecordSchema.safeParse(current).success).toBe(true);
    }
    const ivwCalls: Call[] = [
      ["PATCH", ivw, { body: { base_revision: 1, outcome: "passed" } }],
      ["DELETE", ivw, { query: { base_revision: 1 } }],
      ["DELETE", ivw, { headers: { "If-Match": '"1"' } }],
    ];
    for (const [method, path, options] of ivwCalls) {
      const current = expectConflict(
        await f.alice.call(method, path, options),
        {
          id: ids.interviewId,
          revision: 2,
        }
      );
      expect(InterviewRecordSchema.safeParse(current).success).toBe(true);
    }
    const ofrCalls: Call[] = [
      ["PATCH", ofr, { body: { base_revision: 1, status: "accepted" } }],
      ["DELETE", ofr, { query: { base_revision: 1 } }],
    ];
    for (const [method, path, options] of ofrCalls) {
      const current = expectConflict(
        await f.alice.call(method, path, options),
        {
          id: ids.offerId,
          revision: 2,
        }
      );
      expect(OfferRecordSchema.safeParse(current).success).toBe(true);
    }
    expect(appRow(f.t, ids.appId)).toMatchObject({
      revision: 2,
      archived: false,
      mode: "approval",
      priority: 1,
    });
  });

  it("T20-06 a write that loses a race between planning and commit answers 409 with the re-read record", async () => {
    const app = await trackNew(f.t, f.alice);
    const jobs = f.t.env.JOBS_DB as unknown as {
      batch: (s: D1PreparedStatement[]) => Promise<D1Result[]>;
    };
    const original = jobs.batch;
    jobs.batch = (statements) => {
      jobs.batch = original;
      // Another device writes between this request's read and its commit.
      f.t.jobsSqlite
        .query(
          "UPDATE applications SET stage = 'preparing', revision = revision + 1 WHERE id = ?"
        )
        .run(app.id);
      return original(statements);
    };
    const res = await f.alice.post(`/api/v1/applications/${app.id}/move`, {
      base_revision: 1,
      stage: "withdrawn",
    });
    const current = expectConflict(res, { id: app.id, revision: 2 });
    expect(current.stage).toBe("preparing");
    expect(appRow(f.t, app.id).stage).toBe("preparing");
  });
});
