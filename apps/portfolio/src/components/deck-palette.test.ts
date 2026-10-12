import { describe, expect, it } from "vitest";
import styles from "../styles.css?raw";

// The paper's palette and type in the preview's stylesheet (the `.pf-*`
// rules). The deck is a print artifact: its colours are literals so Night
// Desk never re-themes it, and it keeps no Warp colour. The PDF is tested as
// rendered in deck-render.test.tsx, which also holds it to exactly this
// palette.
const ZEDATIVE_DECK = [
  "#2f343e", // cover: shot
  "#fafafa", // cover text; chip and image-slot fill on paper
  "#b4b9c3", // cover secondary text
  "#9aa1ad", // cover footer text
  "#858c99", // the cover title's full stop
  "#4a505c", // cover rule
  "#1348dc", // links on paper
  "#7c9cff", // links on the cover
  "#ffffff", // paper
  "#000000", // fg: project title, headings, the author's name
  "#393d45", // ink: body copy
  "#5a6170", // fg-muted: rail values, chips, meta
  "#cbcfd4", // line: hairline rules
  "#dadde2", // border: chip and image frames
];

const WARP = ["#121212", "#6f839f", "#bd9f65", "#faf9f6", "#b4b4b2", "#868684"];

// The neutral greys the paper used before it took Zedative's ink.
const RETIRED_GREYS = [
  "#1d1d1f",
  "#6e6e73",
  "#a1a1a6",
  "#e3e3e6",
  "#f5f5f7",
  "#d6d6da",
];

// The static Inter cuts the PDF embeds, the only weights the paper sets:
// 400 text, 600 headings and names, 700 the cover title.
const WEIGHTS = ["400", "600", "700"];

const FAMILY = /font-family:\s*([^;]+);/g;
const WEIGHT = /font-weight:\s*(\d+)/g;
const CASE_OR_TRACKING = /text-transform|letter-spacing/;

const preview = styles.toLowerCase();

function captures(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("portfolio deck palette", () => {
  it.each(ZEDATIVE_DECK)("defines %s on the paper", (hex) => {
    expect(preview).toContain(hex);
  });

  it.each(WARP)("no longer uses the Warp colour %s", (hex) => {
    expect(preview).not.toContain(hex);
  });

  it.each(RETIRED_GREYS)("no longer uses the neutral grey %s", (hex) => {
    expect(preview).not.toContain(hex);
  });
});

describe("portfolio deck type", () => {
  it("sets one family, Inter, through the theme's sans stack", () => {
    expect(captures(styles, FAMILY)).toEqual(["var(--font-sans)"]);
  });

  it("uses only the weights of the PDF's cuts", () => {
    const weights = captures(styles, WEIGHT);
    expect(weights.length).toBeGreaterThan(0);
    expect(weights.filter((w) => !WEIGHTS.includes(w))).toEqual([]);
  });

  it("sets no uppercase and no letter-spacing on paper", () => {
    expect(styles).not.toMatch(CASE_OR_TRACKING);
  });

  it("frames the 16:9 image as a 2px Zedative tile", () => {
    const start = styles.indexOf(".pf-figure {");
    expect(start).toBeGreaterThan(-1);
    expect(styles.slice(start, styles.indexOf("}", start))).toContain(
      "border-radius: 2px;"
    );
  });
});
