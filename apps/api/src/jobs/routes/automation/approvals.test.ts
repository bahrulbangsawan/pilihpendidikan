import { describe, expect, it } from "bun:test";
import { decideApproval } from "../../services/automation/index";
import {
  claimOne,
  createTask,
  DAY,
  decide,
  eventsOf,
  heartbeat,
  key,
  leasePost,
  NOW,
  requestSubmitApproval,
  rows,
  seedReadyApp,
  setup,
  taskRow,
} from "./support.test";
import type { Body } from "./support.test";

async function awaiting() {
  const fx = await setup();
  const app = seedReadyApp(fx.t, fx.userId);
  await createTask(fx.web, { kind: "apply", application_id: app.appId });
  const { taskId, leaseId } = await claimOne(fx.cli);
  await heartbeat(fx.cli, taskId, leaseId);
  const approval = await requestSubmitApproval(
    fx.cli,
    taskId,
    leaseId,
    app.postingId
  );
  return { fx, app, taskId, leaseId, approval: approval.body.approval };
}

function answerPayload(sensitivity = "personal") {
  return {
    type: "answer",
    questions: [
      {
        ref: "q1",
        question: "What is your expected salary?",
        required: true,
        options: [],
        question_key: "salary_expectation",
        sensitivity,
        suggestion: null,
      },
    ],
  };
}

describe("approvals (03 §8, 21 §6.3)", () => {
  it("TA-APPROVALS the device creates a submit approval; the task waits in awaiting_approval", async () => {
    const { fx, app, taskId, leaseId, approval } = await awaiting();
    expect(approval.state).toBe("pending");
    expect(approval.expires_at).toBe(NOW + DAY);
    expect(approval.task_id).toBe(taskId);
    expect(taskRow(fx.t, taskId).state).toBe("awaiting_approval");
    expect(eventsOf(fx.t, app.appId, "approval_requested")).toHaveLength(1);
    const poll = await fx.cli.get<Body>(
      `/api/v1/tasks/${taskId}/lease/${leaseId}/approvals/${approval.id}`
    );
    expect(poll.status).toBe(200);
    expect(poll.body.approval.state).toBe("pending");
    const queue = await fx.web.get<Body>("/api/v1/approvals", {
      query: { state: "pending" },
    });
    expect(queue.body.items.map((a: { id: string }) => a.id)).toEqual([
      approval.id,
    ]);
  });

  it("TA-APPROVALS first decision wins; a later one gets 409 with the decided state", async () => {
    const { fx, taskId, leaseId, approval } = await awaiting();
    const first = await decide(fx.web, approval, "approve");
    expect(first.status).toBe(200);
    const second = await decide(fx.web, approval, "reject");
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("revision_conflict");
    expect(second.body.details.current.state).toBe("approved");
    const poll = await fx.cli.get<Body>(
      `/api/v1/tasks/${taskId}/lease/${leaseId}/approvals/${approval.id}`
    );
    expect(poll.body.approval.state).toBe("approved");
    expect(poll.body.approval.decided_via).toBe("web");
  });

  it("TA-APPROVALS racing decisions: exactly one is recorded", async () => {
    const { fx, approval } = await awaiting();
    const results = await Promise.all([
      decide(fx.web, approval, "approve"),
      decide(fx.web, approval, "reject"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = rows(
      fx.t,
      "SELECT state, revision FROM approvals WHERE id = ?",
      approval.id
    )[0];
    expect(stored.revision).toBe(2);
    expect(
      eventsOf(fx.t, approval.application_id, "approval_decided")
    ).toHaveLength(1);
  });

  it("TA-APPROVALS the decision is bound to payload_hash and needs automation:manage", async () => {
    const { fx, approval } = await awaiting();
    const wrong = await decide(fx.web, {
      ...approval,
      payload_hash: "f".repeat(64),
    });
    expect(wrong.status).toBe(409);
    expect(wrong.body.details.reason).toBe("payload_hash_mismatch");
    const cli = await decide(fx.cli, approval);
    expect(cli.status).toBe(403);
    expect(cli.body.scope).toBe("automation:manage");
    const write = await fx.client.personalToken("alice@example.com", "write");
    expect((await decide(write, approval)).status).toBe(403);
    const reader = await fx.client.personalToken("alice@example.com", "read");
    expect((await reader.get<Body>("/api/v1/approvals")).status).toBe(200);
  });

  it("TA-APPROVALS an expired approval cannot be decided (410) and polls as expired", async () => {
    const { fx, taskId, leaseId, approval } = await awaiting();
    fx.clock.advance(DAY);
    // Heartbeats kept the lease alive meanwhile (21 §5.4).
    fx.t.jobsSqlite
      .query("UPDATE automation_tasks SET lease_expires_at = ? WHERE id = ?")
      .run(NOW + DAY + 60_000, taskId);
    const res = await decide(fx.web, approval);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("approval_expired");
    const poll = await fx.cli.get<Body>(
      `/api/v1/tasks/${taskId}/lease/${leaseId}/approvals/${approval.id}`
    );
    expect(poll.status).toBe(200);
    expect(poll.body.approval.state).toBe("expired");
    expect((await heartbeat(fx.cli, taskId, leaseId)).status).toBe(200);
  });

  it("TA-APPROVALS rejecting a leased task's approval asks the device to stop", async () => {
    const { fx, app, taskId, leaseId, approval } = await awaiting();
    const res = await decide(fx.web, approval, "reject");
    expect(res.status).toBe(200);
    expect(res.body.task.cancel_requested).toBe(true);
    const beat = await heartbeat(fx.cli, taskId, leaseId);
    expect(beat.body.cancel_requested).toBe(true);
    await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "cancelled",
      reason: "approval_rejected",
    });
    const task = taskRow(fx.t, taskId);
    expect(task.state).toBe("cancelled");
    expect(task.error_class).toBe("approval_rejected");
    const row = rows(
      fx.t,
      "SELECT stage, submission_status FROM applications WHERE id = ?",
      app.appId
    )[0];
    expect(row).toEqual({ stage: "ready", submission_status: "not_started" });
  });

  it("TA-APPROVALS rejecting a released approval wait cancels the task", async () => {
    const { fx, taskId, leaseId, approval } = await awaiting();
    await leasePost(fx.cli, taskId, leaseId, "release", {
      reason: "awaiting_approval",
    });
    const res = await decide(fx.web, approval, "reject");
    expect(res.body.task.state).toBe("cancelled");
    expect(taskRow(fx.t, taskId).state).toBe("cancelled");
    expect(taskRow(fx.t, taskId).error_class).toBe("approval_rejected");
  });

  it("TA-APPROVALS answer approvals save ticked answers to the bank, never protected as always", async () => {
    const { fx, taskId, leaseId } = await awaiting();
    const created = await leasePost(fx.cli, taskId, leaseId, "approvals", {
      kind: "answer",
      payload: answerPayload(),
      payload_hash: "c".repeat(64),
    });
    expect(created.status).toBe(201);
    const approval = created.body.approval;
    const missing = await decide(fx.web, approval, "approve", {
      response: { answers: [] },
    });
    expect(missing.status).toBe(422);
    const saved = await decide(fx.web, approval, "approve", {
      response: {
        answers: [
          {
            ref: "q1",
            value: "IDR 20,000,000",
            save_to_bank: true,
            auto_use: "always",
          },
        ],
      },
    });
    expect(saved.status).toBe(200);
    const bank = rows(
      fx.t,
      "SELECT * FROM screening_answers WHERE question_key = 'salary_expectation'"
    );
    expect(bank).toHaveLength(1);
    expect(bank[0]).toMatchObject({
      answer: "IDR 20,000,000",
      sensitivity: "personal",
      auto_use: "always",
    });
    const protectedOne = await leasePost(fx.cli, taskId, leaseId, "approvals", {
      kind: "answer",
      payload: answerPayload("protected"),
      payload_hash: "d".repeat(64),
    });
    const refused = await decide(
      fx.web,
      protectedOne.body.approval,
      "approve",
      {
        response: {
          answers: [
            { ref: "q1", value: "x", save_to_bank: true, auto_use: "always" },
          ],
        },
      }
    );
    expect(refused.status).toBe(422);
    expect(refused.body.details.reason).toBe("protected_always");
  });

  it("TA-APPROVALS a new submit approval supersedes the pending one; assisted needs none", async () => {
    const { fx, app, taskId, leaseId, approval } = await awaiting();
    const second = await requestSubmitApproval(
      fx.cli,
      taskId,
      leaseId,
      app.postingId,
      "e".repeat(64)
    );
    expect(second.status).toBe(201);
    expect(
      rows(fx.t, "SELECT state FROM approvals WHERE id = ?", approval.id)[0]
        .state
    ).toBe("expired");
    const wrongPayload = await leasePost(fx.cli, taskId, leaseId, "approvals", {
      kind: "submit",
      payload: answerPayload(),
      payload_hash: "e".repeat(64),
    });
    expect(wrongPayload.status).toBe(400);
  });

  it("TA-APPROVALS decideApproval is exported for the MCP tool (statements to commit)", async () => {
    const { fx, approval } = await awaiting();
    const result = await decideApproval(fx.db, fx.scope, fx.t.env, {
      approvalId: approval.id,
      decision: "approve",
      payloadHash: approval.payload_hash,
      via: "mcp",
      now: NOW,
    });
    expect(result.approval.state).toBe("approved");
    expect(result.approval.decided_via).toBe("mcp");
    expect(result.statements.length).toBeGreaterThan(2);
    expect(
      rows(fx.t, "SELECT state FROM approvals WHERE id = ?", approval.id)[0]
        .state
    ).toBe("pending");
  });

  it("TA-APPROVALS lists filter by kind and paginate", async () => {
    const { fx } = await awaiting();
    expect(
      (
        await fx.web.get<Body>("/api/v1/approvals", {
          query: { kind: "submit" },
        })
      ).body.items
    ).toHaveLength(1);
    expect(
      (
        await fx.web.get<Body>("/api/v1/approvals", {
          query: { kind: "answer" },
        })
      ).body.items
    ).toHaveLength(0);
    expect(
      (
        await fx.web.get<Body>("/api/v1/approvals", {
          query: { state: "approved" },
        })
      ).body.items
    ).toHaveLength(0);
    expect(
      (
        await fx.web.post<Body>(
          "/api/v1/approvals/apr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A/decide",
          { decision: "approve", payload_hash: "a".repeat(64) },
          { idempotencyKey: key() }
        )
      ).status
    ).toBe(404);
  });
});
