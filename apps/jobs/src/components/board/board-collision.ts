// Collision detection for the desktop board (12 §3, 06 §2): the column under
// the pointer decides where a lifted card is, and only then do the corners of
// the dragged card pick a slot inside that column.
//
// Plain `closestCorners` over every droppable also scores the lifted card's
// own sortable slot, still standing in its origin column. A column body is
// tall, so when the pointer ends in the upper part of the neighbouring column
// the card's own slot is "closer" than that column and nothing moves. Scoping
// the corner test to the column under the pointer leaves the origin slot out
// whenever the pointer is elsewhere, and keeps within-column reordering as it
// was (the card's own slot, its neighbours and the column body compete).
//
// The point is the pointer (mouse, pen, touch) or, for the keyboard sensor
// (no pointer coordinates), the centre of the dragged card, which the board's
// keyboard getter places inside the target column. A point over a column
// header or a gap picks the column whose horizontal span holds it (the nearest
// one vertically: the closed lane stacks Rejected over Withdrawn). Outside
// every column the detection falls back to `closestCorners`.

import type {
  ClientRect,
  CollisionDetection,
  DroppableContainer,
} from "@dnd-kit/core";
import { closestCorners } from "@dnd-kit/core";

type CollisionArgs = Parameters<CollisionDetection>[0];

interface Point {
  x: number;
  y: number;
}

/** The `{type, stage}` data the board's droppables carry (board-columns). */
interface BoardDroppableData {
  stage?: unknown;
  type?: unknown;
}

function dataOf(container: DroppableContainer): BoardDroppableData {
  return (container.data.current ?? {}) as BoardDroppableData;
}

function isColumn(container: DroppableContainer): boolean {
  return dataOf(container).type === "column";
}

function stageOf(container: DroppableContainer): string | null {
  const { stage } = dataOf(container);
  return typeof stage === "string" ? stage : null;
}

function centreOf(rect: ClientRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Vertical distance from the point to the rect (0 when level with it). */
function verticalGap(point: Point, rect: ClientRect): number {
  if (point.y < rect.top) {
    return rect.top - point.y;
  }
  const bottom = rect.top + rect.height;
  return point.y > bottom ? point.y - bottom : 0;
}

/**
 * The column droppable under `point`: the one containing it, else the one
 * whose horizontal span holds it and that is vertically nearest; null when
 * the point is left or right of every column.
 */
export function columnUnderPoint(
  point: Point,
  containers: readonly DroppableContainer[],
  rects: CollisionArgs["droppableRects"]
): DroppableContainer | null {
  let best: DroppableContainer | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const container of containers) {
    const rect = isColumn(container) ? rects.get(container.id) : undefined;
    if (!rect || point.x < rect.left || point.x > rect.left + rect.width) {
      continue;
    }
    const gap = verticalGap(point, rect);
    if (gap < bestGap) {
      best = container;
      bestGap = gap;
    }
  }
  return best;
}

/** The board's `collisionDetection` (see the file header). */
export const boardCollisionDetection: CollisionDetection = (args) => {
  const point = args.pointerCoordinates ?? centreOf(args.collisionRect);
  const column = columnUnderPoint(
    point,
    args.droppableContainers,
    args.droppableRects
  );
  if (!column) {
    return closestCorners(args);
  }
  const stage = stageOf(column);
  const candidates = args.droppableContainers.filter(
    (container) =>
      container.id === column.id ||
      (stage !== null && !isColumn(container) && stageOf(container) === stage)
  );
  const collisions = closestCorners({
    ...args,
    droppableContainers: candidates,
  });
  return collisions.length > 0 ? collisions : [{ id: column.id }];
};
