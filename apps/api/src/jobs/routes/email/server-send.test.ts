import { describe, expect, it } from "bun:test";
import { createFakeClock, createV1Client } from "../../../../test/fakes";
import type { EmailFixture } from "./support.test";
import {
  approve,
  DAY,
  draft,
  insert,
  NOW,
  rows,
  seedEmailApplication,
  setupEmail,
} from "./support.test";

const SEND = { delivery: "server_send" as const };

async function draftAndApprove(
  f: EmailFixture,
  appId: string,
  to: string,
  extra: Record<string, unknown> = {}
) {
  const created = await draft(f.alice, appId, { ...SEND, to, ...extra });
  expect(created.status).toBe(201);
  return await approve(f.alice, created.body.email.id, {
    payload_hash: created.body.review.payload_hash,
  });
}

/** `n` emails already sent `ago` ms before NOW to `to`. */
function seedSent(f: EmailFixture, n: number, ago: number, to: string): void {
  for (let i = 0; i < n; i++) {
    insert(f.t, "email_applications", {
      id: `eml_01JA6V8M3W8Z1T6Q4Y2B7K${String(i).padStart(4, "0")}`.slice(
        0,
        30
      ),
      user_id: f.alice.userId as string,
      application_id: f.app.id,
      to_address: to,
      subject: "s",
      body_text: "b",
      attachment_file_ids: "[]",
      delivery: "server_send",
      status: "sent",
      sent_at: NOW - ago,
      created_at: NOW - ago,
      updated_at: NOW - ago,
    });
  }
}

function sentMessages(f: EmailFixture): Record<string, unknown>[] {
  return f.t.sent as unknown as Record<string, unknown>[];
}

describe("server_send (09 §6.2, §7, §8)", () => {
  it("T9-07 From is never the user; Reply-To/Cc = users.email; evidence, status and stage in one batch", async () => {
    const f = await setupEmail({ serverSend: true });
    // A typed contact.email fact must never be used as an address.
    insert(f.t, "applicant_facts", {
      id: "fct_01JA6V8M3W8Z1T6Q4Y2B7K9C0E",
      user_id: f.alice.userId as string,
      key: "contact.email",
      value: JSON.stringify("spoof@attacker.example"),
      source: "user_entered",
      created_at: 0,
      updated_at: 0,
    });
    const created = await draft(f.alice, f.app.id, {
      ...SEND,
      to: "hr@acme.co.id",
      attachment_file_ids: [f.cvFile.id],
    });
    expect(created.body.approval.payload).toMatchObject({
      cc: ["rina@example.com"],
    });
    const res = await approve(f.alice, created.body.email.id, {
      payload_hash: created.body.review.payload_hash,
    });
    expect(res.status).toBe(200);
    const [message] = sentMessages(f);
    expect(message).toMatchObject({
      from: {
        email: "applications@pilihpendidikan.com",
        name: "Rina Wijaya via pilihpendidikan",
      },
      to: "hr@acme.co.id",
      cc: "rina@example.com",
      replyTo: "rina@example.com",
      subject: "Application for Backend Engineer — Rina Wijaya",
    });
    expect(JSON.stringify(message?.from)).not.toContain("rina@example.com");
    expect(JSON.stringify(message)).not.toContain("spoof@attacker.example");
    expect(message?.html).toBeUndefined();
    expect(message).not.toHaveProperty("bcc");
    const attachments = message?.attachments as Record<string, unknown>[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      disposition: "attachment",
      filename: "Rina CV.pdf",
      type: "application/pdf",
    });
    expect(res.body).toMatchObject({
      email: { status: "sent", provider_message_id: "test-1", sent_at: NOW },
      approval: {
        state: "approved",
        payload_hash: created.body.review.payload_hash,
      },
      application: {
        stage: "applied",
        submission_status: "submitted_verified",
        submission_method: "email",
      },
      evidence: {
        kind: "email_sent",
        verdict: "verified",
        signals: { provider_accepted: true, message_id: "test-1" },
      },
      delivery: { ok: true },
    });
    const events = rows(
      f.t,
      "SELECT type, actor_kind, to_value FROM application_events WHERE application_id = ? ORDER BY rowid",
      f.app.id
    );
    expect(events).toEqual([
      { type: "approval_requested", actor_kind: "user", to_value: null },
      { type: "approval_decided", actor_kind: "user", to_value: null },
      { type: "email_sent", actor_kind: "system", to_value: null },
      { type: "stage_changed", actor_kind: "user", to_value: "applied" },
      {
        type: "submission_status_changed",
        actor_kind: "user",
        to_value: "submitted_verified",
      },
    ]);
    // Everything of the send shares one batch: all rows stamped `now`.
    const evidence = rows(
      f.t,
      "SELECT recorded_at FROM submission_evidence WHERE application_id = ?",
      f.app.id
    );
    expect(evidence).toEqual([{ recorded_at: NOW }]);
    // A sent email cannot be approved (sent) again.
    const again = await approve(f.alice, created.body.email.id, {
      payload_hash: created.body.review.payload_hash,
    });
    expect(again.status).toBe(409);
    expect(sentMessages(f)).toHaveLength(1);
  });

  it("T9-07 a provider failure records `failed` without a stage change; a retry needs no new approval", async () => {
    const f = await setupEmail({ serverSend: true });
    let fail = true;
    const original = f.t.env.EMAIL;
    f.t.env.EMAIL = {
      send(message: unknown) {
        if (fail) {
          return Promise.reject(new Error("provider down"));
        }
        return original.send(message as never);
      },
    } as SendEmail;
    const created = await draft(f.alice, f.app.id, {
      ...SEND,
      to: "hr@acme.co.id",
    });
    const hash = created.body.review.payload_hash;
    const failed = await approve(f.alice, created.body.email.id, {
      payload_hash: hash,
    });
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({
      email: { status: "failed", sent_at: null },
      application: { stage: "ready", submission_status: "failed" },
      evidence: null,
      delivery: { ok: false },
    });
    fail = false;
    const retried = await approve(f.alice, created.body.email.id, {
      payload_hash: hash,
    });
    expect(retried.body).toMatchObject({
      email: { status: "sent" },
      approval: { id: (failed.body.approval as { id: string }).id },
      application: {
        stage: "applied",
        submission_status: "submitted_verified",
      },
    });
    const approvals = rows(
      f.t,
      "SELECT state FROM approvals WHERE application_id = ?",
      f.app.id
    );
    expect(approvals).toEqual([{ state: "approved" }]);
  });

  it("S-26 server send with the fake binding; the 11th send of the day is refused", async () => {
    const f = await setupEmail({ serverSend: true });
    const userId = f.alice.userId as string;
    for (let i = 0; i < 10; i++) {
      const app = seedEmailApplication(f.t, userId, {
        company_domain: `employer${i}.co.id`,
      });
      const res = await draftAndApprove(f, app.id, `hr@employer${i}.co.id`);
      expect(res.status).toBe(200);
      expect((res.body.email as { status: string }).status).toBe("sent");
    }
    expect(sentMessages(f)).toHaveLength(10);
    const eleventh = seedEmailApplication(f.t, userId, {
      company_domain: "employer10.co.id",
    });
    const refused = await draftAndApprove(
      f,
      eleventh.id,
      "hr@employer10.co.id"
    );
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      error: "policy_violation",
      details: { reason: "daily_limit", limit: 10 },
    });
    expect(sentMessages(f)).toHaveLength(10);
    // The refused draft stays a draft; the application is untouched.
    const app = rows(
      f.t,
      "SELECT stage, submission_status FROM applications WHERE id = ?",
      eleventh.id
    );
    expect(app).toEqual([{ stage: "ready", submission_status: "not_started" }]);
    // A day later the window has room again.
    const later = createV1Client(f.t, {
      clock: createFakeClock(NOW + DAY + 1),
    });
    const session = await later.browserSession("rina@example.com");
    const pending = rows(
      f.t,
      "SELECT id, payload_hash FROM approvals WHERE application_id = ?",
      eleventh.id
    )[0] as { id: string; payload_hash: string };
    const email = rows(
      f.t,
      "SELECT id FROM email_applications WHERE application_id = ?",
      eleventh.id
    )[0] as { id: string };
    const next = await approve(session, email.id, {
      payload_hash: pending.payload_hash,
    });
    expect(next.status).toBe(200);
    expect(sentMessages(f)).toHaveLength(11);
  });

  it("TE-LIMITS 50 per 30 days, 3 per recipient domain, the 7-day new-account block and the operator flag", async () => {
    const f = await setupEmail({ serverSend: true });
    const userId = f.alice.userId as string;
    // 3 to acme.co.id within 30 days: a 4th (even to a subdomain) is refused.
    seedSent(f, 3, 10 * DAY, "hr@acme.co.id");
    const domain = await draftAndApprove(
      f,
      f.app.id,
      "talent@careers.acme.co.id"
    );
    expect(domain.status).toBe(422);
    expect((domain.body.details as Record<string, unknown>).reason).toBe(
      "domain_limit"
    );
    // 50 within 30 days (older than a day): monthly limit.
    f.t.jobsSqlite.query("DELETE FROM email_applications").run();
    for (let i = 0; i < 50; i++) {
      insert(f.t, "email_applications", {
        id: `eml_01JA6V8M3W8Z1T6Q4Y2B${String(i).padStart(6, "0")}`,
        user_id: userId,
        application_id: f.app.id,
        to_address: `hr@company${i}.com`,
        subject: "s",
        body_text: "b",
        attachment_file_ids: "[]",
        delivery: "server_send",
        status: "sent",
        sent_at: NOW - 5 * DAY,
        created_at: NOW - 5 * DAY,
        updated_at: NOW - 5 * DAY,
      });
    }
    const monthly = await draftAndApprove(f, f.app.id, "hr@acme.co.id");
    expect((monthly.body.details as Record<string, unknown>).reason).toBe(
      "monthly_limit"
    );
    f.t.jobsSqlite.query("DELETE FROM email_applications").run();
    // A 3-day-old account cannot send yet.
    f.t.sqlite
      .query("UPDATE users SET created_at = ? WHERE id = ?")
      .run(NOW - 3 * DAY, userId);
    const young = await draftAndApprove(f, f.app.id, "hr@acme.co.id");
    expect(young.body).toMatchObject({
      error: "policy_violation",
      details: { reason: "new_account", available_at: NOW + 4 * DAY },
    });
    expect(sentMessages(f)).toHaveLength(0);
    // The operator kill switch stops approvals of existing drafts too.
    f.t.sqlite
      .query("UPDATE users SET created_at = ? WHERE id = ?")
      .run(NOW - 30 * DAY, userId);
    const created = await draft(f.alice, f.app.id, {
      ...SEND,
      to: "hr@acme.co.id",
    });
    await f.t.setFlag("JOBS_EMAIL_SERVER_SEND_ENABLED", false);
    const off = await approve(f.alice, created.body.email.id, {
      payload_hash: created.body.review.payload_hash,
    });
    expect(off.status).toBe(422);
    expect((off.body.details as Record<string, unknown>).reason).toBe(
      "server_send_disabled"
    );
    expect(sentMessages(f)).toHaveLength(0);
  });

  it("TE-LIMITS drafts count toward the task-create limit (05 §1.9)", async () => {
    const f = await setupEmail();
    const limited = createV1Client(f.t, { clock: createFakeClock(NOW) });
    const session = await limited.browserSession("rina@example.com");
    let last = 0;
    for (let i = 0; i < 201; i++) {
      const res = await draft(session, f.app.id, {
        delivery: "local_handoff",
        to: "hr@acme.co.id",
        attachment_file_ids: [],
      });
      last = res.status;
      if (res.status === 429) {
        break;
      }
    }
    expect(last).toBe(429);
  });

  it("TE-ATTACHMENTS the R2 object is re-hashed against files.sha256 before sending", async () => {
    const f = await setupEmail({ serverSend: true });
    const created = await draft(f.alice, f.app.id, {
      ...SEND,
      to: "hr@acme.co.id",
      attachment_file_ids: [f.cvFile.id],
    });
    // The stored bytes are tampered with after the draft.
    const stored = [...f.t.r2.objects.values()].find((object) =>
      object.key.includes(f.cvFile.id)
    );
    expect(stored).toBeDefined();
    (stored as { body: Uint8Array }).body = new TextEncoder().encode(
      "%PDF-tampered"
    );
    const res = await approve(f.alice, created.body.email.id, {
      payload_hash: created.body.review.payload_hash,
    });
    expect(res.status).toBe(422);
    expect((res.body.details as Record<string, unknown>).reason).toBe(
      "attachment_integrity"
    );
    expect(sentMessages(f)).toHaveLength(0);
    // A missing object is refused the same way.
    f.t.r2.objects.clear();
    const missing = await approve(f.alice, created.body.email.id, {
      payload_hash: created.body.review.payload_hash,
    });
    expect((missing.body.details as Record<string, unknown>).reason).toBe(
      "attachment_unavailable"
    );
    const email = rows(
      f.t,
      "SELECT status FROM email_applications WHERE id = ?",
      created.body.email.id
    );
    expect(email).toEqual([{ status: "draft" }]);
  });
});
