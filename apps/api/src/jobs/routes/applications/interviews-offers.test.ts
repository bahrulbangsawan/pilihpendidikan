import { beforeEach, describe, expect, it } from "bun:test";
import {
  InterviewPageSchema,
  OfferPageSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationRecord,
  InterviewRecord,
  OfferRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { Fixture } from "./support.test";
import {
  appRow,
  changeRows,
  eventRows,
  setup,
  trackNew,
  userIdOf,
} from "./support.test";

const FOLD_RE = /\r\n /g;

let f: Fixture;

beforeEach(async () => {
  f = await setup();
});

interface InterviewBody {
  application?: ApplicationRecord;
  interview: InterviewRecord;
}
interface OfferBody {
  application?: ApplicationRecord;
  offer: OfferRecord;
}

function createInterview(appId: string, body: Record<string, unknown>) {
  return f.alice.post<InterviewBody>(
    `/api/v1/applications/${appId}/interviews`,
    body
  );
}

function createOffer(appId: string, body: Record<string, unknown>) {
  return f.alice.post<OfferBody>(`/api/v1/applications/${appId}/offers`, {
    received_at: f.clock.now(),
    ...body,
  });
}

function stageEvents(appId: string) {
  return eventRows(f.t, appId)
    .filter((e) => e.type === "stage_changed")
    .map((e) => [e.from_value, e.to_value]);
}

describe("interviews (06 §6.1)", () => {
  it("TB-INTERVIEW-AUTOMOVE the first interview of an applied application moves it to interviewing (default on)", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    const res = await createInterview(app.id, {
      kind: "phone_screen",
      scheduled_at: f.clock.now() + 86_400_000,
      duration_min: 30,
      timezone: "Asia/Jakarta",
      interviewers: ["Dewi"],
    });
    expect(res.status).toBe(201);
    expect(res.body.interview).toMatchObject({
      round: 1,
      kind: "phone_screen",
      outcome: "pending",
      revision: 1,
      interviewers: ["Dewi"],
    });
    expect(res.body.application).toMatchObject({
      stage: "interviewing",
      revision: 2,
    });
    expect(appRow(f.t, app.id)).toEqual(
      res.body.application as ApplicationRecord
    );
    expect(stageEvents(app.id)).toEqual([["applied", "interviewing"]]);
    const scheduled = eventRows(f.t, app.id).find(
      (e) => e.type === "interview_scheduled"
    );
    expect(scheduled?.payload).toMatchObject({
      interview_id: res.body.interview.id,
      round: 1,
      kind: "phone_screen",
    });
    expect(
      changeRows(f.t, userIdOf(f.alice)).some(
        (c) => c.entity === "interview" && c.entity_id === res.body.interview.id
      )
    ).toBe(true);
  });

  it("TB-INTERVIEW-AUTOMOVE move_application:false keeps the stage, and later interviews never move it", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    const optedOut = await createInterview(app.id, {
      kind: "technical",
      move_application: false,
    });
    expect(optedOut.status).toBe(201);
    expect(optedOut.body.application).toBeUndefined();
    const second = await createInterview(app.id, { kind: "onsite" });
    expect(second.body.interview.round).toBe(2);
    expect(second.body.application).toBeUndefined();
    expect(appRow(f.t, app.id).stage).toBe("applied");
    const saved = await trackNew(f.t, f.alice);
    const early = await createInterview(saved.id, { kind: "other" });
    expect(early.body.application).toBeUndefined();
    expect(appRow(f.t, saved.id).stage).toBe("saved");
  });

  it("TB-INTERVIEW-AUTOMOVE an outcome of failed never rejects the application", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    const created = await createInterview(app.id, { kind: "final" });
    const res = await f.alice.patch<InterviewBody>(
      `/api/v1/applications/${app.id}/interviews/${created.body.interview.id}`,
      { base_revision: 1, outcome: "failed", notes: "No offer" }
    );
    expect(res.status).toBe(200);
    expect(res.body.interview).toMatchObject({
      outcome: "failed",
      revision: 2,
    });
    expect(res.body.application).toBeUndefined();
    expect(appRow(f.t, app.id).stage).toBe("interviewing");
    const updated = eventRows(f.t, app.id).find(
      (e) => e.type === "interview_updated"
    );
    expect(updated?.payload).toMatchObject({ outcome: "failed" });
  });

  it("lists by round, reads one, edits under base_revision and deletes with change_log op=delete", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    const one = await createInterview(app.id, { kind: "phone_screen" });
    const two = await createInterview(app.id, { kind: "technical", round: 5 });
    const three = await createInterview(app.id, { kind: "onsite" });
    expect(three.body.interview.round).toBe(6);
    const list = await f.alice.get<{
      items: InterviewRecord[];
      next_cursor: string | null;
    }>(`/api/v1/applications/${app.id}/interviews`, { query: { limit: 2 } });
    expect(InterviewPageSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.items.map((i) => i.round)).toEqual([1, 5]);
    const rest = await f.alice.get<{ items: InterviewRecord[] }>(
      `/api/v1/applications/${app.id}/interviews`,
      { query: { limit: 2, cursor: list.body.next_cursor ?? "" } }
    );
    expect(rest.body.items.map((i) => i.id)).toEqual([three.body.interview.id]);
    const read = await f.alice.get<InterviewBody>(
      `/api/v1/applications/${app.id}/interviews/${two.body.interview.id}`
    );
    expect(read.body.interview).toEqual(two.body.interview);
    const edit = await f.alice.patch<InterviewBody>(
      `/api/v1/applications/${app.id}/interviews/${one.body.interview.id}`,
      {
        base_revision: 1,
        location: "https://meet.example.com/abc",
        interviewers: ["A", "B"],
      }
    );
    expect(edit.body.interview).toMatchObject({
      location: "https://meet.example.com/abc",
      interviewers: ["A", "B"],
      revision: 2,
    });
    const del = await f.alice.delete(
      `/api/v1/applications/${app.id}/interviews/${two.body.interview.id}`
    );
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ id: two.body.interview.id, deleted: true });
    const gone = await f.alice.get(
      `/api/v1/applications/${app.id}/interviews/${two.body.interview.id}`
    );
    expect(gone.status).toBe(404);
    const deletion = changeRows(f.t, userIdOf(f.alice)).find(
      (c) => c.entity_id === two.body.interview.id && c.op === "delete"
    );
    expect(deletion).toMatchObject({ entity: "interview", revision: 2 });
  });

  it("rejects an unknown time zone (400) and an interview id under another application (404)", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    const other = await trackNew(f.t, f.alice);
    const bad = await createInterview(app.id, {
      kind: "other",
      timezone: "Mars/Olympus",
    });
    expect(bad.status).toBe(400);
    const ok = await createInterview(app.id, { kind: "other" });
    const crossed = await f.alice.get(
      `/api/v1/applications/${other.id}/interviews/${ok.body.interview.id}`
    );
    expect(crossed.status).toBe(404);
  });
});

describe("GET …/interviews/{ivw_id}.ics (06 §6.1)", () => {
  it("TB-ICS exports one VEVENT in UTC with escaped, folded text and no attendee e-mails", async () => {
    const app = await trackNew(
      f.t,
      f.alice,
      { stage: "applied" },
      {
        title: "Senior Backend Engineer, Payments; Platform",
        company_name: "Acme, Inc.",
      }
    );
    const start = Date.UTC(2026, 9, 20, 2, 30);
    const created = await createInterview(app.id, {
      kind: "technical",
      scheduled_at: start,
      duration_min: 45,
      timezone: "Asia/Jakarta",
      location: "https://meet.example.com/xyz",
      interviewers: ["Budi Santoso <budi@acme.example>", "Siti"],
      notes: "Bring laptop\nTopics: system design, SQL; caching \\ queues",
    });
    const res = await f.alice.get(
      `/api/v1/applications/${app.id}/interviews/${created.body.interview.id}.ics`
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8"
    );
    expect(res.headers.get("Content-Disposition")).toContain(
      `interview-${created.body.interview.id}.ics`
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const text = res.text;
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    const lines = text.split("\r\n");
    for (const line of lines) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    }
    const unfolded = text.replace(FOLD_RE, "");
    expect(unfolded).toContain("DTSTART:20261020T023000Z");
    expect(unfolded).toContain("DTEND:20261020T031500Z");
    expect(unfolded).toContain(
      `UID:${created.body.interview.id}@jobs.pilihpendidikan.com`
    );
    expect(unfolded).toContain(
      "SUMMARY:Technical interview (round 1): Senior Backend Engineer\\, Payments\\; Platform at Acme\\, Inc."
    );
    expect(unfolded).toContain(
      "Topics: system design\\, SQL\\; caching \\\\ queues"
    );
    expect(unfolded).toContain("Bring laptop\\nTopics");
    expect(unfolded).toContain("LOCATION:https://meet.example.com/xyz");
    expect(unfolded).toContain("URL:https://meet.example.com/xyz");
    expect(unfolded).not.toContain("ATTENDEE");
    expect(unfolded).not.toContain("ORGANIZER");
    expect(unfolded).not.toContain("budi@acme.example");
    expect(unfolded).toContain("Budi Santoso <[email removed]>");
  });

  it("TB-ICS an unscheduled interview, or another user's, has no calendar export (404)", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    const created = await createInterview(app.id, { kind: "other" });
    const path = `/api/v1/applications/${app.id}/interviews/${created.body.interview.id}.ics`;
    expect((await f.alice.get(path)).status).toBe(404);
    expect((await f.bob.get(path)).status).toBe(404);
  });
});

describe("offers (06 §6.2)", () => {
  it("TB-OFFER recording an offer moves interviewing → offer with an offer_recorded event", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    await createInterview(app.id, { kind: "final" });
    const res = await createOffer(app.id, {
      compensation: { base: 25_000_000, currency: "IDR", period: "month" },
      deadline_at: f.clock.now() + 5 * 86_400_000,
    });
    expect(res.status).toBe(201);
    expect(res.body.offer).toMatchObject({
      status: "open",
      compensation: { base: 25_000_000, currency: "IDR", period: "month" },
      revision: 1,
    });
    expect(res.body.application).toMatchObject({ stage: "offer" });
    expect(stageEvents(app.id)).toEqual([
      ["applied", "interviewing"],
      ["interviewing", "offer"],
    ]);
    const recorded = eventRows(f.t, app.id).find(
      (e) => e.type === "offer_recorded"
    );
    expect(recorded?.payload).toMatchObject({
      offer_id: res.body.offer.id,
      status: "open",
    });
    expect(appRow(f.t, app.id).follow_up_at).toBeNull();
  });

  it("TB-OFFER marking the offer accepted moves offer → accepted; declined never moves the card", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    const revised = await createOffer(app.id, {});
    expect(revised.body.application?.stage).toBe("offer");
    const declined = await f.alice.patch<OfferBody>(
      `/api/v1/applications/${app.id}/offers/${revised.body.offer.id}`,
      { base_revision: 1, status: "declined" }
    );
    expect(declined.body.application).toBeUndefined();
    expect(appRow(f.t, app.id).stage).toBe("offer");
    const second = await createOffer(app.id, { notes: "revised" });
    expect(second.body.application).toBeUndefined();
    const accepted = await f.alice.patch<OfferBody>(
      `/api/v1/applications/${app.id}/offers/${second.body.offer.id}`,
      { base_revision: 1, status: "accepted" }
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.offer).toMatchObject({
      status: "accepted",
      revision: 2,
    });
    expect(accepted.body.application).toMatchObject({ stage: "accepted" });
    expect(appRow(f.t, app.id).stage).toBe("accepted");
    const statusEvent = eventRows(f.t, app.id)
      .filter((e) => e.type === "offer_recorded")
      .at(-1);
    expect(statusEvent?.payload).toMatchObject({
      status: "accepted",
      previous_status: "open",
    });
  });

  it("TB-OFFER an offer recorded as accepted from interviewing passes through offer to accepted in one batch", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    await createInterview(app.id, { kind: "onsite" });
    const res = await createOffer(app.id, { status: "accepted" });
    expect(res.status).toBe(201);
    expect(res.body.application).toMatchObject({
      stage: "accepted",
      revision: 3,
    });
    expect(appRow(f.t, app.id)).toEqual(
      res.body.application as ApplicationRecord
    );
    expect(stageEvents(app.id)).toEqual([
      ["applied", "interviewing"],
      ["interviewing", "offer"],
      ["offer", "accepted"],
    ]);
    const board = await f.alice.get<{
      columns: Array<{
        stage: string;
        cards: Array<{ id: string; latest_offer_status: string | null }>;
      }>;
    }>("/api/v1/board");
    const accepted = board.body.columns.find((c) => c.stage === "accepted");
    expect(accepted?.cards[0]).toMatchObject({
      id: app.id,
      latest_offer_status: "accepted",
    });
  });

  it("TB-OFFER move_application:false keeps the stage", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    const res = await createOffer(app.id, { move_application: false });
    expect(res.body.application).toBeUndefined();
    expect(appRow(f.t, app.id).stage).toBe("applied");
    const accepted = await f.alice.patch<OfferBody>(
      `/api/v1/applications/${app.id}/offers/${res.body.offer.id}`,
      { base_revision: 1, status: "accepted", move_application: false }
    );
    expect(accepted.body.application).toBeUndefined();
    expect(appRow(f.t, app.id).stage).toBe("applied");
  });

  it("TB-OFFER lists newest first, reads one, edits fields without events and deletes with change_log op=delete", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "offer" });
    const older = await createOffer(app.id, {
      received_at: f.clock.now() - 5000,
    });
    const newer = await createOffer(app.id, {});
    const list = await f.alice.get<{ items: OfferRecord[] }>(
      `/api/v1/applications/${app.id}/offers`
    );
    expect(OfferPageSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.items.map((o) => o.id)).toEqual([
      newer.body.offer.id,
      older.body.offer.id,
    ]);
    const read = await f.alice.get<OfferBody>(
      `/api/v1/applications/${app.id}/offers/${older.body.offer.id}`
    );
    expect(read.body.offer).toEqual(older.body.offer);
    const eventsBefore = eventRows(f.t, app.id).length;
    const edit = await f.alice.patch<OfferBody>(
      `/api/v1/applications/${app.id}/offers/${older.body.offer.id}`,
      {
        base_revision: 1,
        notes: "negotiating",
        compensation: { raw: "Rp 30 jt" },
      }
    );
    expect(edit.body.offer).toMatchObject({
      notes: "negotiating",
      compensation: { raw: "Rp 30 jt" },
    });
    expect(eventRows(f.t, app.id)).toHaveLength(eventsBefore);
    const del = await f.alice.delete(
      `/api/v1/applications/${app.id}/offers/${older.body.offer.id}`,
      { query: { base_revision: 2 } }
    );
    expect(del.status).toBe(200);
    const deletion = changeRows(f.t, userIdOf(f.alice)).find(
      (c) => c.entity_id === older.body.offer.id && c.op === "delete"
    );
    expect(deletion).toMatchObject({ entity: "offer", revision: 3 });
    expect(
      (
        await f.alice.get(
          `/api/v1/applications/${app.id}/offers/${older.body.offer.id}`
        )
      ).status
    ).toBe(404);
  });
});
