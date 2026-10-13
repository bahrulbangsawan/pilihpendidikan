// TCV-BULLETS: flattenCvBullets gives every description line and summary
// sentence a provenance id (08 §4.2), splitting lines as the templates do.
import { describe, expect, it } from "bun:test";
import { flattenCvBullets, splitSentences } from "../src/bullets";
import { createEmptyCV } from "../src/document";
import { getDescriptionLines } from "../src/template-utils";
import type { CVData } from "../src/types";
import { EXTENDED, SAMPLE } from "./cases";

function texts(cv: CVData, prefix: string): [string, string][] {
  return flattenCvBullets(cv)
    .filter((bullet) => bullet.id.startsWith(prefix))
    .map((bullet) => [bullet.id, bullet.text]);
}

describe("TCV-BULLETS flattenCvBullets", () => {
  it("TCV-BULLETS ids an experience line as experience:<entry>:<line>", () => {
    expect(texts(SAMPLE, "experience:exp-1:")).toEqual([
      [
        "experience:exp-1:0",
        "Leading marketing operations, multi-channel funnel optimization, and data infrastructure for a family wellness club",
      ],
      [
        "experience:exp-1:1",
        "Driving product growth analytics and user acquisition strategy",
      ],
      [
        "experience:exp-1:2",
        "Building and maintaining data pipelines for business intelligence",
      ],
    ]);
    const bullet = flattenCvBullets(SAMPLE).find(
      (item) => item.id === "experience:exp-1:2"
    );
    expect(bullet).toEqual({
      id: "experience:exp-1:2",
      section: "experience",
      entry_id: "exp-1",
      text: "Building and maintaining data pipelines for business intelligence",
    });
  });

  it("TCV-BULLETS splits lines exactly like getDescriptionLines", () => {
    // "  Built things  \n\nBuilt things\nShipped v2 to 10,000 users\n"
    expect(texts(EXTENDED, "experience:exp-a:")).toEqual([
      ["experience:exp-a:0", "Built things"],
      ["experience:exp-a:1", "Built things"],
      ["experience:exp-a:2", "Shipped v2 to 10,000 users"],
    ]);
    for (const cv of [SAMPLE, EXTENDED]) {
      for (const entry of [...cv.experience, ...cv.projects, ...cv.awards]) {
        const lines = getDescriptionLines(entry.description).map(
          (line) => line.text
        );
        const bullets = flattenCvBullets(cv)
          .filter((bullet) => bullet.entry_id === entry.id)
          .map((bullet) => bullet.text);
        expect(bullets).toEqual(lines);
      }
    }
  });

  it("TCV-BULLETS ids summary sentences as summary:0:<sentence>", () => {
    const summary = flattenCvBullets(SAMPLE).filter(
      (bullet) => bullet.section === "summary"
    );
    expect(summary.map((bullet) => bullet.id)).toEqual([
      "summary:0:0",
      "summary:0:1",
      "summary:0:2",
      "summary:0:3",
    ]);
    expect(summary.every((bullet) => bullet.entry_id === "0")).toBe(true);
    expect(summary[1]?.text).toBe(
      "Helping brands scale with data-driven strategies, marketing automation, and modern web technology."
    );
  });

  it("TCV-BULLETS counts sentences across the summary's lines", () => {
    const cv: CVData = {
      ...createEmptyCV(),
      summary:
        "Engineer with 3.5 years in fintech. Led a team of 4!\n\nShipped e.g. payments. Worked with Dr. Rahma on it.",
    };
    expect(texts(cv, "summary:")).toEqual([
      ["summary:0:0", "Engineer with 3.5 years in fintech."],
      ["summary:0:1", "Led a team of 4!"],
      ["summary:0:2", "Shipped e.g. payments."],
      ["summary:0:3", "Worked with Dr. Rahma on it."],
    ]);
  });

  it("TCV-BULLETS covers projects, volunteer work and awards only", () => {
    const sections = new Set(
      flattenCvBullets(EXTENDED).map((bullet) => bullet.section)
    );
    expect([...sections].sort()).toEqual([
      "awards",
      "experience",
      "projects",
      "summary",
      "volunteer",
    ]);
    expect(texts(EXTENDED, "volunteer:")).toEqual([
      ["volunteer:vol-1:0", "Taught weekly sessions"],
      ["volunteer:vol-1:1", "Ran the yearly showcase"],
    ]);
    expect(texts(EXTENDED, "awards:award-1:")).toEqual([
      ["awards:award-1:0", "Awarded for work on retrieval"],
      ["awards:award-1:1", "Presented in Dublin"],
    ]);
    expect(texts(EXTENDED, "projects:proj-x:")).toEqual([]);
    expect(texts(EXTENDED, "experience:exp-b:")).toEqual([]);
  });

  it("TCV-BULLETS lists bullets in reading order with unique ids", () => {
    const bullets = flattenCvBullets(EXTENDED);
    // volunteer, awards, summary, experience, projects, …
    const order = [...new Set(bullets.map((bullet) => bullet.section))];
    expect(order).toEqual([
      "volunteer",
      "awards",
      "summary",
      "experience",
      "projects",
    ]);
    for (const cv of [SAMPLE, EXTENDED]) {
      const ids = flattenCvBullets(cv).map((bullet) => bullet.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("TCV-BULLETS still flattens sections sectionOrder leaves out", () => {
    const cv: CVData = { ...SAMPLE, sectionOrder: ["projects"] };
    const sections = [
      ...new Set(flattenCvBullets(cv).map((bullet) => bullet.section)),
    ];
    expect(sections).toEqual(["projects", "summary", "experience"]);
  });

  it("TCV-BULLETS gives a blank CV no bullets", () => {
    expect(flattenCvBullets(createEmptyCV())).toEqual([]);
  });
});

describe("TCV-BULLETS splitSentences", () => {
  it("TCV-BULLETS keeps each sentence exactly as written", () => {
    expect(splitSentences("One.  Two? Three")).toEqual([
      "One.",
      "Two?",
      "Three",
    ]);
    expect(splitSentences('He said "Go." Then left.')).toEqual([
      'He said "Go."',
      "Then left.",
    ]);
  });

  it("TCV-BULLETS does not split numbers, initials or lowercase", () => {
    expect(splitSentences("Grew revenue 2.5x. then more")).toEqual([
      "Grew revenue 2.5x. then more",
    ]);
    expect(
      splitSentences("Mentored by J. Smith at Acme Inc. Since 2020.")
    ).toEqual(["Mentored by J. Smith at Acme Inc. Since 2020."]);
    expect(splitSentences("")).toEqual([]);
  });
});
