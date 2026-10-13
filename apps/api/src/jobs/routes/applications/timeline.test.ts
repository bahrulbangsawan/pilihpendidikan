import { beforeEach, describe, expect, it } from "bun:test";
import { ApplicationEventPageSchema } from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { Fixture } from "./support.test";
import {
  appRow,
  changeRows,
  eventRows,
  setup,
  trackNew,
  userIdOf,
} from "./support.test";

let f: Fixture;

beforeEach(async () => {
  f = await setup();
});

interface EventBody {
  event: ApplicationEventRecord;
}
interface EventPage {
  items: ApplicationEventRecord[];
  next_cursor: string | null;
}

function addNote(appId: string, text: string, key: string) {
  return f.alice.post<EventBody>(`/api/v1/applications/${appId}/events`, {
    type: "note_added",
    payload: { text },
    idempotency_key: key,
  });
}

describe("timeline and notes (06 §4–§5)", () => {
  it("TB-NOTES a note is an attributed note_added event (201); the timeline lists newest first", async () => {
    const app = await trackNew(f.t, f.alice);
    f.clock.advance(1000);
    const res = await addNote(
      app.id,
      "**Recruiter** called, call back Friday",
      "n-1"
    );
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      application_id: app.id,
      type: "note_added",
      actor_kind: "user",
      payload: { text: "**Recruiter** called, call back Friday" },
      idempotency_key: "n-1",
      recorded_at: f.clock.now(),
      applied_to_state: true,
    });
    expect(eventRows(f.t, app.id).at(-1)).toEqual(
      res.body.event as unknown as Record<string, unknown>
    );
    expect(appRow(f.t, app.id).revision).toBe(1);
    const page = await f.alice.get<EventPage>(
      `/api/v1/applications/${app.id}/events`
    );
    expect(page.status).toBe(200);
    expect(ApplicationEventPageSchema.safeParse(page.body).success).toBe(true);
    expect(page.body.items.map((e) => e.type)).toEqual([
      "note_added",
      "created",
    ]);
    expect(
      changeRows(f.t, userIdOf(f.alice)).some(
        (c) => c.entity === "event" && c.entity_id === res.body.event.id
      )
    ).toBe(true);
  });

  it("TB-NOTES re-sending an idempotency_key returns the stored note; reusing it for another event is 409 duplicate", async () => {
    const app = await trackNew(f.t, f.alice);
    const first = await addNote(app.id, "first", "same-key");
    const again = await addNote(app.id, "first", "same-key");
    expect(again.status).toBe(201);
    expect(again.body.event.id).toBe(first.body.event.id);
    expect(
      eventRows(f.t, app.id).filter((e) => e.type === "note_added")
    ).toHaveLength(1);
    const other = await trackNew(f.t, f.alice);
    const reused = await addNote(other.id, "elsewhere", "same-key");
    expect(reused.status).toBe(409);
    expect((reused.body as unknown as { error: string }).error).toBe(
      "duplicate"
    );
  });

  it("TB-NOTES note_deleted hides the note (and itself) from the default view; include_hidden=1 shows the audit trail", async () => {
    const app = await trackNew(f.t, f.alice);
    f.clock.advance(10);
    const keep = await addNote(app.id, "keep me", "k-1");
    f.clock.advance(10);
    const drop = await addNote(app.id, "typo", "k-2");
    f.clock.advance(10);
    const del = await f.alice.post<EventBody>(
      `/api/v1/applications/${app.id}/events`,
      {
        type: "note_deleted",
        payload: { note_event_id: drop.body.event.id },
        idempotency_key: "k-3",
      }
    );
    expect(del.status).toBe(201);
    expect(del.body.event.payload).toEqual({
      note_event_id: drop.body.event.id,
    });
    const view = await f.alice.get<EventPage>(
      `/api/v1/applications/${app.id}/events`
    );
    expect(view.body.items.map((e) => e.id)).not.toContain(drop.body.event.id);
    expect(view.body.items.map((e) => e.type)).toEqual([
      "note_added",
      "created",
    ]);
    expect(view.body.items[0].id).toBe(keep.body.event.id);
    const audit = await f.alice.get<EventPage>(
      `/api/v1/applications/${app.id}/events`,
      {
        query: { include_hidden: "1" },
      }
    );
    expect(audit.body.items.map((e) => e.type)).toEqual([
      "note_deleted",
      "note_added",
      "note_added",
      "created",
    ]);
    const twice = await f.alice.post<EventBody>(
      `/api/v1/applications/${app.id}/events`,
      {
        type: "note_deleted",
        payload: { note_event_id: drop.body.event.id },
        idempotency_key: "k-4",
      }
    );
    expect(twice.status).toBe(201);
    expect(twice.body.event.id).toBe(del.body.event.id);
  });

  it("TB-NOTES deleting an unknown note, or an event that is not a note, is 404", async () => {
    const app = await trackNew(f.t, f.alice);
    const created = eventRows(f.t, app.id)[0];
    for (const target of [newId("evt"), created.id as string]) {
      const res = await f.alice.post(`/api/v1/applications/${app.id}/events`, {
        type: "note_deleted",
        payload: { note_event_id: target },
        idempotency_key: `del-${target}`,
      });
      expect(res.status).toBe(404);
    }
  });

  it("TB-NOTES only note events can be posted, with a non-empty text", async () => {
    const app = await trackNew(f.t, f.alice);
    const wrongType = await f.alice.post(
      `/api/v1/applications/${app.id}/events`,
      {
        type: "stage_changed",
        payload: { from: "saved", to: "offer" },
        idempotency_key: "x-1",
      }
    );
    expect(wrongType.status).toBe(400);
    const empty = await f.alice.post(`/api/v1/applications/${app.id}/events`, {
      type: "note_added",
      payload: { text: "" },
      idempotency_key: "x-2",
    });
    expect(empty.status).toBe(400);
    expect(eventRows(f.t, app.id)).toHaveLength(1);
  });

  it("TB-NOTES notes from the CLI carry the device; occurred_at is the client clock", async () => {
    const app = await trackNew(f.t, f.alice);
    const cli = await f.client.cliSession("alice@example.com");
    const occurred = f.clock.now() - 120_000;
    const res = await cli.post<EventBody>(
      `/api/v1/applications/${app.id}/events`,
      {
        type: "note_added",
        payload: { text: "offline note" },
        idempotency_key: "cli-1",
        occurred_at: occurred,
      }
    );
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      actor_kind: "user",
      actor_device_id: cli.deviceId,
      occurred_at: occurred,
      recorded_at: f.clock.now(),
    });
  });

  it("pages the timeline (50 by default) with a cursor, newest first", async () => {
    const app = await trackNew(f.t, f.alice);
    for (let i = 0; i < 55; i++) {
      f.clock.advance(10);
      await addNote(app.id, `note ${i}`, `bulk-${i}`);
    }
    const page1 = await f.alice.get<EventPage>(
      `/api/v1/applications/${app.id}/events`
    );
    expect(page1.body.items).toHaveLength(50);
    expect((page1.body.items[0].payload as { text: string }).text).toBe(
      "note 54"
    );
    const page2 = await f.alice.get<EventPage>(
      `/api/v1/applications/${app.id}/events`,
      {
        query: { cursor: page1.body.next_cursor ?? "" },
      }
    );
    expect(page2.body.items).toHaveLength(6);
    expect(page2.body.items.at(-1)?.type).toBe("created");
    expect(page2.body.next_cursor).toBeNull();
  });
});
