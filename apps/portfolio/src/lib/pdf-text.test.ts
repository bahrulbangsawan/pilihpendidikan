import { describe, expect, it } from "vitest";
import type { Portfolio } from "@/components/portfolio-data-model";
import sample from "@/data/sample-portfolio.json";
import { toPdfText } from "./pdf-text";

const SAMPLE = sample as Portfolio;

describe("toPdfText", () => {
  it("runs line breaks and tabs on as spaces, as the preview shows them", () => {
    const [project] = SAMPLE.projects;
    const pdf = toPdfText({
      ...SAMPLE,
      projects: [
        {
          ...project,
          summary: "First line\r\nsecond line",
          learnings: "Tab\tseparated\nnotes",
        },
      ],
    });
    expect(pdf.projects[0].summary).toBe("First line second line");
    expect(pdf.projects[0].learnings).toBe("Tab separated notes");
  });

  it("collapses a blank line to one space, as the preview's paragraph does", () => {
    const [project] = SAMPLE.projects;
    const pdf = toPdfText({
      ...SAMPLE,
      projects: [{ ...project, summary: "Line one.\n\nLine two. " }],
    });
    expect(pdf.projects[0].summary).toBe("Line one. Line two.");
  });

  it("leaves the rest of the portfolio alone", () => {
    expect(toPdfText(SAMPLE)).toEqual(SAMPLE);
  });
});
