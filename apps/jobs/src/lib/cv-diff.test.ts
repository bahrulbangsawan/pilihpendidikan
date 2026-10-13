import { describe, expect, it } from "vitest";
import { sampleTailoredCv } from "@/test/fixtures-cv";
import { makeDiff } from "@/test/fixtures-rest";
import { buildDiffModel, entryLabels, parseDiff } from "./cv-diff";

describe("TW-CVDIFF the diff model (08 §4.5)", () => {
  it("TW-CVDIFF groups bullets by entry, labelled from the tailored CV, each with its sources", () => {
    const model = buildDiffModel(makeDiff(), sampleTailoredCv());
    expect(model.entries.map((entry) => entry.label)).toEqual([
      "Frontend Engineer · Belajar Bersama",
      "Web Developer · Toko Kita",
    ]);
    const [first, second] = model.entries;
    expect(first?.bullets.map((bullet) => bullet.operation)).toEqual([
      "keep",
      "rephrase",
    ]);
    expect(second?.bullets[0]?.sources.map((source) => source.id)).toEqual([
      "experience:exp-2:0",
      "experience:exp-2:1",
    ]);
    expect(first?.section).toBe("experience");
  });

  it("TW-CVDIFF flags only rephrased and merged lines as rewritten", () => {
    const model = buildDiffModel(makeDiff());
    const flags = model.entries.flatMap((entry) =>
      entry.bullets.map((bullet) => [bullet.operation, bullet.rewritten])
    );
    expect(flags).toEqual([
      ["keep", false],
      ["rephrase", true],
      ["merge", true],
      ["reorder", false],
    ]);
    expect(model.rewrittenCount).toBe(2);
  });

  it("TW-CVDIFF keeps excluded entries, the summary change, the section order and the notes", () => {
    const model = buildDiffModel(makeDiff());
    expect(model.excluded).toEqual([
      { section: "projects", entryId: "p-3", label: "Old portfolio site" },
    ]);
    expect(model.summary?.changed).toBe(true);
    expect(model.sectionOrder.changed).toBe(true);
    expect(model.notes).toContain(
      "The posting asks for GraphQL; it isn't in your CV."
    );
    expect(model.fallbacksToKeep).toBe(1);
    const same = buildDiffModel(
      makeDiff({
        section_order: { from: ["summary"], to: ["summary"] },
        summary: null,
      })
    );
    expect(same.sectionOrder.changed).toBe(false);
    expect(same.summary).toBeNull();
  });

  it("TW-CVDIFF falls back to entry ids without CVData and reads no diff from {}", () => {
    expect(buildDiffModel(makeDiff()).entries[0]?.label).toBe("exp-1");
    expect(parseDiff({})).toBeNull();
    expect(parseDiff(makeDiff())).not.toBeNull();
    expect(
      entryLabels({ experience: [{ id: "x", title: "", company: "" }] }).get(
        "x"
      )?.label
    ).toBe("x");
    expect(entryLabels(null).size).toBe(0);
  });
});
