import { beforeEach, describe, expect, it } from "bun:test";
import { ApplicationEventRecordSchema } from "@pilihpendidikan/jobs-contracts/records";
import type { TestEnv } from "../../../../test/fakes";
import { createTestEnv } from "../../../../test/fakes";
import { rowsOf, seedApplication, seedTask } from "../../../../test/seed-jobs";
import { ApiError } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { trustedScope } from "../../core/scope";
import { planApplicationTransition } from "./application-state";
import type { JobsDb } from "./db";
import { decodeRow, GuardFailedError, jobsDb, runBatch } from "./db";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
const NOW = Date.UTC(2026, 9, 12, 10);
const TASK_CREATED = NOW - 3_600_000;

let t: TestEnv;
let db: JobsDb;
let scope: UserScope;

beforeEach(() => {
  t = createTestEnv();
  db = jobsDb(t.env);
  scope = trustedScope(USER, "script");
});

function app(id: string) {
  return t.jobsSqlite
    .query("SELECT * FROM applications WHERE id = ?")
    .get(id) as Record<string, unknown>;
}

function events(applicationId: string) {
  return (
    t.jobsSqlite
      .query(
        "SELECT * FROM application_events WHERE application_id = ? ORDER BY rowid"
      )
      .all(applicationId) as Record<string, unknown>[]
  ).map((row) => decodeRow<Record<string, unknown>>("application_events", row));
}

function userMove(applicationId: string, from: string, to: string, at: number) {
  t.jobsSqlite
    .query(
      "INSERT INTO application_events (id, user_id, application_id, type, from_value, to_value, payload, actor_kind, applied_to_state, occurred_at, recorded_at, idempotency_key) VALUES (?, ?, ?, 'stage_changed', ?, ?, ?, 'user', 1, ?, ?, ?)"
    )
    .run(
      `evt_${at}`,
      USER,
      applicationId,
      from,
      to,
      JSON.stringify({ from, to }),
      at,
      at,
      `k${at}`
    );
}

async function commit(plan: { statements: D1PreparedStatement[] }) {
  await runBatch(db, plan.statements);
}

describe("application-state user moves (03 §5.1, D-21)", () => {
  it("applies a legal user move with an event and a change_log row", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, {
      stage: "saved",
      revision: 3,
    });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "user",
      source: "web",
      now: NOW,
      baseRevision: 3,
      stage: { to: "ready" },
    });
    expect(plan.stage?.result).toBe("applied");
    await commit(plan);
    expect(app(id)).toMatchObject({
      stage: "ready",
      revision: 4,
      stage_changed_at: NOW,
      last_change_source: "web",
    });
    const [event] = events(id);
    expect(event).toMatchObject({
      type: "stage_changed",
      from_value: "saved",
      to_value: "ready",
      applied_to_state: true,
    });
    expect(ApplicationEventRecordSchema.safeParse(event).success).toBe(true);
    const changes = rowsOf(t.jobsSqlite, "change_log", USER).map(
      (c) => `${c.entity}:${c.revision}`
    );
    expect(changes).toEqual(["application:4", "event:1"]);
  });

  it("refuses illegal moves (422), stale revisions (409) and moves during a submission (06 §2.3)", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, {
      stage: "accepted",
      revision: 2,
    });
    const caught = async (
      input: Parameters<typeof planApplicationTransition>[2]
    ) => {
      try {
        await planApplicationTransition(db, scope, input);
        return null;
      } catch (err) {
        return err instanceof ApiError
          ? { code: err.code, details: err.details }
          : err;
      }
    };
    const base = {
      applicationId: id,
      actor: "user" as const,
      source: "web" as const,
      now: NOW,
    };
    expect(
      await caught({ ...base, stage: { to: "interviewing" } })
    ).toMatchObject({ code: "invalid_transition" });
    const stale = await caught({
      ...base,
      baseRevision: 1,
      stage: { to: "saved" },
    });
    expect(stale).toMatchObject({ code: "revision_conflict" });
    expect(
      (stale as { details: { current: { id: string; revision: number } } })
        .details.current
    ).toMatchObject({
      id,
      revision: 2,
    });
    const other = seedApplication(t.jobsSqlite, USER, { stage: "ready" });
    seedTask(t.jobsSqlite, USER, {
      application_id: other.id,
      state: "running",
      submit_intent_at: NOW - 1,
    });
    expect(
      await caught({
        ...base,
        applicationId: other.id,
        stage: { to: "withdrawn" },
      })
    ).toMatchObject({
      code: "invalid_transition",
      details: { reason: "submission_in_flight" },
    });
    expect(
      await caught({
        ...base,
        applicationId: "app_missing",
        stage: { to: "ready" },
      })
    ).toMatchObject({
      code: "not_found",
    });
    // Another user's application is not found either (11 §6.1).
    const foreign = trustedScope("usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0Z", "script");
    await expect(
      planApplicationTransition(db, foreign, {
        ...base,
        stage: { to: "saved" },
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("aborts the whole batch when the row changed after planning", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, { stage: "saved" });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "user",
      source: "cli",
      now: NOW,
      stage: { to: "preparing" },
    });
    t.jobsSqlite
      .query("UPDATE applications SET revision = revision + 1 WHERE id = ?")
      .run(id);
    await expect(runBatch(db, plan.statements)).rejects.toBeInstanceOf(
      GuardFailedError
    );
    expect(events(id)).toHaveLength(0);
    expect(rowsOf(t.jobsSqlite, "change_log", USER)).toHaveLength(0);
    expect(app(id).stage).toBe("saved");
  });

  it("system moves that do not apply are skipped silently", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, { stage: "applied" });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "system",
      source: "system",
      now: NOW,
      stage: { to: "preparing" },
    });
    expect(plan.stage?.result).toBe("skipped");
    expect(plan.changed).toBe(false);
  });
});

describe("T20-07 automation precedence (20 §6.2)", () => {
  const automation = (taskId: string) => ({
    taskId,
    taskCreatedAt: TASK_CREATED,
    attemptId: "att_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
  });

  it("T20-07 an automation ready → applied after a user rejection leaves the stage, records the conflict and still moves the submission forward", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, {
      stage: "rejected",
      submission_status: "outcome_unknown",
      revision: 6,
    });
    userMove(id, "ready", "rejected", TASK_CREATED + 60_000);
    const task = seedTask(t.jobsSqlite, USER, {
      application_id: id,
      state: "outcome_unknown",
    });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "automation",
      source: "cli",
      now: NOW,
      stage: { to: "applied" },
      submission: {
        to: "submitted_verified",
        evidenceId: "evd_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
        via: "late_evidence",
      },
      automation: automation(task.id),
      actorDeviceId: "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
    });
    expect(plan.stage).toMatchObject({
      result: "conflict",
      reason: "user_stage_change_after_task",
    });
    expect(plan.submission).toMatchObject({
      result: "applied",
      from: "outcome_unknown",
      to: "submitted_verified",
    });
    await commit(plan);
    expect(app(id)).toMatchObject({
      stage: "rejected",
      submission_status: "submitted_verified",
      revision: 7,
    });
    expect(app(id).submitted_at).toBe(NOW);
    const recorded = events(id).slice(1);
    const stage = recorded.find((e) => e.type === "stage_changed");
    expect(stage).toMatchObject({
      applied_to_state: false,
      actor_kind: "automation",
      task_id: task.id,
    });
    const conflict = recorded.find((e) => e.type === "conflict_recorded");
    expect(conflict?.payload).toEqual({
      attempted: "applied",
      current: "rejected",
      reason: "user_stage_change_after_task",
    });
    const submission = recorded.find(
      (e) => e.type === "submission_status_changed"
    );
    expect(submission?.payload).toMatchObject({
      via: "late_evidence",
      evidence_id: "evd_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
    });
    for (const event of recorded) {
      expect(ApplicationEventRecordSchema.safeParse(event).success).toBe(true);
    }
  });

  it("T20-07 without a later user change the automation move applies", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, {
      stage: "ready",
      submission_status: "in_progress",
    });
    userMove(id, "preparing", "ready", TASK_CREATED - 60_000);
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "automation",
      source: "cli",
      now: NOW,
      stage: { to: "applied" },
      submission: { to: "submitted_unverified", method: "browser" },
      automation: automation("tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C0D"),
    });
    expect(plan.stage?.result).toBe("applied");
    await commit(plan);
    expect(app(id)).toMatchObject({
      stage: "applied",
      submission_status: "submitted_unverified",
      submission_method: "browser",
    });
  });

  it("T20-07 a current stage outside the task's expected set is a conflict", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, { stage: "saved" });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "automation",
      source: "cli",
      now: NOW,
      stage: { to: "applied" },
      automation: {
        ...automation("tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C0D"),
        expectedFrom: ["ready"],
      },
    });
    expect(plan.stage).toMatchObject({
      result: "conflict",
      reason: "unexpected_current_stage",
    });
    await commit(plan);
    expect(app(id).stage).toBe("saved");
    expect(app(id).revision).toBe(1);
  });
});

describe("T20-08 forward-only submission status (20 §6.2)", () => {
  it("T20-08 automation cannot lower submitted_verified; the attempt is recorded, not applied", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, {
      stage: "applied",
      submission_status: "submitted_verified",
      submitted_at: NOW - 5,
    });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "automation",
      source: "cli",
      now: NOW,
      submission: { to: "failed" },
      automation: {
        taskId: "tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
        taskCreatedAt: TASK_CREATED,
      },
    });
    expect(plan.submission?.result).toBe("ignored");
    expect(plan.changed).toBe(false);
    await commit(plan);
    expect(app(id)).toMatchObject({
      submission_status: "submitted_verified",
      revision: 1,
      submitted_at: NOW - 5,
    });
    expect(events(id)[0]).toMatchObject({
      type: "submission_status_changed",
      applied_to_state: false,
      to_value: "failed",
    });
  });

  it("T20-08 the system cannot move sideways (outcome_unknown → failed, submitted_unverified → outcome_unknown) but forward works", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, {
      submission_status: "outcome_unknown",
    });
    const sideways = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "system",
      source: "system",
      now: NOW,
      submission: { to: "failed" },
    });
    expect(sideways.submission?.result).toBe("ignored");
    const unconfirmed = seedApplication(t.jobsSqlite, USER, {
      submission_status: "submitted_unverified",
      submitted_at: NOW - 5,
    });
    const backwards = await planApplicationTransition(db, scope, {
      applicationId: unconfirmed.id,
      actor: "system",
      source: "system",
      now: NOW,
      submission: { to: "outcome_unknown" },
    });
    expect(backwards.submission?.result).toBe("ignored");
    const forward = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "system",
      source: "system",
      now: NOW,
      submission: { to: "submitted_verified" },
    });
    expect(forward.submission?.result).toBe("applied");
  });

  it("T20-08 a user deny may lower the status (explicit decision) and clears submitted_at", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, {
      stage: "applied",
      submission_status: "submitted_unverified",
      submitted_at: NOW - 9,
      revision: 4,
    });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "user",
      source: "web",
      now: NOW,
      baseRevision: 4,
      submission: { to: "failed" },
    });
    expect(plan.submission?.result).toBe("applied");
    await commit(plan);
    expect(app(id)).toMatchObject({
      submission_status: "failed",
      submitted_at: null,
      revision: 5,
    });
  });

  it("T20-08 the retry edge failed → in_progress is forward for automation", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, {
      submission_status: "failed",
    });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "automation",
      source: "cli",
      now: NOW,
      submission: { to: "in_progress" },
      automation: {
        taskId: "tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
        taskCreatedAt: TASK_CREATED,
      },
    });
    expect(plan.submission?.result).toBe("applied");
  });
});

// 20 §6.3 A, 19 §9.2, 13 §5 S-24: evidence of an unconfirmed submission
// (verdict `unverified`) resolves `outcome_unknown`; the stage still follows
// the precedence rule, and user decisions stay final.
describe("TFIX-EVIDENCE-EDGE outcome_unknown → submitted_unverified on evidence", () => {
  const automation = (taskId: string) => ({
    taskId,
    taskCreatedAt: TASK_CREATED,
    attemptId: "att_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
  });
  const EVIDENCE_ID = "evd_01JA6V8M3W8Z1T6Q4Y2B7K9C0E";

  it("TFIX-EVIDENCE-EDGE late evidence moves the status forward, never the stage against a user move", async () => {
    const { id } = seedApplication(t.jobsSqlite, USER, {
      stage: "withdrawn",
      submission_status: "outcome_unknown",
      revision: 6,
    });
    userMove(id, "ready", "withdrawn", TASK_CREATED + 60_000);
    const task = seedTask(t.jobsSqlite, USER, {
      application_id: id,
      state: "outcome_unknown",
    });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: id,
      actor: "automation",
      source: "cli",
      now: NOW,
      stage: { to: "applied", reason: "late_evidence" },
      submission: {
        to: "submitted_unverified",
        evidenceId: EVIDENCE_ID,
        method: "browser",
        submittedAt: NOW - 120_000,
        via: "late_evidence",
      },
      automation: automation(task.id),
      actorDeviceId: "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
    });
    expect(plan.stage).toMatchObject({
      result: "conflict",
      reason: "user_stage_change_after_task",
    });
    expect(plan.submission).toMatchObject({
      result: "applied",
      from: "outcome_unknown",
      to: "submitted_unverified",
    });
    await commit(plan);
    expect(app(id)).toMatchObject({
      stage: "withdrawn",
      submission_status: "submitted_unverified",
      submitted_at: NOW - 120_000,
      submission_method: "browser",
      revision: 7,
    });
    const submission = events(id).find(
      (e) => e.type === "submission_status_changed"
    );
    expect(submission).toMatchObject({
      applied_to_state: true,
      actor_kind: "automation",
      from_value: "outcome_unknown",
      to_value: "submitted_unverified",
      task_id: task.id,
      payload: { via: "late_evidence", evidence_id: EVIDENCE_ID },
    });
    expect(
      events(id).filter((e) => e.type === "conflict_recorded")
    ).toHaveLength(1);
  });

  it("TFIX-EVIDENCE-EDGE a user's “not submitted” stays final; verified evidence still lifts an unconfirmed status", async () => {
    const denied = seedApplication(t.jobsSqlite, USER, {
      stage: "ready",
      submission_status: "failed",
    });
    const plan = await planApplicationTransition(db, scope, {
      applicationId: denied.id,
      actor: "automation",
      source: "cli",
      now: NOW,
      submission: { to: "submitted_unverified", via: "late_evidence" },
      automation: automation("tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C0D"),
    });
    expect(plan.submission?.result).toBe("ignored");
    await commit(plan);
    expect(app(denied.id).submission_status).toBe("failed");
    const unconfirmed = seedApplication(t.jobsSqlite, USER, {
      stage: "applied",
      submission_status: "submitted_unverified",
      submitted_at: NOW - 9,
    });
    const verified = await planApplicationTransition(db, scope, {
      applicationId: unconfirmed.id,
      actor: "automation",
      source: "cli",
      now: NOW,
      submission: { to: "submitted_verified", via: "late_evidence" },
      automation: automation("tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C0D"),
    });
    expect(verified.submission?.result).toBe("applied");
  });
});
