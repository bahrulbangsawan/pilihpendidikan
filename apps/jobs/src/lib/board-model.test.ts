import { describe, expect, it } from "vitest";
import { patchBoardWithApplication } from "@/hooks/use-board";
import {
  DAY,
  makeApplication,
  makeBoard,
  makeCard,
  makeDetail,
  NOW,
  sampleBoard,
} from "@/test/fixtures";
import {
  BOARD_STAGES,
  CLOSED_STAGES,
  columnsFromBoard,
  DEFAULT_FILTERS,
  filterColumns,
  hasNoResponse,
  matchesFilters,
  neighboursAt,
  presentSources,
  upcomingInterviews,
} from "./board-model";
import { computeNextStep } from "./next-step";

describe("board model (06 §1)", () => {
  it("lays out seven open columns and a closed lane of rejected + withdrawn", () => {
    expect(BOARD_STAGES).toEqual([
      "saved",
      "preparing",
      "ready",
      "applied",
      "interviewing",
      "offer",
      "accepted",
    ]);
    expect(CLOSED_STAGES).toEqual(["rejected", "withdrawn"]);
  });

  it("orders each column by board_rank as plain strings", () => {
    const a = makeCard({ stage: "saved", company: "A", title: "T" }, 0, {
      board_rank: "m5",
    });
    const b = makeCard({ stage: "saved", company: "B", title: "T" }, 0, {
      board_rank: "a1",
    });
    const c = makeCard({ stage: "saved", company: "C", title: "T" }, 0, {
      board_rank: "m10",
    });
    // Plain string order: "a1" < "m10" < "m5".
    expect(
      columnsFromBoard(makeBoard([a, b, c])).saved.map(
        (card) => card.posting.company_name
      )
    ).toEqual(["B", "C", "A"]);
  });

  it("filters: no response in N days, follow-up due, needs attention, search, source", () => {
    const columns = columnsFromBoard(sampleBoard());
    const quiet = filterColumns(
      columns,
      { ...DEFAULT_FILTERS, noResponseDays: 21 },
      NOW
    );
    expect(quiet.applied.map((card) => card.posting.company_name)).toEqual([
      "Umbrella",
    ]);
    const due = filterColumns(
      columns,
      { ...DEFAULT_FILTERS, followUpDue: true },
      NOW
    );
    expect(
      BOARD_STAGES.flatMap((stage) => due[stage]).map(
        (card) => card.posting.company_name
      )
    ).toEqual(["Bukalapak"]);
    const attention = filterColumns(
      columns,
      { ...DEFAULT_FILTERS, needsAttention: true },
      NOW
    );
    expect(attention.applied).toHaveLength(1);
    const search = filterColumns(
      columns,
      { ...DEFAULT_FILTERS, q: "payments" },
      NOW
    );
    expect(search.saved.map((card) => card.posting.company_name)).toEqual([
      "Tokopedia",
    ]);
    expect(presentSources(columns)).toContain("lever");
    expect(upcomingInterviews(columns, NOW)).toBe(1);
  });

  it("never infers a rejection from silence: no-response is a filter only", () => {
    const old = makeCard({
      stage: "applied",
      company: "A",
      title: "T",
      updatedAgoDays: 40,
    });
    expect(hasNoResponse(old, 21, NOW)).toBe(true);
    expect(old.stage).toBe("applied");
    expect(matchesFilters(old, DEFAULT_FILTERS, NOW)).toBe(true);
    expect(
      hasNoResponse(
        makeCard({
          stage: "interviewing",
          company: "B",
          title: "T",
          updatedAgoDays: 40,
        }),
        21,
        NOW
      )
    ).toBe(false);
    expect(
      hasNoResponse(
        makeCard({ stage: "applied", company: "C", title: "T" }, 0, {
          stage_changed_at: NOW - 3 * DAY,
        }),
        21,
        NOW
      )
    ).toBe(false);
  });

  it("computes before_id / after_id around a drop position", () => {
    const columns = columnsFromBoard(sampleBoard());
    const [first, second, third] = columns.saved;
    expect(neighboursAt(columns.saved, 1, "x")).toEqual({
      beforeId: first?.id,
      afterId: second?.id,
    });
    expect(neighboursAt(columns.saved, 0, "x")).toEqual({
      beforeId: null,
      afterId: first?.id,
    });
    expect(neighboursAt(columns.saved, 9, "x")).toEqual({
      beforeId: third?.id,
      afterId: null,
    });
  });

  it("writes a confirmed application into the cached board (and hides archived ones)", () => {
    const board = sampleBoard();
    const card = board.columns[0]?.cards[0];
    if (!card) {
      throw new Error("fixture");
    }
    const moved = makeApplication({
      id: card.id,
      user_job_id: card.user_job_id,
      stage: "ready",
      revision: 9,
      board_rank: "z",
    });
    const data = patchBoardWithApplication(
      { board, etag: null, fetchedAt: NOW },
      moved,
      false
    );
    const columns = columnsFromBoard(data.board);
    expect(columns.ready.at(-1)?.id).toBe(card.id);
    expect(columns.ready.at(-1)?.revision).toBe(9);
    expect(columns.saved.some((entry) => entry.id === card.id)).toBe(false);
    const archived = patchBoardWithApplication(
      { board, etag: null, fetchedAt: NOW },
      { ...moved, archived: true },
      false
    );
    expect(
      columnsFromBoard(archived.board).ready.some(
        (entry) => entry.id === card.id
      )
    ).toBe(false);
  });
});

describe("next step (12 §5.1)", () => {
  it("recommends exactly one action from the state", () => {
    const base = makeDetail();
    expect(computeNextStep(base)?.kind).toBe("generate_cv");
    expect(
      computeNextStep({
        ...base,
        application: {
          ...base.application,
          submission_status: "outcome_unknown",
        },
      })?.kind
    ).toBe("review_outcome");
    expect(
      computeNextStep({
        ...base,
        application: {
          ...base.application,
          submission_status: "submitted_unverified",
        },
      })?.kind
    ).toBe("confirm_submission");
    expect(
      computeNextStep({
        ...base,
        application: {
          ...base.application,
          stage: "applied",
          submission_status: "submitted_verified",
        },
      })?.kind
    ).toBe("add_interview");
    expect(
      computeNextStep({
        ...base,
        application: { ...base.application, mode: "manual" },
      })?.kind
    ).toBe("start_apply");
    expect(
      computeNextStep({
        ...base,
        application: { ...base.application, stage: "accepted" },
      })
    ).toBeNull();
  });
});
