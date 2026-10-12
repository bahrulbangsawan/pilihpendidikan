import { describe, expect, it } from "vitest";
import type { CVData } from "@/components/cv-form";
import sample from "@/data/sample-cv.json";
import { getTextLines, toPdfText } from "./template-utils";

const SAMPLE = sample as CVData;

describe("toPdfText", () => {
  it("turns tabs into spaces and line endings into newlines", () => {
    const pdf = toPdfText({
      ...SAMPLE,
      summary: "First\tline\r\nSecond line\rThird",
    });
    expect(pdf.summary).toBe("First line\nSecond line\nThird");
  });

  it("keeps the newlines of the summary and descriptions", () => {
    const pdf = toPdfText(SAMPLE);
    expect(pdf.summary).toBe(SAMPLE.summary);
    expect(pdf.experience[0].description).toBe(
      SAMPLE.experience[0].description
    );
  });

  it("collapses a newline in a one-line field to a space", () => {
    const pdf = toPdfText({
      ...SAMPLE,
      personalInfo: { ...SAMPLE.personalInfo, fullName: "Zoë\nNúñez" },
      skills: [{ id: "s", name: "Tools", items: ["Figma\nPro"] }],
    });
    expect(pdf.personalInfo.fullName).toBe("Zoë Núñez");
    expect(pdf.skills[0].items).toEqual(["Figma Pro"]);
  });

  it("sets one-line fields as the preview does: one space, no ends", () => {
    const pdf = toPdfText({
      ...SAMPLE,
      personalInfo: { ...SAMPLE.personalInfo, jobTitle: "  GTM   Engineer " },
    });
    expect(pdf.personalInfo.jobTitle).toBe("GTM Engineer");
  });

  it("composes accents the print cuts have only precomposed", () => {
    const pdf = toPdfText({
      ...SAMPLE,
      personalInfo: { ...SAMPLE.personalInfo, fullName: "Dvor\u030cák" },
    });
    expect(pdf.personalInfo.fullName).toBe("Dvořák");
  });

  it("leaves everything else as it was", () => {
    const pdf = toPdfText(SAMPLE);
    expect(pdf).toEqual(SAMPLE);
    expect(pdf).not.toBe(SAMPLE);
  });
});

describe("getTextLines", () => {
  it("splits on newlines", () => {
    expect(getTextLines("One\nTwo").map((line) => line.text)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("adds no line for a trailing newline", () => {
    expect(getTextLines("One\n").map((line) => line.text)).toEqual(["One"]);
  });

  it("keeps an empty line's height with a no-break space", () => {
    expect(getTextLines("One\n\nTwo").map((line) => line.text)).toEqual([
      "One",
      " ",
      "Two",
    ]);
  });

  it("gives repeated lines distinct keys", () => {
    const keys = getTextLines("Same\nSame").map((line) => line.key);
    expect(new Set(keys).size).toBe(2);
  });
});
