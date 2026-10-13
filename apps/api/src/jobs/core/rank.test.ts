import { describe, expect, it } from "bun:test";
import {
  isValidRank,
  placeInColumn,
  RANK_MAX_LENGTH,
  rankAfter,
  rankBetween,
  rebalanceRanks,
  REBALANCE_RANK_LENGTH,
} from "./rank";

// Deterministic PRNG (Park–Miller minimal standard) so the property runs are
// reproducible; plain arithmetic, products stay below 2^53.
function prng(seed: number): () => number {
  let state = seed % 2_147_483_647 || 1;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
}

describe("T6-02 rankBetween (06 §1.2)", () => {
  it("T6-02 rankBetween is strictly between its bounds and stays a valid rank", () => {
    const random = prng(42);
    const ranks: string[] = [rankBetween(null, null)];
    for (let i = 0; i < 2000; i++) {
      const at = Math.floor(random() * (ranks.length + 1));
      const lower = at > 0 ? ranks[at - 1] : null;
      const upper = at < ranks.length ? ranks[at] : null;
      const rank = rankBetween(lower, upper);
      expect(isValidRank(rank)).toBe(true);
      if (lower !== null) {
        expect(rank > lower).toBe(true);
      }
      if (upper !== null) {
        expect(rank < upper).toBe(true);
      }
      ranks.splice(at, 0, rank);
    }
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("T6-02 ranks compare as plain strings over 0-9a-z", () => {
    expect(rankBetween(null, null)).toBe("i");
    expect(rankAfter("z")).toBe("zi");
    expect(rankBetween(null, "1")).toBe("0i");
    expect(rankBetween("a", "b")).toBe("ai");
    expect(rankBetween("az", "b")).toBe("azi");
    for (const bad of ["", "a0", "A", "a-b"]) {
      expect(isValidRank(bad)).toBe(false);
      expect(() => rankBetween(bad, null)).toThrow();
    }
    expect(() => rankBetween("b", "a")).toThrow();
    expect(() => rankBetween("b", "b")).toThrow();
  });

  it("T6-02 repeated inserts at one spot trigger a rebalance at 32 characters that preserves order", () => {
    let column = [
      { id: "a", rank: "a" },
      { id: "b", rank: "b" },
    ];
    let rebalanced = false;
    for (let i = 0; i < 300 && !rebalanced; i++) {
      // Always drop the new card directly below "a" (the densest gap).
      const id = `n${i}`;
      const placement = placeInColumn(column, id, { beforeId: "a" });
      if (placement.rebalance) {
        rebalanced = true;
        const ids = placement.rebalance.map((r) => r.id);
        expect(ids[0]).toBe("a");
        expect(ids[1]).toBe(id);
        expect(ids.at(-1)).toBe("b");
        const ranks = placement.rebalance.map((r) => r.rank);
        expect([...ranks].sort()).toEqual(ranks);
        for (const rank of ranks) {
          expect(rank).toHaveLength(REBALANCE_RANK_LENGTH);
          expect(isValidRank(rank)).toBe(true);
        }
        expect(placement.rank).toBe(ranks[1]);
        break;
      }
      expect(placement.rank.length).toBeLessThanOrEqual(RANK_MAX_LENGTH);
      column = [column[0], { id, rank: placement.rank }, ...column.slice(1)];
    }
    expect(rebalanced).toBe(true);
  });

  it("T6-02 rebalanceRanks spaces ranks evenly in ascending order", () => {
    for (const count of [0, 1, 2, 37, 500, 5000]) {
      const ranks = rebalanceRanks(count);
      expect(ranks).toHaveLength(count);
      expect([...ranks].sort()).toEqual(ranks);
      expect(new Set(ranks).size).toBe(count);
      for (const rank of ranks) {
        expect(rank).toHaveLength(6);
        expect(isValidRank(rank)).toBe(true);
      }
    }
  });

  it("T6-02 placeInColumn resolves stale neighbours against the current column", () => {
    const column = [
      { id: "a", rank: "c" },
      { id: "b", rank: "m" },
      { id: "c", rank: "t" },
    ];
    const between = placeInColumn(column, "x", { beforeId: "a", afterId: "b" });
    expect(between.rank > "c" && between.rank < "m").toBe(true);
    // A stale after_id: before_id wins (right below "b").
    const stale = placeInColumn(column, "x", { beforeId: "b", afterId: "a" });
    expect(stale.rank > "m" && stale.rank < "t").toBe(true);
    // Unknown before_id, known after_id: right above it.
    const above = placeInColumn(column, "x", {
      beforeId: "gone",
      afterId: "a",
    });
    expect(above.rank < "c").toBe(true);
    // Neither known: append.
    expect(placeInColumn(column, "x", {}).rank > "t").toBe(true);
    // The moving card itself is ignored (move within a column).
    const self = placeInColumn(column, "b", { beforeId: "c" });
    expect(self.rank > "t").toBe(true);
    // Duplicate stored ranks force a rebalance instead of a bad midpoint.
    const broken = placeInColumn(
      [
        { id: "p", rank: "k" },
        { id: "q", rank: "k" },
      ],
      "x",
      { beforeId: "p" }
    );
    expect(broken.rebalance?.map((r) => r.id)).toEqual(["p", "x", "q"]);
  });
});
