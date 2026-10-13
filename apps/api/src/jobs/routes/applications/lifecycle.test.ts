import { beforeEach, describe, expect, it } from "bun:test";
import type { BoardResponse } from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { SubmissionEvidenceRecordSchema } from "@pilihpendidikan/jobs-contracts/records";
import {
  seedApplication,
  seedAttempt,
  seedTask,
} from "../../../../test/seed-jobs";
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

interface SubmissionBody {
  application: ApplicationRecord;
  evidence: SubmissionEvidenceRecord | null;
}

function submit(id: string, body: Record<string, unknown>) {
  return f.alice.post<SubmissionBody>(
    `/api/v1/applications/${id}/submission`,
    body
  );
}

/** A field of an error envelope (`error`, or `details.<key>`). */
function errorOf(body: unknown, detail?: string): unknown {
  const envelope = body as {
    details?: Record<string, unknown>;
    error?: string;
  };
  return detail === undefined ? envelope.error : envelope.details?.[detail];
}

function count(table: string, where: string, ...binds: string[]): number {
  return (
    f.t.jobsSqlite
      .query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
      .get(...binds) as { n: number }
  ).n;
}

describe("POST …/submission (05 §5, 03 §5.2, D-18)", () => {
  it("TB-SUBMISSION mark_applied: submitted_verified with user_attestation evidence and the card moves to applied", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "ready" });
    const appliedAt = f.clock.now() - 3_600_000;
    const res = await submit(app.id, {
      base_revision: 1,
      action: "mark_applied",
      applied_at: appliedAt,
      note: "Applied on the company site",
    });
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({
      stage: "applied",
      submission_status: "submitted_verified",
      submitted_at: appliedAt,
      submission_method: "manual",
      revision: 2,
    });
    expect(appRow(f.t, app.id)).toEqual(res.body.application);
    const evidence = res.body.evidence;
    expect(SubmissionEvidenceRecordSchema.safeParse(evidence).success).toBe(
      true
    );
    expect(evidence).toMatchObject({
      application_id: app.id,
      kind: "user_attestation",
      verdict: "verified",
      captured_at: appliedAt,
      signals: { source: "user_mark_applied", user_confirmed: true },
    });
    const events = eventRows(f.t, app.id);
    expect(events.map((e) => e.type)).toEqual([
      "created",
      "stage_changed",
      "submission_status_changed",
      "note_added",
    ]);
    expect(events[2]).toMatchObject({
      from_value: "not_started",
      to_value: "submitted_verified",
      payload: { evidence_id: evidence?.id },
    });
    expect(events[3].payload).toEqual({
      text: "Applied on the company site",
      kind: "submission_mark_applied",
    });
    const logged = changeRows(f.t, userIdOf(f.alice)).map((c) => c.entity);
    expect(logged).toContain("evidence");
    const board = await f.alice.get<BoardResponse>("/api/v1/board");
    const applied = board.body.columns.find((c) => c.stage === "applied");
    expect(applied?.cards.map((c) => c.id)).toEqual([app.id]);
  });

  it("TB-SUBMISSION confirm turns an unconfirmed submission into submitted_verified (stage stays)", async () => {
    const userId = userIdOf(f.alice);
    const app = seedApplication(f.t.jobsSqlite, userId, {
      stage: "applied",
      submission_status: "submitted_unverified",
      submitted_at: f.clock.now() - 1000,
      submission_method: "browser",
    });
    const res = await submit(app.id, { base_revision: 1, action: "confirm" });
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({
      stage: "applied",
      submission_status: "submitted_verified",
      submission_method: "browser",
      submitted_at: f.clock.now() - 1000,
    });
    expect(res.body.evidence).toMatchObject({
      kind: "user_attestation",
      verdict: "verified",
      signals: { source: "user_confirm" },
    });
  });

  it("TB-SUBMISSION confirm of an outcome_unknown card in ready also moves it to applied", async () => {
    const app = seedApplication(f.t.jobsSqlite, userIdOf(f.alice), {
      stage: "ready",
      submission_status: "outcome_unknown",
    });
    const res = await submit(app.id, {
      base_revision: 1,
      action: "confirm",
      method: "browser",
    });
    expect(res.body.application).toMatchObject({
      stage: "applied",
      submission_status: "submitted_verified",
      submission_method: "browser",
    });
  });

  it("TB-SUBMISSION deny: failed with a negative attestation; outcome_unknown tasks → failed; the stage stays", async () => {
    const userId = userIdOf(f.alice);
    const app = seedApplication(f.t.jobsSqlite, userId, {
      stage: "ready",
      submission_status: "outcome_unknown",
    });
    const task = seedTask(f.t.jobsSqlite, userId, {
      application_id: app.id,
      state: "outcome_unknown",
      submit_intent_at: f.clock.now() - 60_000,
    });
    const res = await submit(app.id, { base_revision: 1, action: "deny" });
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({
      stage: "ready",
      submission_status: "failed",
      submitted_at: null,
    });
    expect(res.body.evidence).toMatchObject({
      verdict: "negative",
      signals: { source: "user_deny", user_confirmed: false },
    });
    const taskRow = f.t.jobsSqlite
      .query(
        "SELECT state, revision, finished_at FROM automation_tasks WHERE id = ?"
      )
      .get(task.id) as { finished_at: number; revision: number; state: string };
    expect(taskRow).toEqual({
      state: "failed",
      revision: 2,
      finished_at: f.clock.now(),
    });
    expect(
      changeRows(f.t, userId).some(
        (c) => c.entity === "task" && c.entity_id === task.id
      )
    ).toBe(true);
    const finished = eventRows(f.t, app.id).find(
      (e) => e.type === "automation_task_finished"
    );
    expect(finished).toMatchObject({
      task_id: task.id,
      payload: { state: "failed" },
    });
  });

  it("TB-SUBMISSION refuses actions with nothing to decide (422) and repeats are no-ops", async () => {
    const app = await trackNew(f.t, f.alice);
    const confirm = await submit(app.id, {
      base_revision: 1,
      action: "confirm",
    });
    expect(confirm.status).toBe(422);
    expect(errorOf(confirm.body)).toBe("invalid_transition");
    const deny = await submit(app.id, { base_revision: 1, action: "deny" });
    expect(deny.status).toBe(422);
    const applied = await submit(app.id, {
      base_revision: 1,
      action: "mark_applied",
    });
    expect(applied.status).toBe(200);
    const before = changeRows(f.t, userIdOf(f.alice)).length;
    const again = await submit(app.id, { base_revision: 2, action: "confirm" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      evidence: null,
      application: { revision: 2 },
    });
    expect(changeRows(f.t, userIdOf(f.alice))).toHaveLength(before);
  });

  it("TB-SUBMISSION rejects an applied_at in the future and an in-flight submission", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "ready" });
    const future = await submit(app.id, {
      base_revision: 1,
      action: "mark_applied",
      applied_at: f.clock.now() + 3 * 86_400_000,
    });
    expect(future.status).toBe(400);
    seedTask(f.t.jobsSqlite, userIdOf(f.alice), {
      application_id: app.id,
      state: "running",
      lease_id: "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0F",
      submit_intent_at: f.clock.now(),
    });
    const inFlight = await submit(app.id, {
      base_revision: 1,
      action: "mark_applied",
    });
    expect(inFlight.status).toBe(422);
    expect(errorOf(inFlight.body, "reason")).toBe("submission_in_flight");
    expect(count("submission_evidence", "application_id = ?", app.id)).toBe(0);
  });
});

describe("DELETE /api/v1/applications/{app_id} (06 §8)", () => {
  it("T6-16 archive hides the card from the board but keeps it, its stage and its events (analytics)", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "ready" });
    await f.alice.post(`/api/v1/applications/${app.id}/events`, {
      type: "note_added",
      payload: { text: "recruiter called" },
      idempotency_key: "note-1",
    });
    const res = await f.alice.delete<{
      application: ApplicationRecord;
      archived: boolean;
      id: string;
      purged: boolean;
    }>(`/api/v1/applications/${app.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: app.id,
      archived: true,
      purged: false,
    });
    expect(res.body.application).toMatchObject({
      archived: true,
      stage: "ready",
      revision: 2,
    });
    const board = await f.alice.get<BoardResponse>("/api/v1/board");
    expect(board.body.columns.flatMap((c) => c.cards)).toHaveLength(0);
    expect(appRow(f.t, app.id)).toMatchObject({
      archived: true,
      stage: "ready",
    });
    expect(eventRows(f.t, app.id).map((e) => e.type)).toEqual([
      "created",
      "note_added",
    ]);
    const detail = await f.alice.get(`/api/v1/applications/${app.id}`);
    expect(detail.status).toBe(200);
    const again = await f.alice.delete(`/api/v1/applications/${app.id}`);
    expect(again.status).toBe(200);
    expect(appRow(f.t, app.id).revision).toBe(2);
  });

  it("TB-PURGE ?purge=1 removes the application and everything hanging off it, R2 objects included; the user_job stays dismissed", async () => {
    const userId = userIdOf(f.alice);
    const now = f.clock.now();
    const app = await trackNew(f.t, f.alice, { stage: "applied" });
    const keep = await trackNew(f.t, f.alice);
    const bobApp = await trackNew(f.t, f.bob);
    await f.alice.post(`/api/v1/applications/${app.id}/interviews`, {
      kind: "onsite",
    });
    await f.alice.post(`/api/v1/applications/${app.id}/offers`, {
      received_at: now,
    });
    const file = (kind: string, ext: string) => {
      const id = newId("fil");
      const key = `u/${userId}/${kind}/${id}${ext}`;
      f.t.jobsSqlite
        .query(
          "INSERT INTO files (id, user_id, kind, r2_key, content_type, size_bytes, sha256, status, created_at) VALUES (?, ?, ?, ?, 'application/pdf', 4, ?, 'ready', ?)"
        )
        .run(id, userId, kind, key, "0".repeat(64), now);
      return { id, key };
    };
    const cvPdf = file("cv_pdf", ".pdf");
    const shot = file("evidence_screenshot", ".png");
    const runLog = file("run_log", ".jsonl");
    const ownAttachment = file("attachment", ".pdf");
    const shared = file("attachment", ".pdf");
    for (const { key } of [cvPdf, shot, runLog, ownAttachment, shared]) {
      await f.t.env.JOBS_FILES.put(key, "%PDF");
    }
    const variant = newId("cvv");
    f.t.jobsSqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, application_id, base_cv_id, tailored_cv_id, template, status, file_id, created_at, updated_at) VALUES (?, ?, ?, 'rahma-cv', 'rahma-cv-t-7k2m9q4x1d', 'basic', 'draft', ?, ?, ?)"
      )
      .run(variant, userId, app.id, cvPdf.id, now, now);
    await f.t.env.CV_KV.put("cv:rahma-cv-t-7k2m9q4x1d", "{}");
    await f.t.env.CV_KV.put(
      "owner:cv:rahma-cv-t-7k2m9q4x1d",
      "alice@example.com"
    );
    f.t.jobsSqlite
      .query(
        "INSERT INTO submission_evidence (id, user_id, application_id, kind, verdict, signals, screenshot_file_id, captured_at, recorded_at) VALUES (?, ?, ?, 'browser_confirmation', 'verified', '{}', ?, ?, ?)"
      )
      .run(newId("evd"), userId, app.id, shot.id, now, now);
    const task = seedTask(f.t.jobsSqlite, userId, {
      application_id: app.id,
      state: "submitted",
      lease_id: "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0G",
    });
    seedAttempt(f.t.jobsSqlite, userId, {
      task_id: task.id,
      lease_id: "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0G",
      log_file_id: runLog.id,
    });
    const insertEmail = (applicationId: string, files: string[]) =>
      f.t.jobsSqlite
        .query(
          "INSERT INTO email_applications (id, user_id, application_id, to_address, subject, body_text, attachment_file_ids, delivery, status, created_at, updated_at) VALUES (?, ?, ?, 'hr@example.com', 'Hi', 'Hello', ?, 'local_handoff', 'draft', ?, ?)"
        )
        .run(
          newId("eml"),
          userId,
          applicationId,
          JSON.stringify(files),
          now,
          now
        );
    insertEmail(app.id, [ownAttachment.id, shared.id]);
    insertEmail(keep.id, [shared.id]);
    f.t.jobsSqlite
      .query(
        "INSERT INTO approvals (id, user_id, kind, task_id, application_id, payload, payload_hash, state, expires_at, created_at) VALUES (?, ?, 'submit', ?, ?, '{}', ?, 'approved', ?, ?)"
      )
      .run(
        newId("apr"),
        userId,
        task.id,
        app.id,
        "c".repeat(64),
        now + 1000,
        now
      );
    const before = changeRows(f.t, userId).length;
    f.t.jobsSqlite.exec("PRAGMA foreign_keys = ON");

    const res = await f.alice.delete(`/api/v1/applications/${app.id}`, {
      query: { purge: "1" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: app.id,
      archived: false,
      purged: true,
      application: null,
    });
    for (const table of [
      "applications",
      "application_events",
      "interviews",
      "offers",
      "cv_variants",
      "submission_evidence",
      "automation_tasks",
      "email_applications",
    ]) {
      const column = table === "applications" ? "id" : "application_id";
      expect(count(table, `${column} = ?`, app.id)).toBe(0);
    }
    expect(count("automation_attempts", "task_id = ?", task.id)).toBe(0);
    expect(count("approvals", "task_id = ?", task.id)).toBe(0);
    for (const gone of [cvPdf, shot, runLog, ownAttachment]) {
      expect(count("files", "id = ?", gone.id)).toBe(0);
      expect(f.t.r2.objects.has(gone.key)).toBe(false);
    }
    expect(count("files", "id = ?", shared.id)).toBe(1);
    expect(f.t.r2.objects.has(shared.key)).toBe(true);
    expect(await f.t.env.CV_KV.get("cv:rahma-cv-t-7k2m9q4x1d")).toBeNull();
    expect(
      await f.t.env.CV_KV.get("owner:cv:rahma-cv-t-7k2m9q4x1d")
    ).toBeNull();
    const userJob = f.t.jobsSqlite
      .query("SELECT inbox_state, revision FROM user_jobs WHERE id = ?")
      .get(app.user_job_id) as { inbox_state: string; revision: number };
    expect(userJob).toEqual({ inbox_state: "dismissed", revision: 3 });
    const logged = changeRows(f.t, userId).slice(before);
    const deletes = new Set(
      logged.filter((c) => c.op === "delete").map((c) => c.entity)
    );
    for (const entity of [
      "application",
      "event",
      "interview",
      "offer",
      "cv_variant",
      "evidence",
      "task",
      "attempt",
      "approval",
      "email",
      "file",
    ]) {
      expect(deletes.has(entity)).toBe(true);
    }
    expect(logged.at(-1)).toMatchObject({
      entity: "user_job",
      entity_id: app.user_job_id,
      op: "upsert",
    });
    expect(appRow(f.t, keep.id).revision).toBe(1);
    expect(appRow(f.t, bobApp.id).revision).toBe(1);
    const rollups = f.t.queue.sent
      .map((m) => m.body)
      .filter((body) => body.type === "rollup_user");
    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({
      user_id: userId,
      days: ["2026-10-12"],
    });
    expect((await f.alice.get(`/api/v1/applications/${app.id}`)).status).toBe(
      404
    );
  });

  it("TB-PURGE is refused while an apply task is live and for MCP credentials", async () => {
    const app = await trackNew(f.t, f.alice, { stage: "ready" });
    const task = seedTask(f.t.jobsSqlite, userIdOf(f.alice), {
      application_id: app.id,
      state: "queued",
    });
    const live = await f.alice.delete(`/api/v1/applications/${app.id}`, {
      query: { purge: "1" },
    });
    expect(live.status).toBe(422);
    expect(live.body.details).toMatchObject({
      reason: "task_live",
      task_id: task.id,
    });
    f.t.jobsSqlite
      .query(
        "UPDATE automation_tasks SET state = 'running', lease_id = 'lse_x', submit_intent_at = ? WHERE id = ?"
      )
      .run(f.clock.now(), task.id);
    const inFlight = await f.alice.delete(`/api/v1/applications/${app.id}`, {
      query: { purge: "1" },
    });
    expect(errorOf(inFlight.body, "reason")).toBe("submission_in_flight");
    f.t.jobsSqlite
      .query("UPDATE automation_tasks SET state = 'submitted' WHERE id = ?")
      .run(task.id);
    const mcp = await f.client.mcpOAuthToken("alice@example.com");
    const viaMcp = await mcp.delete(`/api/v1/applications/${app.id}`, {
      query: { purge: "1" },
    });
    expect(viaMcp.status).toBe(422);
    expect(viaMcp.body.error).toBe("policy_violation");
    expect(count("applications", "id = ?", app.id)).toBe(1);
    const archivedViaMcp = await mcp.delete(`/api/v1/applications/${app.id}`);
    expect(archivedViaMcp.status).toBe(200);
    expect(appRow(f.t, app.id)).toMatchObject({
      archived: true,
      last_change_source: "mcp",
    });
  });

  it("TB-PURGE a purged job can be tracked again later; a replayed purge answers the stored response", async () => {
    const app = await trackNew(f.t, f.alice);
    const first = await f.alice.delete(`/api/v1/applications/${app.id}`, {
      query: { purge: "1" },
      idempotencyKey: "purge-1",
    });
    expect(first.status).toBe(200);
    const replay = await f.alice.delete(`/api/v1/applications/${app.id}`, {
      query: { purge: "1" },
      idempotencyKey: "purge-1",
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    const again = await f.alice.delete(`/api/v1/applications/${app.id}`, {
      query: { purge: "1" },
    });
    expect(again.status).toBe(404);
    const retrack = await f.alice.post<{ application: ApplicationRecord }>(
      "/api/v1/applications",
      { user_job_id: app.user_job_id }
    );
    expect(retrack.status).toBe(201);
    expect(retrack.body.application.id).not.toBe(app.id);
  });
});
