import { describe, expect, it } from "vitest";
import { makeCard } from "@/test/fixtures";
import { ApiError } from "./api-client";
import { BULK_CONCURRENCY, bulkMoveSkip, runBulk, summarizeBulk } from "./bulk";

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
      message: "Error: boom",
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
