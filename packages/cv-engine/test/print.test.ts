// toPdfText and getTextLines, moved from apps/cv's template-utils.test.ts
// with the templates.
import { describe, expect, it } from "bun:test";
import { getTextLines, registerCvPrintText, toPdfText } from "../src/pdf/print";
import { SAMPLE } from "./cases";
import { PRINT_TEXT } from "./print-setup";

registerCvPrintText(PRINT_TEXT);

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
    expect(pdf.experience[0]?.description).toBe(
      SAMPLE.experience[0]?.description
    );
  });

  it("collapses a newline in a one-line field to a space", () => {
    const pdf = toPdfText({
      ...SAMPLE,
      personalInfo: { ...SAMPLE.personalInfo, fullName: "Zoë\nNúñez" },
      skills: [{ id: "s", name: "Tools", items: ["Figma\nPro"] }],
    });
    expect(pdf.personalInfo.fullName).toBe("Zoë Núñez");
    expect(pdf.skills[0]?.items).toEqual(["Figma Pro"]);
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
      personalInfo: { ...SAMPLE.personalInfo, fullName: "Dvořák" },
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

describe("registerCvPrintText", () => {
  it("is required before a render, so no text reaches the fallback font", async () => {
    // A fresh copy of the module, which no app has set up.
    const path = new URL("../src/pdf/print.ts", import.meta.url).pathname;
    const fresh = (await import(
      `${path}?unregistered`
    )) as typeof import("../src/pdf/print");
    expect(() => fresh.toPdfText(SAMPLE)).toThrow("registerCvPrintText");
    expect(() => fresh.getTextLines("One")).toThrow("registerCvPrintText");
  });
});
