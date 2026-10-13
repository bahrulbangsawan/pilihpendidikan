import { describe, expect, test } from "bun:test";
import vectors from "../test-vectors/stage-transitions.json" with {
  type: "json",
};
import type { Stage, StageActor, SubmissionStatus } from "../src/enums";
import {
  ACTOR_KINDS,
  APPROVAL_STATES,
  NON_TERMINAL_STAGES,
  STAGE_ACTORS,
  STAGES,
  SUBMISSION_STATUSES,
  TASK_STATES,
  TASK_TERMINAL_STATES,
} from "../src/enums";
import {
  canApprovalTransition,
  canChangeSubmissionStatus,
  canTaskTransition,
  canTransition,
  isForwardSubmission,
  nextStages,
  SUBMISSION_FORWARD_EXCEPTIONS,
  SUBMISSION_STATUS_RANK,
  STAGE_TRANSITIONS,
  stageActorFor,
  stageTransitionMatrix,
  TASK_TRANSITIONS,
} from "../src/stage";

describe("application stage machine (03 §5.1)", () => {
  test("T6-01 every from x to x actor pair of the stage table is accepted or rejected exactly as 03 §5.1", () => {
    expect(vectors.cases).toHaveLength(
      STAGES.length ** 2 * STAGE_ACTORS.length
    );
    const seen = new Set<string>();
    for (const c of vectors.cases) {
      seen.add(`${c.from}>${c.to}>${c.actor}`);
      expect({
        ...c,
        actual: canTransition(
          c.from as Stage,
          c.to as Stage,
          c.actor as StageActor
        ),
      }).toEqual({
        ...c,
        actual: c.allowed,
      });
    }
    expect(seen.size).toBe(243);
    expect(stageTransitionMatrix()).toEqual(
      vectors.cases.map(({ from, to, actor, allowed }) => ({
        from,
        to,
        actor,
        allowed,
      })) as ReturnType<typeof stageTransitionMatrix>
    );
  });

  test("TC-STAGE accepted has no outgoing transition for any actor", () => {
    for (const to of STAGES) {
      for (const actor of STAGE_ACTORS) {
        expect(canTransition("accepted", to, actor)).toBe(false);
      }
    }
  });

  test("TC-STAGE from === to is never a transition", () => {
    for (const stage of STAGES) {
      for (const actor of STAGE_ACTORS) {
        expect(canTransition(stage, stage, actor)).toBe(false);
      }
    }
  });

  test("TC-STAGE every non-terminal stage can be withdrawn or rejected by the user only", () => {
    for (const from of NON_TERMINAL_STAGES) {
      expect(canTransition(from, "withdrawn", "user")).toBe(true);
      expect(canTransition(from, "rejected", "user")).toBe(true);
      expect(canTransition(from, "rejected", "automation")).toBe(false);
      expect(canTransition(from, "withdrawn", "system")).toBe(false);
    }
  });

  test("TC-STAGE reopen rejected/withdrawn → saved is user only", () => {
    expect(canTransition("rejected", "saved", "user")).toBe(true);
    expect(canTransition("withdrawn", "saved", "user")).toBe(true);
    expect(canTransition("rejected", "saved", "system")).toBe(false);
    expect(canTransition("withdrawn", "saved", "automation")).toBe(false);
    expect(canTransition("accepted", "saved", "user")).toBe(false);
  });

  test("TC-STAGE automation may only apply from prep stages and mark saved/preparing ready", () => {
    const automation = STAGE_TRANSITIONS.filter((rule) =>
      rule.actors.includes("automation")
    )
      .map((rule) => `${rule.from}>${rule.to}`)
      .sort();
    expect(automation).toEqual(
      [
        "preparing>applied",
        "preparing>ready",
        "ready>applied",
        "saved>applied",
        "saved>ready",
      ].sort()
    );
  });

  test("TC-STAGE system may only move saved → preparing and preparing → ready", () => {
    const system = STAGE_TRANSITIONS.filter((rule) =>
      rule.actors.includes("system")
    )
      .map((rule) => `${rule.from}>${rule.to}`)
      .sort();
    expect(system).toEqual(["preparing>ready", "saved>preparing"]);
  });

  test("TC-STAGE illegal user moves (accepted → interviewing, applied → ready, ready → saved)", () => {
    expect(canTransition("accepted", "interviewing", "user")).toBe(false);
    expect(canTransition("applied", "ready", "user")).toBe(false);
    expect(canTransition("ready", "saved", "user")).toBe(false);
    expect(canTransition("interviewing", "applied", "user")).toBe(false);
  });

  test("TC-STAGE nextStages lists reachable stages in board order", () => {
    expect(nextStages("saved", "user")).toEqual([
      "preparing",
      "ready",
      "applied",
      "rejected",
      "withdrawn",
    ]);
    expect(nextStages("saved", "system")).toEqual(["preparing"]);
    expect(nextStages("accepted", "user")).toEqual([]);
  });

  test("TC-STAGE event actor kinds map onto stage actors", () => {
    expect(stageActorFor("user")).toBe("user");
    expect(stageActorFor("mcp")).toBe("user");
    expect(stageActorFor("automation")).toBe("automation");
    expect(stageActorFor("system")).toBe("system");
    expect(stageActorFor("legacy_migration")).toBe("system");
  });
});

describe("submission status (03 §5.2, 20 §6.2)", () => {
  const forward: [SubmissionStatus, SubmissionStatus][] = [
    ["not_started", "in_progress"],
    ["not_started", "submitted_verified"],
    ["in_progress", "failed"],
    ["in_progress", "outcome_unknown"],
    ["in_progress", "submitted_unverified"],
    ["in_progress", "submitted_verified"],
    ["submitted_unverified", "submitted_verified"],
    ["outcome_unknown", "submitted_verified"],
    ["failed", "submitted_verified"],
    ["failed", "in_progress"],
    ["outcome_unknown", "submitted_unverified"],
  ];

  test("TC-STAGE forward order not_started < in_progress < {failed, outcome_unknown, unverified} < verified", () => {
    for (const [from, to] of forward) {
      expect(isForwardSubmission(from, to)).toBe(true);
    }
    expect(isForwardSubmission("submitted_verified", "failed")).toBe(false);
    expect(isForwardSubmission("submitted_unverified", "outcome_unknown")).toBe(
      false
    );
    expect(isForwardSubmission("submitted_unverified", "failed")).toBe(false);
    expect(isForwardSubmission("in_progress", "not_started")).toBe(false);
    for (const status of SUBMISSION_STATUSES) {
      expect(isForwardSubmission(status, status)).toBe(false);
    }
  });

  test("TC-STAGE user decisions may move any status; automation and system only forward", () => {
    for (const from of SUBMISSION_STATUSES) {
      for (const to of SUBMISSION_STATUSES) {
        for (const actor of ACTOR_KINDS) {
          const expected =
            from !== to &&
            (["user", "mcp", "legacy_migration"].includes(actor) ||
              isForwardSubmission(from, to));
          expect(canChangeSubmissionStatus(from, to, actor)).toBe(expected);
        }
      }
    }
    expect(
      canChangeSubmissionStatus("submitted_unverified", "failed", "user")
    ).toBe(true);
    expect(
      canChangeSubmissionStatus("submitted_unverified", "failed", "automation")
    ).toBe(false);
  });
});

describe("TFIX-EVIDENCE-EDGE outcome_unknown → submitted_unverified (20 §6.3 A, 13 §5 S-24)", () => {
  test("TFIX-EVIDENCE-EDGE evidence of an unconfirmed submission resolves outcome_unknown", () => {
    // The two documented exceptions, and nothing else between equal ranks.
    expect(SUBMISSION_FORWARD_EXCEPTIONS).toEqual([
      ["failed", "in_progress"],
      ["outcome_unknown", "submitted_unverified"],
    ]);
    expect(isForwardSubmission("outcome_unknown", "submitted_unverified")).toBe(
      true
    );
    for (const actor of ["automation", "system"] as const) {
      expect(
        canChangeSubmissionStatus(
          "outcome_unknown",
          "submitted_unverified",
          actor
        )
      ).toBe(true);
      // Never backwards: a lease lost after an unconfirmed submission keeps it.
      expect(
        canChangeSubmissionStatus(
          "submitted_unverified",
          "outcome_unknown",
          actor
        )
      ).toBe(false);
      // "Not submitted" stays a user decision.
      expect(
        canChangeSubmissionStatus("outcome_unknown", "failed", actor)
      ).toBe(false);
      // A failure is only left through the retry edge or verified evidence.
      expect(
        canChangeSubmissionStatus("failed", "submitted_unverified", actor)
      ).toBe(false);
      expect(
        canChangeSubmissionStatus("failed", "outcome_unknown", actor)
      ).toBe(false);
    }
    // User decisions stay final in both directions.
    expect(
      canChangeSubmissionStatus(
        "submitted_unverified",
        "outcome_unknown",
        "user"
      )
    ).toBe(true);
    expect(canChangeSubmissionStatus("outcome_unknown", "failed", "mcp")).toBe(
      true
    );
  });

  test("TFIX-EVIDENCE-EDGE the exceptions are the only equal-rank or backward moves that count as forward", () => {
    const exceptions = new Set(
      SUBMISSION_FORWARD_EXCEPTIONS.map(([from, to]) => `${from}>${to}`)
    );
    for (const from of SUBMISSION_STATUSES) {
      for (const to of SUBMISSION_STATUSES) {
        const byRank =
          SUBMISSION_STATUS_RANK[to] > SUBMISSION_STATUS_RANK[from];
        expect(isForwardSubmission(from, to)).toBe(
          byRank || exceptions.has(`${from}>${to}`)
        );
      }
    }
  });
});

describe("task state machine (21 §12)", () => {
  test("TC-STAGE the 21 §12 rows are allowed", () => {
    const rows: [string, string][] = [
      ["queued", "claimed"],
      ["queued", "cancelled"],
      ["queued", "expired"],
      ["claimed", "running"],
      ["claimed", "queued"],
      ["running", "paused"],
      ["paused", "running"],
      ["running", "awaiting_approval"],
      ["awaiting_approval", "running"],
      ["awaiting_approval", "queued"],
      ["awaiting_approval", "cancelled"],
      ["running", "queued"],
      ["paused", "queued"],
      ["running", "submitted"],
      ["running", "succeeded"],
      ["running", "failed"],
      ["paused", "failed"],
      ["running", "outcome_unknown"],
      ["claimed", "outcome_unknown"],
      ["outcome_unknown", "submitted"],
      ["outcome_unknown", "failed"],
    ];
    for (const [from, to] of rows) {
      expect(canTaskTransition(from as never, to as never)).toBe(true);
    }
  });

  test("TC-STAGE terminal task states have no exit except outcome_unknown → submitted | failed", () => {
    for (const from of TASK_TERMINAL_STATES) {
      for (const to of TASK_STATES) {
        const expected =
          from === "outcome_unknown" && (to === "submitted" || to === "failed");
        expect(canTaskTransition(from, to)).toBe(expected);
      }
    }
  });

  test("TC-STAGE outcome_unknown is never re-queued and queued never jumps to running", () => {
    expect(canTaskTransition("outcome_unknown", "queued")).toBe(false);
    expect(canTaskTransition("queued", "running")).toBe(false);
    expect(canTaskTransition("queued", "submitted")).toBe(false);
    expect(canTaskTransition("outcome_unknown", "submitted", "system")).toBe(
      true
    );
    expect(canTaskTransition("outcome_unknown", "failed", "device")).toBe(
      false
    );
    expect(canTaskTransition("queued", "claimed", "device")).toBe(true);
    expect(canTaskTransition("queued", "claimed", "user")).toBe(false);
  });

  test("TC-STAGE task table rows reference known states", () => {
    for (const row of TASK_TRANSITIONS) {
      expect(TASK_STATES).toContain(row.from);
      expect(TASK_STATES).toContain(row.to);
      expect(row.actors.length).toBeGreaterThan(0);
    }
  });
});

describe("approval state machine (03 §8)", () => {
  test("TC-STAGE pending → approved | rejected | expired; decided states are final", () => {
    for (const from of APPROVAL_STATES) {
      for (const to of APPROVAL_STATES) {
        expect(canApprovalTransition(from, to)).toBe(
          from === "pending" && to !== "pending"
        );
      }
    }
  });
});
