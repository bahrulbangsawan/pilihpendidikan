import type {
  Active,
  ClientRect,
  CollisionDetection,
  DroppableContainer,
  UniqueIdentifier,
} from "@dnd-kit/core";
import { closestCorners } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import { boardCollisionDetection, columnUnderPoint } from "./board-collision";

// A desktop board laid out like the real one: column bodies 280 px wide side
// by side (the header sits above each body), cards 264 x 112 inside, and the
// closed lane stacking Rejected over Withdrawn.

type Args = Parameters<CollisionDetection>[0];
type Kind = "card" | "column";

interface Box {
  height: number;
  id: string;
  kind: Kind;
  left: number;
  stage: string;
  top: number;
  width: number;
}

const BODY_TOP = 120;
const COLUMN_WIDTH = 280;
const CARD = { width: 264, height: 112 };

function rectOf(box: Pick<Box, "height" | "left" | "top" | "width">) {
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    right: box.left + box.width,
    bottom: box.top + box.height,
  } satisfies ClientRect;
}

function column(stage: string, left: number, top = BODY_TOP, height = 760) {
  return {
    id: `column:${stage}`,
    kind: "column",
    stage,
    left,
    top,
    width: COLUMN_WIDTH,
    height,
  } satisfies Box;
}

function card(id: string, stage: string, columnLeft: number, slot: number) {
  return {
    id,
    kind: "card",
    stage,
    left: columnLeft + 8,
    top: BODY_TOP + 8 + slot * (CARD.height + 8),
    ...CARD,
  } satisfies Box;
}

function containerOf(box: Box): DroppableContainer {
  return {
    id: box.id,
    key: box.id,
    data: { current: { type: box.kind, stage: box.stage } },
    disabled: false,
    node: { current: null },
    rect: { current: rectOf(box) },
  };
}

const READY = 0;
const APPLIED = 288;
const INTERVIEWING = 576;
const LANE = 864;

function board(extra: Box[] = []): Box[] {
  return [
    column("ready", READY),
    card("r1", "ready", READY, 0),
    card("r2", "ready", READY, 1),
    column("applied", APPLIED),
    column("interviewing", INTERVIEWING),
    card("i1", "interviewing", INTERVIEWING, 0),
    column("rejected", LANE, BODY_TOP, 300),
    column("withdrawn", LANE, 440, 300),
    ...extra,
  ];
}

/** The collision args of a drag of `activeId` with its overlay at `overlay`. */
function argsFor(
  boxes: Box[],
  activeId: UniqueIdentifier,
  overlay: { left: number; top: number },
  pointer: { x: number; y: number } | null
): Args {
  const active: Active = {
    id: activeId,
    data: { current: { type: "card" } },
    rect: { current: { initial: null, translated: null } },
  };
  return {
    active,
    collisionRect: rectOf({ ...CARD, ...overlay }),
    droppableRects: new Map(boxes.map((box) => [box.id, rectOf(box)])),
    droppableContainers: boxes.map(containerOf),
    pointerCoordinates: pointer,
  };
}

const ids = (collisions: ReturnType<CollisionDetection>) =>
  collisions.map((collision) => String(collision.id));

describe("TFIX-BOARD-DROP the column under the pointer decides the drop", () => {
  it("TFIX-BOARD-DROP a card released in the upper part of the next column lands in that column", () => {
    // r1 grabbed at its centre (140, 184), released 30 px below the Applied
    // header: the overlay's top edge is above the column body.
    const withoutInterviews = board().filter((box) => box.id !== "i1");
    const args = argsFor(
      withoutInterviews,
      "r1",
      { left: 298, top: 94 },
      { x: 430, y: 150 }
    );
    // The regression: plain closestCorners scores the card's own slot, still
    // in Ready, closer than the tall Applied body, so nothing moved.
    expect(ids(closestCorners(args))[0]).toBe("r1");
    expect(ids(boardCollisionDetection(args))).toEqual(["column:applied"]);
  });

  it("TFIX-BOARD-DROP only the target column and its cards compete, never the origin slot", () => {
    const args = argsFor(
      board(),
      "r1",
      { left: 586, top: 96 },
      { x: 716, y: 140 }
    );
    const found = ids(boardCollisionDetection(args));
    expect(found[0]).toBe("i1");
    expect(new Set(found)).toEqual(new Set(["i1", "column:interviewing"]));
  });

  it("TFIX-BOARD-DROP once the draft moved the card over, its own slot in the new column still counts", () => {
    // onDragOver moved r1 into Applied (its droppable now carries that stage).
    const moved = board().filter((box) => box.id !== "r1");
    moved.push(card("r1", "applied", APPLIED, 0));
    const args = argsFor(
      moved,
      "r1",
      { left: 296, top: 100 },
      { x: 428, y: 156 }
    );
    expect(ids(boardCollisionDetection(args))).toEqual([
      "r1",
      "column:applied",
    ]);
  });

  it("TFIX-BOARD-DROP reordering within a column keeps working", () => {
    // r1 dragged down over r2 inside Ready.
    const args = argsFor(
      board(),
      "r1",
      { left: 8, top: 252 },
      { x: 140, y: 308 }
    );
    const found = ids(boardCollisionDetection(args));
    expect(found[0]).toBe("r2");
    expect(new Set(found)).toEqual(new Set(["r1", "r2", "column:ready"]));
  });

  it("TFIX-BOARD-DROP the keyboard (no pointer) follows the dragged card's centre", () => {
    // ArrowRight: the board's coordinate getter puts the card 8 px below the
    // top of the next column body, centred.
    const right = argsFor(
      board(),
      "r1",
      { left: APPLIED + 8, top: BODY_TOP + 8 },
      null
    );
    expect(ids(boardCollisionDetection(right))).toEqual(["column:applied"]);
    // ArrowDown inside Ready: the sortable getter moves it onto r2's slot.
    const down = argsFor(board(), "r1", { left: 8, top: 248 }, null);
    expect(ids(boardCollisionDetection(down))[0]).toBe("r2");
  });

  it("TFIX-BOARD-DROP a pointer over a header or between stacked lanes picks the column below or nearest", () => {
    const header = argsFor(
      board(),
      "r1",
      { left: 298, top: 40 },
      { x: 430, y: 96 }
    );
    expect(ids(boardCollisionDetection(header))).toEqual(["column:applied"]);
    const lane = board();
    const rects = new Map(lane.map((box) => [box.id, rectOf(box)]));
    const containers = lane.map(containerOf);
    expect(columnUnderPoint({ x: 1000, y: 200 }, containers, rects)?.id).toBe(
      "column:rejected"
    );
    expect(columnUnderPoint({ x: 1000, y: 435 }, containers, rects)?.id).toBe(
      "column:withdrawn"
    );
    expect(columnUnderPoint({ x: 1000, y: 500 }, containers, rects)?.id).toBe(
      "column:withdrawn"
    );
    // Cards are never columns.
    expect(columnUnderPoint({ x: 2000, y: 200 }, containers, rects)).toBeNull();
  });

  it("TFIX-BOARD-DROP outside every column it falls back to closestCorners", () => {
    const args = argsFor(
      board(),
      "r1",
      { left: 1300, top: 140 },
      { x: 1400, y: 190 }
    );
    expect(boardCollisionDetection(args)).toEqual(closestCorners(args));
  });
});
