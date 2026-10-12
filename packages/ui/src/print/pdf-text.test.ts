import { describe, expect, it } from "vitest";
import { toPrintLine, toPrintLines, toPrintText } from "./pdf-text";

describe("toPrintText", () => {
  it("composes accents and plains out characters the cuts lack", () => {
    expect(toPrintText("Dvořák")).toBe("Dvořák");
    expect(toPrintText("non‑breaking‐hyphen")).toBe("non-breaking-hyphen");
    expect(toPrintText("a\tb")).toBe("a b");
    expect(toPrintText("1 234")).toBe("1 234");
  });

  it("turns every kind of line break into a newline", () => {
    expect(toPrintText("a\r\nb\rc d\u000be")).toBe("a\nb\nc\nd\ne");
  });

  it("spells arrows out and drops emoji, keeping symbols the cuts have", () => {
    expect(toPrintText("Design → Build 🚀️")).toBe("Design -> Build ");
    expect(toPrintText("© 2026 ™")).toBe("© 2026 ™");
  });

  it("leaves scripts the cuts lack to the fallback font", () => {
    expect(toPrintText("王小明")).toBe("王小明");
  });
});

describe("toPrintLine", () => {
  it("collapses spaces and line breaks the way white-space: normal does", () => {
    expect(toPrintLine("  Line one.\n\nLine  two \n")).toBe(
      "Line one. Line two"
    );
  });
});

describe("toPrintLines", () => {
  it("keeps the user's lines the way white-space: pre-line does", () => {
    expect(
      toPrintLines("Jl. Veteran 17\r\n  RT 2  /  RW 3 \n").map((l) => l.text)
    ).toEqual(["Jl. Veteran 17", "RT 2 / RW 3"]);
  });

  it("keeps an empty line's height and gives repeated lines their own keys", () => {
    const lines = toPrintLines("a\n\na");
    expect(lines.map((l) => l.text)).toEqual(["a", " ", "a"]);
    expect(new Set(lines.map((l) => l.key)).size).toBe(3);
  });
});
