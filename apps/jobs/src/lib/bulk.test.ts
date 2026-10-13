import { describe, expect, it } from "vitest";
import { fixtureId, makeCard, NOW } from "@/test/fixtures";
import { ApiError } from "./api-client";
import {
  answerAutoUseBlock,
  autoModeAllowed,
  BULK_CONCURRENCY,
  bulkArchiveTarget,
  bulkMoveSkip,
  bulkPurgeBlock,
  runBulk,
  summarizeBulk,
} from "./bulk";

describe("T6-08 bulk actions report per-card results", () => {
  it("T6-08 bulk move with valid, invalid and conflicting cards reports each one", async () => {
    const cards = [
      makeCard({ stage: "saved", company: "Valid A", title: "T" }),
      makeCard({ stage: "accepted", company: "Illegal", title: "T" }),
      makeCard({ stage: "ready", company: "Conflict", title: "T" }),
      makeCard({ stage: "applied", company: "Already", title: "T" }),
      makeCard({ stage: "preparing", company: "Valid B", title: "T" }),
      makeCard({ stage: "saved", company: "Refused", title: "T" }),
    ];
    const byId = new Map(cards.map((card) => [card.id, card]));
    const sent: string[] = [];
    const results = await runBulk(
      cards.map((card) => card.id),
      async (id) => {
        await Promise.resolve();
        const card = byId.get(id);
        if (!card) {
          throw new Error("missing");
        }
        const skip = bulkMoveSkip(card, "applied");
        if (skip) {
          throw skip;
        }
        sent.push(card.posting.company_name);
        if (card.posting.company_name === "Conflict") {
          throw new ApiError({
            ok: false,
            status: 409,
            error: { error: "revision_conflict", message: "changed" },
          });
        }
        if (card.posting.company_name === "Refused") {
          throw new ApiError({
            ok: false,
            status: 422,
            error: {
              error: "invalid_transition",
              message: "no",
              details: { reason: "submission_in_flight" },
            },
          });
        }
      }
    );
    expect(
      results.map((result) => [
        byId.get(result.id)?.posting.company_name,
        result.status,
        result.reason,
      ])
    ).toEqual([
      ["Valid A", "ok", undefined],
      ["Illegal", "skipped", "invalid_transition"],
      ["Conflict", "conflict", "revision_conflict"],
      ["Already", "skipped", "same_stage"],
      ["Valid B", "ok", undefined],
      ["Refused", "skipped", "submission_in_flight"],
    ]);
    expect(sent).not.toContain("Illegal");
    expect(sent).not.toContain("Already");
    expect(summarizeBulk(results)).toEqual({
      ok: 2,
      skipped: 3,
      conflict: 1,
      failed: 0,
    });
  });

  it("T6-08 runs at most four requests at a time and keeps the input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const ids = Array.from({ length: 11 }, (_, index) => `app_${index}`);
    const results = await runBulk(ids, async (id) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) =>
        setTimeout(resolve, 5 + (Number(id.slice(4)) % 3))
      );
      inFlight -= 1;
      if (id === "app_7") {
        throw new Error("boom");
      }
    });
    expect(peak).toBe(BULK_CONCURRENCY);
    expect(results.map((result) => result.id)).toEqual(ids);
    expect(results[7]).toMatchObject({
      status: "failed",
      message: "boom",
    });
    expect(summarizeBulk(results)).toEqual({
      ok: 10,
      skipped: 0,
      conflict: 0,
      failed: 1,
    });
  });

  it("T6-08 cards past submit_intent are skipped, never sent", () => {
    const card = makeCard({ stage: "ready", company: "A", title: "T" }, 0, {
      live_task: {
        id: "tsk_01J00000000000000000000000",
        kind: "apply",
        state: "running",
        device_id: null,
        device_name: null,
        pause_reason: null,
        progress_stage: "submitting",
        submit_intent_at: 1,
        updated_at: 1,
      },
    });
    expect(bulkMoveSkip(card, "withdrawn")?.reason).toBe(
      "submission_in_flight"
    );
  });
});

describe("T6-08 bulk guards (06 §9, §11)", () => {
  const liveTask = (state: "running" | "queued", submitting: boolean) => ({
    id: fixtureId("tsk"),
    kind: "apply" as const,
    state,
    device_id: null,
    device_name: null,
    pause_reason: null,
    progress_stage: null,
    submit_intent_at: submitting ? NOW : null,
    updated_at: NOW,
  });

  it("T6-08 purge skips cards with a live task or a submission in flight", () => {
    expect(
      bulkPurgeBlock(makeCard({ stage: "saved", company: "A", title: "T" }))
    ).toBeNull();
    expect(
      bulkPurgeBlock(
        makeCard({ stage: "ready", company: "B", title: "T" }, 0, {
          live_task: liveTask("queued", false),
        })
      )
    ).toBe("live_task");
    expect(
      bulkPurgeBlock(
        makeCard({ stage: "ready", company: "C", title: "T" }, 0, {
          live_task: liveTask("running", true),
        })
      )
    ).toBe("submission_in_flight");
    expect(
      bulkPurgeBlock(
        makeCard({ stage: "ready", company: "D", title: "T" }, 0, {
          submission_status: "in_progress",
        })
      )
    ).toBe("submission_in_flight");
  });

  it("T6-08 archive on a mixed selection archives; only an all-archived selection unarchives", () => {
    expect(bulkArchiveTarget([{ archived: true }, { archived: false }])).toBe(
      true
    );
    expect(bulkArchiveTarget([{ archived: true }, { archived: true }])).toBe(
      false
    );
    expect(bulkArchiveTarget([{ archived: false }])).toBe(true);
  });

  it("T6-08 auto mode needs a matching auto rule (or the card already in auto)", () => {
    expect(
      autoModeAllowed({ automation_rule_id: null, mode: "approval" })
    ).toBe(false);
    expect(
      autoModeAllowed({
        automation_rule_id: fixtureId("rul"),
        mode: "approval",
      })
    ).toBe(true);
    expect(autoModeAllowed({ automation_rule_id: null, mode: "auto" })).toBe(
      true
    );
  });

  it("TW-PROFILE a protected answer is never set to always; unchanged answers are skipped", () => {
    const protectedAnswer = { sensitivity: "protected", auto_use: "approval" };
    expect(answerAutoUseBlock(protectedAnswer, "always")).toBe(
      "protected_always"
    );
    expect(answerAutoUseBlock(protectedAnswer, "never")).toBeNull();
    expect(
      answerAutoUseBlock({ sensitivity: "none", auto_use: "always" }, "always")
    ).toBe("unchanged");
  });
});
