import { beforeEach, describe, expect, it } from "bun:test";
import type { TestEnv } from "../../../../test/fakes";
import { createTestEnv } from "../../../../test/fakes";
import { rowsOf, seedApplication } from "../../../../test/seed-jobs";
import type { UserScope } from "../../core/scope";
import { trustedScope } from "../../core/scope";
import { appendChange, latestChangeSeq } from "./change-log";
import type { JobsDb } from "./db";
import {
  decodeJson,
  decodeRow,
  jobsDb,
  retryOnGuardFailure,
  GuardFailedError,
  runBatch,
  UniqueViolationError,
} from "./db";
import { appendEvent } from "./events";
import {
  findIdempotency,
  idempotencyStatements,
  isValidIdempotencyKey,
  requestHash,
  storedBody,
} from "./idempotency";
import { getUserSettings } from "./settings";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
const NOW = Date.UTC(2026, 9, 12, 10);

let t: TestEnv;
let db: JobsDb;
let scope: UserScope;

beforeEach(() => {
  t = createTestEnv();
  db = jobsDb(t.env);
  scope = trustedScope(USER, "script");
});

describe("TCORE-IDEMPOTENCY storage helpers", () => {
  it("TCORE-IDEMPOTENCY validates keys, hashes requests and expires rows", async () => {
    expect(isValidIdempotencyKey("claim:dev_1:01JA")).toBe(true);
    expect(isValidIdempotencyKey("has space")).toBe(false);
    expect(isValidIdempotencyKey("")).toBe(false);
    const a = await requestHash("post", "/api/v1/x?y=1", "{}");
    expect(a).toBe(await requestHash("POST", "/api/v1/x?y=1", "{}"));
    expect(a).not.toBe(await requestHash("POST", "/api/v1/x?y=2", "{}"));
    await runBatch(
      db,
      idempotencyStatements(db, scope, {
        key: "k",
        requestHash: a,
        status: 201,
        body: { ok: 1 },
        now: NOW,
      })
    );
    expect(await findIdempotency(db, scope, "k", NOW + 1)).toMatchObject({
      status_code: 201,
      response_body: '{"ok":1}',
    });
    const later = NOW + 8 * 86_400_000;
    expect(await findIdempotency(db, scope, "k", later)).toBeNull();
    // An expired row is replaced in the same batch, a live one aborts it.
    await runBatch(
      db,
      idempotencyStatements(db, scope, {
        key: "k",
        requestHash: a,
        status: 200,
        body: null,
        now: later,
      })
    );
    await expect(
      runBatch(
        db,
        idempotencyStatements(db, scope, {
          key: "k",
          requestHash: a,
          status: 200,
          body: null,
          now: later + 1,
        })
      )
    ).rejects.toBeInstanceOf(UniqueViolationError);
  });

  it("TCORE-IDEMPOTENCY stores bodies up to 64 KB and a marker above", () => {
    expect(storedBody({ a: 1 })).toBe('{"a":1}');
    expect(storedBody(undefined)).toBe("");
    expect(JSON.parse(storedBody({ big: "x".repeat(70_000) }))).toMatchObject({
      $omitted: true,
    });
  });
});

describe("kernel repo helpers", () => {
  it("appendEvent ignores a replayed idempotency key and only logs inserted events", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER);
    const first = appendEvent(
      db,
      scope,
      {
        applicationId: id,
        type: "note_added",
        actorKind: "user",
        payload: { text: "hi" },
        idempotencyKey: "note-1",
      },
      NOW
    );
    const replay = appendEvent(
      db,
      scope,
      {
        applicationId: id,
        type: "note_added",
        actorKind: "user",
        payload: { text: "hi" },
        idempotencyKey: "note-1",
      },
      NOW
    );
    await runBatch(db, first.statements);
    await runBatch(db, replay.statements);
    expect(rowsOf(t.jobsSqlite, "application_events", USER)).toHaveLength(1);
    expect(rowsOf(t.jobsSqlite, "change_log", USER)).toHaveLength(1);
    const strict = appendEvent(
      db,
      scope,
      {
        applicationId: id,
        type: "note_added",
        actorKind: "user",
        payload: { text: "x" },
        idempotencyKey: "note-1",
        onDuplicate: "abort",
      },
      NOW
    );
    await expect(runBatch(db, strict.statements)).rejects.toBeInstanceOf(
      UniqueViolationError
    );
  });

  it("change_log appends and the latest seq", async () => {
    expect(await latestChangeSeq(db, scope)).toBe(0);
    await runBatch(db, [
      appendChange(db, scope, {
        entity: "application",
        entityId: "app_1",
        revision: 2,
        now: NOW,
      }),
      appendChange(db, scope, {
        entity: "application",
        entityId: "app_1",
        revision: 3,
        now: NOW,
        op: "delete",
      }),
    ]);
    expect(await latestChangeSeq(db, scope)).toBe(2);
    expect(
      await latestChangeSeq(
        db,
        trustedScope("usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0B", "script")
      )
    ).toBe(0);
  });

  it("getUserSettings creates the row with defaults once", async () => {
    const settings = await getUserSettings(db, scope, NOW);
    expect(settings).toMatchObject({
      locale: "en",
      timezone: "Asia/Jakarta",
      default_mode: "approval",
      automation_paused: false,
      ai_scoring_sensitive: true,
      ai_consent_at: null,
      evidence_screenshots: "on_submit",
      evidence_retention_days: 180,
      revision: 1,
    });
    await getUserSettings(db, scope, NOW + 1);
    expect(rowsOf(t.jobsSqlite, "user_settings", USER)).toHaveLength(1);
    const changes = rowsOf(t.jobsSqlite, "change_log", USER);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entity: "settings",
      entity_id: USER,
      revision: 1,
    });
  });

  it("codecs decode JSON and booleans; retryOnGuardFailure retries only guard failures", async () => {
    expect(decodeJson("{bad", 7)).toBe(7);
    const decoded: unknown = decodeRow("automation_tasks", {
      payload: '{"a":1}',
      cancel_requested: 1,
      required_capabilities: "[]",
      progress: "{}",
      resume_requested: 0,
    });
    expect(decoded).toEqual({
      payload: { a: 1 },
      cancel_requested: true,
      required_capabilities: [],
      progress: {},
      resume_requested: false,
    });
    expect(() => decodeRow("nope", {})).toThrow();
    let calls = 0;
    expect(
      await retryOnGuardFailure(() => {
        calls += 1;
        return calls < 3
          ? Promise.reject(new GuardFailedError("x"))
          : Promise.resolve("ok");
      })
    ).toBe("ok");
    await expect(
      retryOnGuardFailure(() => Promise.reject(new Error("other")))
    ).rejects.toThrow("other");
  });
});
