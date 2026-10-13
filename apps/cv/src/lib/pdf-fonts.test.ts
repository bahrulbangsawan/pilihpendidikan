import { CV_STYLES } from "@pilihpendidikan/cv-engine/document";
import type { CvPdfFontStore } from "@pilihpendidikan/cv-engine/pdf";
import { getTextLines, toPdfText } from "@pilihpendidikan/cv-engine/pdf";
import type { CVData } from "@pilihpendidikan/cv-engine/types";
import { describe, expect, it } from "vitest";
import sample from "@/data/sample-cv.json";
import { registerCvPrint } from "./pdf-fonts";

const SAMPLE = sample as CVData;

function fakeFontStore() {
  const families: { family: string; weights: number[] }[] = [];
  let hyphenation: ((word: string) => string[]) | null = null;
  return {
    families,
    hyphenate: (word: string) => hyphenation?.(word),
    store: {
      register(options: {
        family: string;
        fonts: { src: string; fontWeight: number }[];
      }) {
        families.push({
          family: options.family,
          weights: options.fonts.map((font) => font.fontWeight),
        });
      },
      getFont: () => null,
      registerHyphenationCallback(callback: (word: string) => string[]) {
        hyphenation = callback;
      },
    },
  };
}

describe("registerCvPrint", () => {
  it("registers the Inter print cuts and the line-break policy once", () => {
    const fonts = fakeFontStore();
    const store = fonts.store as unknown as CvPdfFontStore;
    registerCvPrint(store);
    registerCvPrint(store);
    expect(fonts.families).toEqual([
      { family: "Inter", weights: [400, 600, 700] },
    ]);
    expect(fonts.hyphenate("full-stack")).toEqual(["full-", "", "stack"]);
  });

  it("hands cv-engine the shared text normaliser", () => {
    registerCvPrint(fakeFontStore().store as unknown as CvPdfFontStore);
    const pdf = toPdfText({
      ...SAMPLE,
      personalInfo: { ...SAMPLE.personalInfo, fullName: " Zoë\tNúñez → " },
    });
    expect(pdf.personalInfo.fullName).toBe("Zoë Núñez ->");
    expect(getTextLines("One\n\nTwo").map((line) => line.text)).toEqual([
      "One",
      " ",
      "Two",
    ]);
  });
});

describe("the CV templates", () => {
  const previews = import.meta.glob("../components/templates/*-preview.tsx");
  const pdfs = import.meta.glob(
    "../../../../packages/cv-engine/src/pdf/*-pdf.tsx"
  );

  it("pair an HTML preview here with a PDF template in cv-engine", () => {
    const names = (paths: string[], suffix: string) =>
      paths.map((path) => path.split("/").at(-1)?.replace(suffix, "")).sort();
    expect(names(Object.keys(previews), "-preview.tsx")).toEqual(
      [...CV_STYLES].sort()
    );
    expect(names(Object.keys(pdfs), "-pdf.tsx")).toEqual([...CV_STYLES].sort());
  });
});
