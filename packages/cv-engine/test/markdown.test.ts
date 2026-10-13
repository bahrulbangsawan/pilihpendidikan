// TCV-MARKDOWN: formatCvMarkdown moved from apps/cv/src/lib/cv-markdown.ts
// unchanged. ./fixtures/markdown-baseline.json was exported by the apps/cv
// module before the move.
import { describe, expect, it } from "bun:test";
import { formatCvMarkdown } from "../src/markdown";
import { MARKDOWN_CASES, SAMPLE } from "./cases";
import baseline from "./fixtures/markdown-baseline.json";

const expected: Readonly<Record<string, string>> = baseline;

describe("TCV-MARKDOWN formatCvMarkdown", () => {
  for (const [name, data] of Object.entries(MARKDOWN_CASES)) {
    it(`TCV-MARKDOWN ${name}: same Markdown as before the move`, () => {
      expect(formatCvMarkdown(data)).toBe(expected[name] ?? "");
    });
  }

  it("TCV-MARKDOWN the baseline covers every case", () => {
    expect(Object.keys(expected).sort()).toEqual(
      Object.keys(MARKDOWN_CASES).sort()
    );
  });

  it("TCV-MARKDOWN writes the header, sections and bullets", () => {
    const markdown = formatCvMarkdown(SAMPLE);
    expect(markdown.startsWith("# Bahrul Bangsawan\n**GTM Engineer**")).toBe(
      true
    );
    expect(markdown).toContain("linkedin.com/in/bahrulbangsawan");
    expect(markdown).toContain("## Work Experience");
    expect(markdown).toContain(
      "- Driving product growth analytics and user acquisition strategy"
    );
    expect(markdown).toContain("*2022-02 – Present* | full-time · hybrid");
  });
});
