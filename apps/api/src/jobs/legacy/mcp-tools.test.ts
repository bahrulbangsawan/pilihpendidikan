import { beforeEach, describe, expect, it } from "bun:test";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { TestEnv } from "../../../test/fakes";
import {
  createTestEnv,
  createToolSession,
  jsonOf,
  textOf,
} from "../../../test/fakes";
import type { Caller } from "../../auth";

// The seven MCP tools added by 05 §14 (TL-MCP-NEW) and the approval limits
// of 11 §4.9 (TL-MCP-APPROVALS).

const ALICE: Caller = {
  email: "alice@example.com",
  isAdmin: false,
  scope: "write",
};
const BOB: Caller = {
  email: "bob@example.com",
  isAdmin: false,
  scope: "write",
};
const ALICE_READ: Caller = { ...ALICE, scope: "read" };
const DAY = 86_400_000;

let t: TestEnv;
beforeEach(() => {
  t = createTestEnv({}, { flags: { JOBS_LEGACY_BACKEND: "d1" } });
});

const as = (caller: Caller) => createToolSession(t.env, caller);

async function track(id: string, status = "saved"): Promise<string> {
  await as(ALICE).call("jobs_create", {
    job_id: id,
    title: `Role ${id}`,
    status,
  });
  const row = t.jobsSqlite
    .query("SELECT id FROM applications WHERE legacy_job_id = ?")
    .get(id) as { id: string };
  return row.id;
}

function aliceId(): string {
  return (
    t.sqlite.query("SELECT id FROM users WHERE email = ?").get(ALICE.email) as {
      id: string;
    }
  ).id;
}

function events(appId: string, type: string) {
  return t.jobsSqlite
    .query(
      "SELECT actor_kind, payload FROM application_events WHERE application_id = ? AND type = ?"
    )
    .all(appId, type) as Array<{ actor_kind: string; payload: string }>;
}

describe("TL-MCP-NEW jobs_board / jobs_move / notes / interviews / offers", () => {
  it("TL-MCP-NEW jobs_board shows the caller's cards by stage, legacy id included", async () => {
    const appId = await track("acme");
    await as(BOB).call("jobs_create", { job_id: "bob1", title: "Bob's" });
    const board = jsonOf<{
      columns: Array<{
        cards: Array<{ application_id: string; job_id: string }>;
        stage: string;
      }>;
    }>(await as(ALICE).call("jobs_board"));
    expect(board.columns.map((c) => c.stage)).toEqual(["saved"]);
    expect(board.columns[0].cards).toEqual([
      expect.objectContaining({
        application_id: appId,
        job_id: "acme",
        status: "saved",
      }),
    ]);
    const applied = jsonOf<{ columns: Array<{ total: number }> }>(
      await as(ALICE).call("jobs_board", { stage: "applied" })
    );
    expect(applied.columns).toEqual([
      expect.objectContaining({ stage: "applied", total: 0 }),
    ]);
  });

  it("TL-MCP-NEW jobs_board works for a read-scoped session", async () => {
    await track("acme");
    const board = jsonOf<{ columns: unknown[] }>(
      await as(ALICE_READ).call("jobs_board")
    );
    expect(board.columns).toHaveLength(1);
  });

  it("TL-MCP-NEW jobs_move follows 03 §5.1 and records the mcp actor", async () => {
    const appId = await track("acme");
    const moved = jsonOf(
      await as(ALICE).call("jobs_move", { job_id: "acme", stage: "preparing" })
    );
    expect(moved).toMatchObject({
      application_id: appId,
      stage: "preparing",
      status: "saved",
    });
    expect(events(appId, "stage_changed")[0].actor_kind).toBe("mcp");
    expect(
      textOf(
        await as(ALICE).call("jobs_move", { job_id: appId, stage: "accepted" })
      )
    ).toContain("not allowed");
  });

  it("TL-MCP-NEW jobs_move with a stale base_revision is refused", async () => {
    await track("acme");
    await as(ALICE).call("jobs_move", { job_id: "acme", stage: "preparing" });
    expect(
      textOf(
        await as(ALICE).call("jobs_move", {
          job_id: "acme",
          stage: "ready",
          base_revision: 1,
        })
      )
    ).toContain("current revision");
  });

  it("TL-MCP-NEW jobs_note_add appends a note_added event", async () => {
    const appId = await track("acme");
    const out = textOf(
      await as(ALICE).call("jobs_note_add", {
        job_id: "acme",
        text: "Recruiter called",
      })
    );
    expect(out).toStartWith('Note added to job "acme"');
    const notes = events(appId, "note_added");
    expect(notes).toHaveLength(1);
    expect(JSON.parse(notes[0].payload)).toEqual({ text: "Recruiter called" });
    expect(notes[0].actor_kind).toBe("mcp");
  });

  it("TL-MCP-NEW jobs_interview_add creates the interview and moves applied → interviewing", async () => {
    await track("acme", "applied");
    const out = jsonOf<{
      application: { stage: string };
      interview: { kind: string; scheduled_at: string };
    }>(
      await as(ALICE).call("jobs_interview_add", {
        job_id: "acme",
        kind: "technical",
        scheduled_at: "2026-11-02T03:00:00Z",
        timezone: "Asia/Jakarta",
      })
    );
    expect(out.interview).toMatchObject({
      kind: "technical",
      scheduled_at: "2026-11-02T03:00:00.000Z",
    });
    expect(out.application.stage).toBe("interviewing");
    const legacy = jsonOf<{ interviewDate: string; status: string }>(
      await as(ALICE).call("jobs_get", { job_id: "acme" })
    );
    expect(legacy).toMatchObject({
      status: "interviewing",
      interviewDate: "2026-11-02",
    });
  });

  it("TL-MCP-NEW jobs_offer_add records the offer and moves interviewing → offer", async () => {
    await track("acme", "applied");
    await as(ALICE).call("jobs_move", {
      job_id: "acme",
      stage: "interviewing",
    });
    const out = jsonOf<{
      application: { stage: string };
      offer: { compensation: unknown };
    }>(
      await as(ALICE).call("jobs_offer_add", {
        job_id: "acme",
        base: 30_000_000,
        currency: "IDR",
        period: "month",
      })
    );
    expect(out.offer.compensation).toEqual({
      base: 30_000_000,
      currency: "IDR",
      period: "month",
    });
    expect(out.application.stage).toBe("offer");
  });

  it("TL-MCP-NEW another user's job is not found for every job_id tool", async () => {
    await track("acme");
    for (const [tool, args] of [
      ["jobs_move", { job_id: "acme", stage: "preparing" }],
      ["jobs_note_add", { job_id: "acme", text: "x" }],
      ["jobs_interview_add", { job_id: "acme" }],
      ["jobs_offer_add", { job_id: "acme" }],
    ] as const) {
      expect(textOf(await as(BOB).call(tool, args))).toBe(
        'Job "acme" not found.'
      );
    }
  });

  it("TL-MCP-NEW the board tools work on the kv backend for Job Tracker applications", async () => {
    await t.setFlag("JOBS_LEGACY_BACKEND", "kv");
    await as(ALICE).call("jobs_create", { job_id: "kvjob", title: "KV" });
    expect(
      textOf(
        await as(ALICE).call("jobs_note_add", { job_id: "kvjob", text: "x" })
      )
    ).toBe('Job "kvjob" not found.');
    const board = jsonOf<{ columns: unknown[] }>(
      await as(ALICE).call("jobs_board")
    );
    expect(board.columns).toEqual([]);
  });

  it("TL-MCP-NEW the tools answer that the Job Tracker is off when JOBS_V1_ENABLED is false", async () => {
    await t.setFlag("JOBS_V1_ENABLED", false);
    expect(textOf(await as(ALICE).call("jobs_board"))).toBe(
      "The Job Tracker is not available yet."
    );
    expect(textOf(await as(ALICE).call("jobs_approvals_list"))).toBe(
      "The Job Tracker is not available yet."
    );
  });
});

// --- approvals ---------------------------------------------------------------

function seedApproval(
  kind: "answer" | "cv_variant" | "submit" | "rule_activation"
): {
  hash: string;
  id: string;
} {
  const id = newId("apr");
  const hash = kind
    .padEnd(64, "a")
    .replace(/[^0-9a-f]/g, "b")
    .slice(0, 64);
  const payload = {
    answer: {
      type: "answer",
      questions: [
        {
          ref: "q1",
          question: "Notice period?",
          required: true,
          options: [],
          question_key: "notice_period",
          sensitivity: "none",
          suggestion: null,
        },
      ],
    },
    cv_variant: { type: "cv_variant", cv_variant_id: newId("cvv") },
    submit: { type: "browser_submit" },
    rule_activation: { type: "rule_activation", rule_id: newId("rul") },
  }[kind];
  const now = Date.now();
  t.jobsSqlite
    .query(
      "INSERT INTO approvals (id, user_id, kind, task_id, application_id, payload, payload_hash, state, expires_at, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'pending', ?, ?)"
    )
    .run(id, aliceId(), kind, JSON.stringify(payload), hash, now + DAY, now);
  return { id, hash };
}

function allowMcpApprovals(on: boolean): void {
  t.jobsSqlite
    .query(
      "INSERT INTO user_settings (user_id, allow_mcp_approvals, updated_at) VALUES (?, ?, 0) ON CONFLICT(user_id) DO UPDATE SET allow_mcp_approvals = excluded.allow_mcp_approvals"
    )
    .run(aliceId(), on ? 1 : 0);
}

function approvalState(id: string): string {
  return (
    t.jobsSqlite.query("SELECT state FROM approvals WHERE id = ?").get(id) as {
      state: string;
    }
  ).state;
}

describe("TL-MCP-APPROVALS jobs_approvals_list / jobs_approval_decide (05 §14, 11 §4.9)", () => {
  beforeEach(async () => {
    await track("seed");
  });

  it("TL-MCP-APPROVALS lists pending approvals with what MCP may decide", async () => {
    allowMcpApprovals(true);
    const answer = seedApproval("answer");
    const submit = seedApproval("submit");
    const out = jsonOf<{
      items: Array<{ decidable_via_mcp: boolean; id: string }>;
    }>(await as(ALICE_READ).call("jobs_approvals_list"));
    const byId = Object.fromEntries(
      out.items.map((i) => [i.id, i.decidable_via_mcp])
    );
    expect(byId).toEqual({ [answer.id]: true, [submit.id]: false });
  });

  it("TL-MCP-APPROVALS refuses while allow_mcp_approvals is off and links the web queue", async () => {
    const answer = seedApproval("answer");
    const out = textOf(
      await as(ALICE).call("jobs_approval_decide", {
        approval_id: answer.id,
        decision: "approve",
        payload_hash: answer.hash,
      })
    );
    expect(out).toContain("http://localhost:4007/automation");
    expect(approvalState(answer.id)).toBe("pending");
  });

  it("TL-MCP-APPROVALS decides an answer approval when allowed (decided_via mcp)", async () => {
    allowMcpApprovals(true);
    const answer = seedApproval("answer");
    const out = jsonOf<{ approval: { decided_via: string; state: string } }>(
      await as(ALICE).call("jobs_approval_decide", {
        approval_id: answer.id,
        decision: "reject",
        payload_hash: answer.hash,
      })
    );
    expect(out.approval).toMatchObject({
      state: "rejected",
      decided_via: "mcp",
    });
    expect(approvalState(answer.id)).toBe("rejected");
  });

  it("TL-MCP-APPROVALS never decides submit or rule_activation, even when allowed", async () => {
    allowMcpApprovals(true);
    for (const kind of ["submit", "rule_activation"] as const) {
      const approval = seedApproval(kind);
      const out = textOf(
        await as(ALICE).call("jobs_approval_decide", {
          approval_id: approval.id,
          decision: "approve",
          payload_hash: approval.hash,
        })
      );
      expect(out).toContain("approval queue");
      expect(approvalState(approval.id)).toBe("pending");
    }
  });

  it("TL-MCP-APPROVALS a payload_hash mismatch is refused", async () => {
    allowMcpApprovals(true);
    const answer = seedApproval("answer");
    const out = textOf(
      await as(ALICE).call("jobs_approval_decide", {
        approval_id: answer.id,
        decision: "approve",
        payload_hash: "f".repeat(64),
      })
    );
    expect(out).toContain("approval changed");
    expect(approvalState(answer.id)).toBe("pending");
  });

  it("TL-MCP-APPROVALS another user's approval is not found; read sessions cannot decide", async () => {
    allowMcpApprovals(true);
    const answer = seedApproval("answer");
    expect(
      textOf(
        await as(BOB).call("jobs_approval_decide", {
          approval_id: answer.id,
          decision: "approve",
          payload_hash: answer.hash,
        })
      )
    ).toBe(`Approval "${answer.id}" not found.`);
    expect(as(ALICE_READ).tools.has("jobs_approval_decide")).toBe(false);
  });
});
