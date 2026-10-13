import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { STAGES } from "@pilihpendidikan/jobs-contracts/enums";
import { canTransition } from "@pilihpendidikan/jobs-contracts/stage";
import { describe, expect, it, vi } from "vitest";
import { createPendingMovesStore } from "@/hooks/use-board";
import { makeApplication, makeBoard, makeCard, NOW } from "@/test/fixtures";
import { ApiError } from "./api-client";
import { applyPendingMoves, columnsFromBoard } from "./board-model";
import type { MoveOutcome } from "./board-move";
import {
  canMoveTo,
  checkMove,
  MOVE_RETRY_DELAYS_MS,
  runMove,
  sendMoveWithRetry,
} from "./board-move";

const noSleep = () => Promise.resolve();
function recordSleep(sleeps: number[]) {
  return (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
}

const network = () =>
  new ApiError({
    ok: false,
    status: 0,
    error: { error: "network_error", message: "offline" },
  });
const httpError = (
  status: number,
  error: string,
  details?: Record<string, never> | { reason: string } | { current: never }
) =>
  new ApiError({
    ok: false,
    status,
    error: {
      error,
      message: error,
      ...(details ? { details: details as never } : {}),
    },
  });

const saved = makeCard(
  { stage: "saved", company: "Acme", title: "Frontend" },
  0
);
const savedTwo = makeCard(
  { stage: "saved", company: "Globex", title: "Data" },
  1
);
const ready = makeCard({ stage: "ready", company: "Initech", title: "SRE" }, 0);
const board = makeBoard([saved, savedTwo, ready]);

describe("T6-05 optimistic move, rollback and retry", () => {
  it("T6-05 retries a network failure with the SAME Idempotency-Key (1 s, 2 s, 4 s)", async () => {
    const keys: string[] = [];
    const sleeps: number[] = [];
    const application = makeApplication({ id: saved.id, stage: "ready" });
    const send = vi.fn((key: string) => {
      keys.push(key);
      return keys.length < 3
        ? Promise.reject(network())
        : Promise.resolve(application);
    });
    const outcome = await sendMoveWithRetry(
      { send, sleep: recordSleep(sleeps) },
      "web:KEY-1"
    );
    expect(outcome).toEqual({ kind: "moved", application, attempts: 3 });
    expect(keys).toEqual(["web:KEY-1", "web:KEY-1", "web:KEY-1"]);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("T6-05 gives up after 3 retries with the same key and reports network_failed", async () => {
    const keys: string[] = [];
    const sleeps: number[] = [];
    const outcome = await sendMoveWithRetry(
      {
        send: (key) => {
          keys.push(key);
          return Promise.reject(network());
        },
        sleep: recordSleep(sleeps),
      },
      "web:KEY-2"
    );
    expect(outcome).toEqual({ kind: "network_failed", attempts: 4 });
    expect(new Set(keys)).toEqual(new Set(["web:KEY-2"]));
    expect(keys).toHaveLength(4);
    expect(sleeps).toEqual([...MOVE_RETRY_DELAYS_MS]);
  });

  it("T6-05 a 409 rolls back at once (no retry) and carries details.current", async () => {
    const current = makeApplication({
      id: saved.id,
      stage: "applied",
      revision: 9,
    });
    const send = vi.fn(() =>
      Promise.reject(
        httpError(409, "revision_conflict", { current: current as never })
      )
    );
    const outcome = await sendMoveWithRetry({ send, sleep: noSleep }, "k");
    expect(outcome).toEqual({ kind: "conflict", current, attempts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("T6-05 a 422 rolls back with the reason (no retry)", async () => {
    const send = vi.fn(() =>
      Promise.reject(
        httpError(422, "invalid_transition", {
          reason: "submission_in_flight",
        })
      )
    );
    const outcome = await sendMoveWithRetry({ send, sleep: noSleep }, "k");
    expect(outcome).toMatchObject({
      kind: "invalid",
      reason: "submission_in_flight",
      attempts: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  async function run(
    send: (key: string) => Promise<ReturnType<typeof makeApplication>>
  ) {
    const pending = createPendingMovesStore();
    const commit = vi.fn();
    const shownDuringSend: string[] = [];
    const outcome: MoveOutcome = await runMove({
      card: saved,
      target: "ready",
      beforeId: ready.id,
      afterId: null,
      idempotencyKey: "web:KEY-3",
      pending,
      commit,
      sleep: noSleep,
      send: (key) => {
        // While the request is in flight the card shows in its new column.
        const columns = applyPendingMoves(
          columnsFromBoard(board),
          pending.getSnapshot()
        );
        shownDuringSend.push(columns.ready.map((card) => card.id).join(","));
        return send(key);
      },
    });
    return { outcome, pending, commit, shownDuringSend };
  }

  it("T6-05 shows the card in place while in flight and commits the server row on success", async () => {
    const application = makeApplication({
      id: saved.id,
      stage: "ready",
      revision: 4,
    });
    const { outcome, pending, commit, shownDuringSend } = await run(() =>
      Promise.resolve(application)
    );
    expect(shownDuringSend[0]).toBe(`${ready.id},${saved.id}`);
    expect(outcome.kind).toBe("moved");
    expect(commit).toHaveBeenCalledWith(application);
    expect(pending.getSnapshot()).toEqual([]);
  });

  it("T6-05 409, 422 and network failures remove the overlay (rollback) without committing", async () => {
    const failures = [
      () =>
        httpError(409, "revision_conflict", {
          current: makeApplication({ id: saved.id }) as never,
        }),
      () => httpError(422, "invalid_transition", { reason: "nope" }),
      network,
    ];
    for (const failure of failures) {
      const { outcome, pending, commit } = await run(() =>
        Promise.reject(failure())
      );
      expect(outcome.kind).not.toBe("moved");
      expect(commit).not.toHaveBeenCalled();
      expect(pending.getSnapshot()).toEqual([]);
      const columns = applyPendingMoves(
        columnsFromBoard(board),
        pending.getSnapshot()
      );
      expect(columns.saved.map((card) => card.id)).toContain(saved.id);
    }
  });

  it("T6-05 the overlay places a card between before_id and after_id", () => {
    const columns = applyPendingMoves(columnsFromBoard(board), [
      {
        cardId: ready.id,
        stage: "saved",
        beforeId: saved.id,
        afterId: savedTwo.id,
      },
    ]);
    expect(columns.saved.map((card) => card.id)).toEqual([
      saved.id,
      ready.id,
      savedTwo.id,
    ]);
    expect(columns.ready).toEqual([]);
    const top = applyPendingMoves(columnsFromBoard(board), [
      { cardId: ready.id, stage: "saved", beforeId: null, afterId: saved.id },
    ]);
    expect(top.saved[0]?.id).toBe(ready.id);
  });
});

describe("TW-TRANSITION client validation uses the contracts' canTransition", () => {
  it("TW-TRANSITION every from → to on the board matches canTransition(from, to, 'user')", () => {
    for (const from of STAGES) {
      const card = makeCard({ stage: from, company: "A", title: "T" }, 0, {
        submission_status: "submitted_verified",
      });
      for (const to of STAGES) {
        const check = checkMove(card, to);
        if (from === to) {
          expect(check.kind).toBe("reorder");
          continue;
        }
        expect(check.kind === "illegal", `${from} → ${to}`).toBe(
          !canTransition(from, to, "user")
        );
        expect(canMoveTo(from, to)).toBe(canTransition(from, to, "user"));
      }
    }
  });

  it("TW-TRANSITION known edges: applied → preparing refused, accepted is terminal, reopen allowed", () => {
    const at = (stage: Stage) => makeCard({ stage, company: "A", title: "T" });
    expect(checkMove(at("applied"), "preparing").kind).toBe("illegal");
    expect(checkMove(at("accepted"), "interviewing").kind).toBe("illegal");
    expect(checkMove(at("rejected"), "saved").kind).toBe("ok");
    expect(checkMove(at("applied"), "offer").kind).toBe("ok");
  });

  it("TW-TRANSITION asks before the 06 §2.2 drops", () => {
    const notStarted = makeCard({ stage: "ready", company: "A", title: "T" });
    expect(checkMove(notStarted, "applied").kind).toBe("confirm_applied");
    const live = makeCard({ stage: "ready", company: "A", title: "T" }, 0, {
      live_task: {
        id: "tsk_01J00000000000000000000000",
        kind: "apply",
        state: "running",
        device_id: null,
        device_name: "MacBook",
        pause_reason: null,
        progress_stage: "filling",
        submit_intent_at: null,
        updated_at: NOW,
      },
    });
    expect(checkMove(live, "rejected")).toEqual({
      kind: "confirm_cancel_task",
      taskId: "tsk_01J00000000000000000000000",
    });
    const waiting = {
      ...live,
      live_task: {
        ...(live.live_task as NonNullable<typeof live.live_task>),
        state: "awaiting_approval" as const,
      },
    };
    expect(checkMove(waiting, "preparing").kind).toBe(
      "confirm_discard_approval"
    );
    // ready → saved is not an edge of 03 §5.1, so it never reaches the dialog.
    expect(checkMove(waiting, "saved").kind).toBe("illegal");
    const submitting = {
      ...live,
      live_task: {
        ...(live.live_task as NonNullable<typeof live.live_task>),
        submit_intent_at: NOW,
      },
    };
    expect(checkMove(submitting, "withdrawn").kind).toBe(
      "submission_in_flight"
    );
  });
});
