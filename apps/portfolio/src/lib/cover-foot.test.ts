import { describe, expect, it } from "vitest";
import { LINES } from "@/components/portfolio-data-model";
import { coverFootLines } from "./cover-foot";

const sum = (lines: number[]) => lines.reduce((total, n) => total + n, 0);

describe("coverFootLines", () => {
  it("gives a lone entry the whole column", () => {
    expect(coverFootLines(1)).toEqual([LINES.cover.contactValue]);
  });

  it("gives the first entry the lines the later ones leave", () => {
    expect(coverFootLines(2)).toEqual([2, 1]);
    expect(coverFootLines(3)).toEqual([1, 1, 1]);
  });

  it("never runs a column past its lines, and every entry it shows keeps one", () => {
    for (let entries = 0; entries <= 6; entries += 1) {
      const lines = coverFootLines(entries);
      expect(lines).toHaveLength(Math.min(entries, LINES.cover.contactValue));
      expect(sum(lines)).toBeLessThanOrEqual(LINES.cover.contactValue);
      expect(lines.every((n) => n >= 1)).toBe(true);
    }
  });

  it("gives an empty column nothing", () => {
    expect(coverFootLines(0)).toEqual([]);
  });
});
