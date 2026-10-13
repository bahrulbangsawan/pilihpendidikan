import { describe, expect, it } from "vitest";
import { makeInboxItem, makeScoreRecord } from "@/test/fixtures-rest";
import {
  barPercent,
  componentRows,
  explanationLines,
  hasBlocker,
  scoreBandOf,
  scoreCell,
  scoreSortValue,
} from "./inbox-score";
import { scoreComponentsOf } from "./score-explain";

const scored = (score: number | "queued" | null) =>
  makeInboxItem({ company: "Acme", title: "FE", score }).score;

describe("TW-INBOX scores in the inbox (12 §4, 07 §5 / §12)", () => {
  it("TW-INBOX the score cell is a number with a band, a queued mark, or none", () => {
    expect(scoreCell(scored(91))).toEqual({
      kind: "score",
      value: 91,
      band: "high",
      aiOff: false,
    });
    expect(scoreCell(scored(65))).toMatchObject({ band: "mid" });
    expect(scoreCell(scored(40))).toMatchObject({ band: "low" });
    expect(scoreCell(scored("queued"))).toEqual({ kind: "queued" });
    expect(scoreCell(null)).toEqual({ kind: "none" });
    const failed = scored(70);
    expect(scoreCell(failed ? { ...failed, status: "failed" } : null)).toEqual({
      kind: "none",
    });
    const aiOff = scored(70);
    expect(
      scoreCell(aiOff ? { ...aiOff, deterministic_only: true } : null)
    ).toMatchObject({ aiOff: true });
    expect(scoreBandOf(scored("queued"))).toBe("unscored");
    expect(scoreBandOf(null)).toBe("unscored");
    expect(
      [scored(50), scored("queued"), null, scored(90)].map(scoreSortValue)
    ).toEqual([50, -1, -2, 90]);
    expect(barPercent(0)).toBe(4);
    expect(barPercent(1.4)).toBe(100);
  });

  it("TW-INBOX explanation lines keep their marks; a gate line marks a blocker", () => {
    const lines = explanationLines(
      "⚠ Possible blocker: posting requires a degree you have not listed\n78 · Good match\n✓ Skills: python, aws (2 of 3)   ✗ Missing: kubernetes\n~ Seniority: posting senior, you mid\n· No target titles set\n"
    );
    expect(lines).toEqual([
      {
        mark: "warning",
        text: "Possible blocker: posting requires a degree you have not listed",
      },
      { mark: null, text: "78 · Good match" },
      { mark: "match", text: "Skills: python, aws (2 of 3)" },
      { mark: "missing", text: "Missing: kubernetes" },
      { mark: "partial", text: "Seniority: posting senior, you mid" },
      { mark: "neutral", text: "No target titles set" },
    ]);
    const base = scored(78);
    expect(hasBlocker(base)).toBe(false);
    expect(
      hasBlocker(
        base ? { ...base, explanation: "⚠ Blocker\n78 · Good match" } : null
      )
    ).toBe(true);
    expect(hasBlocker(scored("queued"))).toBe(false);
  });

  it("TW-INBOX the component breakdown has one bar per present component, AI fit scaled to 0–1", () => {
    const record = makeScoreRecord("pst_01J9ZZZZZZZZZZZZZZZZZZZZZ1");
    const components = scoreComponentsOf(record.components);
    expect(components).not.toBeNull();
    if (!components) {
      return;
    }
    const rows = componentRows(components);
    expect(rows.map((row) => row.name)).toEqual([
      "skills_overlap",
      "title_similarity",
      "location_fit",
      "seniority_fit",
      "language_fit",
      "freshness",
      "ai",
    ]);
    expect(rows[0]).toEqual({
      name: "skills_overlap",
      value: 0.75,
      weight: 0.25,
    });
    expect(rows.at(-1)).toEqual({ name: "ai", value: 0.75, weight: 0.2 });
    const aiOff = componentRows({
      ...components,
      ai: { ...components.ai, status: "disabled", overall_fit: null },
    });
    expect(aiOff.map((row) => row.name)).not.toContain("ai");
    expect(scoreComponentsOf({})).toBeNull();
  });
});
