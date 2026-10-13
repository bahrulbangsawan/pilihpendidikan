import { beforeEach, describe, expect, it } from "bun:test";
import {
  ApprovalRecordSchema,
  EmailApplicationRecordSchema,
  SubmissionEvidenceRecordSchema,
} from "@pilihpendidikan/jobs-contracts/records";
import { flattenCvBullets } from "@pilihpendidikan/cv-engine";
import { getAiProvider } from "../../ai/provider";
import { jobsDb } from "../../repo/core/db";
import { decideApproval } from "../../services/automation/index";
import { sampleCv } from "../../services/cv/tailoring/fixtures";
import { createFakeClock, createV1Client } from "../../../../test/fakes";
import type { EmailFixture } from "./support.test";
import {
  approve,
  draft,
  handOff,
  NOW,
  rows,
  seedEmailApplication,
  seedFile,
  setupEmail,
} from "./support.test";

let f: EmailFixture;

beforeEach(async () => {
  f = await setupEmail();
});

const LOCAL = { delivery: "local_handoff" as const };

describe("POST /api/v1/applications/{app_id}/emails (09 §5)", () => {
  it("renders the template from facts and the posting, attaches the given CV and opens a pending approval", async () => {
    const res = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      attachment_file_ids: [f.cvFile.id],
    });
    expect(res.status).toBe(201);
    const { email, approval, review } = res.body;
    expect(EmailApplicationRecordSchema.safeParse(email).success).toBe(true);
    expect(ApprovalRecordSchema.safeParse(approval).success).toBe(true);
    expect(email).toMatchObject({
      status: "draft",
      to_address: "hr@acme.co.id",
      subject: "Application for Backend Engineer — Rina Wijaya",
      attachment_file_ids: [f.cvFile.id],
      delivery: "local_handoff",
    });
    expect(email.body_text).toContain(
      "position at Acme Indonesia (ref. BE-42)."
    );
    expect(email.body_text).toContain("Dear Hiring Team,");
    expect(email.body_text).not.toContain("undefined");
    expect(email.body_text).toEndWith("Rina Wijaya\n+62 812 0000 0000");
    expect(approval).toMatchObject({
      kind: "submit",
      state: "pending",
      payload_hash: review.payload_hash,
      payload: {
        type: "email_submit",
        email_application_id: email.id,
        cc: [],
        attachments: [{ file_id: f.cvFile.id, sha256: f.cvFile.sha256 }],
        ai_drafted: false,
        recipient_confirmed: false,
      },
    });
    expect(review).toMatchObject({
      locale: "en",
      templated: { subject: true, body: true },
      warnings: [],
    });
    const events = rows(
      f.t,
      "SELECT type FROM application_events WHERE application_id = ?",
      f.app.id
    );
    expect(events.map((e) => e.type)).toEqual(["approval_requested"]);
  });

  it("uses the posting's mailto address and subject, the Indonesian template and the attached CV variant by default", async () => {
    const userId = f.alice.userId as string;
    const app = seedEmailApplication(f.t, userId, {
      apply_url: "mailto:Karir@Acme.co.id?subject=Lamaran%20BE-42",
    });
    f.t.jobsSqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, application_id, base_cv_id, template, status, file_id, created_at, updated_at) VALUES ('cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D', ?, ?, 'cv-1', 'harvard', 'approved', ?, 0, 0)"
      )
      .run(userId, app.id, f.cvFile.id);
    f.t.jobsSqlite
      .query("UPDATE applications SET cv_variant_id = ? WHERE id = ?")
      .run("cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D", app.id);
    const res = await draft(f.alice, app.id, { ...LOCAL, locale: "id" });
    expect(res.status).toBe(201);
    expect(res.body.email).toMatchObject({
      to_address: "Karir@acme.co.id",
      subject: "Lamaran BE-42",
      attachment_file_ids: [f.cvFile.id],
    });
    expect(res.body.email.body_text).toContain("Yth. Tim Rekrutmen");
    expect(res.body.review.templated).toEqual({ subject: false, body: true });
    // No recipient and no mailto link: 400.
    const missing = await draft(f.alice, f.app.id, LOCAL);
    expect(missing.status).toBe(400);
  });

  it("validates the recipient, the body size and the delivery flag", async () => {
    const invalid = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "HR <hr@acme.co.id>",
    });
    expect(invalid.status).toBe(400);
    const tooBig = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      subject: "Hi",
      body_text: "€".repeat(7000),
    });
    expect(tooBig.status).toBe(400);
    const serverSend = await draft(f.alice, f.app.id, {
      to: "hr@acme.co.id",
      delivery: "server_send",
    });
    expect(serverSend.status).toBe(422);
    expect(serverSend.body).toMatchObject({
      error: "policy_violation",
      details: { reason: "server_send_disabled" },
    });
    // Another user's application is not found.
    const bob = await f.client.browserSession("bob@example.com");
    const foreign = await draft(bob, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
    });
    expect(foreign.status).toBe(404);
  });

  it("TE-ATTACHMENTS drafts refuse foreign, oversized, non-PDF/DOCX and too many attachments", async () => {
    const userId = f.alice.userId as string;
    const bob = await f.client.browserSession("bob@example.com");
    const bobFile = await seedFile(f.t, bob.userId as string);
    const png = await seedFile(f.t, userId, {
      kind: "attachment",
      contentType: "image/png",
    });
    const big = await Promise.all(
      [1, 2, 3].map(() =>
        seedFile(f.t, userId, { kind: "attachment", size: 4 * 1_048_576 })
      )
    );
    const cases: [string[], number, string | undefined][] = [
      [[bobFile.id], 422, "attachment_unavailable"],
      [[png.id], 422, "attachment_type"],
      [big.map((file) => file.id), 422, "attachments_too_large"],
      [
        await Promise.all(
          [1, 2, 3, 4, 5, 6].map(async () => (await seedFile(f.t, userId)).id)
        ),
        400,
        undefined,
      ],
    ];
    for (const [ids, status, reason] of cases) {
      const res = await draft(f.alice, f.app.id, {
        ...LOCAL,
        to: "hr@acme.co.id",
        attachment_file_ids: ids,
      });
      expect(res.status).toBe(status);
      if (reason) {
        expect(
          (res.body as { details?: { reason?: string } }).details?.reason
        ).toBe(reason);
      }
    }
    const ok = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      attachment_file_ids: [],
    });
    expect(ok.body.review.warnings).toEqual(["no_attachment"]);
  });

  it("a newer draft supersedes the pending approval of the older one", async () => {
    const first = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
    });
    const second = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "talent@acme.co.id",
    });
    expect(second.status).toBe(201);
    const states = rows(
      f.t,
      "SELECT id, state FROM approvals WHERE application_id = ? ORDER BY rowid",
      f.app.id
    );
    expect(states.map((row) => row.state)).toEqual(["expired", "pending"]);
    expect(states[0]?.id).toBe(first.body.approval.id);
  });

  it("the optional AI paragraph is drafted, validated and recorded (09 §5.2)", async () => {
    const userId = f.alice.userId as string;
    f.t.jobsSqlite
      .query(
        "INSERT INTO user_settings (user_id, ai_consent_at, updated_at) VALUES (?, ?, 0)"
      )
      .run(userId, NOW - 1000);
    const cv = sampleCv();
    await f.t.kv.CV_KV.kv.put("cv:rina-cv", JSON.stringify(cv));
    await f.t.kv.CV_KV.kv.put("owner:cv:rina-cv", "rina@example.com");
    f.t.jobsSqlite
      .query("UPDATE applications SET base_cv_id = 'rina-cv' WHERE id = ?")
      .run(f.app.id);
    const res = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      draft_paragraph: true,
      recipient_name: "Ibu Sari",
    });
    expect(res.status).toBe(201);
    const review = res.body.review as unknown as Record<string, unknown> & {
      ai_paragraph: Record<string, unknown>;
    };
    expect(review.ai_paragraph.status).toBe("drafted");
    const firstLine = flattenCvBullets(cv).find(
      (bullet) => bullet.section !== "summary"
    )?.text as string;
    expect(res.body.email.body_text).toContain(firstLine);
    expect(res.body.approval.payload).toMatchObject({ ai_drafted: true });
    const usage = rows(
      f.t,
      "SELECT purpose, calls FROM ai_usage WHERE user_id = ?",
      userId
    );
    expect(usage).toEqual([{ purpose: "email_draft", calls: 1 }]);
    expect(res.body.email.body_text).toContain("Dear Ibu Sari,");

    // A fabricating model: no paragraph, the user is told, spend recorded.
    const liar = createV1Client(f.t, {
      clock: createFakeClock(NOW),
      ai: (env) =>
        getAiProvider(env, {
          fake: {
            structured: {
              email_paragraph: {
                paragraph: "I hold a PhD from Harvard and 12 years of Rust.",
                source_bullet_ids: [],
                source_fact_keys: [],
              },
            },
          },
        }),
    });
    const session = await liar.browserSession("rina@example.com");
    f.t.jobsSqlite
      .query(
        "INSERT INTO applicant_facts (id, user_id, key, value, source, created_at, updated_at) VALUES ('fct_01JA6V8M3W8Z1T6Q4Y2B7K9C0D', ?, 'skills.extra', '[\"Go\"]', 'user_entered', 0, 0)"
      )
      .run(userId);
    const rejected = await draft(session, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      draft_paragraph: true,
    });
    expect(rejected.status).toBe(201);
    expect(
      (rejected.body.review as unknown as { ai_paragraph: { status: string } })
        .ai_paragraph.status
    ).toBe("rejected");
    expect(rejected.body.email.body_text).not.toContain("Harvard");
    expect(rejected.body.review.warnings).toContain("ai_paragraph_rejected");
    // Without consent no call is made.
    f.t.jobsSqlite
      .query("UPDATE user_settings SET ai_consent_at = NULL WHERE user_id = ?")
      .run(userId);
    const noConsent = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      draft_paragraph: true,
    });
    expect(
      (noConsent.body.review as unknown as { ai_paragraph: { status: string } })
        .ai_paragraph.status
    ).toBe("consent_required");
  });
});

describe("email approval and local hand-off (09 §4, §6.1)", () => {
  it("S-25 local hand-off: draft → approve → handed-off → applied with unverified evidence", async () => {
    const created = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      attachment_file_ids: [f.cvFile.id],
    });
    const emailId = created.body.email.id;
    const approved = await approve(f.alice, emailId, {
      payload_hash: created.body.review.payload_hash,
    });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      email: { status: "approved", approved_at: NOW, revision: 2 },
      approval: {
        id: created.body.approval.id,
        state: "approved",
        decided_via: "web",
        decided_by_user_id: f.alice.userId,
      },
      application: { submission_status: "in_progress", stage: "ready" },
      evidence: null,
    });
    const sentAt = NOW - 60_000;
    const handed = await handOff(f.alice, emailId, {
      sent_confirmed: true,
      sent_at: sentAt,
    });
    expect(handed.status).toBe(200);
    expect(handed.body).toMatchObject({
      email: { status: "handed_off", sent_at: NOW },
      application: {
        stage: "applied",
        submission_status: "submitted_unverified",
        submission_method: "email",
      },
      evidence: {
        kind: "email_sent",
        verdict: "unverified",
        signals: { method: "local_handoff", user_confirmed: true },
        form_hash: created.body.review.payload_hash,
      },
    });
    expect(
      SubmissionEvidenceRecordSchema.safeParse(handed.body.evidence).success
    ).toBe(true);
    const events = rows(
      f.t,
      "SELECT type, actor_kind, to_value FROM application_events WHERE application_id = ? ORDER BY rowid",
      f.app.id
    );
    expect(events).toEqual([
      { type: "approval_requested", actor_kind: "user", to_value: null },
      { type: "approval_decided", actor_kind: "user", to_value: null },
      {
        type: "submission_status_changed",
        actor_kind: "user",
        to_value: "in_progress",
      },
      { type: "email_sent", actor_kind: "user", to_value: null },
      { type: "stage_changed", actor_kind: "user", to_value: "applied" },
      {
        type: "submission_status_changed",
        actor_kind: "user",
        to_value: "submitted_unverified",
      },
    ]);
    // Once handed off, it cannot be reported again.
    const again = await handOff(f.alice, emailId, { sent_confirmed: true });
    expect(again.status).toBe(409);
  });

  it("S-25 'not sent' keeps the email approved, fails the submission, and re-approval restarts it", async () => {
    const created = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
    });
    const emailId = created.body.email.id;
    const hash = created.body.review.payload_hash;
    await approve(f.alice, emailId, { payload_hash: hash });
    const notSent = await handOff(f.alice, emailId, { sent_confirmed: false });
    expect(notSent.status).toBe(200);
    expect(notSent.body).toMatchObject({
      email: { status: "approved" },
      application: { submission_status: "failed", stage: "ready" },
      evidence: null,
    });
    const again = await approve(f.alice, emailId, { payload_hash: hash });
    expect(again.body).toMatchObject({
      email: { status: "approved" },
      approval: { id: created.body.approval.id },
      application: { submission_status: "in_progress" },
    });
    const sent = await handOff(f.alice, emailId, { sent_confirmed: true });
    expect(sent.body).toMatchObject({
      application: {
        stage: "applied",
        submission_status: "submitted_unverified",
      },
    });
  });

  it("T9-02 approval binding: stale hashes are refused and any change after approval needs a new approval", async () => {
    const created = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      attachment_file_ids: [f.cvFile.id],
    });
    const emailId = created.body.email.id;
    const hash = created.body.review.payload_hash;
    const stale = await approve(f.alice, emailId, {
      payload_hash: "0".repeat(64),
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: "revision_conflict",
      details: { reason: "payload_hash_mismatch", payload_hash: hash },
    });
    // Hand-off before any approval.
    const early = await handOff(f.alice, emailId, { sent_confirmed: true });
    expect(early.status).toBe(409);
    expect((early.body.details as Record<string, unknown>).reason).toBe(
      "not_approved"
    );
    await approve(f.alice, emailId, { payload_hash: hash });
    for (const [column, value] of [
      ["subject", "Changed subject"],
      ["body_text", "Changed body"],
      ["to_address", "other@acme.co.id"],
    ] as const) {
      f.t.jobsSqlite
        .query(`UPDATE email_applications SET ${column} = ? WHERE id = ?`)
        .run(value, emailId);
      const blocked = await handOff(f.alice, emailId, { sent_confirmed: true });
      expect(blocked.status).toBe(409);
      expect((blocked.body.details as Record<string, unknown>).reason).toBe(
        "approval_invalidated"
      );
      const original = (created.body.email as Record<string, string>)[column];
      f.t.jobsSqlite
        .query(`UPDATE email_applications SET ${column} = ? WHERE id = ?`)
        .run(original as string, emailId);
    }
    // An attachment whose bytes changed changes the hash too.
    f.t.jobsSqlite
      .query("UPDATE files SET sha256 = ? WHERE id = ?")
      .run("f".repeat(64), f.cvFile.id);
    const swapped = await handOff(f.alice, emailId, { sent_confirmed: true });
    expect(swapped.status).toBe(409);
    // Approving the current content records a NEW approval; then it goes.
    const current = (swapped.body.details as { payload_hash: string })
      .payload_hash;
    expect(current).not.toBe(hash);
    const reapproved = await approve(f.alice, emailId, {
      payload_hash: current,
    });
    expect(reapproved.status).toBe(200);
    expect((reapproved.body.approval as { id: string }).id).not.toBe(
      created.body.approval.id
    );
    const ok = await handOff(f.alice, emailId, { sent_confirmed: true });
    expect(ok.status).toBe(200);
  });

  it("the recipient tick is required to approve a free-mail or unmatched address (09 §1)", async () => {
    const created = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "acme.recruiter@gmail.com",
    });
    expect(created.status).toBe(201);
    expect(created.body.review.warnings).toEqual([
      "free_mail_recipient",
      "recipient_domain_unverified",
      "no_attachment",
    ]);
    const hash = created.body.review.payload_hash;
    const refused = await approve(f.alice, created.body.email.id, {
      payload_hash: hash,
    });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      error: "policy_violation",
      details: { reason: "recipient_unconfirmed", free_mail: true },
    });
    const ticked = await approve(f.alice, created.body.email.id, {
      payload_hash: hash,
      recipient_confirmed: true,
    });
    expect(ticked.status).toBe(200);
    expect(ticked.body.approval).toMatchObject({
      payload: { recipient_confirmed: true },
    });
    // A tick given with the draft (by the user, not MCP) carries over.
    const other = seedEmailApplication(f.t, f.alice.userId as string);
    const withTick = await draft(f.alice, other.id, {
      ...LOCAL,
      to: "hr@other-domain.com",
      recipient_confirmed: true,
    });
    const carried = await approve(f.alice, withTick.body.email.id, {
      payload_hash: withTick.body.review.payload_hash,
    });
    expect(carried.status).toBe(200);
  });

  it("T9-03 MCP clients can draft but never approve; their tick does not count", async () => {
    const mcp = await f.client.mcpOAuthToken("rina@example.com");
    const created = await draft(mcp, f.app.id, {
      ...LOCAL,
      to: "hr@unknown-domain.com",
      recipient_confirmed: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.approval.payload).toMatchObject({
      recipient_confirmed: false,
    });
    const events = rows(
      f.t,
      "SELECT actor_kind FROM application_events WHERE application_id = ? AND type = 'approval_requested'",
      f.app.id
    );
    expect(events).toEqual([{ actor_kind: "mcp" }]);
    const res = await approve(mcp, created.body.email.id, {
      payload_hash: created.body.review.payload_hash,
      recipient_confirmed: true,
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "insufficient_scope",
      scope: "automation:manage",
    });
    const personal = await f.client.personalToken("rina@example.com", "write");
    expect(
      (
        await approve(personal, created.body.email.id, {
          payload_hash: created.body.review.payload_hash,
        })
      ).status
    ).toBe(403);
    // The user approves from the web, ticking the address themselves.
    const web = await approve(f.alice, created.body.email.id, {
      payload_hash: created.body.review.payload_hash,
    });
    expect(web.status).toBe(422);
  });

  it("emails of other users are not found on every route", async () => {
    const created = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
    });
    const bob = await f.client.browserSession("bob@example.com");
    const id = created.body.email.id;
    expect(
      (
        await approve(bob, id, {
          payload_hash: created.body.review.payload_hash,
        })
      ).status
    ).toBe(404);
    expect((await handOff(bob, id, { sent_confirmed: true })).status).toBe(404);
  });

  it("an approval is refused while a browser submission is in flight", async () => {
    const created = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
    });
    f.t.jobsSqlite
      .query(
        "INSERT INTO automation_tasks (id, user_id, kind, application_id, state, not_before, expires_at, created_by, idempotency_key, submit_intent_at, created_at, updated_at) VALUES ('tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C0D', ?, 'apply', ?, 'running', 0, ?, 'web', 'k', ?, 0, 0)"
      )
      .run(f.alice.userId, f.app.id, NOW + 1e9, NOW - 1000);
    const res = await approve(f.alice, created.body.email.id, {
      payload_hash: created.body.review.payload_hash,
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "invalid_transition",
      details: { reason: "submission_in_flight" },
    });
  });
});

describe("email submit approvals decided from the approval queue (09 §4, leaf-2.7 ↔ leaf-2.9)", () => {
  function decide(
    approvalId: string,
    body: Record<string, unknown>,
    session = f.alice
  ) {
    return session.post<Record<string, unknown>>(
      `/api/v1/approvals/${approvalId}/decide`,
      body,
      { idempotencyKey: crypto.randomUUID() }
    );
  }

  it("approving a local hand-off from the queue has the effects of POST /emails/{id}/approve", async () => {
    const created = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      attachment_file_ids: [f.cvFile.id],
    });
    const approvalId = created.body.approval.id as string;
    const res = await decide(approvalId, {
      decision: "approve",
      payload_hash: created.body.review.payload_hash,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      approval: { id: approvalId, state: "approved", decided_via: "web" },
      task: null,
    });
    const [email] = rows(
      f.t,
      "SELECT status, approved_at FROM email_applications WHERE id = ?",
      created.body.email.id
    );
    expect(email).toEqual({ status: "approved", approved_at: NOW });
    const [app] = rows(
      f.t,
      "SELECT submission_status, stage FROM applications WHERE id = ?",
      f.app.id
    );
    expect(app).toEqual({ submission_status: "in_progress", stage: "ready" });
    // The CLI can now report the hand-off.
    const handed = await handOff(f.alice, created.body.email.id, {
      sent_confirmed: true,
    });
    expect(handed.status).toBe(200);
  });

  it("rejecting from the queue rejects the approval and keeps the draft", async () => {
    const created = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      attachment_file_ids: [f.cvFile.id],
    });
    const approvalId = created.body.approval.id as string;
    const res = await decide(approvalId, {
      decision: "reject",
      payload_hash: created.body.review.payload_hash,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ approval: { state: "rejected" } });
    const [email] = rows(
      f.t,
      "SELECT status FROM email_applications WHERE id = ?",
      created.body.email.id
    );
    expect(email).toEqual({ status: "draft" });
    expect(
      rows(
        f.t,
        "SELECT submission_status FROM applications WHERE id = ?",
        f.app.id
      )
    ).toEqual([{ submission_status: "not_started" }]);
  });

  it("T9-03 an MCP decision can reject but never approve an email draft", async () => {
    const created = await draft(f.alice, f.app.id, {
      ...LOCAL,
      to: "hr@acme.co.id",
      attachment_file_ids: [f.cvFile.id],
    });
    const scope = f.alice.scope;
    if (!scope) {
      throw new Error("no scope");
    }
    const input = {
      approvalId: created.body.approval.id as string,
      payloadHash: created.body.review.payload_hash,
      via: "mcp" as const,
      now: NOW,
    };
    await expect(
      decideApproval(jobsDb(f.t.env), scope, f.t.env, {
        ...input,
        decision: "approve",
      })
    ).rejects.toMatchObject({
      code: "policy_violation",
      details: { reason: "mcp_cannot_approve_email" },
    });
    const rejected = await decideApproval(jobsDb(f.t.env), scope, f.t.env, {
      ...input,
      decision: "reject",
    });
    expect(rejected.approval.state).toBe("rejected");
  });

  it("a server_send draft must be approved on the email itself (422)", async () => {
    const g = await setupEmail({ serverSend: true });
    const created = await draft(g.alice, g.app.id, {
      delivery: "server_send",
      to: "hr@acme.co.id",
      attachment_file_ids: [g.cvFile.id],
    });
    expect(created.status).toBe(201);
    const res = await g.alice.post(
      `/api/v1/approvals/${created.body.approval.id as string}/decide`,
      { decision: "approve", payload_hash: created.body.review.payload_hash },
      { idempotencyKey: crypto.randomUUID() }
    );
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      details: { reason: "approve_on_email" },
    });
    expect(
      rows(
        g.t,
        "SELECT state FROM approvals WHERE id = ?",
        created.body.approval.id as string
      )
    ).toEqual([{ state: "pending" }]);
  });
});
